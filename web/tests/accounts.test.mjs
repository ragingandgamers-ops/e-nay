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
  const registered=await f.call('/api/register',{method:'POST',body:{username:'new.patient',password,displayName:'Test Patient',kind:'mother',age:29,edd:today()}});assert.equal(registered.status,201);
  const row=await f.db.prepare('SELECT * FROM accounts WHERE username=?').bind('new.patient').first();assert.equal(row.role,'patient');assert.match(row.password_hash,/^scrypt\$/);assert.ok(!JSON.stringify(registered.value).includes(row.password_hash));
  assert.equal((await f.call('/api/register',{method:'POST',body:{username:'new.patient',password,displayName:'Duplicate',kind:'father'}})).status,409);
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
test('patients can select only authorized maternal profiles and selecting a relationship never grants access',async()=>{
 const f=await fixture();try{
  const staff=await f.login('worker.one'),patient=await f.login('patient.one'),other=await f.login('patient.two');await f.call('/api/workspace',{method:'PUT',session:staff,body:{baseRevision:'initial',operationId:crypto.randomUUID(),data:clinicData()}});await f.call('/api/links',{method:'PUT',session:staff,body:{accountId:'patient-id',patientIds:['M001']}});
  const child={id:'C002',name:'Family Child',gender:'Female',dob:today(),motherId:'M001',motherName:'Forged text',status:'Active'};
  const saved=await records(f,patient,[newOp('children',child)]);assert.equal(saved.status,200);assert.equal(saved.value.data.children[0].motherId,'M001');assert.equal(saved.value.data.children[0].motherName,'First Test Mother');
  assert.equal((await records(f,patient,[newOp('children',{...child,id:'C003',motherId:'M002'})])).status,403);assert.equal((await f.call('/api/workspace',{session:other})).value.data.children.length,0);
  await f.call('/api/links',{method:'PUT',session:staff,body:{accountId:'patient-id',patientIds:[saved.value.data.children[0].id]}});
  const partial=(await f.call('/api/workspace',{session:patient})).value.data;assert.equal(partial.mothers.length,0);assert.equal(partial.children[0].motherId,'M001');const updated=await records(f,patient,[editOp('children',partial.children[0],{contact:'09123456789'})]);assert.equal(updated.status,200);assert.equal(updated.value.data.mothers.length,0);assert.equal(updated.value.data.children[0].motherId,'M001');
 }finally{f.db.close();}
});
test('offline family batches remap the selected maternal ID along with new child IDs',async()=>{
 const f=await fixture();try{
  const staff=await f.login('worker.one'),patient=await f.login('patient.one');await f.call('/api/workspace',{method:'PUT',session:staff,body:{baseRevision:'initial',operationId:crypto.randomUUID(),data:clinicData()}});
  const saved=await records(f,patient,[newOp('mothers',mother('M001','Offline Mother')),newOp('children',{id:'C001',name:'Offline Child',gender:'Male',dob:today(),motherId:'M001',motherName:'Offline Mother',status:'Active'})]);assert.equal(saved.status,200);assert.equal(saved.value.idMap.M001,'M003');assert.equal(saved.value.data.children[0].motherId,'M003');assert.equal(saved.value.data.children[0].motherName,'Offline Mother');
  const current=(await f.call('/api/workspace',{session:staff})).value;const legacy=structuredClone(current.data);delete legacy.children.find(r=>r.name==='Offline Child').motherId;assert.equal((await f.call('/api/workspace',{method:'PUT',session:staff,body:{baseRevision:current.revision,operationId:crypto.randomUUID(),data:legacy}})).status,200);assert.equal((await f.call('/api/workspace',{session:staff})).value.data.children.find(r=>r.name==='Offline Child').motherId,'M003');
 }finally{f.db.close();}
});
test('only staff publish clinic guides; every patient sees published articles without private drafts',async()=>{
 const f=await fixture();try{
  const staff=await f.login('worker.one'),patient=await f.login('patient.one'),other=await f.login('patient.two');
  const record={id:crypto.randomUUID(),title:'Local clinic hours',category:'Clinic information',content:'Fictional local instructions.\n\nBring your clinic card.',status:'Draft'};
  assert.equal((await records(f,patient,[newOp('guides',record)])).status,403);
  const draft=await records(f,staff,[newOp('guides',record)]);assert.equal(draft.status,200);assert.equal(draft.value.data.guides[0].updatedOn,today());
  assert.deepEqual((await f.call('/api/workspace',{session:patient})).value.data.guides,[]);
  const published=await records(f,staff,[editOp('guides',draft.value.data.guides[0],{status:'Published'})]);assert.equal(published.status,200);
  for(const session of [patient,other]){const shared=(await f.call('/api/workspace',{session})).value.data;assert.equal(shared.guides[0].title,record.title);assert.equal(shared.mothers.length,0);assert.equal((await records(f,session,[editOp('guides',shared.guides[0],{content:'Forged clinic advice'})])).status,403);}
  const archived=await records(f,staff,[editOp('guides',published.value.data.guides[0],{status:'Archived'})]);assert.equal(archived.status,200);assert.equal((await f.call('/api/workspace',{session:patient})).value.data.guides.length,0);assert.equal(archived.value.data.guides.length,1);
 }finally{f.db.close();}
});
test('old snapshot clients preserve clinic articles and stale guide edits cannot overwrite newer staff changes',async()=>{
 const f=await fixture();try{
  const staff=await f.login('worker.one'),record={id:crypto.randomUUID(),title:'Clinic update',category:'Clinic information',content:'Original instructions',status:'Published'};
  const created=await records(f,staff,[newOp('guides',record)]);assert.equal(created.status,200);const original=created.value.data.guides[0];
  const changed=await records(f,staff,[editOp('guides',original,{content:'Updated instructions'})]);assert.equal(changed.status,200);
  assert.equal((await records(f,staff,[editOp('guides',original,{content:'Stale instructions'})])).status,409);
  const legacy=emptyData();delete legacy.guides;const saved=await f.call('/api/workspace',{method:'PUT',session:staff,body:{baseRevision:changed.value.revision,operationId:crypto.randomUUID(),data:legacy,resetPatientLinks:true}});assert.equal(saved.status,200);assert.equal((await f.call('/api/workspace',{session:staff})).value.data.guides[0].content,'Updated instructions');
 }finally{f.db.close();}
});
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
test('staff approval reserves once; administration does not double-deduct; allocation corrections are atomic',async()=>{
 const f=await fixture();try{const staff=await f.login('worker.one');await f.call('/api/workspace',{method:'PUT',session:staff,body:{baseRevision:'initial',operationId:crypto.randomUUID(),data:clinicData()}});const vaccine={id:crypto.randomUUID(),patient:'C001',vaccine:'Test vaccine',dose:'Dose 1',scheduled:today(),administered:'',stockMode:'clinic',batchId:'batch-one'};const scheduled=await records(f,staff,[newOp('vaccines',vaccine)]);assert.equal(scheduled.status,200);assert.equal(scheduled.value.data.inventory[0].stock,9);assert.equal(scheduled.value.data.vaccines.at(-1).stockUse.kind,'reserved');let record=scheduled.value.data.vaccines.at(-1);const receipt=crypto.randomUUID(),op=editOp('vaccines',record,{administered:today(),stockMode:'clinic'});const given=await records(f,staff,[op],receipt);assert.equal(given.status,200);assert.equal(given.value.data.inventory[0].stock,9);assert.equal((await records(f,staff,[op],receipt)).value.data.inventory[0].stock,9);record=given.value.data.vaccines.at(-1);const note=await records(f,staff,[editOp('vaccines',record,{notes:'Correct dose',stockMode:'clinic'})]);assert.equal(note.value.data.inventory[0].stock,9);record=note.value.data.vaccines.at(-1);const corrected=await records(f,staff,[editOp('vaccines',record,{stockMode:'external'})]);assert.equal(corrected.status,200);assert.equal(corrected.value.data.inventory[0].stock,10);assert.equal(corrected.value.data.vaccines.at(-1).stockUse,undefined);}finally{f.db.close();}
});
test('patients cannot edit approved vaccination records or protected clinic stock allocations',async()=>{
 const f=await fixture();try{const staff=await f.login('worker.one'),patient=await f.login('patient.one');await f.call('/api/workspace',{method:'PUT',session:staff,body:{baseRevision:'initial',operationId:crypto.randomUUID(),data:clinicData()}});await f.call('/api/links',{method:'PUT',session:staff,body:{accountId:'patient-id',patientIds:['C001']}});const given=await records(f,staff,[newOp('vaccines',{id:crypto.randomUUID(),patient:'C001',vaccine:'Test vaccine',dose:'Dose 1',scheduled:today(),administered:today(),stockMode:'clinic',batchId:'batch-one'})]);const before=given.value.data.vaccines.at(-1);const changed=await records(f,patient,[editOp('vaccines',before,{administered:'',batchId:'fake',stockUse:null,stockMode:'external',notes:'Patient correction requested'})]);assert.equal(changed.status,403);const unchanged=(await f.call('/api/workspace',{session:patient})).value.data.vaccines[0];assert.deepEqual(unchanged.stockUse,before.stockUse);assert.equal(unchanged.updatedByRole,'staff');assert.equal((await f.call('/api/inventory',{session:staff})).value.inventory[0].stock,9);}finally{f.db.close();}
});
test('last-dose concurrency, expired batches and invalid multi-record submissions never produce negative or partial stock',async()=>{
 const f=await fixture();try{const staff=await f.login('worker.one'),seed=clinicData();seed.inventory[0].stock=1;await f.call('/api/workspace',{method:'PUT',session:staff,body:{baseRevision:'initial',operationId:crypto.randomUUID(),data:seed}});const dose=()=>newOp('vaccines',{id:crypto.randomUUID(),patient:'C001',vaccine:'Test vaccine',dose:'Dose 1',scheduled:today(),administered:today(),stockMode:'clinic',batchId:'batch-one'});const outcomes=await Promise.all([records(f,staff,[dose()]),records(f,staff,[dose()])]);assert.deepEqual(outcomes.map(r=>r.status).sort(),[200,400]);let clinic=(await f.call('/api/workspace',{session:staff})).value.data;assert.equal(clinic.inventory[0].stock,0);assert.equal(clinic.vaccines.filter(r=>r.stockUse).length,1);const invalid=await records(f,staff,[newOp('mothers',mother('M003')),dose()]);assert.equal(invalid.status,400);assert.equal((await f.call('/api/workspace',{session:staff})).value.data.mothers.length,2);
  const expired={...clinic.inventory[0],stock:2,expires:'2000-01-01'};assert.equal((await records(f,staff,[editOp('inventory',clinic.inventory[0],expired)])).status,200);assert.equal((await records(f,staff,[dose()])).status,400);assert.equal((await f.call('/api/inventory',{session:staff})).value.inventory[0].stock,2);
 }finally{f.db.close();}
});

