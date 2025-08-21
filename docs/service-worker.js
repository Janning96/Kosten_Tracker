const CACHE='kosten-tracker-v6.4-docs';
self.addEventListener('install',e=>self.skipWaiting());
self.addEventListener('activate',e=>self.clients.claim());
self.addEventListener('fetch',e=>{
  const req=e.request; const url=new URL(req.url);
  if(url.origin!==self.location.origin){ return; } // nur Same-Origin cachen
  e.respondWith(caches.match(req).then(hit=>hit||fetch(req).then(r=>{
    if(req.method==='GET'){const copy=r.clone(); caches.open(CACHE).then(c=>c.put(req,copy));}
    return r;
  }).catch(()=>hit)));
});