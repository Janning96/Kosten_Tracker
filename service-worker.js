const CACHE='kosten-tracker-v6.2';
self.addEventListener('install',e=>self.skipWaiting());
self.addEventListener('activate',e=>self.clients.claim());
self.addEventListener('fetch',e=>{
  const req=e.request; const url=new URL(req.url);
  if(url.origin!==self.location.origin) return; // only same-origin
  e.respondWith(
    caches.match(req).then(hit=>hit||fetch(req).then(resp=>{
      if(req.method==='GET'){
        const copy=resp.clone(); caches.open(CACHE).then(c=>c.put(req,copy));
      }
      return resp;
    }).catch(()=>hit))
  );
});
