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
const vaccineKey=value=>String(value??'').normalize('NFC').trim().replace(/\s+/gu,' ').toLowerCase();
function applyStock(next,previous,record,raw,now){
 const oldUse=previous?.stockUse;
 const inactive=record.approvalStatus&&record.approvalStatus!=='Approved';
 const clinic=!inactive&&(raw.stockMode==='clinic'||(raw.stockMode!=='external'&&Boolean(raw.batchId)));
 if(inactive&&previous?.administered)throw new ValidationError('approvalStatus','An administered vaccination cannot be cancelled or declined. Ask clinic staff to review a correction.');
 let batch,newUse;
 if(clinic){
  batch=next.inventory.find(item=>item.id===raw.batchId);
  if(!batch)throw new ValidationError('batchId','Choose an existing vaccine batch, or choose vaccination recorded elsewhere.');
  if(vaccineKey(batch.vaccine)!==vaccineKey(record.vaccine))throw new ValidationError('vaccine','The vaccine must match the selected inventory batch.');
  record.vaccine=batch.vaccine;
  if(record.approvalStatus==='Approved'&&!record.administered&&record.scheduled<now&&(!oldUse||oldUse.kind!=='reserved'||previous.scheduled!==record.scheduled))throw new ValidationError('scheduled','Choose today or a later appointment date when reserving a clinic dose.');
  const eventDate=record.administered||record.scheduled;
  if(batch.expires<eventDate)throw new ValidationError('batchId','This batch expires before the vaccination date. Choose another batch.');
  if(batch.stock<=0&&useKey(oldUse)!==batch.id)throw new ValidationError('batchId','This vaccine batch has no available doses. Choose another batch.');
  record.batchId=batch.id;
  if(record.approvalStatus==='Approved')newUse={batchId:batch.id,date:eventDate,kind:record.administered?'administered':'reserved'};
  else if(record.administered)newUse={batchId:batch.id,date:record.administered,kind:'administered'};
 }else delete record.batchId;
 if(useKey(oldUse)!==useKey(newUse)){
  if(oldUse){const oldBatch=next.inventory.find(item=>item.id===oldUse.batchId);if(!oldBatch)throw new ValidationError('batchId','The previous stock allocation needs clinic review before this vaccination can be corrected.');if(oldBatch.stock>=100000)throw new ValidationError('stock','Returning this allocation would exceed the stock limit. Review inventory first.');oldBatch.stock++;}
  if(newUse){if(batch.stock<1)throw new ValidationError('batchId','This vaccine batch has no available doses. Choose another batch.');batch.stock--;}
 }
 if(newUse)record.stockUse=newUse;else delete record.stockUse;
}

