const CACHE='kosten-tracker-v5';
const ASSETS=[
  './','./index.html','./styles.css?v=2025-08-18-5','./app.js?v=2025-08-18-5','./manifest.webmanifest','./icon-192.png','./icon-512.png',
  'https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js',
  'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js',
  'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js',
  'https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js',
  'https://cdn.jsdelivr.net/npm/jspdf-autotable@3.8.2/dist/jspdf.plugin.autotable.min.js',
  'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js'
];
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)));self.skipWaiting()});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))));self.clients.claim()});
self.addEventListener('fetch',e=>{
  const req=e.request;
  e.respondWith(
    caches.match(req).then(hit=>hit||fetch(req).then(resp=>{
      if(req.method==='GET'){const copy=resp.clone(); caches.open(CACHE).then(c=>c.put(req, copy));}
      return resp;
    }).catch(()=>hit))
  );
});
