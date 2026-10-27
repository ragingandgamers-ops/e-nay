import test from 'node:test';
import assert from 'node:assert/strict';
import worker,{passwordHash} from '../server/worker.mjs';
import {localDatabase} from '../server/local-db.mjs';
import {SCHEMA,migrateCompanions} from '../server/schema.mjs';
import {today} from '../dist/core.mjs';
const password='Fictional-test-password-2026!',origin='https://enay.test';
const encoded=await passwordHash(password);
async function fixture({legacy=false}={}){
 const db=localDatabase();await db.exec(legacy?SCHEMA.replace('mother_id TEXT NOT NULL REFERENCES accounts(id), created_at INTEGER NOT NULL','mother_id TEXT NOT NULL UNIQUE REFERENCES accounts(id), created_at INTEGER NOT NULL'):SCHEMA);let n=0;
 await db.prepare("INSERT INTO accounts(id,username,display_name,password_hash,role,created_at) VALUES('staff','test.staff','Fictional Staff',?,'staff',0)").bind(encoded).run();
 const call=async(path,method='GET',body,session)=>{const r=await worker.fetch(new Request(origin+'/api/'+path,{method,headers:{Origin:origin,'CF-Connecting-IP':'192.0.2.'+(++n),'Content-Type':'application/json',...(session?{Cookie:session.cookie,'X-Enay-Access':session.proof}:{})},...(body?{body:JSON.stringify(body)}:{})}),{DB:db,ASSETS:{fetch:()=>new Response('test')}});return {status:r.status,value:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};};
 const login=async(username)=>{const r=await call('login','POST',{username,password});assert.equal(r.status,200);return {...r.value,cookie:r.cookie};};
 const register=async(username,kind='mother')=>{const r=await call('register','POST',{username,password,kind,displayName:'Fictional '+kind,age:29,edd:today()});assert.equal(r.status,201,JSON.stringify(r.value));return login(username);};
 return {db,call,login,register};
}
const newOp=(type,record)=>({type,record,originalId:null});
const save=(f,s,operations)=>f.call('records','POST',{operationId:crypto.randomUUID(),operations},s);
test('mother registration creates exactly one personal record and both API and staff can see it',async()=>{const f=await fixture();try{
 const mother=await f.register('family.mother'),staff=await f.login('test.staff');assert.equal(mother.account.kind,'mother');assert.equal(mother.account.maternalId,'M001');
 const own=await f.call('workspace','GET',null,mother);assert.equal(own.value.data.mothers.length,1);assert.equal(own.value.data.mothers[0].name,'Fictional mother');assert.equal((await f.call('workspace','GET',null,staff)).value.data.mothers.length,1);
 assert.equal((await save(f,mother,[newOp('mothers',{id:'M002',name:'Extra Mother',age:29,edd:today(),status:'Active'})])).status,403);
 assert.equal((await f.call('family/setup','POST',{kind:'father'},mother)).status,409);
 const before=own.value.data.mothers[0];assert.equal((await save(f,mother,[{type:'mothers',originalId:before.id,before,record:{...before,contact:'09123456789'}}])).status,200);
}finally{f.db.close();}});
test('registration validation is atomic and account kind cannot be forged into staff',async()=>{const f=await fixture();try{
 for(const body of [{kind:'mother',age:5,edd:today()},{kind:'invalid'},{kind:'mother',age:29,edd:'2026-02-30'},{kind:'mother',age:29,edd:today(),role:'staff'}]){const result=await f.call('register','POST',{username:'invalid.user',password,displayName:'Fictional User',...body});assert.ok([400,403].includes(result.status));}
 assert.equal((await f.db.prepare('SELECT count(*) AS n FROM family_accounts').first()).n,0);assert.equal(JSON.parse((await f.db.prepare('SELECT body FROM workspace').first()).body).mothers.length,0);
}finally{f.db.close();}});
test('unpaired fathers see no family, cannot mutate records or use staff linking, and never get private drafts',async()=>{const f=await fixture();try{
 const mother=await f.register('family.mother'),father=await f.register('family.father','father'),staff=await f.login('test.staff');
 const own=await f.call('workspace','GET',null,father);assert.equal(own.value.data.mothers.length,0);assert.equal(own.value.family.partner,null);
 for(const op of [newOp('mothers',{id:'M002'}),newOp('children',{id:'C001'}),newOp('vaccines',{patient:'M001'})])assert.equal((await save(f,father,[op])).status,403);
 assert.equal((await f.call('links','PUT',{accountId:father.account.id,patientIds:['M001']},staff)).status,403);
 assert.equal((await f.call('family/code','POST',{},father)).status,403);assert.equal((await f.call('family/pair','POST',{code:'A'.repeat(24)},mother)).status,403);
 assert.ok(!(await f.call('accounts','GET',null,staff)).value.accounts.some(a=>a.id===father.account.id));
}finally{f.db.close();}});
test('one-use invitation shares only the mother family and father remains read-only; disconnect revokes an active session',async()=>{const f=await fixture();try{
 const mother=await f.register('family.mother'),other=await f.register('other.mother'),father=await f.register('family.father','father');
 const child=await save(f,mother,[newOp('children',{id:'C001',name:'Fictional Child',dob:today(),gender:'Female',motherId:mother.account.maternalId,motherName:'Fictional mother',status:'Active'})]);assert.equal(child.status,200);
 const invite=await f.call('family/code','POST',{},mother);assert.equal(invite.status,200);assert.equal(invite.value.code.replaceAll('-','').length,24);
 const stored=await f.db.prepare('SELECT * FROM pairing_codes').first();assert.notEqual(stored.code_hash,invite.value.code.replaceAll('-',''));assert.ok(stored.expires_at>Date.now());
 assert.equal((await f.call('family/pair','POST',{code:invite.value.code},father)).status,200);
 const shared=await f.call('workspace','GET',null,father);assert.deepEqual(shared.value.data.mothers.map(m=>m.id),[mother.account.maternalId]);assert.equal(shared.value.data.children.length,1);assert.equal(shared.value.data.inventory.length,0);assert.equal(shared.value.family.partner.id,mother.account.id);
 const before=shared.value.data.mothers[0];assert.equal((await save(f,father,[{type:'mothers',originalId:before.id,before,record:{...before,name:'Forged Mother'}}])).status,403);
 assert.equal((await f.call('family/disconnect','POST',{},father)).status,403);
 const second=await f.register('second.father','father');assert.equal((await f.call('family/pair','POST',{code:invite.value.code},second)).status,400);
 assert.equal((await f.call('family/disconnect','POST',{},other)).status,200);assert.equal((await f.call('workspace','GET',null,father)).value.data.mothers.length,1);
 assert.equal((await f.call('family/disconnect','POST',{},mother)).status,200);const revoked=await f.call('workspace','GET',null,father);assert.equal(revoked.value.data.mothers.length,0);assert.equal(revoked.value.family.partner,null);
 assert.equal((await f.call('family/pair','POST',{code:invite.value.code},second)).status,400);
}finally{f.db.close();}});
test('new invitations replace older ones, expired codes fail, and two fathers cannot redeem one invitation',async()=>{const f=await fixture();try{
 const mother=await f.register('family.mother'),one=await f.register('one.father','father'),two=await f.register('two.father','father');
 const old=(await f.call('family/code','POST',{},mother)).value.code,newCode=(await f.call('family/code','POST',{},mother)).value.code;assert.equal((await f.call('family/pair','POST',{code:old},one)).status,400);
 await f.db.prepare('UPDATE pairing_codes SET expires_at=0').run();assert.equal((await f.call('family/pair','POST',{code:newCode},one)).status,400);
 const code=(await f.call('family/code','POST',{},mother)).value.code;const result=await Promise.all([f.call('family/pair','POST',{code},one),f.call('family/pair','POST',{code},two)]);assert.equal(result.filter(r=>r.status===200).length,1);assert.equal((await f.db.prepare('SELECT count(*) AS n FROM companion_links').first()).n,1);
}finally{f.db.close();}});
test('existing users choose a linked personal record without copying or deleting histories; a record has one owner',async()=>{const f=await fixture();try{
 const owner=await f.register('family.mother');for(const id of ['legacy','other'])await f.db.prepare("INSERT INTO accounts(id,username,display_name,password_hash,role,created_at) VALUES(?,?,?,?,'patient',0)").bind(id,id+'.user','Fictional Legacy',encoded).run();
 await f.db.prepare("INSERT INTO patient_links(account_id,patient_id) VALUES('legacy','M001')").run();const legacy=await f.login('legacy.user');
 assert.equal((await f.call('family/setup','POST',{kind:'mother',maternalId:'M001'},legacy)).status,409);
 assert.equal((await f.call('family/setup','POST',{kind:'mother',maternalId:'M999'},legacy)).status,403);
 const other=await f.login('other.user');const saved=await save(f,other,[newOp('mothers',{id:'M001',name:'Existing Mother',age:29,edd:today(),status:'Active'})]);assert.equal(saved.status,200);const id=saved.value.data.mothers[0].id;
 assert.equal((await f.call('family/setup','POST',{kind:'mother',maternalId:id},other)).status,200);assert.equal((await f.call('workspace','GET',null,other)).value.data.mothers.length,1);assert.equal(JSON.parse((await f.db.prepare('SELECT body FROM workspace').first()).body).mothers.length,2);
}finally{f.db.close();}});
test('pairing attempts are limited per account and proof plus same-origin requirements still apply',async()=>{const f=await fixture();try{
 const father=await f.register('family.father','father');for(let n=0;n<8;n++)assert.equal((await f.call('family/pair','POST',{code:'A'.repeat(24)},father)).status,400);assert.equal((await f.call('family/pair','POST',{code:'A'.repeat(24)},father)).status,429);
 assert.equal((await f.call('family')).status,401);
}finally{f.db.close();}});

