import {TYPES,validateData} from '../dist/core.mjs';
import {planRecordDeletion} from '../dist/trash-plan.mjs';

const eraseError=message=>Object.assign(new Error(message),{status:409});
export async function readHealthArchives(request,env,actor,{reply,ApiError}){
 if(actor.role!=='staff')throw new ApiError(403,'Archived health records are available to clinic staff only.');
 const url=new URL(request.url),id=url.pathname.split('/')[4];
 if(id){const row=await env.DB.prepare('SELECT id,summary,body,counts,archived_at FROM health_archives WHERE id=?').bind(id).first();if(!row)throw new ApiError(404,'This health archive was not found.');return reply({archive:{id:row.id,summary:row.summary,archivedAt:row.archived_at,counts:JSON.parse(row.counts),snapshot:JSON.parse(row.body)}});}
 const query=(url.searchParams.get('query')??'').slice(0,100).toLowerCase(),search='%'+query.replace(/[\\%_]/g,c=>'\\'+c)+'%',size=10;
 const total=(await env.DB.prepare("SELECT count(*) AS n FROM health_archives WHERE search_text LIKE ? ESCAPE '\\'").bind(search).first()).n,pages=Math.max(1,Math.ceil(total/size)),page=Math.min(pages,Math.max(1,Math.trunc(Number(url.searchParams.get('page')))||1));
 const rows=await env.DB.prepare("SELECT id,summary,counts,archived_at FROM health_archives WHERE search_text LIKE ? ESCAPE '\\' ORDER BY archived_at DESC,id LIMIT ? OFFSET ?").bind(search,size,(page-1)*size).all();
 return reply({items:rows.results.map(row=>({id:row.id,summary:row.summary,archivedAt:row.archived_at,counts:JSON.parse(row.counts)})),page,pages,total,start:total?(page-1)*size+1:0,end:Math.min(page*size,total)});
}
export function deletionTargets(input){
 if(!Array.isArray(input)||!input.length||input.length>100)throw eraseError('Select between 1 and 100 items to delete.');
 const targets=input.map(x=>{if(!x||!['account','record','trash'].includes(x.kind)||typeof x.id!=='string'||!x.id||x.id.length>100||(x.kind==='record'&&!TYPES.includes(x.type)))throw eraseError('Choose valid accounts or records to delete.');return {kind:x.kind,type:x.kind==='record'?x.type:null,id:x.id};});
 return [...new Map(targets.map(x=>[JSON.stringify(x),x])).values()].sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
}
async function archivePlan(db,actor,targets,current){
 const data=validateData(JSON.parse(current.body)),accounts=(await db.prepare('SELECT a.id,a.username,a.display_name,a.role,a.active,f.kind,f.maternal_id FROM accounts a LEFT JOIN family_accounts f ON f.account_id=a.id').all()).results,links=(await db.prepare('SELECT account_id,patient_id FROM patient_links').all()).results,trash=(await db.prepare('SELECT id,kind,body,summary FROM trash_entries').all()).results;
 const accountIds=new Set(),profileIds=new Set(),trashIds=new Set(),recordIds=Object.fromEntries(TYPES.map(type=>[type,new Set()])),labels=[];
 function record(type,id){recordIds[type].add(id);if(['mothers','children'].includes(type))profileIds.add(id);}
 for(const target of targets){
  if(target.kind==='account'){const a=accounts.find(a=>a.id===target.id);if(!a)throw eraseError('An account no longer exists. Refresh and review the selection.');accountIds.add(a.id);labels.push(a.display_name+' · @'+a.username);}
  else if(target.kind==='record'){const r=data[target.type].find(r=>r.id===target.id);if(!r)throw eraseError('A selected record no longer exists. Refresh and review the selection.');record(target.type,target.id);labels.push((r.name??r.title??r.vaccine??r.date??r.id)+' · '+r.id);}
  else{const entry=trash.find(t=>t.id===target.id);if(!entry)throw eraseError('A selected item is no longer in Trash.');trashIds.add(entry.id);labels.push(entry.summary);const p=JSON.parse(entry.body);if(entry.kind==='account')accountIds.add(p.id);else for(const type of ['mothers','children'])for(const r of p.records?.[type]??[])record(type,r.id);}
 }
 if(accountIds.has(actor.id))throw eraseError('You cannot delete the account you are currently using.');
 if(!accounts.some(a=>a.active&&a.role==='staff'&&!accountIds.has(a.id)))throw eraseError('Keep at least one active staff account.');
 for(const a of accounts.filter(a=>accountIds.has(a.id))){
  if(a.maternal_id)record('mothers',a.maternal_id);
  // Legacy guardian accounts may predate the personal-mother account model.
  for(const link of links.filter(l=>l.account_id===a.id))if(!accounts.some(other=>other.id!==a.id&&!accountIds.has(other.id)&&other.maternal_id===link.patient_id)&&!links.some(l=>l.patient_id===link.patient_id&&!accountIds.has(l.account_id)))record(link.patient_id.startsWith('M')?'mothers':'children',link.patient_id);
 }
 // Include archived children too, and erase old restored snapshots as well.
 // No Trash bundle may reattach a deleted person's history to a reused number.
 let expanded=true;while(expanded){const before=profileIds.size+trashIds.size;
  for(const c of data.children)if(profileIds.has(c.motherId))record('children',c.id);
  for(const type of ['visits','vaccines','growth'])for(const r of data[type])if(profileIds.has(r.patient))record(type,r.id);
  for(const entry of trash){const p=JSON.parse(entry.body);
   const related=entry.kind==='account'?accountIds.has(p.id):TYPES.some(type=>(p.records?.[type]??[]).some(r=>recordIds[type].has(r.id)||profileIds.has(r.patient)||profileIds.has(r.motherId)));
   if(trashIds.has(entry.id)||related){trashIds.add(entry.id);for(const type of ['mothers','children'])for(const r of p.records?.[type]??[])record(type,r.id);}
  }
  expanded=profileIds.size+trashIds.size>before;
 }
 let next=data,refundedDoses=0;const counts=Object.fromEntries(TYPES.map(type=>[type,0])),records=Object.fromEntries(TYPES.map(type=>[type,[]]));
 for(const type of ['vaccines','visits','growth','children','mothers','inventory','guides'])for(const id of recordIds[type])if(next[type].some(r=>r.id===id)){const plan=planRecordDeletion(next,type,id);next=plan.data;refundedDoses+=plan.refundedDoses;for(const key of TYPES){counts[key]+=plan.counts[key];records[key].push(...plan.records[key]);}}
 const relatedPatients=new Set([...profileIds,...['visits','vaccines','growth'].flatMap(type=>records[type].map(r=>r.patient))]);
 const archive={format:'enay-health-archive-v1',accounts:accounts.filter(a=>accountIds.has(a.id)),patients:[...data.mothers,...data.children].filter(p=>relatedPatients.has(p.id)),records,priorArchives:trash.filter(t=>trashIds.has(t.id)).map(t=>({id:t.id,kind:t.kind,summary:t.summary,payload:JSON.parse(t.body)}))};
 return {data:next,archive,accountIds:[...accountIds],profileIds:[...profileIds],trashIds:[...trashIds],labels,counts,refundedDoses};
}
export async function handleArchiveDeletion(request,env,actor,path,{bodyOf,reply,ApiError,workspaceFor}){
 if(actor.role!=='staff')throw new ApiError(403,'Clinic administration is available to staff only.');
 const db=env.DB,input=await bodyOf(request);let targets;try{targets=deletionTargets(input.targets);}catch(error){throw new ApiError(400,error.message);}const signature=JSON.stringify(targets);
 if(path==='/api/admin/archive-delete'){
  if(input.confirmed!==true||!/^[a-zA-Z0-9-]{16,80}$/.test(input.operationId??''))throw new ApiError(400,'Review and confirm the archive and account deletion.');
  const receipt=await db.prepare('SELECT * FROM archive_delete_operations WHERE id=?').bind(input.operationId).first();if(receipt){if(receipt.account_id!==actor.id||receipt.targets!==signature)throw new ApiError(409,'This deletion identifier is already in use.');return reply({deleted:true,...await workspaceFor(db,actor)});}
 }
 const current=await db.prepare("SELECT * FROM workspace WHERE id='clinic'").first();let plan;try{plan=await archivePlan(db,actor,targets,current);}catch(error){throw new ApiError(error.status??409,error.message);}
 if(path==='/api/admin/archive-preview')return reply({baseRevision:current.revision,targets,labels:plan.labels,counts:plan.counts,accounts:plan.accountIds.length,trash:plan.trashIds.length,refundedDoses:plan.refundedDoses,profileIds:plan.profileIds});
 if(input.baseRevision!==current.revision)throw new ApiError(409,'Clinic records changed. Refresh and review the deletion again.');
 const operation=input.operationId,revision=crypto.randomUUID(),now=Date.now(),condition=" AND EXISTS(SELECT 1 FROM workspace WHERE id='clinic' AND last_operation=?)",accounts=JSON.stringify(plan.accountIds),profiles=JSON.stringify(plan.profileIds),trash=JSON.stringify(plan.trashIds),selectedAccounts='SELECT value FROM json_each(?)',statements=[
  db.prepare("UPDATE workspace SET body=?,revision=?,last_operation=?,updated_at=? WHERE id='clinic' AND revision=? AND EXISTS(SELECT 1 FROM accounts WHERE id=? AND active=1 AND role='staff') AND EXISTS(SELECT 1 FROM accounts WHERE active=1 AND role='staff' AND id NOT IN (SELECT value FROM json_each(?)))").bind(JSON.stringify(plan.data),revision,operation,now,current.revision,actor.id,accounts),
  // The archive is committed in the SAME transaction as removing active data.
  // Its UUID is independent of recyclable M/C display numbers. No purge route exists.
  db.prepare("INSERT INTO health_archives(id,summary,search_text,body,counts,archived_by,archived_at) SELECT ?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM workspace WHERE id='clinic' AND last_operation=?)").bind(operation,plan.labels.join('; '),[...plan.labels,...plan.profileIds,...plan.archive.patients.map(p=>p.name)].join(' ').toLowerCase(),JSON.stringify(plan.archive),JSON.stringify(plan.counts),actor.id,now,operation),
  db.prepare('DELETE FROM sessions WHERE account_id IN ('+selectedAccounts+')'+condition).bind(accounts,operation),
  db.prepare('DELETE FROM password_recovery_codes WHERE (account_id IN ('+selectedAccounts+') OR issued_by IN ('+selectedAccounts+'))'+condition).bind(accounts,accounts,operation),
  db.prepare('DELETE FROM password_recovery_requests WHERE account_id IN ('+selectedAccounts+')'+condition).bind(accounts,operation),
  db.prepare('DELETE FROM companion_links WHERE (father_id IN ('+selectedAccounts+') OR mother_id IN ('+selectedAccounts+') OR mother_id IN (SELECT account_id FROM family_accounts WHERE maternal_id IN (SELECT value FROM json_each(?))))'+condition).bind(accounts,accounts,profiles,operation),
  db.prepare('DELETE FROM pairing_codes WHERE (mother_id IN ('+selectedAccounts+') OR mother_id IN (SELECT account_id FROM family_accounts WHERE maternal_id IN (SELECT value FROM json_each(?))))'+condition).bind(accounts,profiles,operation),
  db.prepare('DELETE FROM patient_links WHERE (account_id IN ('+selectedAccounts+') OR patient_id IN (SELECT value FROM json_each(?)))'+condition).bind(accounts,profiles,operation),
  db.prepare('UPDATE family_accounts SET maternal_id=NULL WHERE maternal_id IN (SELECT value FROM json_each(?))'+condition).bind(profiles,operation),
  db.prepare('DELETE FROM family_accounts WHERE account_id IN ('+selectedAccounts+')'+condition).bind(accounts,operation),
  db.prepare('DELETE FROM accounts WHERE id IN ('+selectedAccounts+')'+condition).bind(accounts,operation),
  db.prepare('DELETE FROM profile_reservations WHERE (profile_id IN (SELECT value FROM json_each(?)) OR trash_id IN (SELECT value FROM json_each(?)))'+condition).bind(profiles,trash,operation),
  db.prepare('DELETE FROM trash_entries WHERE id IN (SELECT value FROM json_each(?))'+condition).bind(trash,operation),
  db.prepare("UPDATE workspace_epoch SET epoch=? WHERE id='clinic'"+condition).bind(revision,operation),
  db.prepare("INSERT INTO archive_delete_operations(id,account_id,targets,revision,created_at) SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM workspace WHERE id='clinic' AND last_operation=?)").bind(operation,actor.id,signature,revision,now,operation),
  db.prepare("INSERT INTO audit_events(id,account_id,action,revision,created_at) SELECT ?,?,'archive-delete',?,? WHERE EXISTS(SELECT 1 FROM workspace WHERE id='clinic' AND last_operation=?)").bind(operation,actor.id,revision,now,operation)
 ];
 let results;try{results=await db.batch(statements);}catch{throw new ApiError(409,'The deletion could not be applied. Nothing was deleted; refresh and review again.');}if(results[0].meta.changes!==1)throw new ApiError(409,'Clinic records or staff access changed. Nothing was deleted; review again.');
 return reply({deleted:true,...await workspaceFor(db,actor)});
}
