import test from 'node:test';
import assert from 'node:assert/strict';
import {clinicTasks} from '../dist/dashboard.mjs';
import {emptyData} from '../dist/core.mjs';
const now='2026-10-22';
test('dashboard queues use actual workflow and calendar dates, not profile totals',()=>{
 const data=emptyData();data.mothers=[{id:'M001',name:'Fictional Mother'}];data.children=[{id:'C001',name:'Fictional Child'}];
 const v=(id,scheduled,extra={})=>({id,patient:'C001',vaccine:'Example vaccine',dose:'Dose 1',scheduled,administered:'',approvalStatus:'Approved',...extra});
 data.vaccines=[v('past','2026-10-21'),v('today',now),v('future','2026-10-23'),v('given','2026-10-21',{administered:'2026-10-21'}),v('pending','',{approvalStatus:'Pending verification'}),v('declined','',{approvalStatus:'Rejected'}),v('cancelled','',{approvalStatus:'Cancelled'}),v('legacy','2026-10-21',{approvalStatus:undefined,updatedByRole:'patient'})];
 const tasks=clinicTasks(data,now);assert.deepEqual(tasks.overdue.map(i=>i.record.id),['past']);assert.deepEqual(tasks.today.map(i=>i.record.id),['today']);assert.deepEqual(tasks.requests.map(i=>i.record.id).sort(),['legacy','pending']);assert.equal(tasks.overdue[0].patient.name,'Fictional Child');
});
test('follow-up and growth queues reflect latest care, without counting resolved historical flags',()=>{
 const data=emptyData();data.visits=[{id:'v1',patient:'M001',date:'2026-10-01',followUp:'2026-10-10'},{id:'v2',patient:'M001',date:'2026-10-15',followUp:'2026-10-25'},{id:'v3',patient:'C001',date:'2026-10-01',followUp:now},{id:'v4',patient:'M002',date:'2026-10-01',followUp:'2026-10-10'},{id:'v5',patient:'M002',date:'2026-10-20',followUp:''}];
 data.growth=[{id:'g1',patient:'C001',date:'2026-10-01',assessment:'Follow-up needed'},{id:'g2',patient:'C001',date:'2026-10-20',assessment:'Reviewed'},{id:'g3',patient:'C002',date:'2026-10-01',assessment:'Follow-up needed'},{id:'g4',patient:'C002',date:'2026-10-20',assessment:'Not assessed'}];
 const tasks=clinicTasks(data,now);assert.deepEqual(tasks.followups.map(i=>i.record.id),['v3']);assert.deepEqual(tasks.growth.map(i=>i.record.id),['g3']);
});
test('stock tasks exclude disposed empty expired batches and put remaining expired doses first',()=>{
 const data=emptyData();data.inventory=[{id:'empty-expired',expires:'2026-10-01',stock:0,threshold:5},{id:'expired',expires:'2026-10-01',stock:3,threshold:5},{id:'low',expires:'2026-12-01',stock:2,threshold:5},{id:'available',expires:'2026-12-01',stock:10,threshold:5},{id:'out',expires:'2026-12-01',stock:0,threshold:0}];
 const before=structuredClone(data);assert.deepEqual(clinicTasks(data,now).stock.map(i=>i.record.id),['expired','out','low']);assert.deepEqual(data,before);assert.ok(Object.values(clinicTasks(emptyData(),now)).every(items=>items.length===0));
});
