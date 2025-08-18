
window.__APP_VERSION__ = 'v2025-08-18-3';
function setVersion(){var el=document.getElementById('ver'); if(el) el.textContent = 'Offline-fähig • IndexedDB • PWA • ' + window.__APP_VERSION__;}
function showHealth(msg){const el=document.getElementById('health'); if(!el) return; el.textContent=msg; el.hidden=false;}

(function safeInit(){
  // Library presence checks
  const libs = {
    pdf: !!(window.pdfjsLib && window.pdfjsLib.getDocument),
    xlsx: !!window.XLSX,
    chart: !!window.Chart,
  };
  if(!libs.pdf){ showHealth('PDF-Bibliothek konnte nicht geladen werden. Prüfe die Internetverbindung oder Content-Blocker.'); }
  if(!libs.xlsx){ showHealth('Excel-Export nicht verfügbar (XLSX Bibliothek fehlt).'); }
  if(!libs.chart){ showHealth('Charts nicht verfügbar (Chart.js fehlt).'); }
  setVersion();
})();

document.addEventListener('DOMContentLoaded', () => {
  // Tabs
  document.querySelectorAll('.tab').forEach(b=>b.addEventListener('click',()=>{
    const id=b.dataset.tab;
    document.querySelectorAll('.tab').forEach(x=>x.classList.toggle('active',x===b));
    document.querySelectorAll('.tabpane').forEach(p=>p.classList.toggle('active',p.id===`tab-${id}`));
  }));
  // Update button
  const upd=document.getElementById('btn-force-update');
  if (upd) upd.addEventListener('click', forceUpdate);
});

async function forceUpdate(){
  try{
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map(r => r.update()));
    }
    if (window.caches && caches.keys) {
      const keys = await caches.keys();
      await Promise.all(keys.map(k => caches.delete(k)));
    }
  } catch(e){ console.warn('Update-Fehler', e); }
  location.reload();
}
