const CACHE='kosten-tracker-v5_3';
const ASSETS=['./','./index.html','./styles.css?v=2025-08-18-6','./app.js?v=2025-08-18-6','./manifest.webmanifest','./icon-192.png','./icon-512.png',
  'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js',
  'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)));self.skipWaiting()});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))));self.clients.claim()});
self.addEventListener('fetch',e=>{const req=e.request;e.respondWith(caches.match(req).then(hit=>hit||fetch(req).then(r=>{if(req.method==='GET'){const copy=r.clone();caches.open(CACHE).then(c=>c.put(req,copy))}return r}).catch(()=>hit)))})