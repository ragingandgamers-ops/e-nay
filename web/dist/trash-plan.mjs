import {TYPES,validateData,today} from './core.mjs';
const trashFailure=message=>Object.assign(new Error(message),{status:409});
export function planRecordDeletion(source,type,id){
 if(!TYPES.includes(type))throw trashFailure('Choose a valid record type.');
 const data=validateData(source),target=data[type].find(r=>r.id===id);if(!target)throw trashFailure('This record is no longer available. Refresh the clinic copy.');
 const records=Object.fromEntries(TYPES.map(t=>[t,[]])),profileIds=['mothers','children'].includes(type)?[id]:[];
 if(type==='inventory'&&data.vaccines.some(v=>v.stockUse?.batchId===id))throw trashFailure('This batch is referenced by a vaccination. Move those vaccination records to Trash first, or keep the batch for their history.');
 for(const t of TYPES){const removing=data[t].filter(r=>(t===type&&r.id===id)||(profileIds.length&&['visits','vaccines','growth'].includes(t)&&r.patient===id));records[t]=removing;const ids=new Set(removing.map(r=>r.id));data[t]=data[t].filter(r=>!ids.has(r.id));}
 let refundedDoses=0;
 for(const v of records.vaccines)if(v.stockUse?.kind==='reserved'&&!v.administered){const batch=data.inventory.find(b=>b.id===v.stockUse.batchId);if(!batch)throw trashFailure('The reserved vaccine batch needs review before this record can be removed.');if(batch.stock>=100000)throw trashFailure('Returning a reserved dose would exceed the stock limit. Review inventory first.');batch.stock++;refundedDoses++;}
 const person=[...source.mothers,...source.children].find(p=>p.id===target.patient);const summary=['mothers','children'].includes(type)?target.name+' · '+id:type==='inventory'?target.vaccine+' · '+target.batch:person?person.name+' · '+(target.vaccine??target.date??id):target.title??target.vaccine??id;
 return {data:validateData(data),records,profileIds,refundedDoses,summary,counts:Object.fromEntries(TYPES.map(t=>[t,records[t].length]))};
}
export function planRecordRestore(source,payload){
 const data=validateData(source),records=structuredClone(payload.records);let resetReservations=0;
 for(const type of TYPES)for(const record of records[type]??[]){if(data[type].some(r=>r.id===record.id))throw trashFailure('A record with this ID is already active. Nothing was overwritten.');if(type==='growth'&&data.growth.some(r=>r.patient===record.patient&&r.date===record.date))throw trashFailure('A measurement already exists for this child and date. Review that active entry before restoring this one.');if(type==='vaccines'&&record.stockUse?.kind==='reserved'&&!record.administered){record.approvalStatus='Cancelled';record.scheduled='';record.administered='';delete record.batchId;delete record.stockUse;resetReservations++;}}
 for(const type of TYPES)data[type].push(...records[type]);
 for(const v of data.vaccines)if(v.stockUse&&!data.inventory.some(b=>b.id===v.stockUse.batchId))throw trashFailure('Restore the referenced vaccine batch before restoring this vaccination history.');
 try{return {data:validateData(data),resetReservations};}catch(error){throw trashFailure('Restore needs review: '+error.message);}
}
