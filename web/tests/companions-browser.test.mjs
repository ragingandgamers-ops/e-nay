import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir} from 'node:fs/promises';
import {password,resetClinic,signIn} from './session.mjs';
const {chromium,webkit}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'playwright'),safari=process.env.ENAY_BROWSER==='webkit';
const base=process.env.ENAY_URL||'http://127.0.0.1:8765/',origin=new URL(base).origin;
const browser=await(safari?webkit:chromium).launch({headless:true,...(!safari&&process.env.BROWSER_BIN?{executablePath:process.env.BROWSER_BIN}:{})});
let checks=0;const check=(ok,message)=>{assert.ok(ok,message);checks++;};
const contexts=[];
async function post(context,path,body,proof){const r=await context.request.post(base+'api/'+path,{headers:{Origin:origin,...(proof?{'X-Enay-Access':proof}:{})},data:body});return {status:r.status(),value:await r.json()};}
async function state(companion){const r=await companion.context.request.get(base+'api/workspace',{headers:{'X-Enay-Access':companion.proof}});assert.equal(r.status(),200);return r.json();}
async function openSettings(page){await page.locator('#open-profile').click();await page.locator('#open-companion').click();await page.locator('#family-code').waitFor({state:'visible'});}
try{
 await resetClinic(base);await mkdir('test-output/web',{recursive:true});
 const motherContext=await browser.newContext({viewport:{width:390,height:900},reducedMotion:'reduce'});contexts.push(motherContext);
 const mother=await motherContext.newPage(),errors=[];mother.on('pageerror',e=>errors.push(e.message));mother.on('dialog',d=>d.accept());
 const mu='three.mother.'+Date.now().toString(36),body={username:mu,password,kind:'mother',displayName:'Fictional Mother',age:28,pregnancyStatus:'Not pregnant',edd:''};
 assert.equal((await post(motherContext,'register',body)).status,201);
 await mother.goto(base+'#workspace');const logged=mother.waitForResponse(r=>r.url().endsWith('/api/login'));await signIn(mother,mu);const motherProof=(await(await logged).json()).proof;
 const companions=[];
 for(const [i,name]of ['One','Two','Three','Four'].entries()){
  const context=await browser.newContext();contexts.push(context);const username='companion.'+(i+1)+'.'+Date.now().toString(36);
  assert.equal((await post(context,'register',{username,password,kind:'father',displayName:'Fictional Companion '+name})).status,201);
  const login=await post(context,'login',{username,password});assert.equal(login.status,200);companions.push({context,proof:login.value.proof,id:login.value.account.id,name:'Fictional Companion '+name});
 }
 for(const [i,c]of companions.slice(0,3).entries()){
  await openSettings(mother);check(await mother.locator('.companion-count').textContent().then(s=>s.includes(i+' of 3')),'UI shows current count before inviting '+(i+1));
  await mother.locator('#family-code').click();await mother.locator('.pairing-code').waitFor();const code=await mother.locator('.pairing-code').textContent();await mother.locator('#close-info').click();
  check((await post(c.context,'family/pair',{code},c.proof)).status===200,'Companion '+(i+1)+' accepts a unique invitation');check((await state(c)).data.mothers.length===1,'Companion '+(i+1)+' sees the invited mother');
 }
 await openSettings(mother);check(await mother.locator('.companion-person').count()===3,'All 3 companions appear separately');check(await mother.locator('.companion-count').textContent().then(s=>s.includes('3 of 3')),'Full count is clear');check(!(await mother.locator('#family-code').isEnabled()),'Invite control disables at 3');check(await mother.locator('.family-panel').textContent().then(s=>s.includes('Disconnect one before')),'Cap explains how to free a slot');check((await post(motherContext,'family/code',{},motherProof)).status===409,'Direct API cannot issue a fourth invitation');
 for(const width of [320,390,768,1440]){await mother.setViewportSize({width,height:900});check(await mother.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Companion UI fits '+width+'px');check(await mother.evaluate(()=>{const panel=document.querySelector('#info-dialog'),p=panel.getBoundingClientRect();return [...panel.querySelectorAll('button')].filter(e=>e.getBoundingClientRect().width).every(e=>{const r=e.getBoundingClientRect();return r.left>=p.left-1&&r.right<=p.right+1;});}),'Companion controls stay inside dialog at '+width);}
 await mother.setViewportSize({width:390,height:900});await mother.screenshot({path:'test-output/web/three-companions-'+(safari?'webkit':'chromium')+'.png'});
 await mother.locator('.companion-person').filter({hasText:companions[1].name}).locator('[data-disconnect-companion]').click();await mother.locator('#info-dialog').waitFor({state:'hidden'});
 check((await state(companions[1])).data.mothers.length===0,'Only selected companion loses cloud access');check((await state(companions[0])).data.mothers.length===1&&(await state(companions[2])).data.mothers.length===1,'Other two retain access');
 await openSettings(mother);check(await mother.locator('.companion-person').count()===2&&await mother.locator('#family-code').isEnabled(),'Disconnect frees one invitation slot');
 await mother.locator('#family-code').click();await mother.locator('.pairing-code').waitFor();const replacement=await mother.locator('.pairing-code').textContent();await mother.locator('#close-info').click();
 check((await post(companions[3].context,'family/pair',{code:replacement},companions[3].proof)).status===200,'A replacement can use the freed slot');
 await mother.locator('#open-profile').click();await mother.locator('#profile-dialog [data-language=fil]').click();await mother.locator('#profile-dialog [data-theme-picker]').selectOption('dark');await mother.locator('#close-profile').click();await openSettings(mother);
 check(await mother.locator('.companion-count').textContent().then(s=>s.includes('3 sa 3 kasama')),'Count is translated into Filipino');check(await mother.locator('.companion-person').count()===3&&!(await mother.locator('#family-code').isEnabled()),'Cap survives replacement and language switch');check(await mother.locator('.companion-person').allTextContents().then(rows=>rows.some(s=>s.includes('Fictional Companion Four'))&&!rows.some(s=>s.includes('Fictional Companion Two'))),'Literal names stay intact and disconnected companion is absent');
 await mother.screenshot({path:'test-output/web/three-companions-filipino-'+(safari?'webkit':'chromium')+'.png'});
 check(errors.length===0,JSON.stringify(errors));console.log((safari?'WebKit: ':'Chromium: ')+checks+' companion capacity and mobile assertions passed.');
}catch(error){for(const c of contexts)for(const p of c.pages())console.error(JSON.stringify({url:p.url(),errors:await p.locator('#family-error,#auth-error').allTextContents()}));throw error;}finally{await Promise.all(contexts.map(c=>c.close()));await browser.close();}
