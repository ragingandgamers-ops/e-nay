import {validateData} from '../dist/core.mjs';
import {planRecordDeletion,planRecordRestore} from '../dist/trash-plan.mjs';
export async function handleAdmin(request,env,account,path,method,{bodyOf,reply,ApiError,workspaceFor}){
 const db=env.DB;if(account.role!=='staff')throw new ApiError(403,'Clinic administration is available to staff only.');
 if(path==='/api/admin/accounts'&&method==='GET'){const rows=await db.prepare('SELECT a.id,a.username,a.display_name,a.role,a.active,r.requested_at FROM accounts a LEFT JOIN password_recovery_requests r ON r.account_id=a.id AND r.resolved_at IS NULL ORDER BY a.username').all();return reply({accounts:rows.results.map(r=>({id:r.id,username:r.username,displayName:r.display_name,role:r.role,active:Boolean(r.active),current:r.id===account.id,recoveryRequestedAt:r.requested_at??null}))});}
 if(path==='/api/admin/trash'&&method==='GET'){const rows=await db.prepare("SELECT id,kind,summary,deleted_at,json_extract(body,'$.type') AS record_type FROM trash_entries WHERE restored_at IS NULL ORDER BY deleted_at DESC").all();return reply({entries:rows.results});}
 if(!['/api/admin/delete','/api/admin/restore'].includes(path)||method!=='POST')throw new ApiError(404,'This operation is not available.');
 const input=await bodyOf(request),current=await db.prepare("SELECT * FROM workspace WHERE id='clinic'").first();
 const conditional=" WHERE EXISTS(SELECT 1 FROM workspace WHERE id='clinic' AND last_operation=?)";
 if(path==='/api/admin/delete'){
  if(typeof input.operationId!=='string'||!/^[a-zA-Z0-9-]{16,80}$/.test(input.operationId))throw new ApiError(400,'The deletion identifier is invalid.');
  const receipt=await db.prepare("SELECT * FROM trash_entries WHERE id=?").bind(input.operationId).first();if(receipt){const prior=JSON.parse(receipt.body);if(receipt.deleted_by!==account.id||receipt.kind!==input.kind||prior.id!==input.id||prior.type!==(input.type??null))throw new ApiError(409,'This deletion identifier is already in use.');return reply({deleted:true,...await workspaceFor(db,account)});}
  if(input.baseRevision!==current.revision)throw new ApiError(409,'Clinic records changed. Refresh and review the deletion again.');
  const revision=crypto.randomUUID(),now=Date.now(),statements=[],conditionId=input.operationId;let payload,summary,kind=input.kind;
  if(kind==='record'){
   let plan;try{plan=planRecordDeletion(JSON.parse(current.body),input.type,input.id);}catch(error){throw new ApiError(error.status??400,error.message);}
   payload={id:input.id,type:input.type,records:plan.records,profileIds:plan.profileIds,refundedDoses:plan.refundedDoses};summary=plan.summary;
   statements.push(db.prepare("UPDATE workspace SET body=?,revision=?,last_operation=?,updated_at=? WHERE id='clinic' AND revision=?").bind(JSON.stringify(plan.data),revision,conditionId,now,current.revision));
   statements.push(db.prepare('INSERT INTO trash_entries(id,kind,summary,body,deleted_by,deleted_at) SELECT ?,?,?,?,?,?'+conditional).bind(conditionId,kind,summary,JSON.stringify(payload),account.id,now,conditionId));
   for(const id of plan.profileIds)statements.push(db.prepare('INSERT INTO profile_reservations(profile_id,trash_id) SELECT ?,?'+conditional).bind(id,conditionId,conditionId));
   const ids=JSON.stringify(plan.profileIds);
   statements.push(db.prepare("DELETE FROM companion_links WHERE mother_id IN (SELECT account_id FROM family_accounts WHERE maternal_id IN (SELECT value FROM json_each(?))) AND EXISTS(SELECT 1 FROM workspace WHERE id='clinic' AND last_operation=?)").bind(ids,conditionId));
   statements.push(db.prepare("DELETE FROM pairing_codes WHERE mother_id IN (SELECT account_id FROM family_accounts WHERE maternal_id IN (SELECT value FROM json_each(?))) AND EXISTS(SELECT 1 FROM workspace WHERE id='clinic' AND last_operation=?)").bind(ids,conditionId));
   statements.push(db.prepare("UPDATE family_accounts SET maternal_id=NULL WHERE maternal_id IN (SELECT value FROM json_each(?)) AND EXISTS(SELECT 1 FROM workspace WHERE id='clinic' AND last_operation=?)").bind(ids,conditionId));
   statements.push(db.prepare("DELETE FROM patient_links WHERE patient_id IN (SELECT value FROM json_each(?)) AND EXISTS(SELECT 1 FROM workspace WHERE id='clinic' AND last_operation=?)").bind(ids,conditionId));
  }else if(kind==='account'){
   const target=await db.prepare("SELECT id,username,display_name,role,active FROM accounts WHERE id=?").bind(input.id??'').first();if(!target?.active)throw new ApiError(409,'This account is already inactive. Refresh the account list.');
   if(target.id===account.id)throw new ApiError(409,'You cannot delete the account you are currently using.');
   if(target.role==='staff'&&(await db.prepare("SELECT count(*) AS n FROM accounts WHERE role='staff' AND active=1").first()).n<=1)throw new ApiError(409,'Keep at least one active staff account.');
   payload={id:target.id,type:null,role:target.role};summary=target.display_name+' · @'+target.username;
   statements.push(db.prepare("UPDATE workspace SET revision=?,last_operation=?,updated_at=? WHERE id='clinic' AND revision=? AND EXISTS(SELECT 1 FROM accounts WHERE id=? AND active=1 AND role=? AND id<>? AND (role<>'staff' OR (SELECT count(*) FROM accounts WHERE active=1 AND role='staff')>1))").bind(revision,conditionId,now,current.revision,target.id,target.role,account.id));
   statements.push(db.prepare("UPDATE accounts SET active=0 WHERE id=? AND active=1 AND EXISTS(SELECT 1 FROM workspace WHERE id='clinic' AND last_operation=?)").bind(target.id,conditionId));
   statements.push(db.prepare('DELETE FROM sessions WHERE account_id=?'+conditional.replace(' WHERE EXISTS',' AND EXISTS')).bind(target.id,conditionId));
   statements.push(db.prepare('DELETE FROM password_recovery_codes WHERE (account_id=? OR issued_by=?)'+conditional.replace(' WHERE EXISTS',' AND EXISTS')).bind(target.id,target.id,conditionId));
   statements.push(db.prepare("DELETE FROM companion_links WHERE (father_id=? OR mother_id=?) AND EXISTS(SELECT 1 FROM workspace WHERE id='clinic' AND last_operation=?)").bind(target.id,target.id,conditionId));
   statements.push(db.prepare("DELETE FROM pairing_codes WHERE mother_id=? AND EXISTS(SELECT 1 FROM workspace WHERE id='clinic' AND last_operation=?)").bind(target.id,conditionId));
   statements.push(db.prepare('INSERT INTO trash_entries(id,kind,summary,body,deleted_by,deleted_at) SELECT ?,?,?,?,?,?'+conditional).bind(conditionId,kind,summary,JSON.stringify(payload),account.id,now,conditionId));
  }else throw new ApiError(400,'Choose a record or account to delete.');
  statements.push(db.prepare("INSERT INTO audit_events(id,account_id,action,revision,created_at) SELECT ?,?,'move-to-trash',?,?"+conditional).bind(conditionId,account.id,revision,now,conditionId));
  let results;try{results=await db.batch(statements);}catch{throw new ApiError(409,'The deletion could not be applied. Previous records are intact; refresh and review again.');}
  if(results[0].meta.changes!==1)throw new ApiError(409,'Clinic records or staff access changed. Refresh and review the deletion again.');
  return reply({deleted:true,...await workspaceFor(db,account)});
 }
 const entry=await db.prepare("SELECT * FROM trash_entries WHERE id=?").bind(input.trashId??'').first();if(!entry)throw new ApiError(404,'This item is not in Trash.');if(entry.restored_at!==null)return reply({restored:true,...await workspaceFor(db,account)});
 if(input.baseRevision!==current.revision)throw new ApiError(409,'Clinic records changed. Refresh and review the restore again.');
 const payload=JSON.parse(entry.body),operation=crypto.randomUUID(),revision=crypto.randomUUID(),now=Date.now(),statements=[];let resetReservations=0;
 if(entry.kind==='record'){
  let plan;try{plan=planRecordRestore(JSON.parse(current.body),payload);}catch(error){throw new ApiError(error.status??400,error.message);}resetReservations=plan.resetReservations;if(new TextEncoder().encode(JSON.stringify(plan.data)).length>1498000)throw new ApiError(413,'The restored workspace would exceed its size limit. Nothing was changed.');
  statements.push(db.prepare("UPDATE workspace SET body=?,revision=?,last_operation=?,updated_at=? WHERE id='clinic' AND revision=?").bind(JSON.stringify(plan.data),revision,operation,now,current.revision));
  statements.push(db.prepare('DELETE FROM profile_reservations WHERE trash_id=?'+conditional.replace(' WHERE EXISTS',' AND EXISTS')).bind(entry.id,operation));
 }else{
  const target=await db.prepare("SELECT role,active FROM accounts WHERE id=?").bind(payload.id).first();if(!target||target.role!==payload.role)throw new ApiError(409,'This account needs an administrator review before restoration.');
  statements.push(db.prepare("UPDATE workspace SET revision=?,last_operation=?,updated_at=? WHERE id='clinic' AND revision=?").bind(revision,operation,now,current.revision));
  statements.push(db.prepare('UPDATE accounts SET active=1 WHERE id=?'+conditional.replace(' WHERE EXISTS',' AND EXISTS')).bind(payload.id,operation));
 }
 statements.push(db.prepare("UPDATE trash_entries SET restored_at=? WHERE id=? AND restored_at IS NULL AND EXISTS(SELECT 1 FROM workspace WHERE id='clinic' AND last_operation=?)").bind(now,entry.id,operation));
 statements.push(db.prepare("INSERT INTO audit_events(id,account_id,action,revision,created_at) SELECT ?,?,'restore-from-trash',?,?"+conditional).bind(operation,account.id,revision,now,operation));
 const changed=await db.batch(statements);if(changed[0].meta.changes!==1)throw new ApiError(409,'Clinic records changed. Refresh and review the restore again.');
 return reply({restored:true,resetReservations,...await workspaceFor(db,account)});
}
