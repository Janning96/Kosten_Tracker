console.log('app');
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

document.addEventListener('DOMContentLoaded', ()=>{
  const upd=document.getElementById('btn-force-update');
  if (upd) upd.addEventListener('click', forceUpdate);
});
