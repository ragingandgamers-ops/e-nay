// The browser edition has its own local store. Java text imports/exports are
// deliberately limited to the profile fields supported by the Java models.
export const KEY = 'enay.workspace.v1';
export const TYPES = ['mothers', 'children', 'visits', 'vaccines', 'growth', 'inventory', 'guides'];
export const GUIDE_CATEGORIES = ['Maternal care','Child care','Vaccination','Clinic information','Other'];
export class ValidationError extends Error {
  constructor(field, message) { super(message); this.field = field; }
}
const fail = (field, message) => { throw new ValidationError(field, message); };
// Clinic calendar dates use Philippine time on browsers and Cloudflare alike.
export const today = (instant = new Date()) => {
  const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(instant).map(part=>[part.type,part.value]));
  return parts.year+'-'+parts.month+'-'+parts.day;
};

export function yearsBefore(date, years) {
  const [y,m,d] = date.split('-').map(Number);
  const last = new Date(Date.UTC(y-years,m,0)).getUTCDate();
  return `${String(y-years).padStart(4,'0')}-${String(m).padStart(2,'0')}-${String(Math.min(d,last)).padStart(2,'0')}`;
}
export const emptyData = () => Object.fromEntries(TYPES.map(t => [t, []]));
function text(value, field, required = true, max = 100) {
  if (typeof value !== 'string') {
    if (!required && value == null) return '';
    fail(field, 'Enter a text value.');
  }
  const s = value.normalize('NFC').trim().replace(/\s+/gu, ' ');
  if (required && !s) fail(field, 'This field is required.');
  if (/[|\r\n]/u.test(value) && max <= 100) fail(field, 'Pipes and line breaks are not allowed.');
  if (s.length > max) fail(field, `Use ${max} characters or fewer.`);
  return s;
}
function name(value, field) {
  const s = text(value, field);
  let letter = false, preceding = false;
  for (const c of s) {
    if (/\p{L}/u.test(c)) { letter = true; preceding = true; }
    else if (/[\p{Mn}\p{Mc}]/u.test(c) && preceding) { /* combining accent */ }
    else if (/[\s\-'’.]/u.test(c)) preceding = false;
    else fail(field, 'Use letters, spaces, hyphens, apostrophes or periods.');
  }
  if (!letter) fail(field, 'Enter a name containing letters.');
  return s;
}
function article(value,field,required=true,max=12000){
  if(typeof value!=='string'){if(!required&&value==null)return '';fail(field,'Enter a text value.');}
  const s=value.normalize('NFC').replace(/\r\n?/g,'\n').trim();
  if(required&&!s)fail(field,'This field is required.');
  if(s.length>max)fail(field,`Use ${max} characters or fewer.`);
  if(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u.test(s))fail(field,'Remove unsupported control characters.');
  return s;
}
function choice(value, field, values) {
  const s = text(value, field);
  return values.find(v => v.toLowerCase() === s.toLowerCase()) ?? fail(field, `Choose ${values.join(' or ')}.`);
}
function number(value, field, min, max, integer = false) {
  const s = String(value ?? '').trim();
  if (!s || !/^(?:\d+\.?\d*|\.\d+)$/.test(s)) fail(field, 'Enter a valid positive number.');
  const n = Number(s);
  if (!Number.isFinite(n) || n < min || n > max || (integer && !Number.isInteger(n)))
    fail(field, `Enter ${integer ? 'a whole number' : 'a number'} from ${min} to ${max}.`);
  return n;
}
export function date(value, field, optional = false) {
  if (optional && !value) return '';
  const s = text(value, field);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || s.startsWith('0000')) fail(field, 'Use a real date in YYYY-MM-DD format.');
  const d = new Date(s+'T00:00:00Z');
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0,10) !== s) fail(field, 'Enter a real calendar date.');
  return s;
}
const uid = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
export const patientById = (data,id) => [...data.mothers,...data.children].find(x => x.id === id);
export function normalize(type, raw, data, {original = null, historical = false, preserveId = false, now = today()} = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail('', 'Invalid record.');
  let r = {};
  if (type === 'mothers' || type === 'children') {
    const prefix = type === 'mothers' ? 'M' : 'C';
    r.id = text(raw.id,'id').toUpperCase();
    if (!new RegExp(`^${prefix}[0-9]{3}$`).test(r.id)) fail('id', `Use ${prefix} followed by exactly three digits, for example ${prefix}001.`);
    if (original && r.id !== original.id) fail('id', 'Existing IDs cannot be changed.');
    r.name = name(raw.name, 'name');
    r.status = choice(raw.status,'status',['Active','Inactive']);
    r.contact = text(raw.contact, 'contact', false, 40);
    if (r.contact && (!/^[+\d ()-]+$/.test(r.contact) || r.contact.replace(/\D/g,'').length < 7 || r.contact.replace(/\D/g,'').length > 15)) fail('contact','Enter a contact number with 7 to 15 digits.');
    r.barangay = text(raw.barangay,'barangay',false);
    if (type === 'mothers') {
      r.age = number(raw.age,'age',12,60,true);
      r.edd = date(raw.edd,'edd');
      if (!historical && original?.edd !== r.edd && r.edd < now) fail('edd','A new delivery date must be today or later.');
    } else {
      r.gender = choice(raw.gender,'gender',['Female','Male']);
      r.dob = date(raw.dob,'dob');
      if (r.dob > now) fail('dob','Date of birth cannot be in the future.');
      if (!historical && original?.dob !== r.dob && r.dob < yearsBefore(now,2)) fail('dob','New child profiles are for children up to two years old.');
      r.motherName = name(raw.motherName,'motherName');
    }
  } else {
    if (!TYPES.includes(type)) fail('', 'Unknown record type.');
    r.id = original?.id ?? (historical || preserveId ? text(raw.id,'id') : uid());
    if (!['inventory','guides'].includes(type)) {
      r.patient = text(raw.patient,'patient');
      const p = patientById(data,r.patient);
      if (!p) fail('patient','Choose an existing patient profile first.');
      if (type === 'growth' && !data.children.some(c=>c.id===r.patient)) fail('patient','Growth records require a child profile.');
    }
    if (type === 'visits') {
      r.date = date(raw.date,'date');
      if (r.date > now) fail('date','A completed visit cannot be in the future.');
      r.notes = text(raw.notes,'notes',true,2000);
      r.symptoms = text(raw.symptoms,'symptoms',false,2000);
      r.food = text(raw.food,'food',false,2000);
      r.bloodPressure = text(raw.bloodPressure,'bloodPressure',false,40);
      r.followUp = date(raw.followUp,'followUp',true);
      if (r.followUp && r.followUp < r.date) fail('followUp','Follow-up cannot be before the visit.');
    } else if (type === 'vaccines') {
      r.vaccine = text(raw.vaccine,'vaccine');
      if(raw.approvalStatus!==undefined)r.approvalStatus=choice(raw.approvalStatus,'approvalStatus',['Pending verification','Approved','Rejected','Cancelled']);
      const request=r.approvalStatus&&r.approvalStatus!=='Approved';
      r.dose = text(raw.dose,'dose',!request);
      r.scheduled = date(raw.scheduled,'scheduled',Boolean(request));
      r.administered = date(raw.administered,'administered',true);
      if(r.approvalStatus&&r.approvalStatus!=='Approved'&&r.administered)fail('administered','Only an approved vaccination can be recorded as administered.');
      if (r.administered > now) fail('administered','An administered dose cannot have a future date.');
      r.notes = text(raw.notes,'notes',false,2000);
      if(r.approvalStatus){
        r.preferredDate=date(raw.preferredDate,'preferredDate',true);
        if(!historical&&r.preferredDate&&r.preferredDate!==original?.preferredDate&&r.preferredDate<now)fail('preferredDate','Choose today or a later preferred date.');
        r.requestNotes=text(raw.requestNotes,'requestNotes',false,2000);
        r.reviewNotes=text(raw.reviewNotes,'reviewNotes',false,2000);
        if(r.approvalStatus==='Rejected'&&!r.reviewNotes)fail('reviewNotes','Explain why this request was declined so the patient knows the next step.');
      }
      if(raw.batchId)r.batchId=text(raw.batchId,'batchId');
      if(raw.stockUse){
        if(typeof raw.stockUse!=='object'||Array.isArray(raw.stockUse))fail('batchId','Invalid vaccine stock allocation.');
        r.stockUse={batchId:text(raw.stockUse.batchId,'batchId'),date:date(raw.stockUse.date,'administered')};
        if(raw.stockUse.kind)r.stockUse.kind=choice(raw.stockUse.kind,'batchId',['reserved','administered']);
      }
    } else if (type === 'growth') {
      r.date = date(raw.date,'date');
      if (r.date > now) fail('date','Measurement date cannot be in the future.');
      r.weight = number(raw.weight,'weight',0.1,100);
      r.height = number(raw.height,'height',10,200);
      r.assessment = choice(raw.assessment,'assessment',['Not assessed','Reviewed','Follow-up needed']);
      r.notes = text(raw.notes,'notes',false,2000);
    } else if(type==='guides') {
      r.title=text(raw.title,'title',true,160);
      r.category=choice(raw.category,'category',GUIDE_CATEGORIES);
      r.summary=text(raw.summary,'summary',false,320);
      r.content=article(raw.content,'content');
      r.titleFil=text(raw.titleFil,'titleFil',false,160);
      r.summaryFil=text(raw.summaryFil,'summaryFil',false,320);
      r.contentFil=article(raw.contentFil,'contentFil',false);
      if(Boolean(r.titleFil)!==Boolean(r.contentFil))fail(r.titleFil?'contentFil':'titleFil','Add both a Filipino title and article, or leave both empty.');
      r.status=choice(raw.status,'status',['Draft','Published','Archived']);
      r.sourceName=text(raw.sourceName,'sourceName',false,160);
      r.resourceUrl=article(raw.resourceUrl,'resourceUrl',false,2048);
      if(r.resourceUrl){let parsed;try{parsed=new URL(r.resourceUrl);}catch{fail('resourceUrl','Use a complete HTTPS link to the article, PDF or material.');}if(parsed.protocol!=='https:'||parsed.username||parsed.password||/\s/u.test(r.resourceUrl))fail('resourceUrl','Use a complete HTTPS link to the article, PDF or material.');r.resourceUrl=parsed.href;}
      if(raw.updatedOn)r.updatedOn=date(raw.updatedOn,'updatedOn');
    } else {
      r.vaccine = text(raw.vaccine,'vaccine');
      r.batch = text(raw.batch,'batch');
      r.stock = number(raw.stock,'stock',0,100000,true);
      r.threshold = number(raw.threshold,'threshold',0,100000,true);
      r.expires = date(raw.expires,'expires');
      if (data.inventory.some(x=>x.id!==original?.id && x.batch.toUpperCase()===r.batch.toUpperCase())) fail('batch','This batch already exists. Edit its stock instead.');
    }
    const child = data.children.find(c=>c.id===r.patient);
    if (child) {
      const eventDate = type==='vaccines' ? (r.administered || r.scheduled) : r.date;
      if (eventDate && eventDate < child.dob) fail(type==='vaccines' ? (r.administered ? 'administered':'scheduled'):'date','This date cannot be before the child’s birth.');
      if (type==='vaccines' && r.scheduled && r.scheduled < child.dob) fail('scheduled','The scheduled date cannot be before the child’s birth.');
      if (type==='growth' && r.date > yearsBefore(child.dob,-2)) fail('date','Growth measurements are for the child’s first two years. Historical measurements within that period can still be recorded.');
    }
  }
  const others = data[type].filter(x=>x.id!==original?.id);
  if (others.some(x=>x.id.toUpperCase() === r.id.toUpperCase())) fail('id','This ID already exists. Open the existing profile to edit it.');
  if (!original && data[type].length >= (type==='mothers'||type==='children'?100:type==='guides'?200:5000)) fail('', 'The record limit has been reached. Export a backup before changing records.');
  if(raw.updatedByRole!==undefined)r.updatedByRole=choice(raw.updatedByRole,'updatedByRole',['patient','staff']);
  return r;
}
export function validateData(raw, now = today()) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail('', 'Invalid backup data.');
  const data = emptyData();
  for (const type of TYPES) {
   // Earlier backups and encrypted device copies predate clinic-authored guides.
   const records=type==='guides'&&raw[type]===undefined?[]:raw[type];
   if (!Array.isArray(records)) fail('', `The backup is missing ${type} records.`);
   for (const r of records) data[type].push(normalize(type,r,data,{historical:true,now}));
  }
  return data;
}
export function readEnvelope(raw) {
  const e = JSON.parse(raw);
  if (e?.format !== 'enay-web' || e.version !== 1 || typeof e.revision !== 'string') fail('', 'Unsupported E-Nay backup format.');
  return {data:validateData(e.data),revision:e.revision};
}
export const envelope = (data) => ({format:'enay-web',version:1,revision:uid(),savedAt:new Date().toISOString(),data});
export class LocalStore {
  constructor(storage) { this.storage=storage; this.raw=null; this.data=emptyData(); this.blocked=false; this.error=''; }
  load() {
    try { this.raw=this.storage.getItem(KEY); this.data=this.raw===null ? emptyData() : readEnvelope(this.raw).data; this.blocked=false; this.error=''; }
    catch (e) { this.blocked=true; this.error=`Records could not be loaded: ${e.message} Your existing storage has not been changed.`; }
    return this.data;
  }
  commit(data, {recover=false}={}) {
    if (this.blocked && !recover) fail('', 'Storage needs attention. Export the original data, then restore a valid backup.');
    // Validate and serialize before touching storage; quota/security failures
    // leave both the saved data and this.data intact.
    const valid=validateData(data);
    let current;
    try { current=this.storage.getItem(KEY); }
    catch { fail('', 'Device storage access is unavailable. Allow browser storage and retry. Your entered values and previous records have been preserved.'); }
    if (current!==this.raw) fail('', 'Records changed in another tab. Reload this workspace before saving. Your form is still open.');
    const raw=JSON.stringify(envelope(valid));
    try { this.storage.setItem(KEY,raw); }
    catch { fail('', 'The device could not save this change. Free storage or allow browser storage, then retry. Your previous records are intact.'); }
    this.raw=raw;this.data=valid;this.blocked=false;this.error='';return this.data;
  }
  save(type, raw, originalId=null) {
    const original=originalId ? this.data[type].find(x=>x.id===originalId) : null;
    if (originalId && !original) fail('', 'This record no longer exists. Reload the workspace.');
    const r=normalize(type,raw,this.data,{original});
    const next=structuredClone(this.data);
    if (original) next[type][next[type].findIndex(x=>x.id===originalId)]=r;
    else next[type].push(r);
    this.commit(next);return r;
  }
}
export function parseText(content,type) {
  if (!['mothers','children'].includes(type)) fail('', 'Choose a maternal or child text file.');
  const data=emptyData(), errors=[];
  for (const [i,line] of content.replace(/^\uFEFF/,'').split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    try {
      const f=line.split('|').map(x=>x.trim());
      if (f.length !== (type==='mothers'?5:6)) fail('', 'Wrong number of fields.');
      const raw=type==='mothers'?{id:f[0],name:f[1],age:f[2],edd:f[3],status:f[4]}:{id:f[0],name:f[1],gender:f[2],dob:f[3],motherName:f[4],status:f[5]};
      data[type].push(normalize(type,raw,data,{historical:true}));
    } catch(e) { errors.push(`Line ${i+1}: ${e.message}`); }
  }
  if (!data[type].length) fail('', 'No valid records were found. Nothing will be replaced.');
  return {records:data[type],errors};
}
export function toText(records,type) {
  return records.map(r=>type==='mothers'?[r.id,r.name,r.age,r.edd,r.status].join('|'):[r.id,r.name,r.gender,r.dob,r.motherName,r.status].join('|')).join('\n')+(records.length?'\n':'');
}
export function ageMonths(dob, now=today()) {
  const a=dob.split('-').map(Number), b=now.split('-').map(Number);
  return (b[0]-a[0])*12+b[1]-a[1]-(b[2]<a[2]?1:0);
}
export const vaccinationNeedsReview=r=>r.approvalStatus==='Pending verification'||(!r.approvalStatus&&!r.stockUse&&(r.updatedByRole==='patient'||!r.administered));
export const vaccineStatus = (r,now=today()) => {
 if(r.approvalStatus&&r.approvalStatus!=='Approved')return r.approvalStatus;
 if(vaccinationNeedsReview(r))return 'Needs staff review';
 return r.administered?'Completed':r.scheduled<now?'Overdue':r.scheduled===now?'Due today':r.approvalStatus==='Approved'?'Approved / scheduled':'Upcoming';
};

export const stockStatus = (r,now=today()) => r.expires<now?'Expired':r.stock<=r.threshold?'Low stock':'Available';
