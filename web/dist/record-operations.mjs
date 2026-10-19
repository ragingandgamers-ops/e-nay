import {TYPES,ValidationError,normalize,validateData,today} from './core.mjs';

const recordError=(status,message)=>Object.assign(new Error(message),{status});
const conflict=()=>recordError(409,'This record changed on another device. Your pending changes are preserved. Review or export them before loading the clinic copy.');
const deny=()=>recordError(403,'You can change only your own family records. Vaccine stock is managed by clinic staff.');
export function nextProfileId(data,type){
 const prefix=type==='mothers'?'M':'C';
 for(let n=1;n<=999;n++){const id=prefix+String(n).padStart(3,'0');if(!data[type].some(record=>record.id===id))return id;}
 throw new ValidationError('id','No profile IDs are available. Contact clinic staff.');
}
function canonical(record){return JSON.stringify(record);}
function useKey(use){return use?.batchId??'';}
function applyStock(next,previous,record,raw,now){
 const oldUse=previous?.stockUse;
 const clinic=raw.stockMode==='clinic'||(raw.stockMode!=='external'&&Boolean(raw.batchId));
 let batch,newUse;
 if(clinic){
  batch=next.inventory.find(item=>item.id===raw.batchId);
  if(!batch)throw new ValidationError('batchId','Choose an existing vaccine batch, or choose vaccination recorded elsewhere.');
  if(batch.vaccine!==record.vaccine)throw new ValidationError('vaccine','The vaccine must match the selected inventory batch.');
  const eventDate=record.administered||record.scheduled;
  if(batch.expires<eventDate)throw new ValidationError('batchId','This batch expires before the vaccination date. Choose another batch.');
  if(batch.stock<=0&&useKey(oldUse)!==batch.id)throw new ValidationError('batchId','This vaccine batch has no available doses. Choose another batch.');
  record.batchId=batch.id;
  if(record.administered)newUse={batchId:batch.id,date:record.administered};
 }else delete record.batchId;
 if(useKey(oldUse)!==useKey(newUse)){
  if(oldUse){const oldBatch=next.inventory.find(item=>item.id===oldUse.batchId);if(!oldBatch)throw new ValidationError('batchId','The previous stock allocation needs clinic review before this vaccination can be corrected.');if(oldBatch.stock>=100000)throw new ValidationError('stock','Returning this allocation would exceed the stock limit. Review inventory first.');oldBatch.stock++;}
  if(newUse){if(batch.stock<1)throw new ValidationError('batchId','This vaccine batch has no available doses. Choose another batch.');batch.stock--;}
 }
 if(newUse)record.stockUse=newUse;else delete record.stockUse;
}
// The server applies these operations to its current clinic copy. Patients never
// submit a replacement clinic snapshot. New patient profile IDs are allocated
// globally, and references in subsequent offline operations are remapped together.
export function applyRecordOperations(data,operations,{role,allowedIds=[],allocatePatientIds=false,checkBefore=true,now=today()}={}){
 if(!['staff','patient'].includes(role))throw deny();
 if(!Array.isArray(operations)||!operations.length||operations.length>500)throw new ValidationError('','Submit between 1 and 500 record changes at a time.');
 const next=validateData(data,now),allowed=new Set(allowedIds),idMap={},newLinks=[];
 for(const operation of operations){
  if(!operation||!TYPES.includes(operation.type)||!operation.record||typeof operation.record!=='object'||(operation.originalId!==null&&typeof operation.originalId!=='string'))throw new ValidationError('','Invalid record operation.');
  const type=operation.type,profile=['mothers','children'].includes(type),raw=structuredClone(operation.record);
  if(role==='patient'&&type==='inventory')throw deny();
  const originalId=operation.originalId===null?null:(idMap[operation.originalId]??operation.originalId);
  const previous=originalId?next[type].find(record=>record.id===originalId):null;
  if(originalId&&!previous)throw conflict();
  if(previous&&role==='patient'&&!allowed.has(profile?previous.id:previous.patient))throw deny();
  if(previous&&checkBefore){
   const before=structuredClone(operation.before);
   if(before?.id)before.id=idMap[before.id]??before.id;
   if(before?.patient)before.patient=idMap[before.patient]??before.patient;
   if(canonical(before)!==canonical(previous))throw conflict();
  }
  if(raw.patient)raw.patient=idMap[raw.patient]??raw.patient;
  if(previous)raw.id=previous.id;
  if(profile&&!previous&&role==='patient'&&allocatePatientIds){const requested=raw.id;if(typeof requested!=='string'||!(type==='mothers'?/^M\d{3}$/:/^C\d{3}$/).test(requested))throw new ValidationError('id','Invalid profile identifier.');raw.id=nextProfileId(next,type);idMap[requested]=raw.id;}
  if(!profile&&role==='patient'&&!allowed.has(raw.patient))throw deny();
  if(!profile&&!previous&&(!/^[a-zA-Z0-9-]{16,100}$/.test(raw.id??'')))throw new ValidationError('id','Invalid record identifier.');
  if(!previous&&next[type].some(record=>record.id===raw.id))throw new ValidationError('id','This ID already exists. Open the existing profile to edit it.');
  // Provenance and stock allocations are assigned here, never trusted from a
  // patient's request. Patient edits do not refund or consume physical stock.
  raw.updatedByRole=role;
  if(type==='vaccines'&&role==='patient'){
   if(previous?.stockUse)raw.stockUse=previous.stockUse;else delete raw.stockUse;
   if(previous?.batchId)raw.batchId=previous.batchId;else delete raw.batchId;
  }
  const record=normalize(type,raw,next,{original:previous,preserveId:true,now});
  if(type==='vaccines'&&role==='staff')applyStock(next,previous,record,raw,now);
  if(previous)next[type][next[type].findIndex(item=>item.id===previous.id)]=record;else next[type].push(record);
  if(profile&&!previous){allowed.add(record.id);if(role==='patient')newLinks.push(record.id);}
 }
 return {data:validateData(next,now),idMap,newLinks};
}
