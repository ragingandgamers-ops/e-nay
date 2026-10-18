import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile, mkdir} from 'node:fs/promises';
import {createRequire} from 'node:module';

const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'playwright');
const files=new Map();
const root=new URL('../dist/',import.meta.url);
const types={html:'text/html',mjs:'application/javascript',js:'application/javascript',css:'text/css',webmanifest:'application/manifest+json',png:'image/png',webp:'image/webp',svg:'image/svg+xml'};
// Match Pages' canonical HTML redirect, which a plain Python server misses.
const server=createServer(async(req,res)=>{
 const path=new URL(req.url,'http://localhost').pathname;
 if(path==='/index.html'){res.writeHead(308,{Location:'/'});res.end();return;}
 // Pages' default SPA fallback also serves the app at the /start recovery URL.
 const name=path==='/'||path==='/start'?'index.html':path.slice(1);
 if(!/^(?:[\w.-]+|assets\/[\w.-]+)$/.test(name)){res.writeHead(404);res.end();return;}
 try{
  const body=files.get(name)??await readFile(new URL(name,root));
  res.writeHead(200,{'Content-Type':types[name.split('.').pop()]||'application/octet-stream','Cache-Control':'no-store'});res.end(body);
 }catch{res.writeHead(404);res.end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base=`http://127.0.0.1:${server.address().port}/`;
const browser=await chromium.launch({headless:true,...(process.env.BROWSER_BIN?{executablePath:process.env.BROWSER_BIN}:{})});
const context=await browser.newContext();
const page=await context.newPage(),messages=[];
page.on('console',message=>{if(message.type()==='error')messages.push(message.text());});
try{
 const redirect=await fetch(base+'index.html',{redirect:'manual'});
 assert.equal(redirect.status,308,'Fixture reproduces the production HTML redirect');
 await page.goto(base+'#workspace/mothers');
 await page.waitForFunction(()=>document.querySelector('#offline-status').textContent==='Offline ready · App downloaded');
 await page.evaluate(()=>localStorage.setItem('enay.sw-regression','preserved'));
 for(const path of ['','#workspace/mothers','index.html','start','?reload=1#workspace/children']){
  await page.goto(base+path);
  await page.locator(path.includes('workspace')?'#auth-view h1':'.hero-photo').waitFor();
  assert.match(await page.title(),/E-Nay/);
 }
 await page.reload();
 assert.equal(await page.evaluate(()=>localStorage.getItem('enay.sw-regression')),'preserved');
 await context.setOffline(true);
 for(const path of ['#workspace/mothers','index.html#workspace/children','start#workspace/mothers']){
  await page.goto(base+path);
  await page.locator('#auth-view h1').waitFor();
 }
 assert.equal(await page.evaluate(async()=>{try{await fetch('./uncached-network-probe');return false;}catch{return true;}}),true);
 await context.setOffline(false);
 await page.goto(base);
 await mkdir('test-output/web',{recursive:true});
 await page.screenshot({path:'test-output/web/cloudflare-redirect-regression.png',fullPage:false});
 // Reproduce the previously deployed worker, then check the recovery entry
 // updates it without deleting site data or running a manual repair script.
 files.set('sw.js',Buffer.from(`
 self.addEventListener('install',e=>e.waitUntil((async()=>{await(await caches.open('enay-shell-v4')).add('./index.html');await self.skipWaiting();})()));
 self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));
 self.addEventListener('fetch',e=>{if(e.request.mode==='navigate'&&['/','/index.html'].includes(new URL(e.request.url).pathname))e.respondWith(caches.match(new URL('./index.html',self.location.href).href));});
 `));
 const legacy=await browser.newContext();
 try{
  const oldPage=await legacy.newPage();
  await oldPage.goto(base);
  await oldPage.waitForFunction(()=>Boolean(navigator.serviceWorker.controller));
  await oldPage.evaluate(()=>localStorage.setItem('enay.sw-regression','keep existing records'));
  await assert.rejects(oldPage.reload(),/ERR_FAILED/,'Legacy redirected cache reproduces the reported browser error');
  files.delete('sw.js');
  const repairPage=await legacy.newPage();
  repairPage.on('console',message=>{if(message.type()==='error')console.error('Upgrade console:',message.text());});
  repairPage.on('pageerror',error=>console.error('Upgrade page:',error.message));
  await repairPage.goto(base+'start#workspace/mothers');
  await repairPage.waitForFunction(()=>document.querySelector('#offline-status').textContent==='Offline ready · App downloaded',{timeout:15000}).catch(async error=>{
   console.error('Upgrade state:',await repairPage.evaluate(async()=>({status:document.querySelector('#offline-status')?.textContent,worker:navigator.serviceWorker.controller?.scriptURL,registrations:(await navigator.serviceWorker.getRegistrations()).map(r=>({active:r.active?.state,waiting:r.waiting?.state,installing:r.installing?.state})),caches:await caches.keys()})));throw error;
  });
  await oldPage.goto(base);
  await oldPage.reload();
  await oldPage.locator('.hero-photo').waitFor();
  assert.equal(await oldPage.evaluate(()=>localStorage.getItem('enay.sw-regression')),'keep existing records');
  assert.equal(await oldPage.evaluate(async()=>(await caches.keys()).includes('enay-shell-v4')),false,'Broken legacy cache was replaced');
 }finally{files.delete('sw.js');await legacy.close();}
 console.log('Cloudflare redirect regression passed: repeat visits, HTML alias, offline navigation, legacy recovery through /start and stored-data preservation.');
}catch(error){console.error('Service-worker browser errors:',messages);throw error;}
finally{await context.close();await browser.close();await new Promise(resolve=>server.close(resolve));}
