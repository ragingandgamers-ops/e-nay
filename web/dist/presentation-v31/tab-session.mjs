// A refresh can resume this tab, without persisting a password or plaintext
// medical records. The server still requires its separate HttpOnly device cookie.
const TICKET='enay.tab-session.v1',LIFETIME=12*60*60*1000;
const bytes=value=>new TextEncoder().encode(value);
const binding=t=>bytes(JSON.stringify([t.id,t.account.id,t.account.username,t.account.role,t.expiresAt]));
let database;
async function db(){
 if(!database)database=new Promise((resolve,reject)=>{const r=indexedDB.open('enay-tab-sessions-v1',1);r.onupgradeneeded=()=>r.result.createObjectStore('unlocks',{keyPath:'id'});r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);r.onblocked=()=>reject(new Error('Tab storage is unavailable.'));});
 return database;
}
async function unlockRow(id,value){const connection=await db();return new Promise((resolve,reject)=>{const tx=connection.transaction('unlocks',value===undefined?'readonly':'readwrite'),store=tx.objectStore('unlocks');const r=value===undefined?store.get(id):value===null?store.delete(id):store.put(value);let result;r.onsuccess=()=>{result=r.result;};tx.oncomplete=()=>resolve(result);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);});}
function current(){try{return JSON.parse(sessionStorage.getItem(TICKET)||'null');}catch{return null;}}
export async function deriveVaultKey(password,salt,extractable=false){const material=await crypto.subtle.importKey('raw',bytes(password),'PBKDF2',false,['deriveKey']);return crypto.subtle.deriveKey({name:'PBKDF2',hash:'SHA-256',iterations:600000,salt},material,{name:'AES-GCM',length:256},extractable,['encrypt','decrypt']);}
export function forgetTabSession(expectedId){
 const ticket=current();
 // Clear synchronously: a reload during a slow/offline logout cannot restore it.
 if(ticket&&(!expectedId||ticket.id===expectedId)){try{sessionStorage.removeItem(TICKET);}catch{}void unlockRow(ticket.id,null).catch(()=>{});}
}
export async function saveTabSession(store,password){
 forgetTabSession();
 const ticket={version:1,id:crypto.randomUUID(),account:store.account,proof:store.proof,expiresAt:store.expiresAt??Date.now()+LIFETIME};
 try{
  if(store.cacheEnabled){
   const secret=crypto.getRandomValues(new Uint8Array(32)),iv=crypto.getRandomValues(new Uint8Array(12));
   const wrappingKey=await crypto.subtle.importKey('raw',secret,{name:'AES-GCM'},false,['wrapKey']);
   // Only this short-lived candidate is extractable for wrapKey; active and
   // restored vault keys are non-extractable. Never export a raw key to storage.
   const candidate=await deriveVaultKey(password,store.salt,true);
   const wrapped=await crypto.subtle.wrapKey('raw',candidate,wrappingKey,{name:'AES-GCM',iv,additionalData:binding(ticket)});
   await unlockRow(ticket.id,{id:ticket.id,expiresAt:ticket.expiresAt,iv,wrapped});
   ticket.secret=Array.from(secret);
  }
  sessionStorage.setItem(TICKET,JSON.stringify(ticket));store.sessionId=ticket.id;store.expiresAt=ticket.expiresAt;
 }catch{
  void unlockRow(ticket.id,null).catch(()=>{});
  store.sessionWarning='This browser cannot keep this tab signed in after a refresh. You can continue using it now.';
 }
}
export async function readTabSession(){
 const ticket=current();if(!ticket)return null;
 try{
  if(ticket.version!==1||typeof ticket.id!=='string'||typeof ticket.account?.id!=='string'||typeof ticket.account?.username!=='string'||!['staff','patient'].includes(ticket.account.role)||typeof ticket.proof!=='string'||(ticket.proof&&!/^[a-f0-9]{64}$/.test(ticket.proof))||!Number.isFinite(ticket.expiresAt))throw new Error('Sign in again to continue. Your encrypted offline copy is unchanged.');
  if(ticket.expiresAt<=Date.now())throw new Error('Your session expired. Sign in again; your encrypted offline copy is unchanged.');
  let key;
  if(ticket.secret){
   if(!Array.isArray(ticket.secret)||ticket.secret.length!==32||!ticket.secret.every(n=>Number.isInteger(n)&&n>=0&&n<=255))throw new Error();
   const row=await unlockRow(ticket.id);if(!row||row.expiresAt!==ticket.expiresAt)throw new Error();
   const wrappingKey=await crypto.subtle.importKey('raw',new Uint8Array(ticket.secret),{name:'AES-GCM'},false,['unwrapKey']);
   key=await crypto.subtle.unwrapKey('raw',row.wrapped,wrappingKey,{name:'AES-GCM',iv:row.iv,additionalData:binding(ticket)},{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
  }
  return {...ticket,key};
 }catch(error){forgetTabSession(ticket.id);throw new Error(error.message||'This tab could not be restored. Sign in again; your encrypted offline copy is unchanged.');}
}
