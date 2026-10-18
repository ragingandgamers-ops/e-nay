import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {today} from '../dist/core.mjs';
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'playwright');
const base=process.env.ENAY_URL||'http://127.0.0.1:8765/';
const browser=await chromium.launch({headless:true,...(process.env.BROWSER_BIN?{executablePath:process.env.BROWSER_BIN}:{})});
const errors=[];
const makePage=async context=>{const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));return page;};
let checks=0;
function check(result,message){assert.ok(result,message);checks++;}
await mkdir('test-output/web',{recursive:true});
try{
 const normal=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'no-preference'});
 const page=await makePage(normal);
 await page.goto(base);
 await page.waitForFunction(()=>getComputedStyle(document.querySelector('.hero-art')).opacity==='1');
 check(await page.locator('#hero-title').isVisible(),'Animated hero remains readable');
 const firstPosition=await page.locator('.hero-photo').evaluate(image=>image.style.getPropertyValue('--photo-drift'));
 await page.evaluate(()=>scrollBy(0,160));
 await page.waitForFunction(before=>document.querySelector('.hero-photo').style.getPropertyValue('--photo-drift')!==before,firstPosition);
 check(true,'Hero photo responds to natural scrolling');
 await page.locator('#care').scrollIntoViewIfNeeded();
 await page.waitForFunction(()=>getComputedStyle(document.querySelector('.care-story figure')).opacity==='1');
 check(await page.evaluate(()=>scrollY>200),'Native page scrolling remains available');
 check(await page.locator('.care-story img').evaluate(image=>image.complete&&image.naturalWidth>0),'Scroll reveal retains the real photograph');
 await page.screenshot({path:'test-output/web/animated-care-section.png',fullPage:false});
 await page.emulateMedia({reducedMotion:'reduce'});
 await page.waitForFunction(()=>getComputedStyle(document.querySelector('.closing')).opacity==='1');
 check(await page.locator('.care-story img').evaluate(element=>getComputedStyle(element).transform==='none'),'Changing reduced-motion preference stops photo movement');
 await page.emulateMedia({reducedMotion:'no-preference'});
 await page.locator('.site-header a[href="#workspace"]').click();
 await page.locator('#page-content h1').waitFor();
 check(await page.getByRole('button',{name:'+ Add a profile',exact:true}).isEnabled(),'Workspace entry transition keeps actions usable');
 await normal.close();

 const reduced=await browser.newContext({viewport:{width:390,height:844},reducedMotion:'reduce'});
 const quiet=await makePage(reduced);
 await quiet.goto(base);
 check(await quiet.locator('#hero-title').isVisible(),'Reduced-motion homepage is visible immediately');
 await quiet.locator('#care').scrollIntoViewIfNeeded();
 check(await quiet.locator('.care-story figure').evaluate(element=>getComputedStyle(element).opacity==='1'),'Reduced-motion sections do not wait for a reveal');
 check(await quiet.locator('.care-story img').evaluate(element=>getComputedStyle(element).transform==='none'),'Reduced-motion photographs do not drift');
 await quiet.goto(base+'#workspace');
 await quiet.locator('#page-content h1').waitFor();
 check(await quiet.evaluate(()=>document.getAnimations().every(animation=>animation.playState!=='running')),'Reduced-motion workspace has no running entrance animation');
 await reduced.close();

 // Model the missing offline API reported by the user's Messenger screenshot.
 const embedded=await browser.newContext({viewport:{width:393,height:852},isMobile:true,hasTouch:true});
 await embedded.addInitScript(()=>Object.defineProperty(navigator,'serviceWorker',{value:undefined,configurable:true}));
 const mobile=await makePage(embedded);
 await mobile.goto(base+'#workspace');
 await mobile.getByText('Offline unavailable here',{exact:true}).waitFor();
 check(await mobile.locator('#offline-guidance').isVisible(),'Unsupported browser receives actionable offline guidance');
 await mobile.getByRole('button',{name:'How to open & install',exact:true}).click();
 check(await mobile.locator('#info-body').getByText(/Open this site in Safari/).isVisible(),'Installation guidance explains Safari and Add to Home Screen');
 await mobile.getByRole('button',{name:'Close dialog',exact:true}).click();
 await mobile.locator('[data-add="mothers"]').first().click();
 for(const [field,value] of Object.entries({id:'M001',name:'Mobile Test Mother',age:'25',edd:today()}))await mobile.locator('#field-'+field).fill(value);
 await mobile.locator('#record-form button[type=submit]').click();
 await mobile.locator('#form-dialog').waitFor({state:'hidden'});
 check(await mobile.evaluate(()=>JSON.parse(localStorage.getItem('enay.workspace.v1')).data.mothers.length===1),'Online record entry works without offline support');
 await mobile.goto(base+'#workspace');
 await mobile.waitForFunction(()=>document.querySelector('#page-content').getAnimations().every(animation=>animation.playState!=='running'));
 check(await mobile.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Unsupported-browser guidance fits the phone screen');
 await mobile.screenshot({path:'test-output/web/mobile-browser-guidance.png',fullPage:true});
 await embedded.close();

 const basic=await browser.newContext({javaScriptEnabled:false});
 const staticPage=await makePage(basic);
 await staticPage.goto(base);
 check(await staticPage.locator('#hero-title').isVisible(),'Homepage stays readable when animation JavaScript cannot run');
 await basic.close();
 check(errors.length===0,`No presentation errors: ${errors.join(', ')}`);
 console.log(`${checks} presentation assertions passed: scroll reveals, workspace entry, reduced motion, embedded-browser help and mobile record entry.`);
}finally{await browser.close();}