async function vaccinationFixture(){const f=await fixture();f.staff=await f.login('worker.one');f.patient=await f.login('patient.one');await f.call('/api/workspace',{method:'PUT',session:f.staff,body:{baseRevision:'initial',operationId:crypto.randomUUID(),data:clinicData()}});await f.call('/api/links',{method:'PUT',session:f.staff,body:{accountId:'patient-id',patientIds:['C001']}});return f;}
const requestDose=()=>newOp('vaccines',{id:crypto.randomUUID(),patient:'C001',vaccine:'Test vaccine',preferredDate:today(),requestNotes:'Please arrange a clinic vaccination.'});
test('patient requests stay unapproved despite forged approval, schedule, administration and stock fields',async()=>{
 const f=await vaccinationFixture();try{const op=requestDose();Object.assign(op.record,{approvalStatus:'Approved',scheduled:today(),administered:today(),batchId:'batch-one',stockUse:{batchId:'batch-one',date:today(),kind:'administered'},reviewNotes:'Fake staff verification'});const result=await records(f,f.patient,[op]);assert.equal(result.status,200);const request=result.value.data.vaccines[0];assert.equal(request.approvalStatus,'Pending verification');assert.equal(request.administered,'');assert.equal(request.scheduled,'');assert.equal(request.reviewNotes,'');assert.equal(request.stockUse,undefined);assert.equal((await f.call('/api/inventory',{session:f.staff})).value.inventory[0].stock,10);assert.equal((await f.call('/api/workspace',{session:f.staff})).value.data.vaccines.at(-1).id,request.id);assert.equal((await records(f,f.patient,[requestDose()])).status,400);}finally{f.db.close();}
});
test('staff approves a patient request, reserves one batch dose and records administration without a second deduction',async()=>{
 const f=await vaccinationFixture();try{const pending=(await records(f,f.patient,[requestDose()])).value.data.vaccines[0],id=crypto.randomUUID(),op=editOp('vaccines',pending,{approvalStatus:'Approved',stockMode:'clinic',batchId:'batch-one',dose:'Dose 1',scheduled:today()});const approved=await records(f,f.staff,[op],id);assert.equal(approved.status,200);const appointment=approved.value.data.vaccines.at(-1);assert.equal(appointment.approvalStatus,'Approved');assert.equal(appointment.stockUse.kind,'reserved');assert.equal(approved.value.data.inventory[0].stock,9);assert.equal((await records(f,f.staff,[op],id)).value.data.inventory[0].stock,9);assert.equal((await f.call('/api/workspace',{session:f.patient})).value.data.vaccines[0].approvalStatus,'Approved');assert.equal((await records(f,f.patient,[editOp('vaccines',appointment,{approvalStatus:'Cancelled'})])).status,403);const administered=await records(f,f.staff,[editOp('vaccines',appointment,{administered:today()})]);assert.equal(administered.status,200);assert.equal(administered.value.data.inventory[0].stock,9);assert.equal(administered.value.data.vaccines.at(-1).stockUse.kind,'administered');assert.equal((await records(f,f.staff,[editOp('vaccines',administered.value.data.vaccines.at(-1),{approvalStatus:'Cancelled'})])).status,400);}finally{f.db.close();}
});
test('pending requests can be edited or withdrawn by their family; another family cannot access them',async()=>{
 const f=await vaccinationFixture();try{let request=(await records(f,f.patient,[requestDose()])).value.data.vaccines[0];const other=await f.login('patient.two');assert.equal((await records(f,other,[editOp('vaccines',request,{requestNotes:'Foreign overwrite'})])).status,403);const edited=await records(f,f.patient,[editOp('vaccines',request,{requestNotes:'Updated request message'})]);assert.equal(edited.status,200);request=edited.value.data.vaccines[0];assert.equal(request.requestNotes,'Updated request message');const withdrawn=await records(f,f.patient,[editOp('vaccines',request,{approvalStatus:'Cancelled'})]);assert.equal(withdrawn.status,200);assert.equal(withdrawn.value.data.vaccines[0].approvalStatus,'Cancelled');assert.equal((await f.call('/api/inventory',{session:f.staff})).value.inventory[0].stock,10);}finally{f.db.close();}
});
test('declined requests include a staff reason and never reserve stock; cancellation returns an unused reservation',async()=>{
 const f=await vaccinationFixture();try{const pending=(await records(f,f.patient,[requestDose()])).value.data.vaccines[0];assert.equal((await records(f,f.staff,[editOp('vaccines',pending,{approvalStatus:'Rejected'})])).status,400);const declined=await records(f,f.staff,[editOp('vaccines',pending,{approvalStatus:'Rejected',reviewNotes:'Please contact the clinic to discuss the requested vaccine.'})]);assert.equal(declined.status,200);assert.equal(declined.value.data.inventory[0].stock,10);assert.equal((await f.call('/api/workspace',{session:f.patient})).value.data.vaccines[0].reviewNotes,'Please contact the clinic to discuss the requested vaccine.');const another=(await records(f,f.patient,[requestDose()])).value.data.vaccines.at(-1);const approved=await records(f,f.staff,[editOp('vaccines',another,{approvalStatus:'Approved',stockMode:'clinic',batchId:'batch-one',scheduled:today(),dose:'Dose 1'})]);assert.equal(approved.value.data.inventory[0].stock,9);const cancelled=await records(f,f.staff,[editOp('vaccines',approved.value.data.vaccines.at(-1),{approvalStatus:'Cancelled',reviewNotes:'Appointment cancelled with the family.'})]);assert.equal(cancelled.status,200);assert.equal(cancelled.value.data.inventory[0].stock,10);assert.equal(cancelled.value.data.vaccines.at(-1).stockUse,undefined);}finally{f.db.close();}
});
test('approval requires a real available clinic batch and two approvals cannot reserve the same final dose',async()=>{
 const f=await vaccinationFixture();try{const pending=(await records(f,f.patient,[requestDose()])).value.data.vaccines[0];const approve=changes=>editOp('vaccines',pending,{approvalStatus:'Approved',scheduled:today(),dose:'Dose 1',...changes});assert.equal((await records(f,f.staff,[approve({stockMode:'external'})])).status,400);assert.equal((await records(f,f.staff,[approve({stockMode:'clinic',batchId:'batch-one',vaccine:'Different vaccine'})])).status,400);assert.equal((await records(f,f.staff,[approve({stockMode:'clinic',batchId:'missing'})])).status,400);let clinic=(await f.call('/api/workspace',{session:f.staff})).value.data;await records(f,f.staff,[editOp('inventory',clinic.inventory[0],{stock:1})]);const otherPending=(await records(f,f.staff,[newOp('vaccines',{id:crypto.randomUUID(),patient:'M001',vaccine:'Test vaccine',dose:'Dose 1',approvalStatus:'Pending verification'})])).value.data.vaccines.at(-1);const results=await Promise.all([records(f,f.staff,[approve({stockMode:'clinic',batchId:'batch-one'})]),records(f,f.staff,[editOp('vaccines',otherPending,{approvalStatus:'Approved',stockMode:'clinic',batchId:'batch-one',scheduled:today(),dose:'Dose 1'})])]);assert.deepEqual(results.map(r=>r.status).sort(),[200,400]);clinic=(await f.call('/api/workspace',{session:f.staff})).value.data;assert.equal(clinic.inventory[0].stock,0);assert.equal(clinic.vaccines.filter(r=>r.stockUse?.kind==='reserved').length,1);assert.equal(clinic.vaccines.filter(r=>r.approvalStatus==='Pending verification').length,1);}finally{f.db.close();}
});

