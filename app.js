window.__APP_BOOT__ = true;
const APP_VERSION='v6.2-2025-08-18';

// --- Sicheres Laden von pdf.js ---
async function ensurePDFReady(){
  try{
    if (window.pdfjsLib && typeof pdfjsLib.getDocument === 'function') {
      if (pdfjsLib.GlobalWorkerOptions) {
        pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';
      }
      return true;
    }
    await new Promise(resolve => {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js';
      s.defer = true;
      s.onload = s.onerror = () => resolve();
      document.head.appendChild(s);
    });
    if (window.pdfjsLib && typeof pdfjsLib.getDocument === 'function') {
      if (pdfjsLib.GlobalWorkerOptions) {
        pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';
      }
      return true;
    }
  }catch(e){ console.warn('ensurePDFReady error', e); }
  return false;
}

document.addEventListener('DOMContentLoaded',()=>{});