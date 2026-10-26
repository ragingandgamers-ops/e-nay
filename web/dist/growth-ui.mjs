import {t,label,ui,setText} from './language.mjs';
import {updateFieldRequirements} from './forms.mjs';
const escape=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function mountGrowthForm(root,store,onMode,initialId=''){
 const patient=root.querySelector('[name=patient]'),date=root.querySelector('[name=date]'),keys=['weight','height','assessment','notes'];
 const fields=Object.fromEntries(keys.map(k=>[k,root.querySelector('[name='+k+']')]));
 const panel=document.createElement('section');panel.id='growth-context';panel.className='growth-context wide';panel.setAttribute('aria-live','polite');fields.weight.closest('.field').before(panel);
 let chosen='',baseline='',previousPair='',selectedId=initialId,prior=null;
 const values=()=>JSON.stringify(keys.map(k=>fields[k].value));
 function update(force=false,preferred=''){
  const pair=patient.value+'|'+date.value;
  if(!force&&values()!==baseline&&!window.confirm(t('Switch child or date and discard the unsaved measurement values?'))){const [p,d]=previousPair.split('|');patient.value=p??'';date.value=d??'';return;}
  const matches=store.data.growth.filter(g=>g.patient===patient.value&&g.date===date.value).sort((a,b)=>a.id.localeCompare(b.id));
  const record=matches.find(g=>g.id===(preferred||selectedId))??matches[0];selectedId=record?.id??'';
  prior=store.data.growth.filter(g=>g.patient===patient.value&&g.date<date.value).sort((a,b)=>b.date.localeCompare(a.date)||a.id.localeCompare(b.id))[0]??null;
  for(const k of keys)fields[k].value=record?.[k]??(k==='assessment'?'Not assessed':'');
  panel.innerHTML=!patient.value?ui`<p>Select a child and measurement date to get started.</p>`:ui`<p class="eyebrow">${label(record?'UPDATE EXISTING ENTRY':'NEW DATED ENTRY')}</p><p>${label(record?'A measurement already exists for this child and date. Saving will update that entry.':'No measurement is saved for this child on this date. Saving will create a new entry.')}</p>${matches.length>1?ui`<label for="growth-existing-record">Existing entries for this date</label><select id="growth-existing-record">${matches.map(g=>ui`<option value="${escape(g.id)}" ${g.id===selectedId?'selected':''}>${g.weight} kg · ${g.height} cm · ${escape(g.id.slice(0,8))}</option>`).join('')}</select><p class="data-note">Older duplicate entries are preserved. Select one to correct; staff can move an unwanted duplicate to Trash.</p>`:''}${prior?ui`<div class="growth-previous"><strong>Previous measurement</strong><p>${label('{date}',{date:{date:prior.date,format:'short'}})} · ${prior.weight} kg · ${prior.height} cm</p>${!record?ui`<button type="button" class="row-button" id="growth-use-previous">Measured again—values are unchanged</button>`:''}</div>`:ui`<p class="data-note">No earlier measurement is recorded for this child.</p>`}`;
  chosen=pair;previousPair=pair;baseline=values();onMode(record??null);updateFieldRequirements(root);
  const old=panel.querySelector('#growth-existing-record');if(old)old.onchange=()=>update(false,old.value);
  const reuse=panel.querySelector('#growth-use-previous');if(reuse)reuse.onclick=()=>{fields.weight.value=prior.weight;fields.height.value=prior.height;fields.weight.dispatchEvent(new Event('input',{bubbles:true}));};
 }
 patient.addEventListener('change',()=>{if(chosen!==patient.value+'|'+date.value)update();});date.addEventListener('input',()=>{if(date.value&&date.validity.valid&&chosen!==patient.value+'|'+date.value)update();});date.addEventListener('change',()=>{if(chosen!==patient.value+'|'+date.value)update();});
 update(true);
 return {refresh(){if(chosen!==patient.value+'|'+date.value)update();},remap(mapping){const remapPair=value=>{const [id,d]=value.split('|');return (mapping[id]??id)+'|'+d;};chosen=remapPair(chosen);previousPair=remapPair(previousPair);}};
}
