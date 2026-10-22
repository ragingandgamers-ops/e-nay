import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir} from 'node:fs/promises';
import {signIn,resetClinic,profileAction,privateCopy} from './session.mjs';
import {emptyData,today} from '../dist/core.mjs';
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'playwright');
const base=process.env.ENAY_URL||'http://127.0.0.1:8765/';
const browser=await chromium.launch({headless:true,...(process.env.BROWSER_BIN?{executablePath:process.env.BROWSER_BIN}:{})});
let checks=0;const check=(ok,message)=>{assert.ok(ok,message);checks++;};
const route=async(page,path)=>{await page.evaluate(path=>location.hash='workspace/'+path,path);await page.locator('#page-content h1').waitFor();};
try{
 await resetClinic(base);await mkdir('test-output/web',{recursive:true});
 const context=await browser.newContext({viewport:{width:1280,height:900},reducedMotion:'reduce',colorScheme:'dark'}),staff=await context.newPage(),errors=[];
 staff.on('pageerror',e=>errors.push(e.message));await staff.goto(base+'#workspace/mothers');const login=staff.waitForResponse(r=>r.url().endsWith('/api/login'));await signIn(staff);const {proof}=await(await login).json();
 const fixture=emptyData();for(let i=0;i<21;i++){
  const suffix=String(i+1).padStart(3,'0'),letter=String.fromCharCode(65+i);
  fixture.mothers.push({id:'M'+suffix,name:'Mother '+letter,age:25,edd:today(),status:i%4?'Active':'Inactive',barangay:i%2?'South':'North'});
  fixture.children.push({id:'C'+suffix,name:'Child '+letter,motherName:'Mother '+letter,dob:today(),gender:'Female',status:'Active',barangay:'North'});
 }
 await staff.evaluate(async({fixture,proof})=>{const headers={'Content-Type':'application/json','X-Enay-Access':proof};const before=await(await fetch('/api/workspace',{headers})).json();const response=await fetch('/api/workspace',{method:'PUT',headers,body:JSON.stringify({baseRevision:before.revision,operationId:crypto.randomUUID(),data:fixture,resetPatientLinks:true})});if(!response.ok)throw Error(await response.text());},{fixture,proof});await profileAction(staff,'sync-records');
 check(await staff.locator('#record-results tbody tr').count()===10,'Record pages render ten rows instead of the whole clinic');
 await staff.locator('#record-results [data-list-page="2"]').click();check((await staff.locator('#record-results').textContent()).includes('M011'),'Next page reaches the next records');
 await staff.locator('#record-search').fill('M021');check(await staff.locator('#record-results tbody tr').count()===1&&(await staff.locator('#record-results').textContent()).includes('M021'),'Search spans every page and resets the page number');
 await staff.locator('#record-search').fill('');await staff.locator('#record-sort').selectOption('name-desc');check(await staff.locator('#record-results strong').first().textContent()==='Mother U','Name sorting applies to the full list before pagination');
 await staff.locator('#record-location').selectOption('South');check(await staff.locator('#record-results tbody tr').count()===10&&!(await staff.locator('#record-results').textContent()).includes('North'),'Location filter narrows the clinic list');
 await staff.locator('#record-filter').selectOption('Inactive');check(await staff.locator('#clear-search').isVisible(),'Combined filters report no matches');await staff.locator('#clear-search').click();check(await staff.locator('#record-location').inputValue()==='','Clear filters also clears the location');
 await staff.route('**/api/accounts',async request=>{const response=await request.fetch();const original=await response.json();await request.fulfill({response,json:{accounts:[...original.accounts,...Array.from({length:25},(_,i)=>({id:'fictional-account-'+i,username:'sample.'+String(i).padStart(2,'0'),displayName:'Sample Family '+String.fromCharCode(65+i),patientIds:[]}))]}});});
 const linkRequests=[];staff.on('request',r=>{if(r.url().endsWith('/api/links')&&r.method()==='PUT')linkRequests.push(r.postDataJSON());});
 await route(staff,'access');await staff.locator('.patient-access-account').first().waitFor();
 check(await staff.locator('.patient-access-account').count()===10,'Account directory is paginated');check(await staff.locator('.patient-link-form').count()===0,'Account names start folded and profile choices are loaded only when expanded');
 await staff.screenshot({path:'test-output/web/patient-access-directory-desktop.png'});
 await staff.locator('#account-search').fill('@test.patient');const account=staff.locator('.patient-access-account');check(await account.count()===1,'Username search reaches the actual patient account');await account.locator('summary').click();const form=account.locator('form');
 await form.locator('[data-profile-search]').fill('M001');await form.locator('input[name=patient][value=M001]').check();await form.locator('[data-profile-search]').fill('M021');await form.locator('input[name=patient][value=M021]').check();
 await form.locator('[data-profile-kind]').selectOption('C');await form.locator('[data-profile-search]').fill('C002');await form.locator('input[name=patient][value=C002]').check();check((await form.locator('.access-selected-count').textContent()).includes('3'),'Selections accumulate across profile searches');
 await account.locator('summary').click();check(!await form.isVisible(),'Clicking the name folds all sharing controls');await staff.evaluate(async()=>{const panel=document.querySelector('[data-access-account]');if(!panel.open){const toggled=new Promise(resolve=>panel.addEventListener('toggle',resolve,{once:true}));panel.open=true;await toggled;}panel.open=false;const input=document.querySelector('#account-search');for(const value of ['sample.24','test.patient']){input.value=value;input.dispatchEvent(new Event('input',{bubbles:true}));}});check(await account.getAttribute('open')===null,'A same-turn collapse and search preserves the actual closed state before native toggle events fire');await account.locator('summary').click();
 check(await form.locator('input[name=patient][value=C002]').isChecked(),'Unsaved selections survive collapsing and account search');
 await form.locator('[data-profile-search]').fill('');await form.locator('[data-profile-kind]').selectOption('All');await form.locator('[data-profile-scope]').selectOption('Selected');check(await form.locator('input[name=patient]').count()===3,'Selected-only view includes selected profiles from other pages');
 check(await account.getByText('Unsaved changes',{exact:true}).isVisible(),'Unapplied access changes are labeled');await form.getByRole('button',{name:'Save patient access',exact:true}).click();await form.getByText('Patient access updated.',{exact:true}).waitFor();
 check(linkRequests.length===1&&JSON.stringify([...linkRequests[0].patientIds].sort())===JSON.stringify(['C002','M001','M021']),'Save sends every selected ID, including choices outside the current page');
 check(!await account.getByText('Unsaved changes',{exact:true}).count(),'Saved changes clear their draft label');
 await staff.locator('#account-filter').selectOption('Unlinked');check(await staff.locator('.patient-access-account').count()===0,'Shared-access filters reflect successful saves');await staff.locator('#account-filter').selectOption('Linked');check(await staff.locator('.patient-access-account').count()===1,'Linked accounts are easy to find');
 await form.locator('[data-profile-scope]').selectOption('All');await form.locator('[data-profile-search]').fill('C003');await form.locator('input[name=patient][value=C003]').check();await staff.locator('#account-filter').selectOption('All');await staff.locator('#account-search').fill('');await staff.locator('[data-list-key=accounts][data-list-page="2"]').click();await staff.locator('[data-list-key=accounts][data-list-page="1"]').click();await staff.locator('#account-search').fill('test.patient');
 check(await form.locator('input[name=patient][value=C003]').isChecked(),'Unsubmitted selections survive account pagination');check(linkRequests.length===1,'Expanding, searching and paging never grants access automatically');
 await staff.locator('#open-profile').click();await staff.locator('#profile-dialog [data-language=fil]').click();await staff.locator('#close-profile').click();check((await staff.locator('#patient-access-directory').textContent()).includes('Hindi pa na-save'),'Draft and navigation labels translate without losing the draft');
 for(const width of [320,390,768,1280]){await staff.setViewportSize({width,height:900});check(await staff.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Directory fits '+width+'px in Filipino dark mode');}
 await staff.setViewportSize({width:390,height:900});await staff.screenshot({path:'test-output/web/patient-access-directory-mobile.png'});
 const family=await browser.newContext({viewport:{width:390,height:844},reducedMotion:'reduce'}),patient=await family.newPage();await patient.goto(base+'#workspace');await signIn(patient,'test.patient');const own=await privateCopy(patient,'test.patient');
 check(own.mothers.length===2&&own.children.length===1,'Patient still receives only the profiles explicitly saved for that account');check(!own.children.some(p=>p.id==='C003'),'Unsubmitted checkbox choices grant no patient access');
 await route(patient,'mothers');check(await patient.locator('#record-results tbody tr').count()===2,'Patients can browse their own records with the same controls');await route(patient,'access');check(await patient.locator('#patient-access-directory').count()===0,'Patient accounts cannot enter the staff account directory');
 check(errors.length===0,'No uncaught directory errors: '+errors.join('; '));await context.close();await family.close();console.log(checks+' directory browser assertions passed: folded accounts, full-list search/sort, paging, preserved selections, explicit sharing, role scope and responsive bilingual layouts.');
}finally{await browser.close();}
