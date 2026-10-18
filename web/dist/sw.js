/* One same-origin shell; no patient data is sent over the network. */
const CACHE='enay-shell-v4';
const FILES=['./','./index.html','./styles.css','./app.mjs','./core.mjs','./manifest.webmanifest','./assets/icon.svg','./assets/icon-192.png','./assets/icon-512.png','./assets/mother-baby.webp','./assets/mother-baby-small.webp','./assets/mother-child.webp','./assets/mother-child-small.webp'];
const urls=FILES.map(p=>new URL(p,self.location.href).href);
self.addEventListener('install',event=>event.waitUntil((async()=>{
 const cache=await caches.open(CACHE);
 // cache.addAll is atomic: Offline ready is never signalled for a partial shell.
 await cache.addAll(urls);
 await self.skipWaiting();
})()));
self.addEventListener('activate',event=>event.waitUntil((async()=>{
 const old=await caches.keys();await Promise.all(old.filter(k=>k.startsWith('enay-shell-')&&k!==CACHE).map(k=>caches.delete(k)));
 await self.clients.claim();
})()));
self.addEventListener('message',event=>{
 if(event.data?.type!=='CHECK_OFFLINE')return;
 event.waitUntil((async()=>{const cache=await caches.open(CACHE);const checks=await Promise.all(urls.map(url=>cache.match(url)));if(checks.every(Boolean))event.source?.postMessage({type:'OFFLINE_READY'});})());
});
self.addEventListener('fetch',event=>{
 const url=new URL(event.request.url);
 if(event.request.method!=='GET'||url.origin!==self.location.origin)return;
 const base=new URL('./',self.location.href);
 // Ignore host authentication endpoints and supplementary external resources.
 if(!url.pathname.startsWith(base.pathname))return;
 // Open the cached entry immediately even on a weak, half-connected network.
 // Versioned service-worker installation updates the shell on connected visits.
 if(event.request.mode==='navigate'&&(url.pathname===base.pathname||url.pathname===new URL('./index.html',self.location.href).pathname))event.respondWith((async()=>await caches.match(new URL('./index.html',self.location.href).href)??fetch(event.request))());
 else if(urls.includes(url.origin+url.pathname))event.respondWith((async()=>{const cached=await caches.match(event.request,{ignoreSearch:true});return cached??fetch(event.request);})());
});
