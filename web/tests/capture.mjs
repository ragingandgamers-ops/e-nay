import {createRequire} from 'node:module';
import {mkdir} from 'node:fs/promises';
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({headless:true,...(process.env.BROWSER_BIN?{executablePath:process.env.BROWSER_BIN}:{})});
await mkdir('test-output/web',{recursive:true});
for(const [name,viewport] of [['desktop',{width:1440,height:1000}],['mobile',{width:390,height:844}]]){
 const context=await browser.newContext({viewport,deviceScaleFactor:1});const page=await context.newPage();page.on('pageerror',e=>console.error(e.message));await page.goto('http://127.0.0.1:8765/');await page.screenshot({path:`test-output/web/${name}-home.png`,fullPage:true});await page.goto('http://127.0.0.1:8765/#workspace');await page.screenshot({path:`test-output/web/${name}-workspace.png`,fullPage:true});await context.close();
}
await browser.close();console.log('Desktop and mobile previews captured.');
