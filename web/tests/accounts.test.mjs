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
 const login=async username=>{const result=await call('/api/login',{method:'POST',body:{username,password}});assert.equal(result.status,200);return {cookie:result.response.headers.get('Set-Cookie').split(';')[0],proof:result.value.proof};};
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
test('patients cannot mutate clinical state, view inventory or assign record links by direct API calls',async()=>{
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
  assert.equal((await f.call('/api/workspace',{method:'PUT',session:staff,body:{...input,baseRevision:initial.value.revision,operationId:crypto.randomUUID()}})).status,200);
  assert.equal((await f.db.prepare('SELECT COUNT(*) AS n FROM patient_links').first()).n,0);
 }finally{f.db.close();}
});
test('cookies alone do not unlock records; logout revokes the request proof',async()=>{
 const f=await fixture();try{const session=await f.login('worker.one');assert.equal((await f.call('/api/workspace',{headers:{Cookie:session.cookie}})).status,401);assert.equal((await f.call('/api/workspace',{session:{...session,proof:'0'.repeat(64)}})).status,401);assert.equal((await f.call('/api/logout',{method:'POST',session,body:{}})).status,200);assert.equal((await f.call('/api/workspace',{session})).status,401);}finally{f.db.close();}
});
test('cross-origin mutations, expired sessions and missing database configuration fail safely',async()=>{
 const f=await fixture();try{const session=await f.login('worker.one');assert.equal((await f.call('/api/workspace',{method:'PUT',session,headers:{Origin:'https://other.test'},body:{}})).status,403);await f.db.prepare('UPDATE sessions SET expires_at=0').run();assert.equal((await f.call('/api/workspace',{session})).status,401);const missing=await worker.fetch(new Request(origin+'/api/status'),{});assert.equal(missing.status,503);}finally{f.db.close();}
});
