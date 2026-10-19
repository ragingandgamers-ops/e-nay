import test from 'node:test';
import assert from 'node:assert/strict';
import worker,{passwordHash} from '../server/worker.mjs';
import {localDatabase} from '../server/local-db.mjs';
import {SCHEMA} from '../server/schema.mjs';
import {emptyData,today} from '../dist/core.mjs';
const origin='https://enay.test';
const password='Fictional-test-password-2026!';
const encoded=await passwordHash(password);
async function fixture(){
 const db=localDatabase();await db.exec(SCHEMA);
 for(const [id,username,role]of [['staff-id','worker.one','staff'],['patient-id','patient.one','patient'],['other-id','patient.two','patient']])await db.prepare('INSERT INTO accounts(id,username,display_name,password_hash,role,created_at) VALUES(?,?,?,?,?,?)').bind(id,username,username,encoded,role,Date.now()).run();
 const env={DB:db,ASSETS:{fetch:async()=>new Response('static page')}};
 const call=async(path,{method='GET',body,session,headers={}}={})=>{
  const response=await worker.fetch(new Request(origin+path,{method,headers:{Origin:origin,...(body!==undefined?{'Content-Type':'application/json'}:{}),...(session?{Cookie:session.cookie,'X-Enay-Access':session.proof}:{}),...headers},...(body!==undefined?{body:JSON.stringify(body)}:{})}),env);
  return {response,status:response.status,value:await response.json()};
 };
 const login=async username=>{const result=await call('/api/login',{method:'POST',body:{username,password}});assert.equal(result.status,200);const sessionRow=await db.prepare('SELECT expires_at FROM sessions WHERE account_id=(SELECT id FROM accounts WHERE username=?) ORDER BY expires_at DESC').bind(username).first();assert.equal(result.value.expiresAt,sessionRow.expires_at);assert.ok(result.value.expiresAt>Date.now()&&result.value.expiresAt<=Date.now()+12*60*60*1000);return {cookie:result.response.headers.get('Set-Cookie').split(';')[0],proof:result.value.proof};};
 return {db,env,call,login};
}
function clinicData(){const data=emptyData();data.mothers=[{id:'M001',name:'First Test Mother',age:25,edd:today(),status:'Active'},{id:'M002',name:'Other Test Mother',age:28,edd:today(),status:'Active'}];data.children=[{id:'C001',name:'Test Child',gender:'Female',dob:today(),motherName:'First Test Mother',status:'Active'}];data.vaccines=[{id:'v-one',patient:'M001',vaccine:'Test vaccine',dose:'Dose 1',scheduled:today(),administered:'',notes:''},{id:'v-two',patient:'M002',vaccine:'Other vaccine',dose:'Dose 1',scheduled:today(),administered:'',notes:''}];data.inventory=[{id:'batch-one',vaccine:'Test vaccine',batch:'TEST-001',stock:10,threshold:5,expires:'2099-01-01'}];return data;}
test('guest requests cannot read clinic records, inventory, accounts or links',async()=>{
 const f=await fixture();try{for(const path of ['/api/workspace','/api/inventory','/api/accounts'])assert.equal((await f.call(path)).status,401);assert.equal((await f.call('/api/links',{method:'PUT',body:{accountId:'patient-id',patientIds:['M001']}})).status,401);}finally{f.db.close();}
});
test('public registration creates only patient accounts and does not expose password hashes',async()=>{
 const f=await fixture();try{
  assert.equal((await f.call('/api/register',{method:'POST',body:{username:'new.patient',password,displayName:'Test Patient',role:'staff'}})).status,403);
  const registered=await f.call('/api/register',{method:'POST',body:{username:'new.patient',password,displayName:'Test Patient'}});assert.equal(registered.status,201);
  const row=await f.db.prepare('SELECT * FROM accounts WHERE username=?').bind('new.patient').first();assert.equal(row.role,'patient');assert.match(row.password_hash,/^scrypt\$/);assert.ok(!JSON.stringify(registered.value).includes(row.password_hash));
  assert.equal((await f.call('/api/register',{method:'POST',body:{username:'new.patient',password,displayName:'Duplicate'}})).status,409);
 }finally{f.db.close();}
});
test('patient reads contain only staff-linked profiles and never clinic inventory',async()=>{
 const f=await fixture();try{
  const staff=await f.login('worker.one');const saved=await f.call('/api/workspace',{method:'PUT',session:staff,body:{baseRevision:'initial',operationId:crypto.randomUUID(),data:clinicData()}});assert.equal(saved.status,200);
  assert.equal((await f.call('/api/links',{method:'PUT',session:staff,body:{accountId:'patient-id',patientIds:['M001','C001']}})).status,200);
  const patient=await f.login('patient.one');const result=await f.call('/api/workspace?role=staff&patient=M002',{session:patient});assert.equal(result.status,200);assert.deepEqual(result.value.data.mothers.map(r=>r.id),['M001']);assert.deepEqual(result.value.data.children.map(r=>r.id),['C001']);assert.deepEqual(result.value.data.vaccines.map(r=>r.id),['v-one']);assert.deepEqual(result.value.data.inventory,[]);
  const other=await f.login('patient.two');assert.deepEqual((await f.call('/api/workspace',{session:other})).value.data,emptyData());
 }finally{f.db.close();}
});
test('patients cannot replace the clinic snapshot, view inventory or assign record links',async()=>{
 const f=await fixture();try{const patient=await f.login('patient.one');for(const path of ['/api/inventory','/api/accounts'])assert.equal((await f.call(path,{session:patient})).status,403);assert.equal((await f.call('/api/workspace',{method:'PUT',session:patient,body:{role:'staff',baseRevision:'initial',operationId:crypto.randomUUID(),data:clinicData()}})).status,403);assert.equal((await f.call('/api/links',{method:'PUT',session:patient,body:{accountId:'patient-id',patientIds:['M002']}})).status,403);assert.equal((await f.db.prepare("SELECT revision FROM workspace WHERE id='clinic'").first()).revision,'initial');}finally{f.db.close();}
});
test('staff synchronization is atomic, rejects stale devices and handles a retried operation idempotently',async()=>{
 const f=await fixture();try{
  const staff=await f.login('worker.one'),id=crypto.randomUUID();const input={baseRevision:'initial',operationId:id,data:clinicData()};const first=await f.call('/api/workspace',{method:'PUT',session:staff,body:input});assert.equal(first.status,200);
  const retry=await f.call('/api/workspace',{method:'PUT',session:staff,body:input});assert.equal(retry.status,200);assert.equal(retry.value.revision,first.value.revision);
  const stale=await f.call('/api/workspace',{method:'PUT',session:staff,body:{...input,operationId:crypto.randomUUID(),data:emptyData()}});assert.equal(stale.status,409);assert.equal((await f.call('/api/workspace',{session:staff})).value.data.mothers.length,2);
  const invalid=await f.call('/api/workspace',{method:'PUT',session:staff,body:{baseRevision:first.value.revision,operationId:crypto.randomUUID(),data:{mothers:[]}}});assert.equal(invalid.status,400);assert.equal((await f.call('/api/workspace',{session:staff})).value.revision,first.value.revision);
 }finally{f.db.close();}
});
test('invalid link replacement preserves existing patient access',async()=>{
 const f=await fixture();try{const staff=await f.login('worker.one');await f.call('/api/workspace',{method:'PUT',session:staff,body:{baseRevision:'initial',operationId:crypto.randomUUID(),data:clinicData()}});await f.call('/api/links',{method:'PUT',session:staff,body:{accountId:'patient-id',patientIds:['M001']}});assert.equal((await f.call('/api/links',{method:'PUT',session:staff,body:{accountId:'patient-id',patientIds:['M999']}})).status,400);assert.deepEqual((await f.db.prepare('SELECT patient_id FROM patient_links WHERE account_id=?').bind('patient-id').all()).results.map(x=>x.patient_id),['M001']);}finally{f.db.close();}
});
test('a staff-role revocation is enforced on the server during an existing session',async()=>{
 const f=await fixture();try{const staff=await f.login('worker.one');await f.db.prepare("UPDATE accounts SET role='patient' WHERE id='staff-id'").run();assert.equal((await f.call('/api/inventory',{session:staff})).status,403);assert.equal((await f.call('/api/workspace',{method:'PUT',session:staff,body:{baseRevision:'initial',operationId:crypto.randomUUID(),data:clinicData()}})).status,403);}finally{f.db.close();}
});
test('reviewed import clears patient links atomically; stale imports preserve them',async()=>{
 const f=await fixture();try{
  const staff=await f.login('worker.one'),initial=await f.call('/api/workspace',{method:'PUT',session:staff,body:{baseRevision:'initial',operationId:crypto.randomUUID(),data:clinicData()}});
  await f.call('/api/links',{method:'PUT',session:staff,body:{accountId:'patient-id',patientIds:['M001']}});
  const input={baseRevision:'initial',operationId:crypto.randomUUID(),data:clinicData(),resetPatientLinks:true};assert.equal((await f.call('/api/workspace',{method:'PUT',session:staff,body:input})).status,409);
  assert.equal((await f.db.prepare('SELECT COUNT(*) AS n FROM patient_links').first()).n,1);
  assert.equal((await f.call('/api/workspace',{method:'PUT',session:staff,body:{...input,baseRevision:(await f.call('/api/workspace',{session:staff})).value.revision,operationId:crypto.randomUUID()}})).status,200);
  assert.equal((await f.db.prepare('SELECT COUNT(*) AS n FROM patient_links').first()).n,0);
 }finally{f.db.close();}
});
test('cookies alone do not unlock records; logout revokes the request proof',async()=>{
 const f=await fixture();try{const session=await f.login('worker.one');assert.equal((await f.call('/api/workspace',{headers:{Cookie:session.cookie}})).status,401);assert.equal((await f.call('/api/workspace',{session:{...session,proof:'0'.repeat(64)}})).status,401);assert.equal((await f.call('/api/logout',{method:'POST',session,body:{}})).status,200);assert.equal((await f.call('/api/workspace',{session})).status,401);}finally{f.db.close();}
});
test('cross-origin mutations, expired sessions and missing database configuration fail safely',async()=>{
 const f=await fixture();try{const session=await f.login('worker.one');assert.equal((await f.call('/api/workspace',{method:'PUT',session,headers:{Origin:'https://other.test'},body:{}})).status,403);await f.db.prepare('UPDATE sessions SET expires_at=0').run();assert.equal((await f.call('/api/workspace',{session})).status,401);const missing=await worker.fetch(new Request(origin+'/api/status'),{});assert.equal(missing.status,503);}finally{f.db.close();}
});

