import {scrypt,randomBytes,createHash,timingSafeEqual} from 'node:crypto';
import {Buffer} from 'node:buffer';
import {validateData,emptyData,normalize} from '../dist/core.mjs';
import {applyRecordOperations,nextProfileId} from '../dist/record-operations.mjs';
import {SCHEMA,MAX_COMPANIONS,migrateCompanions} from './schema.mjs';
import {handleAdmin} from './admin.mjs';
import {handleRecovery} from './recovery.mjs';

const readyDatabases=new WeakMap();
const MAX_BODY=1500000;
let hashing=0;
class ApiError extends Error{constructor(status,message){super(message);this.status=status;}}
const digest=value=>createHash('sha256').update(value).digest('hex');
const publicAccount=account=>({id:account.id,username:account.username,displayName:account.display_name,role:account.role,kind:account.kind??null,maternalId:account.maternal_id??null});
const isDevelopment=(request,env)=>env.DEVELOPMENT==='true'&&['localhost','127.0.0.1'].includes(new URL(request.url).hostname);
const cookieName=(request,env)=>isDevelopment(request,env)?'enay_dev_device':'__Host-enay_device';
const cookieValue=(request,key)=>request.headers.get('Cookie')?.split(';').map(v=>v.trim()).find(v=>v.startsWith(key+'='))?.slice(key.length+1);
function reply(value,status=200,headers={}){return new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...headers}});}
async function setup(db){if(!readyDatabases.has(db))readyDatabases.set(db,db.batch(SCHEMA.split(';').map(sql=>sql.trim()).filter(Boolean).map(sql=>db.prepare(sql))).then(()=>migrateCompanions(db)).catch(error=>{readyDatabases.delete(db);throw error;}));await readyDatabases.get(db);}
async function bodyOf(request){
 if(!request.headers.get('Content-Type')?.toLowerCase().startsWith('application/json'))throw new ApiError(415,'Send a JSON request.');
 if(Number(request.headers.get('Content-Length'))>MAX_BODY)throw new ApiError(413,'This workspace is too large to synchronize in one request. Export a backup before reducing it.');
 const reader=request.body?.getReader();let total=0,parts=[];
 if(!reader)throw new ApiError(400,'The request body is missing.');
 while(true){const {value,done}=await reader.read();if(done)break;total+=value.length;if(total>MAX_BODY){await reader.cancel();throw new ApiError(413,'The request is too large.');}parts.push(value);}
 const bytes=new Uint8Array(total);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.length;}
 try{const value=JSON.parse(new TextDecoder().decode(bytes));if(!value||typeof value!=='object'||Array.isArray(value))throw new Error();return value;}catch{throw new ApiError(400,'The request is not a valid JSON object.');}
}
function credentials(raw){
 const username=String(raw.username??'').trim().toLowerCase();
 if(!/^[a-z0-9][a-z0-9._-]{2,39}$/.test(username))throw new ApiError(400,'Use a username of 3-40 letters, numbers, periods, underscores or hyphens.');
 if(typeof raw.password!=='string'||raw.password.length<12||raw.password.length>128)throw new ApiError(400,'Use a password of 12-128 characters.');
 return {username,password:raw.password};
}
async function derivePassword(password,salt){
 if(hashing>=2)throw new ApiError(429,'Sign-in is busy. Please try again shortly.');
 hashing++;
 try{return await new Promise((resolve,reject)=>scrypt(password,salt,64,{N:32768,r:8,p:3,maxmem:64*1024*1024},(error,key)=>error?reject(error):resolve(key)));}
 finally{hashing--;}
}
export async function passwordHash(password){const salt=randomBytes(16).toString('hex');return `scrypt$32768$8$3$${salt}$${(await derivePassword(password,salt)).toString('hex')}`;}
async function passwordMatches(password,encoded){
 const fields=String(encoded).split('$');
 if(fields.length!==6||fields.slice(0,4).join('$')!=='scrypt$32768$8$3'||!/^[a-f0-9]{32}$/.test(fields[4])||!/^[a-f0-9]{128}$/.test(fields[5]))return false;
 const actual=await derivePassword(password,fields[4]);return timingSafeEqual(actual,Buffer.from(fields[5],'hex'));
}
async function limit(db,bucket,max){
 const now=Date.now(),key=digest(bucket);
 await db.prepare('INSERT INTO auth_limits(bucket,attempts,resets_at) VALUES(?,1,?) ON CONFLICT(bucket) DO UPDATE SET attempts=CASE WHEN resets_at<=? THEN 1 ELSE attempts+1 END,resets_at=CASE WHEN resets_at<=? THEN excluded.resets_at ELSE resets_at END').bind(key,now+15*60*1000,now,now).run();
 const row=await db.prepare('SELECT attempts FROM auth_limits WHERE bucket=?').bind(key).first();
 if(row.attempts>max)throw new ApiError(429,'Too many attempts. Please try again in 15 minutes.');
}
async function accountFor(request,env){
 const device=cookieValue(request,cookieName(request,env)),proof=request.headers.get('X-Enay-Access');
 if(!device||!proof||proof.length!==64)throw new ApiError(401,'Sign in to continue.');
 const row=await env.DB.prepare('SELECT a.* FROM accounts a JOIN sessions s ON s.account_id=a.id WHERE s.proof_hash=? AND s.device_hash=? AND s.expires_at>? AND a.active=1').bind(digest(proof),digest(device),Date.now()).first();
 if(!row)throw new ApiError(401,'Your session expired. Sign in again; your offline copy has not been removed.');
 return enrichAccount(env.DB,row);
}
function staffOnly(account){if(account.role!=='staff')throw new ApiError(403,'This operation is available to authorized clinic staff only.');}
async function workspaceFor(db,account){
 const row=await db.prepare("SELECT * FROM workspace WHERE id='clinic'").first();
 const data=validateData(JSON.parse(row.body));
 const catalog=[...new Set(data.inventory.map(batch=>batch.vaccine))].sort();
 if(account.role==='staff')return {revision:row.revision,data,catalog,savedAt:row.updated_at,reservedProfileIds:(await db.prepare('SELECT profile_id FROM profile_reservations').all()).results.map(r=>r.profile_id)};
 const allowed=new Set(await familyAllowed(db,account)),filtered=emptyData();
 filtered.mothers=data.mothers.filter(record=>allowed.has(record.id));
 filtered.children=data.children.filter(record=>allowed.has(record.id));
 for(const type of ['visits','vaccines','growth'])filtered[type]=data[type].filter(record=>allowed.has(record.patient));
  filtered.guides=data.guides.filter(guide=>guide.status==='Published');
 return {revision:row.revision,data:filtered,catalog,savedAt:row.updated_at,family:await familyState(db,account),account:publicAccount({...account,display_name:account.kind==='mother'?(data.mothers.find(m=>m.id===account.maternal_id)?.name??account.display_name):account.display_name})};
}
async function saveWorkspace(db,account,input){
 staffOnly(account);
 if(typeof input.baseRevision!=='string'||typeof input.operationId!=='string'||!/^[a-zA-Z0-9-]{16,80}$/.test(input.operationId))throw new ApiError(400,'The synchronization identifier is invalid.');
 const existing=await db.prepare('SELECT * FROM sync_operations WHERE id=?').bind(input.operationId).first();
 if(existing){if(existing.account_id!==account.id)throw new ApiError(409,'This synchronization identifier is already in use.');return {revision:existing.revision};}
 let data;try{data=validateData(input.data);}catch(error){throw new ApiError(400,error.message);}
  const reservedIds=(await db.prepare('SELECT profile_id FROM profile_reservations').all()).results.map(r=>r.profile_id);if([...data.mothers,...data.children].some(r=>reservedIds.includes(r.id)))throw new ApiError(409,'An imported profile ID is reserved in Trash. Restore or review that profile first.');
  // Old clients and pre-guide backups must not erase current clinic articles.
  if(input.data.guides===undefined)data.guides=validateData(JSON.parse((await db.prepare("SELECT body FROM workspace WHERE id='clinic'").first()).body)).guides;
 // Older clients send whole snapshots without newer provenance/stock fields.
 // Preserve those fields on ordinary saves; reviewed replacements remain explicit.
 if(input.resetPatientLinks!==true){const current=JSON.parse((await db.prepare("SELECT body FROM workspace WHERE id='clinic'").first()).body);for(const type of Object.keys(data))for(const record of data[type]){const old=current[type]?.find(item=>item.id===record.id);for(const key of ['updatedByRole','batchId','stockUse','approvalStatus','preferredDate','requestNotes','reviewNotes','requestedVaccine','pregnancyStatus','motherId'])if(old?.[key]!==undefined&&record[key]===undefined)record[key]=old[key];if(old?.stockUse?.kind&&record.stockUse&&record.stockUse.kind===undefined)record.stockUse.kind=old.stockUse.kind;}}
 try{data=validateData(data);}catch(error){throw new ApiError(400,error.message);}
 const revision=crypto.randomUUID(),now=Date.now(),body=JSON.stringify(data);
 if(new TextEncoder().encode(body).length>MAX_BODY-2000)throw new ApiError(413,'The workspace is too large to synchronize. Your previous clinic records are intact.');
 const results=await db.batch([
  db.prepare("UPDATE workspace SET revision=?,body=?,last_operation=?,updated_at=? WHERE id='clinic' AND revision=?").bind(revision,body,input.operationId,now,input.baseRevision),
  // Replacing/importing clinic data requires staff to verify patient links
  // again. Ordinary saves also remove links to deleted profiles atomically.
  db.prepare("DELETE FROM patient_links WHERE EXISTS(SELECT 1 FROM workspace WHERE id='clinic' AND last_operation=?) AND (?=1 OR patient_id NOT IN (SELECT json_extract(value,'$.id') FROM json_each(?, '$.mothers') UNION SELECT json_extract(value,'$.id') FROM json_each(?, '$.children')))").bind(input.operationId,input.resetPatientLinks===true?1:0,body,body),
  db.prepare("DELETE FROM companion_links WHERE (?=1 OR mother_id IN (SELECT account_id FROM family_accounts WHERE maternal_id NOT IN (SELECT json_extract(value,'$.id') FROM json_each(?, '$.mothers')))) AND EXISTS(SELECT 1 FROM workspace WHERE id='clinic' AND last_operation=?)").bind(input.resetPatientLinks===true?1:0,body,input.operationId),
  db.prepare("DELETE FROM pairing_codes WHERE (?=1 OR mother_id IN (SELECT account_id FROM family_accounts WHERE maternal_id NOT IN (SELECT json_extract(value,'$.id') FROM json_each(?, '$.mothers')))) AND EXISTS(SELECT 1 FROM workspace WHERE id='clinic' AND last_operation=?)").bind(input.resetPatientLinks===true?1:0,body,input.operationId),
  db.prepare("UPDATE family_accounts SET maternal_id=NULL WHERE kind='mother' AND (?=1 OR maternal_id NOT IN (SELECT json_extract(value,'$.id') FROM json_each(?, '$.mothers'))) AND EXISTS(SELECT 1 FROM workspace WHERE id='clinic' AND last_operation=?)").bind(input.resetPatientLinks===true?1:0,body,input.operationId),
  db.prepare("INSERT OR IGNORE INTO sync_operations(id,account_id,revision,created_at) SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM workspace WHERE id='clinic' AND last_operation=?)").bind(input.operationId,account.id,revision,now,input.operationId),
  db.prepare("INSERT OR IGNORE INTO audit_events(id,account_id,action,revision,created_at) SELECT ?,?,'workspace-sync',?,? WHERE EXISTS(SELECT 1 FROM workspace WHERE id='clinic' AND last_operation=?)").bind(input.operationId,account.id,revision,now,input.operationId)
 ]);
 if(results[0].meta.changes!==1){const previous=await db.prepare('SELECT * FROM sync_operations WHERE id=?').bind(input.operationId).first();if(previous?.account_id===account.id)return {revision:previous.revision};throw new ApiError(409,'Clinic records changed on another device. Your pending copy is preserved. Review or export it before loading the newer clinic copy.');}
 return {revision,savedAt:now};
}

