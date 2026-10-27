import test from 'node:test';
import assert from 'node:assert/strict';
import worker,{passwordHash} from '../server/worker.mjs';
import {localDatabase} from '../server/local-db.mjs';
import {SCHEMA} from '../server/schema.mjs';
import {today} from '../dist/core.mjs';
const password='Fictional-test-password-2026!',encoded=await passwordHash(password),origin='https://enay.test';
async function fixture(){
 const db=localDatabase();await db.exec(SCHEMA);let requests=0;
 await db.prepare("INSERT INTO accounts(id,username,display_name,password_hash,role,created_at) VALUES('staff','test.staff','Fictional Staff',?,'staff',0)").bind(encoded).run();
 const call=async(path,method='GET',body,s)=>{const r=await worker.fetch(new Request(origin+'/api/'+path,{method,headers:{Origin:origin,'CF-Connecting-IP':'192.0.2.'+(++requests),'Content-Type':'application/json',...(s?{Cookie:s.cookie,'X-Enay-Access':s.proof}:{})},...(body?{body:JSON.stringify(body)}:{})}),{DB:db,ASSETS:{fetch:()=>new Response('test')}});return {status:r.status,value:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};};
 const login=async username=>{const r=await call('login','POST',{username,password});assert.equal(r.status,200,JSON.stringify(r.value));return {...r.value,cookie:r.cookie};};
 const register=async(username,kind='mother')=>{const r=await call('register','POST',{username,password,kind,displayName:'Fictional '+username.replaceAll('.',' '),age:29,pregnancyStatus:'Not pregnant',edd:''});assert.equal(r.status,201,JSON.stringify(r.value));return login(username);};
 const workspace=async s=>(await call('workspace','GET',null,s)).value;
 const save=async(s,operations,epoch)=>call('records','POST',{operationId:crypto.randomUUID(),epoch:epoch??(await workspace(s)).epoch,operations},s);
 const preview=async(s,targets)=>call('admin/archive-preview','POST',{targets},s);
 const erase=async(s,targets)=>{const p=await preview(s,targets);if(p.status!==200)return p;return call('admin/archive-delete','POST',{targets,baseRevision:p.value.baseRevision,confirmed:true,operationId:crypto.randomUUID()},s);};
 return {db,call,login,register,workspace,save,preview,erase};
}
const add=(type,record)=>({type,record,originalId:null});
const child=(id,motherId='M001')=>({id,motherId,motherName:'Fictional Mother',name:'Fictional Child',dob:today(),gender:'Female',status:'Active'});
test('archiving and deleting a mother account frees its M/C gaps, retains staff-only health history and revokes sessions/links',async()=>{const f=await fixture();try{
 const staff=await f.login('test.staff'),one=await f.register('mother.one'),old=await f.register('mother.two'),three=await f.register('mother.three'),father=await f.register('father.one','father');
 const setup=await f.save(old,[add('children',child('C001','M002')),add('visits',{id:crypto.randomUUID(),patient:'M002',date:today(),notes:'Old maternal note'}),add('growth',{id:crypto.randomUUID(),patient:'C001',date:today(),weight:4,height:52,assessment:'Not assessed',notes:'Old child measurement'})]);assert.equal(setup.status,200,JSON.stringify(setup.value));
 const code=(await f.call('family/code','POST',{},old)).value.code;assert.equal((await f.call('family/pair','POST',{code},father)).status,200);
 const batch={id:crypto.randomUUID(),vaccine:'Fictional vaccine',batch:'F-001',stock:5,threshold:0,expires:'2099-12-31'};assert.equal((await f.save(staff,[add('inventory',batch)])).status,200);
 const doses=await f.save(staff,[add('vaccines',{id:crypto.randomUUID(),patient:'C001',vaccine:batch.vaccine,dose:'Dose 1',scheduled:today(),approvalStatus:'Approved',stockMode:'clinic',batchId:batch.id}),add('vaccines',{id:crypto.randomUUID(),patient:'M002',vaccine:batch.vaccine,dose:'Dose 1',scheduled:today(),administered:today(),approvalStatus:'Approved',stockMode:'clinic',batchId:batch.id})]);assert.equal(doses.status,200);assert.equal(doses.value.data.inventory[0].stock,3);
 const targets=[{kind:'account',id:old.account.id}],p=await f.preview(staff,targets);assert.deepEqual(p.value.profileIds.sort(),['C001','M002']);assert.equal(p.value.counts.vaccines,2);assert.equal(p.value.refundedDoses,1);
 const operationId=crypto.randomUUID(),body={targets,baseRevision:p.value.baseRevision,confirmed:true,operationId},deleted=await f.call('admin/archive-delete','POST',body,staff);assert.equal(deleted.status,200,JSON.stringify(deleted.value));assert.equal(deleted.value.data.inventory[0].stock,4);assert.equal((await f.call('workspace','GET',null,old)).status,401);assert.equal((await f.call('login','POST',{username:'mother.two',password})).status,401);
 const archives=await f.call('admin/archives','GET',null,staff);assert.equal(archives.value.total,1);const archived=await f.call('admin/archives/'+operationId,'GET',null,staff);assert.equal(archived.value.archive.snapshot.records.visits[0].notes,'Old maternal note');assert.equal(archived.value.archive.snapshot.records.growth[0].notes,'Old child measurement');assert.equal(archived.value.archive.snapshot.records.vaccines.length,2);assert.ok(!JSON.stringify(archived.value).includes('password_hash'));assert.equal((await f.call('admin/archives/'+operationId,'GET',null,one)).status,403);
 assert.equal(await f.db.prepare('SELECT id FROM accounts WHERE id=?').bind(old.account.id).first(),null);assert.equal((await f.workspace(father)).family.partner,null);assert.deepEqual((await f.workspace(father)).data.children,[]);
 const fresh=await f.register('mother.two');assert.equal(fresh.account.maternalId,'M002');assert.notEqual(fresh.account.id,old.account.id);let copy=await f.workspace(fresh);assert.equal(copy.data.mothers.length,1);assert.equal(copy.data.mothers[0].contact,'');for(const type of ['children','visits','vaccines','growth'])assert.deepEqual(copy.data[type],[]);
 const newChild=await f.save(fresh,[add('children',child('C001','M002'))]);assert.equal(newChild.status,200);assert.equal(newChild.value.idMap.C001,'C001');for(const type of ['visits','vaccines','growth'])assert.deepEqual(newChild.value.data[type],[]);
 assert.equal((await f.call('admin/archive-delete','POST',body,staff)).status,200);copy=await f.workspace(fresh);assert.equal(copy.data.children.length,1,'Retrying an old delete must not delete a reused ID');assert.equal((await f.workspace(one)).data.mothers[0].id,'M001');assert.equal((await f.workspace(three)).data.mothers[0].id,'M003');
 assert.equal((await f.call('admin/archives/'+operationId,'GET',null,staff)).value.archive.snapshot.records.growth[0].patient,'C001');assert.equal((await f.call('admin/archives/'+operationId,'GET',null,fresh)).status,403);assert.equal((await f.call('admin/erase','POST',body,staff)).status,404,'No permanent health purge endpoint exists');
}finally{f.db.close();}});
test('child ID reuse rejects old staff edits, new care entries, snapshot saves and link assignments from before deletion',async()=>{const f=await fixture();try{
 const staff=await f.login('test.staff'),mother=await f.register('mother.one');await f.save(mother,[add('children',child('C001'))]);const before=await f.workspace(staff),oldChild=before.data.children[0];
 assert.equal((await f.erase(staff,[{kind:'record',type:'children',id:'C001'}])).status,200);assert.equal((await f.save(mother,[add('children',child('C001'))])).status,200);
 const operations=[{type:'children',record:{...oldChild,contact:'09123456789'},before:oldChild,originalId:'C001'}];assert.equal((await f.save(staff,operations,before.epoch)).status,409);
 assert.equal((await f.save(staff,[add('visits',{id:crypto.randomUUID(),patient:'C001',date:today(),notes:'Stale child note'})],before.epoch)).status,409);
 const current=await f.workspace(staff);assert.equal((await f.call('workspace','PUT',{epoch:before.epoch,baseRevision:current.revision,data:before.data,operationId:crypto.randomUUID()},staff)).status,409);
 assert.equal((await f.call('links','PUT',{epoch:before.epoch,accountId:mother.account.id,patientIds:['M001','C001']},staff)).status,409);assert.equal((await f.workspace(staff)).data.visits.length,0);assert.equal((await f.workspace(staff)).data.children[0].contact,'');
}finally{f.db.close();}});
test('batch deletion is staff-only, protects self/final staff and rejects stale or partial selections atomically',async()=>{const f=await fixture();try{
 const staff=await f.login('test.staff'),one=await f.register('mother.one'),two=await f.register('mother.two'),targets=[{kind:'account',id:one.account.id},{kind:'account',id:two.account.id}];
 assert.equal((await f.preview(one,targets)).status,403);assert.equal((await f.erase(staff,[...targets,{kind:'account',id:'staff'}])).status,409);assert.equal((await f.workspace(one)).data.mothers.length,1);
 assert.equal((await f.erase(staff,[...targets,{kind:'record',type:'children',id:'C999'}])).status,409);assert.equal((await f.workspace(two)).data.mothers.length,1);
 const p=await f.preview(staff,targets);await f.register('mother.three');assert.equal((await f.call('admin/archive-delete','POST',{targets,baseRevision:p.value.baseRevision,confirmed:true,operationId:crypto.randomUUID()},staff)).status,409);
 assert.equal((await f.erase(staff,targets)).status,200);assert.equal((await f.register('mother.four')).account.maternalId,'M001');assert.equal((await f.register('mother.five')).account.maternalId,'M002');
}finally{f.db.close();}});
test('old Trash entries move to the retained health archive to release child IDs without restoring into a reused ID',async()=>{const f=await fixture();try{
 const staff=await f.login('test.staff'),mother=await f.register('mother.one');await f.save(mother,[add('children',child('C001'))]);const current=await f.workspace(staff),id=crypto.randomUUID();assert.equal((await f.call('admin/delete','POST',{kind:'record',type:'children',id:'C001',baseRevision:current.revision,operationId:id},staff)).status,200);
 assert.ok((await f.workspace(staff)).reservedProfileIds.includes('C001'));assert.equal((await f.erase(staff,[{kind:'trash',id}])).status,200);assert.ok(!(await f.workspace(staff)).reservedProfileIds.includes('C001'));
 assert.equal((await f.save(mother,[add('children',child('C001'))])).value.idMap.C001,'C001');assert.equal((await f.call('admin/restore','POST',{trashId:id,baseRevision:(await f.workspace(staff)).revision},staff)).status,404);const archived=(await f.call('admin/archives','GET',null,staff)).value.items[0];assert.equal((await f.call('admin/archives/'+archived.id,'GET',null,staff)).value.archive.snapshot.priorArchives[0].payload.records.children[0].id,'C001');
}finally{f.db.close();}});
test('a failing archival deletion transaction rolls back profiles, accounts, reservations and the sync barrier',async()=>{const f=await fixture();try{
 const staff=await f.login('test.staff'),mother=await f.register('mother.one'),before=await f.workspace(staff),batch=f.db.batch;let fail=true;f.db.batch=statements=>{if(fail&&statements.some(s=>s.sql.includes('archive_delete_operations'))){fail=false;return batch([...statements,f.db.prepare('INSERT INTO missing_deletion_table VALUES(1)')]);}return batch(statements);};
 assert.equal((await f.erase(staff,[{kind:'account',id:mother.account.id}])).status,409);assert.deepEqual(await f.workspace(staff),before);assert.equal((await f.workspace(mother)).data.mothers.length,1);assert.equal((await f.call('admin/archives','GET',null,staff)).value.total,0);
}finally{f.db.close();}});