test('older staff snapshots preserve reservations and cannot persist incompatible pending-request administration',async()=>{
 const f=await vaccinationFixture();try{
  let approved=await records(f,f.staff,[newOp('vaccines',{id:crypto.randomUUID(),patient:'C001',vaccine:'Test vaccine',dose:'Dose 1',scheduled:today(),stockMode:'clinic',batchId:'batch-one'})]);let legacy=structuredClone(approved.value.data);for(const item of legacy.vaccines){for(const key of ['approvalStatus','preferredDate','requestNotes','reviewNotes'])delete item[key];if(item.stockUse)delete item.stockUse.kind;}
  const saved=await f.call('/api/workspace',{method:'PUT',session:f.staff,body:{baseRevision:approved.value.revision,operationId:crypto.randomUUID(),data:legacy}});assert.equal(saved.status,200);let clinic=(await f.call('/api/workspace',{session:f.staff})).value;assert.equal(clinic.data.vaccines.at(-1).stockUse.kind,'reserved');assert.equal(clinic.data.inventory[0].stock,9);assert.equal(clinic.data.vaccines.at(-1).approvalStatus,'Approved');
  const pendingOp=requestDose();pendingOp.record.vaccine='Another requested vaccine';assert.equal((await records(f,f.patient,[pendingOp])).status,200);clinic=(await f.call('/api/workspace',{session:f.staff})).value;legacy=structuredClone(clinic.data);const request=legacy.vaccines.at(-1);for(const key of ['approvalStatus','preferredDate','requestNotes','reviewNotes'])delete request[key];request.scheduled=today();request.administered=today();request.dose='Dose 1';
  const invalid=await f.call('/api/workspace',{method:'PUT',session:f.staff,body:{baseRevision:clinic.revision,operationId:crypto.randomUUID(),data:legacy}});assert.equal(invalid.status,400);const intact=(await f.call('/api/workspace',{session:f.staff})).value;assert.equal(intact.revision,clinic.revision);assert.equal(intact.data.vaccines.at(-1).approvalStatus,'Pending verification');assert.equal(intact.data.vaccines.at(-1).administered,'');
 }finally{f.db.close();}
});

