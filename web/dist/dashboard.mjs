import {today,vaccinationNeedsReview,patientById,stockStatus} from './core.mjs';

export const TASK_KINDS=['requests','overdue','today','followups','growth','stock'];
const byDate=(a,b)=>(a.date||'9999').localeCompare(b.date||'9999')||a.record.id.localeCompare(b.record.id);
function latestByPatient(records){const result=new Map();for(const record of records){const previous=result.get(record.patient);if(!previous||record.date>=previous.date)result.set(record.patient,record);}return [...result.values()];}
export function clinicTasks(data,now=today()){
 const approved=data.vaccines.filter(r=>!r.administered&&r.scheduled&&!vaccinationNeedsReview(r)&&(!r.approvalStatus||r.approvalStatus==='Approved'));
 const item=(kind,record,date)=>({kind,record,date,patient:record.patient?patientById(data,record.patient):null});
 return {
  requests:data.vaccines.filter(vaccinationNeedsReview).map(r=>item('requests',r,r.preferredDate)).sort(byDate),
  overdue:approved.filter(r=>r.scheduled<now).map(r=>item('overdue',r,r.scheduled)).sort(byDate),
  today:approved.filter(r=>r.scheduled===now).map(r=>item('today',r,r.scheduled)).sort(byDate),
  followups:latestByPatient(data.visits).filter(r=>r.followUp&&r.followUp<=now).map(r=>item('followups',r,r.followUp)).sort(byDate),
  // A new unassessed measurement does not resolve an earlier staff review flag.
  growth:latestByPatient(data.growth.filter(r=>r.assessment!=='Not assessed')).filter(r=>r.assessment==='Follow-up needed').map(r=>item('growth',r,r.date)).sort(byDate),
  // An expired batch with no doses left needs no disposal action.
  stock:data.inventory.filter(r=>r.expires<now?r.stock>0:r.stock<=r.threshold).map(r=>item('stock',r,r.expires)).sort((a,b)=>Number(stockStatus(a.record,now)!=='Expired')-Number(stockStatus(b.record,now)!=='Expired')||a.record.stock-b.record.stock||byDate(a,b))
 };
}
