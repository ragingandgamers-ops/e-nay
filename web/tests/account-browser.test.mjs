import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir} from 'node:fs/promises';
import {signIn,password,resetClinic,privateCopy} from './session.mjs';
import {profileAction,waitOffline} from './session.mjs';
import {emptyData,today} from '../dist/core.mjs';
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'playwright');
const base=process.env.ENAY_URL||'http://127.0.0.1:8765/';
const browser=await chromium.launch({headless:true,...(process.env.BROWSER_BIN?{executablePath:process.env.BROWSER_BIN}:{})});
let checks=0;const check=(ok,message)=>{assert.ok(ok,message);checks++;};
try{
 await resetClinic(base);await mkdir('test-output/web',{recursive:true});
 const clinic=await browser.newContext({reducedMotion:'reduce'}),staff=await clinic.newPage();
 await staff.goto(base+'#workspace/inventory');check(await staff.locator('#auth-view').isVisible(),'Inventory requires sign-in');check(!await staff.locator('#workspace-view').isVisible(),'Guest cannot see staff workspace');
 const response=staff.waitForResponse(r=>r.url().endsWith('/api/login'));await signIn(staff);const {proof}=await (await response).json();
 const fixture=emptyData();fixture.mothers.push({id:'M001',name:'Fictional Private Mother',age:25,edd:today(),status:'Active',contact:'',barangay:''});fixture.inventory.push({id:'batch-0001',vaccine:'Fictional clinic stock',batch:'B001',stock:12,threshold:5,expires:'2099-12-31'});
 const saved=await staff.evaluate(async({proof,fixture})=>{const headers={'X-Enay-Access':proof,'Content-Type':'application/json'},before=await(await fetch('/api/workspace',{headers})).json();return(await fetch('/api/workspace',{method:'PUT',headers,body:JSON.stringify({baseRevision:before.revision,operationId:crypto.randomUUID(),data:fixture})})).status;},{proof,fixture});check(saved===200,'Staff can synchronize clinic records');
 await profileAction(staff,'sync-records');await staff.getByText('Fictional clinic stock',{exact:true}).waitFor();
 await staff.locator('[data-page="access"]').click();await staff.locator('.patient-access-account').first().waitFor();
 const patientAccount=staff.locator('.patient-access-account').filter({has:staff.getByText('@test.patient',{exact:true})});await patientAccount.locator('summary').click();const patientForm=patientAccount.locator('.patient-link-form');await patientForm.locator('[value="M001"]').check();await patientForm.getByRole('button',{name:'Save patient access',exact:true}).click();await patientForm.getByText('Patient access updated.',{exact:true}).waitFor();
 const family=await browser.newContext({viewport:{width:390,height:844},reducedMotion:'reduce'}),patient=await family.newPage();await patient.goto(base+'#workspace');await signIn(patient,'test.patient');
 check(await patient.locator('#page-content .action-row').filter({hasText:'Fictional Private Mother'}).isVisible(),'Patient sees a profile explicitly linked by staff');check(!await patient.locator('[data-page="inventory"]').isVisible(),'Patient navigation excludes inventory');check(await patient.locator('[data-add="mothers"]').count()===0,'Patient cannot add a second maternal record');
 await patient.evaluate(()=>location.hash='workspace/inventory');await patient.getByRole('heading',{name:'Your care, close by.',exact:true}).waitFor();check(!await patient.getByText('Fictional clinic stock',{exact:true}).isVisible(),'Forged inventory route reveals no stock');
 const anon=await patient.evaluate(async()=>({status:(await fetch('/api/workspace')).status,keys:Object.keys(localStorage)}));check(anon.status===401,'Device cookie alone cannot authorize API calls');check(!anon.keys.some(k=>/proof|token|password/i.test(k)),'No login proof or password in localStorage');
 const encrypted=await patient.evaluate(async()=>{const connection=await new Promise(resolve=>{const r=indexedDB.open('enay-private-v1');r.onsuccess=()=>resolve(r.result);});const row=await new Promise(resolve=>{const r=connection.transaction('copies').objectStore('copies').get('test.patient');r.onsuccess=()=>resolve(r.result);});connection.close();return {cipher:row.cipher instanceof ArrayBuffer,fields:Object.keys(row),plaintext:new TextDecoder().decode(row.cipher)};});check(encrypted.cipher&&!encrypted.fields.includes('data')&&!encrypted.plaintext.includes('Fictional Private Mother'),'Persistent device snapshot contains ciphertext rather than medical text');
 await patient.screenshot({path:'test-output/web/patient-mobile.png',fullPage:true});
 await profileAction(patient,'sign-out');check(!await patient.locator('#page-content .action-row').filter({hasText:'Fictional Private Mother'}).isVisible(),'Signing out removes private profile text');
 await family.setOffline(true);await patient.reload();await signIn(patient,'test.patient');check(await patient.locator('#page-content .action-row').filter({hasText:'Fictional Private Mother'}).isVisible(),'Patient can unlock their encrypted copy offline');
 await profileAction(patient,'sign-out');await patient.locator('#account-username').fill('test.patient');await patient.locator('#account-password').fill('Incorrect-offline-password!');await patient.locator('#auth-submit').click();await patient.locator('#auth-error').waitFor();check(!await patient.locator('#workspace-view').isVisible(),'Wrong offline password cannot reveal cached care data');await family.setOffline(false);await patient.locator('#account-password').fill('Incorrect-online-password!');await patient.locator('#auth-submit').click();await patient.locator('#auth-error').getByText('The username or password is incorrect.',{exact:true}).waitFor();check(!await patient.locator('#workspace-view').isVisible(),'Online rejection cannot fall back to an offline copy');
 await staff.evaluate(()=>location.hash='workspace/mothers');await staff.locator('[data-add="mothers"]').first().waitFor();
 const otherContext=await browser.newContext(),other=await otherContext.newPage();await other.goto(base+'#workspace/mothers');await signIn(other);
 for(const [page,name] of [[staff,'First Device Mother'],[other,'Conflicting Device Mother']]){await page.locator('[data-edit="mothers"][data-id="M001"]').click();await page.locator('#form-dialog').waitFor({state:'visible'});await page.locator('#field-name').fill(name);}
 for(const page of [staff,other]){await page.locator('#record-form [type="submit"]').click();await page.locator('#form-dialog').waitFor({state:'hidden'});}
 check(await other.locator('#sync-status').textContent()==='Conflict · Pending copy preserved','Stale edit of the same record reports cloud conflict');check((await privateCopy(other)).mothers.some(r=>r.name==='Conflicting Device Mother'),'Conflicting device retains its pending encrypted record');
 const remote=await staff.evaluate(async proof=>await(await fetch('/api/workspace',{headers:{'X-Enay-Access':proof}})).json(),proof);check(remote.data.mothers[0].name==='First Device Mother','Conflict never overwrites accepted clinic records');
 await staff.screenshot({path:'test-output/web/staff-accounts.png',fullPage:true});
 await Promise.all([clinic.close(),family.close(),otherContext.close()]);
 console.log(`${checks} account browser assertions passed: separate roles, linked profiles, encrypted offline unlock, sign-out and cross-device conflict preservation.`);
}finally{await browser.close();}
