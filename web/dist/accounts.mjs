import {applyRecordOperations,nextProfileId} from './record-operations.mjs';
import {emptyData,validateData} from './core.mjs';
import {deriveVaultKey as keyFor,saveTabSession,readTabSession,forgetTabSession} from './tab-session.mjs';

export class ApiError extends Error { constructor(message,status=0){super(message);this.status=status;} }
export async function api(path,{method='GET',body,proof,signal}={}){
 let response;
 try{response=await fetch('/api/'+path,{method,credentials:'same-origin',cache:'no-store',headers:{...(body?{'Content-Type':'application/json'}:{}),...(proof?{'X-Enay-Access':proof}:{})},body:body?JSON.stringify(body):undefined,signal:signal??AbortSignal.timeout(15000)});}
 catch{throw new ApiError('The clinic could not be reached. Your saved offline copy is unchanged.');}
 let result;try{result=await response.json();}catch{throw new ApiError('The account service is unavailable. Please try again when connected.',response.status);}
 if(!response.ok)throw new ApiError(result.error??'The request could not be completed.',response.status);
 return result;
}
const requestResult=request=>new Promise((resolve,reject)=>{request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
let database;
async function db(){
 if(!database)database=new Promise((resolve,reject)=>{const request=indexedDB.open('enay-private-v1',1);request.onupgradeneeded=()=>request.result.createObjectStore('copies',{keyPath:'username'});request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);request.onblocked=()=>reject(new Error('Close other E-Nay tabs to enable offline storage.'));});
 return database;
}
async function cached(username){const connection=await db();return requestResult(connection.transaction('copies').objectStore('copies').get(username));}
async function replace(row,expected){
 const connection=await db();
 await new Promise((resolve,reject)=>{const tx=connection.transaction('copies','readwrite'),copies=tx.objectStore('copies'),read=copies.get(row.username);let reason;
  read.onsuccess=()=>{if((read.result?.generation??null)!==expected){reason=new Error('Records changed in another tab. Sign out and sign in again before saving. Your form values are preserved.');tx.abort();}else copies.put(row);};
  tx.oncomplete=resolve;tx.onerror=()=>reject(reason??tx.error);tx.onabort=()=>reject(reason??tx.error??new Error('The device could not save this change. Previous records are intact.'));
 });
}
const aad=account=>new TextEncoder().encode(JSON.stringify([account.id,account.username,account.role]));
async function decryptWithKey(row,key){try{const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:row.iv,additionalData:aad(row.account)},key,row.cipher);const payload=JSON.parse(new TextDecoder().decode(plain));payload.data=validateData(payload.data);return {key,payload};}catch{throw new Error('The offline copy could not be unlocked. Sign in again; nothing has been changed.');}}
async function decrypt(row,password){return decryptWithKey(row,await keyFor(password,row.salt));}

// Only encrypted authorized snapshots go into IndexedDB. Per-tab continuation
// survives refresh; passwords are never saved. The device cookie alone grants no access.

// Each queued batch has an immutable receipt ID. A lost response can be retried
// without creating another profile or consuming another physical dose.
function rebasePending(batches,local,result,role){
 if(!batches.length)return {data:result.data,pending:null,idMap:result.idMap??{}};
 const mapping={...result.idMap},nextBatches=structuredClone(batches),occupied=structuredClone(result.data);
 for(const batch of nextBatches)for(const op of batch.operations){
  const profile=['mothers','children'].includes(op.type);
  if(op.originalId!==null)op.originalId=mapping[op.originalId]??op.originalId;
  if(op.before?.id)op.before.id=mapping[op.before.id]??op.before.id;
  if(op.before?.patient)op.before.patient=mapping[op.before.patient]??op.before.patient;
  if(profile&&op.originalId===null){const previous=op.record.id;if(occupied[op.type].some(r=>r.id===previous))op.record.id=nextProfileId(occupied,op.type);mapping[previous]=op.record.id;occupied[op.type].push({id:op.record.id});}
  else if(op.record.id)op.record.id=mapping[op.record.id]??op.record.id;
  if(op.record.patient)op.record.patient=mapping[op.record.patient]??op.record.patient;
 }
 const fallback=structuredClone(local);for(const type of Object.keys(fallback))for(const record of fallback[type]){if(['mothers','children'].includes(type))record.id=mapping[record.id]??record.id;if(record.patient)record.patient=mapping[record.patient]??record.patient;}
 let data=fallback;try{data=applyRecordOperations(result.data,nextBatches.flatMap(batch=>batch.operations),{role,allowedIds:[...result.data.mothers,...result.data.children].map(r=>r.id),checkBefore:false}).data;}catch{/* Keep the editable pending copy if the clinic revoked a link or changed a dependency. */}
 return {data,pending:{batches:nextBatches},idMap:mapping};
}

