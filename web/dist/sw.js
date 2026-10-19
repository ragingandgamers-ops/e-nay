/* Public app shell only. Private API responses are never cached here. */
const CACHE='enay-shell-v13';
// Pages redirects index.html to ./; a cached redirected response cannot be
// returned for a navigation request. Cache and serve the canonical entry URL.
const FILES=['./','./tokens.css','./styles.css','./design-system.css','./icons.mjs','./assets/plus-jakarta-sans-variable.ttf','./app.mjs','./accounts.mjs','./tab-session.mjs','./auth-ui.mjs','./language.mjs','./filipino.mjs','./core.mjs','./motion.mjs','./manifest.webmanifest','./assets/icon.svg','./assets/icon-192.png','./assets/icon-512.png','./assets/philippines-mother-baby.webp','./assets/philippines-mother-baby-small.webp','./assets/philippines-mother-child.webp','./assets/philippines-mother-child-small.webp'];
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
 if(event.request.mode==='navigate'&&['./','./index.html','./start'].some(path=>url.pathname===new URL(path,self.location.href).pathname))event.respondWith((async()=>await (await caches.open(CACHE)).match(base.href)??fetch(event.request))());
 else if(urls.includes(url.origin+url.pathname))event.respondWith((async()=>{const cached=await caches.match(event.request,{ignoreSearch:true});return cached??fetch(event.request);})());
});