async function recordReceipt(db,account,operationId){
 const receipt=await db.prepare('SELECT * FROM sync_operations WHERE id=?').bind(operationId).first();
 if(!receipt)return null;
 if(receipt.account_id!==account.id)throw new ApiError(409,'This synchronization identifier is already in use.');
 const mapping=await db.prepare('SELECT map_json FROM record_sync_maps WHERE operation_id=?').bind(operationId).first();
 return {...await workspaceFor(db,account),idMap:JSON.parse(mapping?.map_json??'{}')};
}
async function saveRecords(db,account,input){
 if(account.role==='patient'&&account.kind==='father')throw new ApiError(403,'Companion access is read-only. The mother or clinic staff can update records.');
 if(typeof input.operationId!=='string'||!/^[a-zA-Z0-9-]{16,80}$/.test(input.operationId))throw new ApiError(400,'The synchronization identifier is invalid.');
 for(let attempt=0;attempt<3;attempt++){
  const receipt=await recordReceipt(db,account,input.operationId);if(receipt)return receipt;
  const current=await db.prepare("SELECT * FROM workspace WHERE id='clinic'").first();
  const allowedIds=await familyAllowed(db,account);
  if(account.role==='patient'&&input.operations?.some(op=>op.type==='mothers'&&op.originalId===null)){
   if(account.kind||allowedIds.some(id=>id.startsWith('M')))throw new ApiError(403,'Your account has one personal maternal record. Open it to update your details.');
   if(input.operations.filter(op=>op.type==='mothers'&&op.originalId===null).length>1)throw new ApiError(400,'Create only one personal maternal record.');
  }
  const reservedIds=(await db.prepare('SELECT profile_id FROM profile_reservations').all()).results.map(r=>r.profile_id);
  let applied;try{applied=applyRecordOperations(JSON.parse(current.body),input.operations,{role:account.role,allowedIds,allocatePatientIds:true,reservedIds});}catch(error){throw new ApiError(error.status??400,error.message);}
  const body=JSON.stringify(applied.data),revision=crypto.randomUUID(),now=Date.now();
  if(new TextEncoder().encode(body).length>MAX_BODY-2000)throw new ApiError(413,'The workspace is too large to synchronize. Your previous clinic records are intact.');
  const condition=" WHERE EXISTS(SELECT 1 FROM workspace WHERE id='clinic' AND last_operation=?)";
  const results=await db.batch([
   db.prepare("UPDATE workspace SET revision=?,body=?,last_operation=?,updated_at=? WHERE id='clinic' AND revision=?").bind(revision,body,input.operationId,now,current.revision),
   ...applied.newLinks.map(id=>db.prepare('INSERT OR IGNORE INTO patient_links(account_id,patient_id) SELECT ?,?'+condition).bind(account.id,id,input.operationId)),
   db.prepare("UPDATE accounts SET display_name=(SELECT json_extract(value,'$.name') FROM json_each(?, '$.mothers') WHERE json_extract(value,'$.id')=(SELECT maternal_id FROM family_accounts WHERE account_id=accounts.id)) WHERE id IN (SELECT account_id FROM family_accounts WHERE kind='mother' AND maternal_id IN (SELECT json_extract(value,'$.id') FROM json_each(?, '$.mothers'))) AND EXISTS(SELECT 1 FROM workspace WHERE id='clinic' AND last_operation=?)").bind(body,body,input.operationId),
   db.prepare('INSERT OR IGNORE INTO sync_operations(id,account_id,revision,created_at) SELECT ?,?,?,?'+condition).bind(input.operationId,account.id,revision,now,input.operationId),
   db.prepare('INSERT OR IGNORE INTO record_sync_maps(operation_id,map_json) SELECT ?,?'+condition).bind(input.operationId,JSON.stringify(applied.idMap),input.operationId),
   db.prepare("INSERT OR IGNORE INTO audit_events(id,account_id,action,revision,created_at) SELECT ?,?,'record-sync',?,?"+condition).bind(input.operationId,account.id,revision,now,input.operationId)
  ]);
  if(results[0].meta.changes===1)return {...await workspaceFor(db,account),idMap:applied.idMap};
 }
 const receipt=await recordReceipt(db,account,input.operationId);if(receipt)return receipt;
 throw new ApiError(409,'Clinic records are being updated. Your pending changes are preserved. Try syncing again.');
}


