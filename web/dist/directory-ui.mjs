import {ui,label,setText} from './language.mjs';
import {searchText,orderItems,pageItems} from './lists.mjs';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function pagination(view,key){
 if(view.pages<=1)return '';
 return ui`<nav class="list-pagination" aria-label="List pages" tabindex="-1" data-pagination="${esc(key)}"><button type="button" class="row-button" data-list-key="${esc(key)}" data-list-page="${view.page-1}" ${view.page===1?'disabled':''}>Previous</button><span>${label('Page {page} of {pages}',{page:view.page,pages:view.pages})}</span><button type="button" class="row-button" data-list-key="${esc(key)}" data-list-page="${view.page+1}" ${view.page===view.pages?'disabled':''}>Next</button></nav>`;
}
export function createPatientDirectory(accounts,profiles,save){
 let root,query='',filter='All',sort='name',page=1;
 const states=new Map(accounts.map(a=>[a.id,{saved:new Set(a.patientIds),selected:new Set(a.patientIds),open:false,query:'',kind:'All',scope:'All',page:1,message:'',busy:false}]));
 const dirty=s=>s.saved.size!==s.selected.size||[...s.saved].some(id=>!s.selected.has(id));
 const stateFor=element=>states.get(element.closest('[data-access-account]')?.dataset.accessAccount);
 function count(s){return ui`<span class="access-shared-count">${label('{count} shared profiles',{count:s.saved.size})}</span>${dirty(s)?ui`<span class="badge warning">Unsaved changes</span>`:''}`;}
 function filteredAccounts(){
  const items=accounts.filter(a=>searchText(a.displayName+' @'+a.username).includes(searchText(query))&&(filter==='All'||(filter==='Linked')===Boolean(states.get(a.id).saved.size)));
  return orderItems(items,sort,a=>sort==='username'?a.username:a.displayName);
 }
 function profileView(s){
  return pageItems(orderItems(profiles.filter(p=>searchText([p.name,p.id,p.barangay].join(' ')).includes(searchText(s.query))&&(s.kind==='All'||p.id.startsWith(s.kind))&&(s.scope==='All'||s.selected.has(p.id)))) ,s.page);
 }
 function profileChoices(s){
  const view=profileView(s);s.page=view.page;
  return ui`<p class="record-count">${label('Showing {start}–{end} of {total}',{start:view.start,end:view.end,total:view.total})}</p><fieldset class="access-choices"><legend class="screen-reader">Care profiles shared with this account</legend>${view.items.map(p=>ui`<label class="confirm-check"><input type="checkbox" name="patient" value="${esc(p.id)}" ${s.selected.has(p.id)?'checked':''} ${s.busy?'disabled':''}><span><strong>${esc(p.name)}</strong><small>${esc(p.id)}${p.barangay?' · '+esc(p.barangay):''}</small></span></label>`).join('')||ui`<p>${label(profiles.length?'No matching profiles.':'Create a clinical profile first.')}</p>`}</fieldset>${pagination(view,'profiles')}`;
 }
 function accountBody(account){
  const s=states.get(account.id);
  return ui`<form class="patient-link-form" data-account="${esc(account.id)}"><p class="access-help">Care profiles shared with this account</p><div class="access-profile-toolbar"><label><span>Search profiles</span><input type="search" data-profile-search placeholder="Name, ID, or barangay" value="${esc(s.query)}"></label><label><span>Profile type</span><select data-profile-kind>${[['All','All profiles'],['M','Mothers’ records'],['C','Children’s records']].map(([value,text])=>ui`<option value="${value}" ${s.kind===value?'selected':''}>${label(text)}</option>`).join('')}</select></label><label><span>Show profiles</span><select data-profile-scope><option value="All" ${s.scope==='All'?'selected':''}>All profiles</option><option value="Selected" ${s.scope==='Selected'?'selected':''}>Selected profiles</option></select></label></div><div class="access-profile-results">${profileChoices(s)}</div><div class="access-save-row"><p class="access-selected-count">${label('{count} profiles selected',{count:s.selected.size})}</p><button class="button primary" type="submit" ${s.busy?'disabled':''}>Save patient access</button></div><p class="link-result" role="status">${s.message?label(s.message):''}</p></form>`;
 }
 function card(a){
  const s=states.get(a.id);
  return ui`<details class="panel patient-access-account" data-access-account="${esc(a.id)}" ${s.open?'open':''}><summary><span class="access-identity"><strong>${esc(a.displayName)}</strong><small>@${esc(a.username)}</small></span><span class="access-account-meta">${count(s)}</span><span class="access-chevron" aria-hidden="true"></span></summary><div class="access-account-body">${s.open?accountBody(a):''}</div></details>`;
 }
 function updateAccounts(){
  if(!root?.isConnected)return;
  const view=pageItems(filteredAccounts(),page);page=view.page;
  root.querySelector('.access-account-results').innerHTML=ui`<p class="record-count">${label('Showing {start}–{end} of {total} accounts',{start:view.start,end:view.end,total:view.total})}</p>${view.items.map(card).join('')||ui`<section class="panel"><h2>${label(accounts.length?'No matching accounts.':'No patient accounts yet.')}</h2><p>${label(accounts.length?'Try another name, username, or filter.':'Patients and guardians can register from the sign-in screen. Verify their identity, then link their care profiles here.')}</p></section>`}${pagination(view,'accounts')}`;
 }
 function updateProfile(form,s){
  form.querySelector('.access-profile-results').innerHTML=profileChoices(s);
  setText(form.querySelector('.access-selected-count'),'{count} profiles selected',{count:s.selected.size});
  const panel=form.closest('[data-access-account]');panel.querySelector('.access-account-meta').innerHTML=count(s);
 }
 const html=ui`<p class="notice good">Confirm the person's identity with the clinic before linking a profile. Patients can edit the profiles selected here and any profiles they create. Unlinking removes future cloud access; an already downloaded offline copy remains on that person's device.</p><section id="patient-access-directory"><div class="directory-toolbar"><label class="directory-search"><span>Find a patient account</span><input id="account-search" type="search" placeholder="Search name or username"></label><label><span>Shared access</span><select id="account-filter"><option value="All">All accounts</option><option value="Linked">With shared profiles</option><option value="Unlinked">Without shared profiles</option></select></label><label><span>Sort accounts</span><select id="account-sort"><option value="name">Name A–Z</option><option value="name-desc">Name Z–A</option><option value="username">Username A–Z</option></select></label></div><p class="data-note">Open a name to manage access. Selections stay while you search, change pages, or collapse an account. Use Save patient access to apply changes.</p><p class="access-directory-status data-note" role="status"></p><div class="access-account-results"></div></section>`;
 return {html,mount(container){
  root=container;updateAccounts();
  root.addEventListener('toggle',event=>{
   if(!event.target.matches('.patient-access-account'))return;
   const panel=event.target,s=states.get(panel.dataset.accessAccount);s.open=panel.open;
   if(s.open&&!panel.querySelector('form'))panel.querySelector('.access-account-body').innerHTML=accountBody(accounts.find(a=>a.id===panel.dataset.accessAccount));
  },true);
  root.addEventListener('input',event=>{
   if(event.target.id==='account-search'){query=event.target.value;page=1;updateAccounts();}
   if(event.target.matches('[data-profile-search]')){const s=stateFor(event.target);s.query=event.target.value;s.page=1;updateProfile(event.target.closest('form'),s);}
  });
  root.addEventListener('change',event=>{
   if(event.target.id==='account-filter'){filter=event.target.value;page=1;updateAccounts();}
   if(event.target.id==='account-sort'){sort=event.target.value;page=1;updateAccounts();}
   const form=event.target.closest('form');if(!form)return;const s=stateFor(form);
   if(event.target.matches('[data-profile-kind],[data-profile-scope]')){s[event.target.matches('[data-profile-kind]')?'kind':'scope']=event.target.value;s.page=1;updateProfile(form,s);}
   if(event.target.matches('[name=patient]')){
    if(event.target.checked)s.selected.add(event.target.value);else s.selected.delete(event.target.value);
    s.message='';form.querySelector('.link-result').replaceChildren();
    // Avoid replacing the focused checkbox; refresh only the counters.
    setText(form.querySelector('.access-selected-count'),'{count} profiles selected',{count:s.selected.size});
    form.closest('[data-access-account]').querySelector('.access-account-meta').innerHTML=count(s);
    if(s.scope==='Selected'&&!event.target.checked){updateProfile(form,s);form.querySelector('[data-profile-scope]').focus();}
   }
  });
  root.addEventListener('click',event=>{
   const button=event.target.closest('[data-list-page]');if(!button)return;
   if(button.dataset.listKey==='accounts'){page=Number(button.dataset.listPage);updateAccounts();root.querySelector('[data-pagination=accounts]')?.focus();}
   else{const form=button.closest('form'),s=stateFor(form);s.page=Number(button.dataset.listPage);updateProfile(form,s);form.querySelector('[data-pagination=profiles]')?.focus();}
  });
  root.addEventListener('submit',async event=>{
   const form=event.target.closest('.patient-link-form');if(!form)return;event.preventDefault();const s=stateFor(form);if(s.busy)return;
   const ids=[...s.selected];s.busy=true;form.querySelectorAll('input[type=checkbox],button[type=submit]').forEach(el=>el.disabled=true);
   try{await save(form.dataset.account,ids);s.saved=new Set(ids);s.message='Patient access updated.';}
   catch(error){s.message=error.message;}
   finally{s.busy=false;if(root.isConnected){updateAccounts();setText(root.querySelector('.access-directory-status'),s.message);}}
  });
 }};
}
