const CACHE='kosten-tracker-pro-v4';
const ASSETS=['./','./index.html','./styles.css','./app.js?v=2025-08-18-3','./manifest.webmanifest','./icon-192.png','./icon-512.png'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)));self.skipWaiting()});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))));self.clients.claim()});
self.addEventListener('fetch',e=>{const req=e.request;e.respondWith(caches.match(req).then(hit=>hit||fetch(req).then(r=>{if(req.method==='GET'){const copy=r.clone();caches.open(CACHE).then(c=>c.put(req,copy))}return r}).catch(()=>hit)))})