test('staff cannot unlink a personal maternal record; reviewed imports revoke companion access and ownership without deleting accounts',async()=>{const f=await fixture();try{
 const mother=await f.register('family.mother'),father=await f.register('family.father','father'),staff=await f.login('test.staff');
 assert.equal((await f.call('links','PUT',{accountId:mother.account.id,patientIds:[]},staff)).status,400);
 const code=(await f.call('family/code','POST',{},mother)).value.code;assert.equal((await f.call('family/pair','POST',{code},father)).status,200);
 const current=(await f.call('workspace','GET',null,staff)).value;assert.equal((await f.call('workspace','PUT',{data:current.data,baseRevision:current.revision,operationId:crypto.randomUUID(),resetPatientLinks:true},staff)).status,200);
 const state=(await f.call('workspace','GET',null,father)).value;assert.equal(state.family.partner,null);assert.equal(state.data.mothers.length,0);assert.equal((await f.db.prepare('SELECT maternal_id FROM family_accounts WHERE account_id=?').bind(mother.account.id).first()).maternal_id,null);assert.equal((await f.db.prepare('SELECT count(*) AS n FROM accounts').first()).n,3);
}finally{f.db.close();}});

test('nonpregnant mothers register without a due date, while pregnant registration validates it atomically',async()=>{const f=await fixture();try{
 const raw={username:'not.pregnant',password,kind:'mother',displayName:'Fictional Mother',age:29,pregnancyStatus:'Not pregnant',edd:''};assert.equal((await f.call('register','POST',raw)).status,201);const own=(await f.call('workspace','GET',null,await f.login(raw.username))).value.data.mothers[0];assert.equal(own.edd,'');assert.equal(own.pregnancyStatus,'Not pregnant');
 assert.equal((await f.call('register','POST',{...raw,username:'pregnant.mother',pregnancyStatus:'Pregnant'})).status,400);assert.equal((await f.db.prepare('SELECT count(*) AS n FROM accounts WHERE username=?').bind('pregnant.mother').first()).n,0);
}finally{f.db.close();}});