async function enrichAccount(db,account){
 const family=await db.prepare('SELECT kind,maternal_id FROM family_accounts WHERE account_id=?').bind(account.id).first();
 return {...account,...family};
}
async function familyAllowed(db,account){
 if(account.role==='staff')return [];
 let owner=account;
 if(account.kind==='father'){
  const link=await db.prepare('SELECT a.*,f.kind,f.maternal_id FROM companion_links c JOIN accounts a ON a.id=c.mother_id JOIN family_accounts f ON f.account_id=a.id WHERE c.father_id=? AND a.active=1').bind(account.id).first();
  if(!link||link.kind!=='mother'||!link.maternal_id)return [];
  owner=link;
 }
 const rows=await db.prepare('SELECT patient_id FROM patient_links WHERE account_id=?').bind(owner.id).all();
 return rows.results.map(r=>r.patient_id).filter(id=>!owner.kind||id.startsWith('C')||id===owner.maternal_id);
}
async function familyState(db,account){
 if(account.role==='staff')return null;
 const partner=account.kind==='father'?await db.prepare('SELECT a.id,a.display_name FROM companion_links c JOIN accounts a ON a.id=c.mother_id WHERE c.father_id=? AND a.active=1').bind(account.id).first():null;
 const companions=account.kind==='mother'?(await db.prepare('SELECT a.id,a.display_name,a.username FROM companion_links c JOIN accounts a ON a.id=c.father_id WHERE c.mother_id=? AND a.active=1 ORDER BY c.created_at,c.father_id').bind(account.id).all()).results.map(a=>({id:a.id,name:a.display_name,username:a.username})):[];
 // Keep the singular field for already-open older clients. Mothers use the list.
 return {kind:account.kind??null,maternalId:account.maternal_id??null,partner:partner?{id:partner.id,name:partner.display_name}:companions[0]??null,companions,companionLimit:MAX_COMPANIONS};
}
// Existing accounts explicitly choose their personal record. Never infer identity
// from a similar name, merge records, or transfer another account's ownership.
async function setupFamily(db,account,input,registration=null){
 if(!['mother','father'].includes(input.kind))throw new ApiError(400,'Choose mother or father to create your account.');
 const identity=await db.prepare('SELECT * FROM family_accounts WHERE account_id=?').bind(account.id).first();
 if(identity&&(identity.kind==='father'||identity.maternal_id||input.kind!==identity.kind))throw new ApiError(409,'Your account type is already set. Contact clinic staff for a correction.');
 const operation=crypto.randomUUID(),now=Date.now();
 for(let attempt=0;attempt<3;attempt++){
  const row=await db.prepare("SELECT * FROM workspace WHERE id='clinic'").first(),data=validateData(JSON.parse(row.body));
  let maternalId=null,created=false;
  if(input.kind==='mother'){
   if(input.maternalId&&!registration){
    const link=await db.prepare('SELECT patient_id FROM patient_links WHERE account_id=? AND patient_id=?').bind(account.id,input.maternalId).first();
    if(!link||!data.mothers.some(m=>m.id===input.maternalId))throw new ApiError(403,'Choose your own maternal record already linked by the clinic.');
    maternalId=input.maternalId;
    if(await db.prepare('SELECT account_id FROM family_accounts WHERE maternal_id=? AND account_id<>?').bind(maternalId,account.id).first())throw new ApiError(409,'This maternal record already belongs to another account. Ask the clinic to verify your identity.');
   }else{
    if(!registration){
     const linked=await db.prepare("SELECT patient_id FROM patient_links WHERE account_id=? AND patient_id LIKE 'M%'").bind(account.id).all();
     if(linked.results.some(l=>data.mothers.some(m=>m.id===l.patient_id)))throw new ApiError(400,'Choose your existing maternal record to avoid creating a duplicate.');
    }
    maternalId=nextProfileId(data,'mothers',(await db.prepare('SELECT profile_id FROM profile_reservations').all()).results.map(r=>r.profile_id));
    let record;try{record=normalize('mothers',{id:maternalId,name:account.display_name,age:input.age,edd:input.edd,...(input.pregnancyStatus!==undefined?{pregnancyStatus:input.pregnancyStatus}:{}),status:'Active',contact:input.contact??'',barangay:input.barangay??''},data);}catch(error){throw new ApiError(400,error.message);}
    record.updatedByRole='patient';data.mothers.push(record);try{validateData(data);}catch(error){throw new ApiError(400,error.message);}created=true;
   }
  }
  const revision=crypto.randomUUID(),condition=" WHERE EXISTS(SELECT 1 FROM workspace WHERE id='clinic' AND last_operation=?)";
  const statements=[
   db.prepare("UPDATE workspace SET revision=?,body=?,last_operation=?,updated_at=? WHERE id='clinic' AND revision=?").bind(revision,JSON.stringify(data),operation,now,row.revision)
  ];
  if(registration)statements.push(db.prepare("INSERT INTO accounts(id,username,display_name,password_hash,role,created_at) SELECT ?,?,?,?,'patient',?"+condition).bind(account.id,registration.username,account.display_name,registration.hash,now,operation));
  statements.push(db.prepare('INSERT INTO family_accounts(account_id,kind,maternal_id) SELECT ?,?,?'+condition+' ON CONFLICT(account_id) DO UPDATE SET maternal_id=excluded.maternal_id').bind(account.id,input.kind,maternalId,operation));
  if(created)statements.push(db.prepare('INSERT OR IGNORE INTO patient_links(account_id,patient_id) SELECT ?,?'+condition).bind(account.id,maternalId,operation));
  statements.push(db.prepare("INSERT INTO audit_events(id,account_id,action,revision,created_at) SELECT ?,?,'family-setup',?,?"+condition).bind(operation,account.id,revision,now,operation));
  try{const changed=await db.batch(statements);if(changed[0].meta.changes===1)return;}
  catch(error){if(/UNIQUE/i.test(error.message))throw new ApiError(409,'That username or personal record is already in use.');throw error;}
 }
 throw new ApiError(409,'Clinic records changed. Please try setting up your account again.');
}
async function familyApi(request,env,account,path,method){
 if(account.role!=='patient')throw new ApiError(403,'Family pairing is for mother and father accounts.');
 const db=env.DB;
 if(path==='/api/family'&&method==='GET')return reply({family:await familyState(db,account)});
 if(path==='/api/family/setup'&&method==='POST'){
  await setupFamily(db,account,await bodyOf(request));
  return reply({account:publicAccount(await enrichAccount(db,account))});
 }
 if(path==='/api/family/code'&&method==='POST'){
  if(account.kind!=='mother'||!account.maternal_id)throw new ApiError(403,'Set up your personal maternal record before inviting a companion.');
  if((await db.prepare('SELECT count(*) AS n FROM companion_links WHERE mother_id=?').bind(account.id).first()).n>=MAX_COMPANIONS)throw new ApiError(409,'You have reached the limit of 3 companions. Disconnect one before inviting someone else.');
  await limit(db,'pair-code:'+account.id,8);
  const code=randomBytes(12).toString('hex').toUpperCase(),expiresAt=Date.now()+15*60*1000;
  await db.prepare('INSERT INTO pairing_codes(mother_id,code_hash,expires_at) VALUES(?,?,?) ON CONFLICT(mother_id) DO UPDATE SET code_hash=excluded.code_hash,expires_at=excluded.expires_at').bind(account.id,digest(code),expiresAt).run();
  return reply({code:code.match(/.{4}/g).join('-'),expiresAt});
 }
 if(path==='/api/family/pair'&&method==='POST'){
  if(account.kind!=='father')throw new ApiError(403,'Only a father account can redeem a pairing code.');
  await limit(db,'pair-account:'+account.id,8);await limit(db,'pair-ip:'+request.headers.get('CF-Connecting-IP'),24);
  const input=await bodyOf(request),code=String(input.code??'').replace(/[ -]/g,'').toUpperCase();
  if(!/^[A-F0-9]{24}$/.test(code))throw new ApiError(400,'Enter the complete pairing code shared by the mother.');
  const now=Date.now(),hash=digest(code),eventId=crypto.randomUUID();
  try{
   const result=await db.batch([
    db.prepare("INSERT INTO companion_links(father_id,mother_id,created_at) SELECT ?,p.mother_id,? FROM pairing_codes p JOIN accounts a ON a.id=p.mother_id JOIN family_accounts f ON f.account_id=a.id WHERE p.code_hash=? AND p.expires_at>? AND a.active=1 AND f.kind='mother' AND f.maternal_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM companion_links WHERE father_id=?) AND (SELECT count(*) FROM companion_links WHERE mother_id=p.mother_id)<?").bind(account.id,now,hash,now,account.id,MAX_COMPANIONS),
    db.prepare('DELETE FROM pairing_codes WHERE code_hash=? AND changes()=1 AND EXISTS(SELECT 1 FROM companion_links WHERE father_id=? AND mother_id=pairing_codes.mother_id)').bind(hash,account.id),
    db.prepare("INSERT INTO audit_events(id,account_id,action,created_at) SELECT ?,?,'family-pair',? WHERE changes()=1 AND EXISTS(SELECT 1 FROM companion_links WHERE father_id=?)").bind(eventId,account.id,now,account.id)
   ]);
   if(result[0].meta.changes!==1){
    const full=await db.prepare('SELECT mother_id FROM pairing_codes p WHERE code_hash=? AND expires_at>? AND (SELECT count(*) FROM companion_links WHERE mother_id=p.mother_id)>=?').bind(hash,now,MAX_COMPANIONS).first();
    if(full)throw new ApiError(409,'You have reached the limit of 3 companions. Disconnect one before inviting someone else.');
    throw new ApiError(400,'This code is expired, already used or unavailable. Ask the mother for a new code.');
   }
  }catch(error){if(/UNIQUE/i.test(error.message))throw new ApiError(409,'This account is already paired.');throw error;}
  return reply({paired:true});
 }
 if(path==='/api/family/disconnect'&&method==='POST'){
  if(account.kind!=='mother')throw new ApiError(403,'Only the mother can disconnect her companion.');
  const input=await bodyOf(request);let companionId=input.companionId;
  if(companionId===undefined){
   const links=(await db.prepare('SELECT father_id FROM companion_links WHERE mother_id=?').bind(account.id).all()).results;
   if(links.length>1)throw new ApiError(409,'Choose the companion you want to disconnect.');
   companionId=links[0]?.father_id??'';
  }
  if(typeof companionId!=='string'||companionId.length>100)throw new ApiError(400,'Choose the companion you want to disconnect.');
  await db.batch([
   db.prepare('DELETE FROM companion_links WHERE mother_id=? AND father_id=?').bind(account.id,companionId),
   db.prepare('DELETE FROM pairing_codes WHERE mother_id=? AND changes()=1').bind(account.id),
   db.prepare("INSERT INTO audit_events(id,account_id,action,created_at) VALUES(?,?,'family-disconnect',?)").bind(crypto.randomUUID(),account.id,Date.now())
  ]);
  return reply({disconnected:true});
 }
 throw new ApiError(404,'This operation is not available.');
}