test('staff can verify an inventory name against a differently worded request without losing the original or double-deducting',async()=>{const f=await fixture();try{
 const staff=await f.login('worker.one'),patient=await f.login('patient.one');await f.call('/api/workspace',{method:'PUT',session:staff,body:{baseRevision:'initial',operationId:crypto.randomUUID(),data:clinicData()}});await f.call('/api/links',{method:'PUT',session:staff,body:{accountId:'patient-id',patientIds:['C001']}});
 const request=await records(f,patient,[newOp('vaccines',{id:crypto.randomUUID(),patient:'C001',vaccine:'Patient wording',preferredDate:today(),requestedVaccine:'Forged original'})]);assert.equal(request.status,200);const before=request.value.data.vaccines.find(v=>v.approvalStatus==='Pending verification');assert.equal(before.requestedVaccine,'Patient wording');
 const changes={approvalStatus:'Approved',vaccine:'Test vaccine',batchId:'batch-one',dose:'Dose 1',scheduled:today()};assert.equal((await records(f,staff,[editOp('vaccines',before,changes)])).status,400);assert.equal((await f.call('/api/workspace',{session:staff})).value.data.inventory[0].stock,10);
 const approved=await records(f,staff,[editOp('vaccines',before,{...changes,confirmVaccineChange:true})]);assert.equal(approved.status,200);const saved=approved.value.data.vaccines.find(v=>v.id===before.id);assert.equal(saved.requestedVaccine,'Patient wording');assert.equal(saved.vaccine,'Test vaccine');assert.equal(approved.value.data.inventory[0].stock,9);
 const complete=await records(f,staff,[editOp('vaccines',saved,{administered:today(),requestedVaccine:'Forged change'})]);assert.equal(complete.status,200);assert.equal(complete.value.data.vaccines.find(v=>v.id===before.id).requestedVaccine,'Patient wording');assert.equal(complete.value.data.inventory[0].stock,9);
}finally{f.db.close();}});