test('maternal deletion disconnects the companion, preserves children, and restoration requires relinking',async()=>{const f=await fixture();try{
 const mother=await f.register('family.mother'),father=await f.register('family.father','father'),staff=await f.login('test.staff'),mid=mother.account.maternalId;
 assert.equal((await save(f,mother,[newOp('children',{id:'C001',name:'Fictional Child',dob:today(),gender:'Female',motherId:mid,motherName:'Fictional mother',status:'Active'})])).status,200);
 const code=(await f.call('family/code','POST',{},mother)).value.code;assert.equal((await f.call('family/pair','POST',{code},father)).status,200);
 const trashId=crypto.randomUUID(),baseRevision=(await f.call('workspace','GET',null,staff)).value.revision;
 const removed=await f.call('admin/delete','POST',{kind:'record',type:'mothers',id:mid,operationId:trashId,baseRevision},staff);assert.equal(removed.status,200);
 assert.equal(removed.value.data.mothers.length,0);assert.equal(removed.value.data.children.length,1);
 const shared=(await f.call('workspace','GET',null,father)).value;assert.equal(shared.family.partner,null);assert.equal(shared.data.children.length,0);
 const restored=await f.call('admin/restore','POST',{trashId,baseRevision:removed.value.revision},staff);assert.equal(restored.status,200);assert.equal(restored.value.data.mothers.length,1);assert.equal(restored.value.data.children.length,1);
 assert.equal((await f.call('workspace','GET',null,mother)).value.data.mothers.length,0);assert.equal((await f.call('workspace','GET',null,father)).value.family.partner,null);
}finally{f.db.close();}});

