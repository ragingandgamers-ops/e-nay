import test from 'node:test';
import assert from 'node:assert/strict';
import worker,{passwordHash} from '../server/worker.mjs';
import {localDatabase} from '../server/local-db.mjs';
import {SCHEMA} from '../server/schema.mjs';
const origin='https://enay.test',password='Fictional-original-password!',replacement='Fictional-replacement-password!',encoded=await passwordHash(password),otherHash=await passwordHash(replacement);
async function fixture(){
 const db=localDatabase();await db.exec(SCHEMA);let n=0;
 for(const [id,role]of [['staff','staff'],['second-staff','staff'],['patient','patient'],['other-patient','patient']])await db.prepare('INSERT INTO accounts(id,username,display_name,password_hash,role,created_at) VALUES(?,?,?,?,?,0)').bind(id,id,'Fictional '+id,encoded,role).run();
 const env={DB:db,ASSETS:{fetch:()=>new Response('fixture')}};
 const call=async(path,{method='GET',body,session,headers={}}={})=>{const r=await worker.fetch(new Request(origin+'/api/'+path,{method,headers:{Origin:origin,'CF-Connecting-IP':'192.0.2.'+(++n),...(body?{'Content-Type':'application/json'}:{}),...(session?{Cookie:session.cookie,'X-Enay-Access':session.proof}:{}),...headers},...(body?{body:JSON.stringify(body)}:{})}),env);return {status:r.status,value:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};};
 const login=async(username='staff',value=password)=>{const r=await call('login',{method:'POST',body:{username,password:value}});assert.equal(r.status,200,JSON.stringify(r.value));return {cookie:r.cookie,proof:r.value.proof};};
 const staff=await login();
 const issue=async(accountId='patient',changes={},session=staff)=>call('admin/password-code',{method:'POST',session,body:{accountId,identityConfirmed:true,currentPassword:password,...changes}});
 const reset=async(code,changes={})=>call('password/reset',{method:'POST',body:{username:'patient',code,password:replacement,confirmPassword:replacement,...changes}});
 return {db,call,login,staff,issue,reset};
}
test('recovery requests have identical public responses and only staff can inspect the queue',async()=>{const f=await fixture();try{
 const good=await f.call('password/request',{method:'POST',body:{username:' PATIENT '}}),missing=await f.call('password/request',{method:'POST',body:{username:'missing'}});
 await f.db.prepare("UPDATE accounts SET active=0 WHERE id='other-patient'").run();const inactive=await f.call('password/request',{method:'POST',body:{username:'other-patient'}});
 assert.equal(good.status,202);assert.deepEqual(missing.value,good.value);assert.deepEqual(inactive.value,good.value);
 assert.equal((await f.db.prepare('SELECT count(*) AS n FROM password_recovery_requests').first()).n,1);assert.equal((await f.db.prepare('SELECT count(*) AS n FROM password_recovery_codes').first()).n,0);
 assert.equal((await f.call('admin/accounts')).status,401);assert.equal((await f.call('admin/accounts',{session:await f.login('patient')})).status,403);
 assert.ok((await f.call('admin/accounts',{session:f.staff})).value.accounts.find(a=>a.id==='patient').recoveryRequestedAt);
}finally{f.db.close();}});
test('only reauthenticated staff with an identity confirmation can issue an account-bound hashed code',async()=>{const f=await fixture();try{
 assert.equal((await f.issue('patient',{},null)).status,401);assert.equal((await f.issue('patient',{},await f.login('patient'))).status,403);
 assert.equal((await f.issue('patient',{identityConfirmed:false})).status,400);assert.equal((await f.issue('patient',{currentPassword:'Wrong-staff-password!'})).status,403);
 assert.equal((await f.issue('staff')).status,409);assert.equal((await f.issue('missing')).status,400);
 const result=await f.issue();assert.equal(result.status,200);assert.match(result.value.code,/^[A-F0-9]{4}(?:-[A-F0-9]{4}){7}$/);
 const token=await f.db.prepare('SELECT * FROM password_recovery_codes').first();assert.equal(token.account_id,'patient');assert.equal(token.issued_by,'staff');assert.ok(token.expires_at>Date.now()&&token.expires_at<=Date.now()+900000);
 assert.ok(!JSON.stringify(token).includes(result.value.code.replaceAll('-','')));assert.ok(!JSON.stringify(result.value).includes('password_hash'));assert.equal((await f.db.prepare("SELECT password_hash FROM accounts WHERE id='patient'").first()).password_hash,encoded);
}finally{f.db.close();}});
test('a successful reset is single-use, revokes old sessions and preserves records, links and roles',async()=>{const f=await fixture();try{
 const old=await f.login('patient'),second=await f.login('patient');await f.db.prepare("INSERT INTO patient_links(account_id,patient_id) VALUES('patient','M001')").run();
 const before=(await f.db.prepare('SELECT body FROM workspace').first()).body;await f.call('password/request',{method:'POST',body:{username:'patient'}});
 const code=(await f.issue()).value.code,result=await f.reset(code,{role:'staff'});assert.equal(result.status,200);assert.equal(result.value.proof,undefined);assert.equal(result.cookie,undefined);
 assert.equal((await f.call('me',{session:old})).status,401);assert.equal((await f.call('me',{session:second})).status,401);
 assert.equal((await f.call('login',{method:'POST',body:{username:'patient',password}})).status,401);await f.login('patient',replacement);
 assert.equal((await f.reset(code)).status,400);assert.equal((await f.db.prepare('SELECT body FROM workspace').first()).body,before);
 assert.equal((await f.db.prepare("SELECT role FROM accounts WHERE id='patient'").first()).role,'patient');assert.equal((await f.db.prepare("SELECT patient_id FROM patient_links WHERE account_id='patient'").first()).patient_id,'M001');
 assert.equal((await f.db.prepare('SELECT count(*) AS n FROM password_recovery_codes').first()).n,0);assert.ok((await f.db.prepare('SELECT resolved_at FROM password_recovery_requests').first()).resolved_at);
 assert.equal((await f.db.prepare("SELECT count(*) AS n FROM audit_events WHERE action='password-reset'").first()).n,1);
}finally{f.db.close();}});
test('wrong account, code, confirmation, password length and expired codes never change credentials or sessions',async()=>{const f=await fixture();try{
 const old=await f.login('patient'),code=(await f.issue()).value.code;
 assert.equal((await f.reset(code,{username:'other-patient'})).status,400);assert.equal((await f.reset('0'.repeat(32))).status,400);
 assert.equal((await f.reset(code,{confirmPassword:'Different-password!'})).status,400);assert.equal((await f.reset(code,{password:'short',confirmPassword:'short'})).status,400);
 await f.db.prepare('UPDATE password_recovery_codes SET expires_at=0').run();assert.equal((await f.reset(code)).status,400);
 assert.equal((await f.db.prepare("SELECT password_hash FROM accounts WHERE id='patient'").first()).password_hash,encoded);assert.equal((await f.call('me',{session:old})).status,200);
}finally{f.db.close();}});
test('reissuing cancels the previous code and two concurrent redemptions have one winner',async()=>{const f=await fixture();try{
 const old=(await f.issue()).value.code,code=(await f.issue()).value.code;assert.equal((await f.reset(old)).status,400);
 const results=await Promise.all([f.reset(code),f.reset(code,{password:'Another-valid-password!',confirmPassword:'Another-valid-password!'})]);assert.equal(results.filter(r=>r.status===200).length,1);assert.equal(results.filter(r=>r.status===400).length,1);
 assert.equal((await f.db.prepare("SELECT count(*) AS n FROM audit_events WHERE action='password-reset'").first()).n,1);
 await f.login('patient',results[0].status===200?replacement:'Another-valid-password!');
}finally{f.db.close();}});
test('revoked issuers, changed issuer credentials and inactive targets invalidate outstanding codes',async()=>{for(const mutation of ["UPDATE accounts SET role='patient' WHERE id='staff'","UPDATE accounts SET active=0 WHERE id='staff'","UPDATE accounts SET password_hash=? WHERE id='staff'","UPDATE accounts SET active=0 WHERE id='patient'"]){const f=await fixture();try{
 const code=(await f.issue()).value.code;const stmt=f.db.prepare(mutation);await(mutation.includes('?')?stmt.bind(otherHash):stmt).run();assert.equal((await f.reset(code)).status,400);
 assert.equal((await f.db.prepare("SELECT password_hash FROM accounts WHERE id='patient'").first()).password_hash,encoded);
}finally{f.db.close();}}});
test('deleted/restored accounts do not regain old recovery codes',async()=>{const f=await fixture();try{
 const code=(await f.issue()).value.code,revision=(await f.call('workspace',{session:f.staff})).value.revision,id=crypto.randomUUID();
 assert.equal((await f.call('admin/delete',{method:'POST',session:f.staff,body:{kind:'account',type:null,id:'patient',operationId:id,baseRevision:revision}})).status,200);
 const baseRevision=(await f.call('workspace',{session:f.staff})).value.revision;assert.equal((await f.call('admin/restore',{method:'POST',session:f.staff,body:{trashId:id,baseRevision}})).status,200);assert.equal((await f.reset(code)).status,400);await f.login('patient');
}finally{f.db.close();}});
test('request limits never lock out normal login and cross-origin resets are rejected',async()=>{const f=await fixture();try{
 for(let i=0;i<3;i++)assert.equal((await f.call('password/request',{method:'POST',body:{username:'patient'}})).status,202);
 assert.equal((await f.call('password/request',{method:'POST',body:{username:'patient'}})).status,429);await f.login('patient');
 assert.equal((await f.call('password/reset',{method:'POST',body:{username:'patient'},headers:{Origin:'https://untrusted.test'}})).status,403);
}finally{f.db.close();}});
test('a password change during a successful old-password check cannot create a new session',async()=>{const f=await fixture();try{
 const prepare=f.db.prepare.bind(f.db);f.db.prepare=sql=>{const stmt=prepare(sql);if(!sql.startsWith('INSERT INTO sessions'))return stmt;return {bind(...values){const bound=stmt.bind(...values);return {async run(){await prepare("UPDATE accounts SET password_hash=? WHERE id='patient'").bind(otherHash).run();return bound.run();}};}};};
 const result=await f.call('login',{method:'POST',body:{username:'patient',password}});assert.equal(result.status,401);assert.equal((await prepare("SELECT count(*) AS n FROM sessions WHERE account_id='patient'").first()).n,0);
}finally{f.db.close();}});
test('recovering a staff account invalidates recovery codes it previously issued',async()=>{const f=await fixture();try{
 const patientCode=(await f.issue()).value.code,otherStaff=await f.login('second-staff');
 const staffCode=(await f.issue('staff',{},otherStaff)).value.code;
 assert.equal((await f.reset(staffCode,{username:'staff'})).status,200);assert.equal((await f.reset(patientCode)).status,400);
 assert.equal((await f.call('me',{session:f.staff})).status,401);await f.login('staff',replacement);
}finally{f.db.close();}});

test('a database failure during redemption rolls back credentials, code consumption and session revocation together',async()=>{const f=await fixture();try{
 const session=await f.login('patient'),code=(await f.issue()).value.code,batch=f.db.batch.bind(f.db);
 f.db.batch=statements=>statements.some(s=>s.sql.startsWith('UPDATE accounts SET password_hash='))?batch([...statements.slice(0,2),f.db.prepare('INSERT INTO missing_recovery_table VALUES(1)'),...statements.slice(2)]):batch(statements);
 assert.equal((await f.reset(code)).status,500);assert.equal((await f.db.prepare("SELECT password_hash FROM accounts WHERE id='patient'").first()).password_hash,encoded);assert.equal((await f.call('me',{session})).status,200);assert.equal((await f.db.prepare('SELECT count(*) AS n FROM password_recovery_codes').first()).n,1);
 f.db.batch=batch;assert.equal((await f.reset(code)).status,200);
}finally{f.db.close();}});
