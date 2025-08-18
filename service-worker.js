const CACHE='kosten-tracker-v6';
self.addEventListener('install', e=>self.skipWaiting());
self.addEventListener('activate', e=>self.clients.claim());
self.addEventListener('fetch', e=>{
  e.respondWith(
    caches.match(e.request).then(r=>{
      return r || fetch(e.request).then(resp=>{
        if(!e.request.url.startsWith('http')) return resp;
        const copy=resp.clone();
        caches.open(CACHE).then(c=>c.put(e.request,copy));
        return resp;
      }).catch(()=>r);
    })
  );
});