const newOp=(type,record)=>({type,record,originalId:null});
const editOp=(type,before,changes)=>({type,record:{...before,...changes},originalId:before.id,before});
const mother=(id,name='Patient Mother')=>({id,name,age:29,edd:today(),status:'Active'});
async function records(f,session,operations,operationId=crypto.randomUUID()){return f.call('/api/records',{method:'POST',session,body:{operationId,operations}});}
test('patients create globally unique profiles, auto-link them, and staff see every family',async()=>{
 const f=await fixture();try{
  const staff=await f.login('worker.one'),patient=await f.login('patient.one'),other=await f.login('patient.two');
  await f.call('/api/workspace',{method:'PUT',session:staff,body:{baseRevision:'initial',operationId:crypto.randomUUID(),data:clinicData()}});
  const first=await records(f,patient,[newOp('mothers',{...mother('M001'),updatedByRole:'staff'})]);assert.equal(first.status,200);assert.equal(first.value.idMap.M001,'M003');assert.deepEqual(first.value.data.mothers.map(r=>r.id),['M003']);assert.equal(first.value.data.mothers[0].updatedByRole,'patient');assert.deepEqual(first.value.data.inventory,[]);assert.deepEqual(first.value.catalog,['Test vaccine']);
  const second=await records(f,other,[newOp('mothers',mother('M001','Another Mother'))]);assert.equal(second.status,200);assert.equal(second.value.idMap.M001,'M004');
  const clinic=(await f.call('/api/workspace',{session:staff})).value.data;assert.equal(clinic.mothers.length,4);assert.equal(clinic.mothers[0].name,'First Test Mother');
  assert.deepEqual((await f.call('/api/workspace',{session:patient})).value.data.mothers.map(r=>r.id),['M003']);
 }finally{f.db.close();}
});
test('patient ownership is enforced for profiles, notes, growth and vaccinations; stock and links remain staff-only',async()=>{
 const f=await fixture();try{
  const staff=await f.login('worker.one'),patient=await f.login('patient.one');await f.call('/api/workspace',{method:'PUT',session:staff,body:{baseRevision:'initial',operationId:crypto.randomUUID(),data:clinicData()}});await f.call('/api/links',{method:'PUT',session:staff,body:{accountId:'patient-id',patientIds:['M001','C001']}});
  const own=(await f.call('/api/workspace',{session:patient})).value.data,foreign=(await f.call('/api/workspace',{session:staff})).value.data.mothers[1];
  const edit=await records(f,patient,[editOp('mothers',own.mothers[0],{contact:'09123456789'})]);assert.equal(edit.status,200);assert.equal(edit.value.data.mothers[0].contact,'09123456789');
  assert.equal((await records(f,patient,[editOp('mothers',foreign,{name:'Unauthorized Edit'})])).status,403);
  assert.equal((await records(f,patient,[newOp('visits',{id:crypto.randomUUID(),patient:'M002',date:today(),notes:'Foreign note'})])).status,403);
  assert.equal((await records(f,patient,[newOp('inventory',{id:crypto.randomUUID(),vaccine:'Forged',batch:'FORGED',stock:99,threshold:2,expires:'2099-01-01'})])).status,403);
  const care=await records(f,patient,[newOp('visits',{id:crypto.randomUUID(),patient:'M001',date:today(),notes:'My checkup notes'}),newOp('growth',{id:crypto.randomUUID(),patient:'C001',date:today(),weight:4,height:52,assessment:'Not assessed'}),newOp('vaccines',{id:crypto.randomUUID(),patient:'C001',vaccine:'Reported vaccine',dose:'Dose 1',scheduled:today(),administered:today(),stockUse:{batchId:'batch-one',date:today()},batchId:'batch-one',updatedByRole:'staff'})]);assert.equal(care.status,200);assert.equal(care.value.data.visits.length,1);assert.equal(care.value.data.growth.length,1);const reported=care.value.data.vaccines.find(r=>r.patient==='C001');assert.equal(reported.updatedByRole,'patient');assert.equal(reported.stockUse,undefined);assert.equal(reported.batchId,undefined);assert.equal((await f.call('/api/inventory',{session:staff})).value.inventory[0].stock,10);
 }finally{f.db.close();}
});
test('offline dependent operations remap patient profile IDs and a retried receipt never duplicates them',async()=>{
 const f=await fixture();try{const staff=await f.login('worker.one'),patient=await f.login('patient.one');await f.call('/api/workspace',{method:'PUT',session:staff,body:{baseRevision:'initial',operationId:crypto.randomUUID(),data:clinicData()}});const id=crypto.randomUUID(),ops=[newOp('children',{id:'C001',name:'Own Child',gender:'Male',dob:today(),motherName:'Patient Mother',status:'Active'}),newOp('growth',{id:crypto.randomUUID(),patient:'C001',date:today(),weight:4,height:52,assessment:'Not assessed'})];const first=await records(f,patient,ops,id);assert.equal(first.status,200);assert.equal(first.value.idMap.C001,'C002');assert.equal(first.value.data.growth[0].patient,'C002');const retry=await records(f,patient,ops,id);assert.equal(retry.status,200);assert.deepEqual(retry.value.idMap,first.value.idMap);assert.equal(retry.value.data.children.length,1);assert.equal(retry.value.data.growth.length,1);assert.equal((await records(f,staff,ops,id)).status,409);}finally{f.db.close();}
});
test('independent record edits merge while a stale edit of the same record is rejected intact',async()=>{
 const f=await fixture();try{const staff=await f.login('worker.one');await f.call('/api/workspace',{method:'PUT',session:staff,body:{baseRevision:'initial',operationId:crypto.randomUUID(),data:clinicData()}});const old=(await f.call('/api/workspace',{session:staff})).value.data;assert.equal((await records(f,staff,[editOp('mothers',old.mothers[0],{name:'First Changed'})])).status,200);assert.equal((await records(f,staff,[editOp('mothers',old.mothers[1],{name:'Second Changed'})])).status,200);assert.equal((await records(f,staff,[editOp('mothers',old.mothers[0],{name:'Stale Overwrite'})])).status,409);const final=(await f.call('/api/workspace',{session:staff})).value.data;assert.deepEqual(final.mothers.map(r=>r.name),['First Changed','Second Changed']);}finally{f.db.close();}
});
test('scheduling keeps stock; administering consumes once; corrections refund the old allocation atomically',async()=>{
 const f=await fixture();try{const staff=await f.login('worker.one');await f.call('/api/workspace',{method:'PUT',session:staff,body:{baseRevision:'initial',operationId:crypto.randomUUID(),data:clinicData()}});const vaccine={id:crypto.randomUUID(),patient:'C001',vaccine:'Test vaccine',dose:'Dose 1',scheduled:today(),administered:'',stockMode:'clinic',batchId:'batch-one'};const scheduled=await records(f,staff,[newOp('vaccines',vaccine)]);assert.equal(scheduled.status,200);assert.equal(scheduled.value.data.inventory[0].stock,10);let record=scheduled.value.data.vaccines.at(-1);const receipt=crypto.randomUUID(),op=editOp('vaccines',record,{administered:today(),stockMode:'clinic'});const given=await records(f,staff,[op],receipt);assert.equal(given.status,200);assert.equal(given.value.data.inventory[0].stock,9);assert.equal((await records(f,staff,[op],receipt)).value.data.inventory[0].stock,9);record=given.value.data.vaccines.at(-1);const note=await records(f,staff,[editOp('vaccines',record,{notes:'Correct dose',stockMode:'clinic'})]);assert.equal(note.value.data.inventory[0].stock,9);record=note.value.data.vaccines.at(-1);const corrected=await records(f,staff,[editOp('vaccines',record,{stockMode:'external'})]);assert.equal(corrected.status,200);assert.equal(corrected.value.data.inventory[0].stock,10);assert.equal(corrected.value.data.vaccines.at(-1).stockUse,undefined);}finally{f.db.close();}
});
test('patients cannot alter protected clinic stock allocations even when editing their vaccination history',async()=>{
 const f=await fixture();try{const staff=await f.login('worker.one'),patient=await f.login('patient.one');await f.call('/api/workspace',{method:'PUT',session:staff,body:{baseRevision:'initial',operationId:crypto.randomUUID(),data:clinicData()}});await f.call('/api/links',{method:'PUT',session:staff,body:{accountId:'patient-id',patientIds:['C001']}});const given=await records(f,staff,[newOp('vaccines',{id:crypto.randomUUID(),patient:'C001',vaccine:'Test vaccine',dose:'Dose 1',scheduled:today(),administered:today(),stockMode:'clinic',batchId:'batch-one'})]);const before=given.value.data.vaccines.at(-1);const changed=await records(f,patient,[editOp('vaccines',before,{administered:'',batchId:'fake',stockUse:null,stockMode:'external',notes:'Patient correction requested'})]);assert.equal(changed.status,200);assert.deepEqual(changed.value.data.vaccines[0].stockUse,before.stockUse);assert.equal(changed.value.data.vaccines[0].updatedByRole,'patient');assert.equal((await f.call('/api/inventory',{session:staff})).value.inventory[0].stock,9);}finally{f.db.close();}
});
test('last-dose concurrency, expired batches and invalid multi-record submissions never produce negative or partial stock',async()=>{
 const f=await fixture();try{const staff=await f.login('worker.one'),seed=clinicData();seed.inventory[0].stock=1;await f.call('/api/workspace',{method:'PUT',session:staff,body:{baseRevision:'initial',operationId:crypto.randomUUID(),data:seed}});const dose=()=>newOp('vaccines',{id:crypto.randomUUID(),patient:'C001',vaccine:'Test vaccine',dose:'Dose 1',scheduled:today(),administered:today(),stockMode:'clinic',batchId:'batch-one'});const outcomes=await Promise.all([records(f,staff,[dose()]),records(f,staff,[dose()])]);assert.deepEqual(outcomes.map(r=>r.status).sort(),[200,400]);let clinic=(await f.call('/api/workspace',{session:staff})).value.data;assert.equal(clinic.inventory[0].stock,0);assert.equal(clinic.vaccines.filter(r=>r.stockUse).length,1);const invalid=await records(f,staff,[newOp('mothers',mother('M003')),dose()]);assert.equal(invalid.status,400);assert.equal((await f.call('/api/workspace',{session:staff})).value.data.mothers.length,2);
  const expired={...clinic.inventory[0],stock:2,expires:'2000-01-01'};assert.equal((await records(f,staff,[editOp('inventory',clinic.inventory[0],expired)])).status,200);assert.equal((await records(f,staff,[dose()])).status,400);assert.equal((await f.call('/api/inventory',{session:staff})).value.inventory[0].stock,2);
 }finally{f.db.close();}
});