test('a mother can invite 3 read-only companions, disconnect one specifically and reuse only the freed slot',async()=>{const f=await fixture();try{
 const mother=await f.register('three.mother'),other=await f.register('other.mother'),companions=[];
 await save(f,mother,[newOp('children',{id:'C001',name:'Fictional Child',dob:today(),gender:'Female',motherId:mother.account.maternalId,motherName:'Fictional mother',status:'Active'})]);
 for(let n=1;n<=4;n++)companions.push(await f.register('companion.'+n,'father'));
 for(const companion of companions.slice(0,3)){const invite=await f.call('family/code','POST',{},mother);assert.equal(invite.status,200);assert.equal((await f.call('family/pair','POST',{code:invite.value.code},companion)).status,200);const shared=(await f.call('workspace','GET',null,companion)).value;assert.equal(shared.data.mothers.length,1);assert.equal(shared.data.children.length,1);assert.deepEqual(shared.family.companions,[]);assert.equal((await save(f,companion,[newOp('visits',{patient:mother.account.maternalId})])).status,403);}
 let state=(await f.call('family','GET',null,mother)).value.family;assert.equal(state.companions.length,3);assert.equal(state.companionLimit,3);
 assert.equal((await f.call('family/code','POST',{},mother)).status,409);
 assert.equal((await f.call('family/disconnect','POST',{},mother)).status,409,'An older client cannot disconnect everyone after showing one person');
 assert.equal((await f.call('family/disconnect','POST',{companionId:companions[0].account.id},other)).status,200);assert.equal((await f.call('family','GET',null,mother)).value.family.companions.length,3);
 assert.equal((await f.call('family/disconnect','POST',{companionId:companions[0].account.id},mother)).status,200);
 assert.equal((await f.call('workspace','GET',null,companions[0])).value.data.mothers.length,0);
 assert.equal((await f.call('workspace','GET',null,companions[1])).value.data.mothers.length,1);
 assert.equal((await f.call('workspace','GET',null,companions[2])).value.data.children.length,1);
 const replacement=(await f.call('family/code','POST',{},mother)).value.code;assert.equal((await f.call('family/pair','POST',{code:replacement},companions[3])).status,200);
 state=(await f.call('family','GET',null,mother)).value.family;assert.equal(state.companions.length,3);assert.ok(!state.companions.some(c=>c.id===companions[0].account.id));
}finally{f.db.close();}});