export class AccountStore {
 constructor(account,proof=''){this.account=account;this.proof=proof;this.data=emptyData();this.catalog=[];this.raw=null;this.blocked=false;this.error='';this.message='';this.cacheEnabled=false;this.pending=null;this.baseRevision='initial';this.queue=Promise.resolve();this.closed=false;}
 static async signIn(username,password){
  username=username.trim().toLowerCase();let row,cacheAvailable=true;
  try{row=await cached(username);}catch{cacheAvailable=false;}
  let login;
  try{login=await api('login',{method:'POST',body:{username,password}});}
  catch(error){
   if(error.status!==0||!row)throw error;
   const unlocked=await decrypt(row,password),store=new AccountStore(row.account);
   Object.assign(store,unlocked.payload,{key:unlocked.key,salt:row.salt,raw:row.generation,cacheEnabled:true});store.message='Offline copy unlocked · Sign in online to sync';await saveTabSession(store,password);return store;
  }
  const store=new AccountStore(login.account,login.proof);
  store.expiresAt=login.expiresAt;
  try{
   const cloud=await api('workspace',{proof:login.proof});
   let previous;
   if(row){previous=await decrypt(row,password);if(row.account.id!==login.account.id)throw new Error('This username belongs to a different account. Contact the clinic before replacing this device copy.');}
   store.data=cloud.data;store.catalog=cloud.catalog??[];store.baseRevision=cloud.revision;
   if(previous?.payload.pending&&row.account.role===login.account.role){store.data=previous.payload.data;store.pending=previous.payload.pending;store.baseRevision=previous.payload.baseRevision;}
   if(previous?.payload.pending&&row.account.role!==login.account.role)throw new Error('Your clinic role changed while this device had pending edits. Ask the clinic administrator to review those edits; they have not been uploaded or removed.');
   if(cacheAvailable){store.key=previous?.key??await keyFor(password,store.salt=crypto.getRandomValues(new Uint8Array(16)));store.salt=row?.salt??store.salt;store.raw=row?.generation??null;store.cacheEnabled=true;await store.persist(store.data,store.pending,store.baseRevision);}
   store.message=store.cacheEnabled?'Cloud connected · Encrypted copy on device':'Online only · Offline storage unavailable';
   if(store.pending)await store.sync();await saveTabSession(store,password);return store;
  }catch(error){await api('logout',{method:'POST',body:{},proof:login.proof}).catch(()=>{});store.close();throw error;}
 }
 static async resume(){
  const ticket=await readTabSession();if(!ticket)return null;
  const store=new AccountStore(ticket.account,ticket.proof);store.sessionId=ticket.id;store.expiresAt=ticket.expiresAt;
  try{
   let previous;
   if(ticket.key){
    const row=await cached(ticket.account.username);
    if(!row||row.account.id!==ticket.account.id||row.account.role!==ticket.account.role)throw new Error('Your saved account changed in another tab. Sign in again; your encrypted copy is unchanged.');
    previous=await decryptWithKey(row,ticket.key);
    Object.assign(store,previous.payload,{key:ticket.key,salt:row.salt,raw:row.generation,cacheEnabled:true});
   }
   let cloud;
   try{
    const current=await api('me',{proof:ticket.proof});
    if(current.account.id!==ticket.account.id||current.account.username!==ticket.account.username||current.account.role!==ticket.account.role)throw new Error('Your clinic access changed. Sign in again; any pending offline edits are preserved.');
    store.account=current.account;cloud=await api('workspace',{proof:ticket.proof});
   }catch(error){
    // A reachable server rejection must never fall back to offline privileges.
    if(error.status!==0||!previous)throw error;
    store.message=store.pending?'Saved offline · Pending clinic sync':'Offline session restored · Encrypted copy on device';return store;
   }
   store.catalog=cloud.catalog??[];
   if(!store.pending){if(store.cacheEnabled)await store.persist(cloud.data,null,cloud.revision);store.data=cloud.data;store.baseRevision=cloud.revision;}
   store.message=store.cacheEnabled?'Cloud connected · Encrypted copy on device':'Cloud connected · Online only';
   if(store.pending)await store.sync();return store;
  }catch(error){store.close();throw error;}
 }
 async persist(data,pending,baseRevision){
  const iv=crypto.getRandomValues(new Uint8Array(12)),generation=crypto.randomUUID();
  const cipher=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:aad(this.account)},this.key,new TextEncoder().encode(JSON.stringify({data,pending,baseRevision,catalog:this.catalog})));
  if(this.closed)throw new Error('Sign in again before saving.');
  await replace({username:this.account.username,account:this.account,salt:this.salt,iv,cipher,generation},this.raw);this.raw=generation;
 }
 serial(action){const next=this.queue.then(()=>{if(this.closed)throw new Error('Sign in again before continuing.');return action();});this.queue=next.catch(()=>{});return next;}
 async save(type,raw,originalId=null,{before}={}){return this.serial(async()=>{
   if(['inventory','guides'].includes(type))this.requireStaff();
  if(!Object.hasOwn(this.data,type))throw new Error('Invalid record type.');
  const original=originalId?this.data[type].find(r=>r.id===originalId):null;if(originalId&&!original)throw new Error('This record no longer exists. Reload the workspace.');
  const input={...raw};if(!originalId&&!input.id)input.id=['mothers','children'].includes(type)?nextProfileId(this.data,type):crypto.randomUUID();
  // An earlier appointment may have been completed by staff since this screen
  // was opened. Recheck a suspected duplicate without replacing pending edits.
  if(type==='vaccines'&&this.account.role==='patient'&&!originalId&&!this.pending&&this.proof&&navigator.onLine){
   const key=value=>String(value??'').normalize('NFC').trim().replace(/\s+/gu,' ').toLowerCase();
   if(this.data.vaccines.some(item=>item.patient===input.patient&&['Pending verification','Approved'].includes(item.approvalStatus)&&!item.administered&&key(item.vaccine)===key(input.vaccine))){
    const cloud=await api('workspace',{proof:this.proof});this.catalog=cloud.catalog??[];if(this.cacheEnabled)await this.persist(cloud.data,null,cloud.revision);this.data=cloud.data;this.baseRevision=cloud.revision;
   }
  }
  const operation={type,record:input,originalId,before:original?structuredClone(before??original):undefined};
  const allowedIds=[...this.data.mothers,...this.data.children].map(r=>r.id);
  const next=applyRecordOperations(this.data,[operation],{role:this.account.role,allowedIds}).data;
  const record=next[type].find(item=>item.id===(['mothers','children'].includes(type)?String(input.id).trim().toUpperCase():input.id));operation.record.id=record.id;
  if(this.pending&&!this.pending.batches){this.requireStaff();await this.write(next);return record;}
  const batch={id:crypto.randomUUID(),operations:[operation]},pending={batches:[...(this.pending?.batches??[]),batch]};
  if(pending.batches.length>500)throw new Error('Sync your pending records before adding more changes.');
  if(!this.cacheEnabled){const result=await api('records',{method:'POST',proof:this.proof,body:{operationId:batch.id,operations:batch.operations}});this.data=result.data;this.catalog=result.catalog??[];this.baseRevision=result.revision;this.message='Saved to clinic cloud';return record;}
  await this.persist(next,pending,this.baseRevision);this.data=next;this.pending=pending;this.message='Saved offline · Pending clinic sync';await this.syncNow();return record;
 });}
 requireStaff(){if(this.account.role!=='staff')throw new Error('Vaccine stock and clinic administration are managed by authorized health workers.');}
 commit(data){return this.serial(async()=>{this.requireStaff();await this.write(validateData(data),true);});}
 async write(data,resetLinks=false){
  const operationId=crypto.randomUUID();resetLinks=resetLinks||Boolean(this.pending?.resetLinks);const pending={id:operationId,resetLinks};
  if(!this.cacheEnabled){if(!this.proof)throw new Error('Sign in online before saving.');const result=await api('workspace',{method:'PUT',proof:this.proof,body:{data,baseRevision:this.baseRevision,operationId,resetPatientLinks:resetLinks}});this.data=data;this.baseRevision=result.revision;this.raw=operationId;this.message='Saved to clinic cloud';return;}
  await this.persist(data,pending,this.baseRevision);this.data=data;this.pending=pending;this.message='Saved offline · Pending clinic sync';await this.syncNow();
 }
 sync(){return this.serial(()=>this.syncNow());}
 async syncNow(){
  try{
   if(!this.proof){this.message=this.pending?'Saved offline · Sign in online to sync':'Offline copy · Sign in online to refresh';return;}
   while(this.pending?.batches?.length){
    const batch=this.pending.batches[0],result=await api('records',{method:'POST',proof:this.proof,body:{operationId:batch.id,operations:batch.operations}});if(this.closed)return;
    const rebased=rebasePending(this.pending.batches.slice(1),this.data,result,this.account.role);
    this.catalog=result.catalog??[];if(this.cacheEnabled)await this.persist(rebased.data,rebased.pending,result.revision);
    this.data=rebased.data;this.pending=rebased.pending;this.baseRevision=result.revision;this.onRemap?.(rebased.idMap);
   }
   if(this.pending){const result=await api('workspace',{method:'PUT',proof:this.proof,body:{data:this.data,baseRevision:this.baseRevision,operationId:this.pending.id??this.pending,resetPatientLinks:Boolean(this.pending.resetLinks)}});if(this.closed)return;if(this.cacheEnabled)await this.persist(this.data,null,result.revision);this.baseRevision=result.revision;this.pending=null;}
   this.message=this.cacheEnabled?'Cloud connected · Encrypted copy on device':'Cloud connected · Online only';this.error='';
  }catch(error){this.message=error.status===409?'Conflict · Pending copy preserved':error.status===401||error.status===403?'Sign in online · Pending copy preserved':'Saved offline · Clinic sync unavailable';this.error=error.message;}
 }
 load({discard=false}={}){return this.serial(async()=>{
  if(this.pending&&!discard)throw new Error('This device has pending changes. Download a backup before choosing to replace them with the clinic copy.');
  if(!this.proof)throw new Error('Sign out and sign in while connected to refresh the clinic copy.');
  const cloud=await api('workspace',{proof:this.proof});this.catalog=cloud.catalog??[];if(this.cacheEnabled)await this.persist(cloud.data,null,cloud.revision);this.data=cloud.data;this.baseRevision=cloud.revision;this.pending=null;this.error='';this.message='Latest clinic copy loaded';return this.data;
 });}
 async signOut(){if(this.sessionId)forgetTabSession(this.sessionId);await this.queue;const proof=this.proof;this.close();if(proof)await api('logout',{method:'POST',body:{},proof}).catch(()=>{});}
 close(){if(this.sessionId)forgetTabSession(this.sessionId);this.closed=true;this.proof='';this.key=null;this.data=emptyData();}
}
