import {label,ui} from './language.mjs';
import {today,patientById,stockStatus} from './core.mjs';
import {clinicTasks,TASK_KINDS} from './dashboard.mjs';
import {icon} from './icons.mjs';
const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=date=>date?label('{date}',{date:{date,format:'short'}}):label('No preferred date');
const config={
 requests:{title:'Requests to review',action:'Review vaccination requests',clear:'No requests awaiting review',icon:'vaccines',description:'Confirm the requested vaccine, check availability, then approve or respond to the family.'},
 overdue:{title:'Overdue vaccinations',action:'Follow up overdue appointments',clear:'No overdue vaccinations',icon:'vaccines',description:'Approved appointments whose dates have passed, with no administration recorded. Contact the family and review the appointment.'},
 today:{title:'Vaccinations today',action:'Open today’s appointments',clear:'No vaccinations scheduled today',icon:'vaccines',description:'Approved vaccinations scheduled for today. Check the appointment before recording administration.'},
 followups:{title:'Follow-ups due',action:'Open follow-ups due',clear:'No follow-ups due',icon:'visits',description:'The latest visit for each patient has a follow-up date today or earlier. Record the next visit to update the care history.'},
 growth:{title:'Growth reviews flagged',action:'Review flagged measurements',clear:'No growth reviews flagged',icon:'growth',description:'The latest recorded assessment for each child still says Follow-up needed. Review the measurement and update the assessment.'},
 stock:{title:'Stock needing action',action:'Review vaccine stock',clear:'No vaccine stock alerts',icon:'inventory',description:'Available doses are at or below the alert level, or an expired batch still has doses. Empty expired batches are excluded.'}
};
export const taskTitle=kind=>config[kind]?.title??'Clinic tasks';
function taskRow(item,data){
 const {kind,record:r,patient}=item,profile=patient??patientById(data,r.patient),name=profile?`${profile.name} · ${profile.id}`:'',href=profile?`#workspace/${profile.id.startsWith('M')?'mothers':'children'}/${profile.id}`:'';
 let detail,status,action;
 if(kind==='stock'){
  detail=label('Batch {batch} · {count} available doses · Expires {date}',{batch:r.batch,count:r.stock,date:{date:r.expires,format:'short'}});status=stockStatus(r);
  action=ui`<button class="row-button" data-edit="inventory" data-id="${escape(r.id)}">Review stock ↗</button>`;
 }else if(kind==='requests'){
  detail=ui`${escape(r.vaccine)} · ${fmt(r.preferredDate)}`;status='Awaiting review';action=ui`<button class="row-button" data-review-vaccination="${escape(r.id)}">Review request ↗</button>`;
 }else if(kind==='followups'){
  detail=ui`${label('Follow-up date')}: ${fmt(r.followUp)}`;status=r.followUp<today()?'Overdue':'Due today';action=ui`<button class="row-button" data-add="visits" data-patient="${escape(r.patient)}">Record follow-up ↗</button>`;
 }else if(kind==='growth'){
  detail=ui`${fmt(r.date)} · ${r.weight} kg · ${r.height} cm`;status='Follow-up needed';action=ui`<button class="row-button" data-edit="growth" data-id="${escape(r.id)}">Review measurement ↗</button>`;
 }else{
  detail=ui`${escape(r.vaccine)} · ${escape(r.dose)} · ${fmt(r.scheduled)}`;status=kind==='overdue'?'Overdue':r.scheduled===today()?'Due today':'Approved / scheduled';action=ui`<button class="row-button" data-edit="vaccines" data-id="${escape(r.id)}">Open appointment ↗</button>`;
 }
 return ui`<div class="action-row task-row" data-task-kind="${kind}" data-task-id="${escape(r.id)}"><div>${kind==='stock'?ui`<strong>${escape(r.vaccine)}</strong>`:ui`<strong><a class="profile-name-link" href="${href}">${escape(name)}</a></strong>`}<small>${detail}</small></div><div class="row-actions"><span class="badge ${['Expired','Overdue'].includes(status)?'danger':'warning'}">${label(status)}</span>${action}</div></div>`;
}
export function renderStaffDashboard(data){
 const tasks=clinicTasks(data),priorities=[...tasks.overdue,...tasks.stock.filter(i=>stockStatus(i.record)==='Expired'),...tasks.followups,...tasks.requests,...tasks.today,...tasks.growth,...tasks.stock.filter(i=>stockStatus(i.record)!=='Expired')].slice(0,6);
 const upcoming=data.vaccines.filter(r=>!r.administered&&r.approvalStatus==='Approved'&&r.scheduled>=today()).sort((a,b)=>a.scheduled.localeCompare(b.scheduled)).slice(0,4);
 const recent=[...data.visits].sort((a,b)=>b.date.localeCompare(a.date)).slice(0,4);
 return ui`<div class="dashboard-intro"><div><h2>What needs attention?</h2><p>Choose a task to see the records and take the next step. Counts use recorded dates and review flags.</p></div></div><div class="metrics task-metrics">${TASK_KINDS.map(kind=>{const items=tasks[kind],cfg=config[kind],tone=!items.length?'is-clear':kind==='overdue'||kind==='stock'&&items.some(i=>stockStatus(i.record)==='Expired')?'is-urgent':'is-attention';return ui`<a class="metric task-metric ${tone}" href="#workspace/tasks/${kind}" data-task-card="${kind}"><span class="metric-icon" aria-hidden="true">${icon(cfg.icon)}</span><b>${items.length}</b><span class="metric-title">${label(cfg.title)}</span><small class="metric-action">${label(items.length?cfg.action:cfg.clear)} ${items.length?'↗':''}</small></a>`;}).join('')}</div><section class="panel"><h2>Start with these records</h2><p class="task-description">Open a request, review a missed appointment, or record a follow-up directly from this list.</p>${priorities.map(item=>taskRow(item,data)).join('')||ui`<p class="task-queue-empty">No outstanding tasks in your current clinic copy. Sync to check for new requests and changes.</p>`}</section><div class="workspace-columns task-queue"><section class="panel"><h2>Next approved vaccinations</h2>${upcoming.map(r=>taskRow({kind:'today',record:r,patient:patientById(data,r.patient)},data)).join('')||ui`<p>No upcoming approved vaccinations.</p>`}<div class="button-stack"><a class="button secondary" href="#workspace/vaccines">View vaccinations ↗</a></div></section><section class="panel"><h2>Recent visits</h2>${recent.map(r=>ui`<div class="action-row task-row"><div><strong>${escape(patientById(data,r.patient)?.name??r.patient)}</strong><small>${fmt(r.date)} · ${escape(r.notes.slice(0,100))}</small></div><button class="row-button" data-edit="visits" data-id="${escape(r.id)}">View & edit ↗</button></div>`).join('')||ui`<p>Your latest checkups and care notes will appear here.</p>`}<div class="button-stack"><button class="button secondary" data-add="visits">Record a visit</button></div></section></div><div class="dashboard-totals"><a href="#workspace/mothers">${label('{count} maternal profiles',{count:data.mothers.length})} ↗</a><a href="#workspace/children">${label('{count} child profiles',{count:data.children.length})} ↗</a></div><p class="data-note">This summary uses your current clinic copy. Sync to receive other devices’ updates; offline edits remain pending until accepted.</p>`;
}
export function renderClinicTaskQueue(data,kind){
 const selected=TASK_KINDS.includes(kind)?kind:'requests',items=clinicTasks(data)[selected];
 return ui`<a class="profile-back" href="#workspace">← Back to dashboard</a><div class="page-heading"><div><p class="eyebrow">YOUR NEXT ACTION</p><h1>${label(config[selected].title)}</h1><p>${label(config[selected].description)}</p></div></div><p class="record-count">${label('{count} tasks in your current clinic copy',{count:items.length})}</p><section class="panel task-queue" data-task-queue="${selected}">${items.map(item=>taskRow(item,data)).join('')||ui`<p class="task-queue-empty">No outstanding tasks in this view. Sync to check for updates.</p>`}</section>`;
}