function prepareVaccination(next,previous,raw,role){
 if(role==='patient'){
  if(previous&&previous.approvalStatus!=='Pending verification')throw recordError(403,'Patients can change only pending vaccination requests. Contact clinic staff about approved doses or vaccination history.');
  const cancelling=previous&&raw.approvalStatus==='Cancelled';
  raw.approvalStatus=cancelling?'Cancelled':'Pending verification';
  raw.requestedVaccine=raw.vaccine;
  raw.preferredDate=raw.preferredDate??previous?.preferredDate??raw.scheduled??'';
  raw.requestNotes=raw.requestNotes??previous?.requestNotes??raw.notes??'';
  raw.reviewNotes=previous?.reviewNotes??'';raw.notes=previous?.notes??'';
  raw.scheduled='';raw.administered='';delete raw.batchId;delete raw.stockUse;
  if(previous&&raw.patient!==previous.patient)throw new ValidationError('patient','A vaccination request cannot be moved to another patient. Submit a new request instead.');
  if(!previous&&next.vaccines.some(item=>item.patient===raw.patient&&['Pending verification','Approved'].includes(item.approvalStatus)&&!item.administered&&vaccineKey(item.vaccine)===vaccineKey(raw.vaccine)))throw new ValidationError('vaccine','You already have a pending or approved request for this vaccine. Open that request or contact the clinic.');
 }else{
  raw.approvalStatus=raw.approvalStatus??previous?.approvalStatus??'Approved';
  if(previous?.approvalStatus&&raw.patient!==previous.patient)throw new ValidationError('patient','A vaccination request cannot be moved to another patient. Submit a new request instead.');
  raw.notes=raw.notes??previous?.notes??'';raw.dose=raw.dose??previous?.dose??'';
  raw.preferredDate=previous?.preferredDate??raw.preferredDate??'';
  raw.requestNotes=previous?.requestNotes??raw.requestNotes??'';
  raw.reviewNotes=raw.reviewNotes??previous?.reviewNotes??'';
  if(previous?.requestedVaccine!==undefined)raw.requestedVaccine=previous.requestedVaccine;else if(previous?.approvalStatus==='Pending verification')raw.requestedVaccine=previous.vaccine;else delete raw.requestedVaccine;
  if(previous?.approvalStatus==='Pending verification'&&raw.approvalStatus==='Approved'){if(vaccineKey(previous.vaccine)!==vaccineKey(raw.vaccine)&&![true,'on'].includes(raw.confirmVaccineChange))throw new ValidationError('confirmVaccineChange','Verify the selected inventory vaccine against the patient’s request before approving.');raw.stockMode='clinic';}
  if(raw.approvalStatus!=='Approved'){raw.scheduled='';raw.administered='';delete raw.batchId;delete raw.stockUse;}
 }
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
  if(role==='patient'&&type==='guides')throw recordError(403,'Only clinic staff can create, edit or publish care guides.');
  if(role==='patient'&&type==='inventory')throw deny();
  const originalId=operation.originalId===null?null:(idMap[operation.originalId]??operation.originalId);
  const previous=originalId?next[type].find(record=>record.id===originalId):null;
  if(originalId&&!previous)throw conflict();
  if(previous&&role==='patient'&&!allowed.has(profile?previous.id:previous.patient))throw deny();
  if(previous&&checkBefore){
   const before=structuredClone(operation.before);
   if(before?.id)before.id=idMap[before.id]??before.id;
   if(before?.patient)before.patient=idMap[before.patient]??before.patient;
   if(before?.motherId)before.motherId=idMap[before.motherId]??before.motherId;
   if(canonical(before)!==canonical(previous))throw conflict();
  }
  if(raw.patient)raw.patient=idMap[raw.patient]??raw.patient;
  if(type==='children'){
   if(raw.motherId===undefined&&previous?.motherId)raw.motherId=previous.motherId;
   if(raw.motherId){raw.motherId=idMap[raw.motherId]??raw.motherId;raw.motherId=String(raw.motherId).trim().toUpperCase();
    const changed=raw.motherId!==previous?.motherId;
    if(role==='patient'&&changed&&!allowed.has(raw.motherId))throw recordError(403,'Choose a mother’s profile linked to your account.');
    if(changed&&!next.mothers.some(m=>m.id===raw.motherId))throw new ValidationError('motherId','Choose an existing mother’s profile, or enter her name instead.');
   }
  }
  if(previous)raw.id=previous.id;
  if(profile&&!previous&&role==='patient'&&allocatePatientIds){const requested=raw.id;if(typeof requested!=='string'||!(type==='mothers'?/^M\d{3}$/:/^C\d{3}$/).test(requested))throw new ValidationError('id','Invalid profile identifier.');raw.id=nextProfileId(next,type);idMap[requested]=raw.id;}
  if(!profile&&role==='patient'&&!allowed.has(raw.patient))throw deny();
  if(!profile&&!previous&&(!/^[a-zA-Z0-9-]{16,100}$/.test(raw.id??'')))throw new ValidationError('id','Invalid record identifier.');
  if(!previous&&next[type].some(record=>record.id===raw.id))throw new ValidationError('id','This ID already exists. Open the existing profile to edit it.');
  // Provenance and stock allocations are assigned here, never trusted from a
  // patient's request. Patient requests do not reserve, refund or consume physical stock.
  raw.updatedByRole=role;
  if(type==='guides')raw.updatedOn=now;
  if(type==='vaccines')prepareVaccination(next,previous,raw,role);
  const record=normalize(type,raw,next,{original:previous,preserveId:true,now});
  if(type==='vaccines'&&role==='staff')applyStock(next,previous,record,raw,now);
  if(previous)next[type][next[type].findIndex(item=>item.id===previous.id)]=record;else next[type].push(record);
  if(profile&&!previous){allowed.add(record.id);if(role==='patient')newLinks.push(record.id);}
 }
 return {data:validateData(next,now),idMap,newLinks};
}