async function api(request,env){
 if(!env.DB)throw new ApiError(503,'The clinic account service is not configured yet.');
 await setup(env.DB);
 const url=new URL(request.url),path=url.pathname,method=request.method;
 if(!['GET','HEAD'].includes(method)&&request.headers.get('Origin')!==url.origin)throw new ApiError(403,'This request must come from the E-Nay website.');
 if(path==='/api/status'&&method==='GET')return reply({ready:true,version:'password-recovery-v1'});
 if(path.startsWith('/api/password/'))return handleRecovery(request,env,null,path,method,{bodyOf,reply,ApiError,limit,credentials,passwordHash,passwordMatches,digest,randomBytes});
 if(path==='/api/register'&&method==='POST'){
  const raw=await bodyOf(request),{username,password}=credentials(raw);
  if(raw.role&&raw.role!=='patient')throw new ApiError(403,'Staff access is assigned by the clinic; it cannot be selected during registration.');
  const displayName=String(raw.displayName??'').trim().replace(/\s+/g,' ');
  if(!displayName||displayName.length>80)throw new ApiError(400,'Enter a name of 1-80 characters.');
  await limit(env.DB,'register:'+request.headers.get('CF-Connecting-IP'),20);
  if(await env.DB.prepare('SELECT id FROM accounts WHERE username=?').bind(username).first())throw new ApiError(409,'That username is unavailable.');
  if(!['mother','father'].includes(raw.kind))throw new ApiError(400,'Choose mother or father to create your account.');
  const id=crypto.randomUUID(),hash=await passwordHash(password);
  await setupFamily(env.DB,{id,role:'patient',display_name:displayName},raw,{username,hash});
  return reply({message:'Your account is ready. Sign in to continue.'},201);
 }
 if(path==='/api/login'&&method==='POST'){
  const {username,password}=credentials(await bodyOf(request));
  await limit(env.DB,'login-ip:'+request.headers.get('CF-Connecting-IP'),40);await limit(env.DB,'login-user:'+username,12);
  let account=await env.DB.prepare('SELECT * FROM accounts WHERE username=? AND active=1').bind(username).first();
  // An unknown user still pays the same password-derivation cost.
  const dummy='scrypt$32768$8$3$'+'0'.repeat(32)+'$'+'0'.repeat(128);
  const valid=await passwordMatches(password,account?.password_hash??dummy);
  if(!account||!valid)throw new ApiError(401,'The username or password is incorrect.');
  account=await enrichAccount(env.DB,account);
  const previousDevice=cookieValue(request,cookieName(request,env));
  const device=previousDevice&&/^[a-f0-9]{64}$/.test(previousDevice)?previousDevice:randomBytes(32).toString('hex');
  const proof=randomBytes(32).toString('hex'),expiresAt=Date.now()+12*60*60*1000;
  const established=await env.DB.prepare('INSERT INTO sessions(proof_hash,device_hash,account_id,expires_at) SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM accounts WHERE id=? AND active=1 AND password_hash=?)').bind(digest(proof),digest(device),account.id,expiresAt,account.id,account.password_hash).run();if(established.meta.changes!==1)throw new ApiError(401,'The username or password is incorrect.');
  await env.DB.prepare('DELETE FROM auth_limits WHERE bucket=?').bind(digest('login-user:'+username)).run();
  return reply({account:publicAccount(account),proof,expiresAt},200,{'Set-Cookie':`${cookieName(request,env)}=${device}; Path=/; HttpOnly; SameSite=Strict; Max-Age=1209600${isDevelopment(request,env)?'':'; Secure'}`});
 }
 const account=await accountFor(request,env);
 if(path==='/api/admin/password-code')return handleRecovery(request,env,account,path,method,{bodyOf,reply,ApiError,limit,credentials,passwordHash,passwordMatches,digest,randomBytes});
 if(path.startsWith('/api/admin/'))return handleAdmin(request,env,account,path,method,{bodyOf,reply,ApiError,workspaceFor});
 if(path.startsWith('/api/family'))return familyApi(request,env,account,path,method);
 if(path==='/api/me'&&method==='GET')return reply({account:publicAccount(account)});
 if(path==='/api/logout'&&method==='POST'){
  await env.DB.prepare('DELETE FROM sessions WHERE proof_hash=?').bind(digest(request.headers.get('X-Enay-Access'))).run();return reply({signedOut:true});
 }
 if(path==='/api/workspace'&&method==='GET')return reply(await workspaceFor(env.DB,account));
 if(path==='/api/records'&&method==='POST')return reply(await saveRecords(env.DB,account,await bodyOf(request)));
 if(path==='/api/workspace'&&method==='PUT')return reply(await saveWorkspace(env.DB,account,await bodyOf(request)));
 if(path==='/api/inventory'){staffOnly(account);if(method==='GET')return reply({inventory:(await workspaceFor(env.DB,account)).data.inventory});}
 if(path==='/api/accounts'&&method==='GET'){
  staffOnly(account);const accounts=await env.DB.prepare("SELECT a.id,a.username,a.display_name,a.role,f.kind,f.maternal_id FROM accounts a LEFT JOIN family_accounts f ON f.account_id=a.id WHERE a.active=1 AND a.role='patient' AND (f.kind IS NULL OR f.kind='mother') ORDER BY a.username").all();
  const links=await env.DB.prepare('SELECT account_id,patient_id FROM patient_links').all();
  return reply({accounts:accounts.results.map(a=>({...publicAccount(a),patientIds:links.results.filter(link=>link.account_id===a.id).map(link=>link.patient_id)}))});
 }
 if(path==='/api/links'&&method==='PUT'){
  staffOnly(account);const input=await bodyOf(request),target=await env.DB.prepare("SELECT id FROM accounts WHERE id=? AND role='patient' AND active=1").bind(input.accountId??'').first();
  if(!target)throw new ApiError(400,'Choose an active patient account.');
  const targetIdentity=await enrichAccount(env.DB,target);if(targetIdentity.kind==='father')throw new ApiError(403,'Fathers use a mother’s pairing code. Staff cannot assign companion access.');
  const clinic=await workspaceFor(env.DB,account),validIds=new Set([...clinic.data.mothers,...clinic.data.children].map(r=>r.id));
  if(!Array.isArray(input.patientIds)||input.patientIds.length>100||new Set(input.patientIds).size!==input.patientIds.length||input.patientIds.some(id=>!validIds.has(id)))throw new ApiError(400,'Choose existing maternal or child profiles.');
  if(targetIdentity.kind==='mother'&&targetIdentity.maternal_id&&!input.patientIds.includes(targetIdentity.maternal_id))throw new ApiError(400,'Keep the account’s personal maternal record selected.');
  const linkOperation=crypto.randomUUID(),linkRevision=crypto.randomUUID(),linkNow=Date.now(),condition=" AND EXISTS(SELECT 1 FROM workspace WHERE id='clinic' AND last_operation=?)";
  const changed=await env.DB.batch([
   env.DB.prepare("UPDATE workspace SET revision=?,last_operation=?,updated_at=? WHERE id='clinic' AND revision=?").bind(linkRevision,linkOperation,linkNow,clinic.revision),
   env.DB.prepare('DELETE FROM patient_links WHERE account_id=?'+condition).bind(target.id,linkOperation),
   ...input.patientIds.map(id=>env.DB.prepare("INSERT INTO patient_links(account_id,patient_id) SELECT ?,? WHERE EXISTS(SELECT 1 FROM workspace WHERE id='clinic' AND last_operation=?)").bind(target.id,id,linkOperation)),
   env.DB.prepare("INSERT INTO audit_events(id,account_id,action,created_at) SELECT ?,?,'patient-link-change',? WHERE EXISTS(SELECT 1 FROM workspace WHERE id='clinic' AND last_operation=?)").bind(linkOperation,account.id,linkNow,linkOperation)
  ]);
  if(changed[0].meta.changes!==1)throw new ApiError(409,'Clinic records changed. Refresh patient access and review these links again.');
  return reply({linked:true});
 }
 throw new ApiError(404,'This operation is not available.');
}
export default {
 async fetch(request,env){
  const url=new URL(request.url);
  if(url.pathname.startsWith('/api/')){
   try{return await api(request,env);}catch(error){return reply({error:error.status?error.message:'The clinic service could not complete this request. Your previous records are intact.'},error.status??500);}
  }
  const response=await env.ASSETS.fetch(request),headers=new Headers(response.headers);
  headers.set('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'");
  headers.set('Referrer-Policy','strict-origin-when-cross-origin');headers.set('X-Content-Type-Options','nosniff');
  return new Response(response.body,{status:response.status,statusText:response.statusText,headers});
 }
};