test('the final companion slot is atomic and a valid invitation cannot bypass a full maternal account',async()=>{const f=await fixture();try{
 const mother=await f.register('limit.mother'),companions=[];for(let n=1;n<=4;n++)companions.push(await f.register('limit.father'+n,'father'));
 for(const c of companions.slice(0,2)){const code=(await f.call('family/code','POST',{},mother)).value.code;assert.equal((await f.call('family/pair','POST',{code},c)).status,200);}
 const code=(await f.call('family/code','POST',{},mother)).value.code,results=await Promise.all(companions.slice(2).map(c=>f.call('family/pair','POST',{code},c)));
 assert.equal(results.filter(r=>r.status===200).length,1);assert.equal((await f.db.prepare('SELECT count(*) AS n FROM companion_links WHERE mother_id=?').bind(mother.account.id).first()).n,3);
 const rejected=companions[results[0].status===200?3:2],raw='1234567890ABCDEF12345678',cryptoModule=await import('node:crypto');
 await f.db.prepare('INSERT INTO pairing_codes(mother_id,code_hash,expires_at) VALUES(?,?,?)').bind(mother.account.id,cryptoModule.createHash('sha256').update(raw).digest('hex'),Date.now()+900000).run();
 const full=await f.call('family/pair','POST',{code:raw},rejected);assert.equal(full.status,409);assert.equal((await f.db.prepare('SELECT count(*) AS n FROM companion_links').first()).n,3);
 assert.equal((await f.db.prepare("SELECT count(*) AS n FROM audit_events WHERE action='family-pair'").first()).n,3,'Only accepted invitations create a pairing audit');
}finally{f.db.close();}});

test('the legacy unique-mother schema migrates atomically and idempotently without losing existing pairings or care data',async()=>{const f=await fixture({legacy:true});try{
 for(const [id,kind]of [['legacy-mother','mother'],['legacy-father','father']]){await f.db.prepare("INSERT INTO accounts(id,username,display_name,password_hash,role,created_at) VALUES(?,?,?,?,'patient',0)").bind(id,id,'Fictional '+kind,encoded).run();await f.db.prepare('INSERT INTO family_accounts(account_id,kind,maternal_id) VALUES(?,?,?)').bind(id,kind,kind==='mother'?'M001':null).run();}
 await f.db.prepare("INSERT INTO companion_links(father_id,mother_id,created_at) VALUES('legacy-father','legacy-mother',1234)").run();
 const originalBody=(await f.db.prepare("SELECT body FROM workspace WHERE id='clinic'").first()).body;
 await Promise.all([migrateCompanions(f.db),migrateCompanions(f.db)]);await migrateCompanions(f.db);
 assert.deepEqual({...await f.db.prepare('SELECT * FROM companion_links').first()},{father_id:'legacy-father',mother_id:'legacy-mother',created_at:1234});
 assert.equal((await f.db.prepare("SELECT body FROM workspace WHERE id='clinic'").first()).body,originalBody);assert.equal((await f.db.prepare('SELECT count(*) AS n FROM accounts').first()).n,3);
 const mother=await f.login('legacy-mother');for(const username of ['legacy.second','legacy.third']){const father=await f.register(username,'father'),code=(await f.call('family/code','POST',{},mother)).value.code;assert.equal((await f.call('family/pair','POST',{code},father)).status,200);}
 assert.equal((await f.call('family','GET',null,mother)).value.family.companions.length,3);
}finally{f.db.close();}});

test('a failed legacy schema migration rolls back cleanly and can be retried',async()=>{const f=await fixture({legacy:true});try{
 const broken={prepare:sql=>f.db.prepare(sql),batch:statements=>f.db.batch([...statements.slice(0,2),f.db.prepare('INSERT INTO missing_migration_table VALUES(1)'),...statements.slice(2)])};
 await assert.rejects(migrateCompanions(broken));
 assert.match((await f.db.prepare("SELECT sql FROM sqlite_master WHERE name='companion_links'").first()).sql,/mother_id TEXT NOT NULL UNIQUE/);
 assert.equal(await f.db.prepare("SELECT name FROM sqlite_master WHERE name='companion_links_migration'").first(),null);
 await migrateCompanions(f.db);assert.doesNotMatch((await f.db.prepare("SELECT sql FROM sqlite_master WHERE name='companion_links'").first()).sql,/mother_id TEXT NOT NULL UNIQUE/);
}finally{f.db.close();}});
