const APP_VERSION='v2025-08-18-6';
pdfjsLib.GlobalWorkerOptions.workerSrc='https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';

function logDebug(line){const el=document.getElementById('debug-log'); if(el){el.textContent += line + '\n';}}

document.addEventListener('DOMContentLoaded',()=>{
  document.getElementById('ver').textContent='Offline‑fähig • IndexedDB • PWA • '+APP_VERSION;
  document.getElementById('btn-force-update')?.addEventListener('click', forceUpdate);
});

// IndexedDB setup (same as v5)
const DB_NAME='kosten-tracker-db', DB_VERSION=8; let db;
function openDB(){return new Promise((res,rej)=>{const r=indexedDB.open(DB_NAME,DB_VERSION);r.onupgradeneeded=e=>{const db=e.target.result;if(!db.objectStoreNames.contains('transactions')){const s=db.createObjectStore('transactions',{keyPath:'id',autoIncrement:true});s.createIndex('date','date');s.createIndex('dedupe','dedupe_key',{unique:true});}else{const s=r.transaction.objectStore('transactions');if(!s.indexNames.contains('date'))s.createIndex('date','date');if(!s.indexNames.contains('dedupe'))s.createIndex('dedupe','dedupe_key',{unique:true});}if(!db.objectStoreNames.contains('meta'))db.createObjectStore('meta');};r.onsuccess=()=>{db=r.result;res(db)};r.onerror=()=>rej(r.error)})}
function tx(store,mode='readonly'){return db.transaction(store,mode).objectStore(store)}
function getAll(store){return new Promise((res,rej)=>{const rq=tx(store).getAll();rq.onsuccess=()=>res(rq.result);rq.onerror=()=>rej(rq.error)})}
function put(store,val,key){return new Promise((res,rej)=>{const rq=tx(store,'readwrite').put(val,key);rq.onsuccess=()=>res(rq.result);rq.onerror=()=>rej(rq.error)})}
async function putMany(store, list){for(const v of list){try{await put(store,v)}catch{}}}

const CURRENCY=new Intl.NumberFormat('de-DE',{style:'currency',currency:'EUR'});
function fromCents(c){return CURRENCY.format((c||0)/100)}
function toISO(dmy){const [d,m,y]=dmy.split('.');return `${y}-${m}-${d}`}
function yyyymm(iso){return iso.slice(0,7)}
function inRange(d,from,to){if(from&&d<from)return false;if(to&&d>to)return false;return true}

function parseAmountToCents(raw){
  let s=String(raw).replace(/\u00A0/g,' ').replace(/\s?€/g,'').replace(/\u2212/g,'-').trim();
  s=s.replace(/\./g,'').replace(',', '.');
  let sign=0;
  if(/^[\+\-–-]/.test(s)){sign=(s[0]==='-'||s[0]==='–')?-1:+1;s=s.slice(1);}
  else if(/[\+\-–-]$/.test(s)){sign=(/[-–]$/.test(s))?-1:+1;s=s.slice(0,-1);}
  const value=Math.round(parseFloat(s)*100);
  if(isNaN(value)) throw new Error('Betrag unlesbar: '+raw);
  if(sign===0) sign=-1; // Standard: Ausgaben
  return value*sign;
}

function normDesc(s){return (s||'').toLowerCase().normalize('NFKD').replace(/\p{Diacritic}/gu,'').replace(/\s+/g,' ').trim()}
async function sha256(text){if(crypto?.subtle){const buf=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text));return Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,'0')).join('')}let h=5381,i=text.length;while(i)h=(h*33)^text.charCodeAt(--i);return (h>>>0).toString(16)}
async function makeDedupeKey(o){return await sha256(`${o.source}|${o.date}|${o.amount_cents}|${normDesc(o.description||'')}`)}

const UNDEF='Undefiniert'; const DEFAULT_CATS=['Café','Gesundheit','Klamotten','Lebensmittel','Restaurant','Shoppen','Transport','Unterhaltung','Urlaub',UNDEF];
async function getCategories(){const r=await new Promise(res=>{const q=tx('meta').get('categories');q.onsuccess=()=>res(q.result);q.onerror=()=>res(null)});let cats=Array.isArray(r)&&r.length?r:DEFAULT_CATS.slice();cats=cats.filter(c=>c!==UNDEF).sort((a,b)=>a.localeCompare(b,'de')).concat([UNDEF]);await put('meta',cats,'categories');return cats}

const $=s=>document.querySelector(s), $$=s=>Array.from(document.querySelectorAll(s));

// Counterparty normalization (same as v5)
const CP_STOP_WORDS=['gesendet mit n26','abo','dein alter kontostand','dein neuer kontostand','wertstellung','ihr einkauf bei','mastercard','lastschriften','gutschriften','belastungen','buchungstag'];
function looksLikeIdToken(tok){if(!tok)return true;const t=tok.trim();if(!t)return true;if(/^[0-9]{4,}$/.test(t))return true;if(/^[0-9A-Z]{5,}$/.test(t))return true;if(/^[A-Z]{2,}\d+/.test(t))return true;return false}
function stripPrefixes(s){return s.replace(/^ny[ay]\*/i,'').replace(/^uzr\*/i,'').replace(/^sumup\s*\*/i,'').replace(/^zettle_\*/i,'').replace(/^pp\.\s*/i,'').replace(/^\d{4,}([\-\/][0-9A-Za-z]{2,})*\s*/,'').trim()}
function stripTrailingNoise(s){return s.replace(/\s+\d{2}\.\d{2}\.(?:\d{2}|\d{4}).*$/,'').replace(/\s+[A-Z]{2,}\d.*$/,'').replace(/\s+\d{3,}$/,'').replace(/\s*[•,]\s*$/,'').trim()}
function brandMap(s){const lower=s.toLowerCase();if(lower.includes('amzn')||lower.includes('amazon'))return 'AMAZON PAYMENTS EUROPE S.C.A.';if(lower.includes('paypal')||lower.includes('pp.'))return 'PayPal Europe S.a.r.l. et Cie S.C.A.';return null}
function chooseCounterparty(lines){const cand=[...lines].reverse().map(s=>s.replace(/\u00A0/g,' ').replace(/\u2212/g,'-').trim());for(let raw of cand){if(!raw)continue;const lr=raw.toLowerCase();if(CP_STOP_WORDS.some(sw=>lr.startsWith(sw)))continue;let s=stripPrefixes(raw);s=stripTrailingNoise(s);const brand=brandMap(s);if(brand)return brand;const star=s.split('*');if(star.length>1&&star[1].trim())s=star.slice(1).join('*').trim();const tokens=s.split(/\s+/);const good=tokens.filter(t=>!looksLikeIdToken(t));const candidate=(good.length?good.join(' '):s).trim();if(candidate&&/[A-Za-zÄÖÜäöüß]/.test(candidate))return candidate}return (lines[lines.length-1]||'').trim()}

// Group lines with Y tolerance
function groupIntoLines(items){const sorted=items.map(it=>({y:it.transform[5],x:it.transform[4],s:it.str})).sort((a,b)=>a.y-b.y||a.x-b.x);const tol=3;const out=[];let bucket=[],y=null;for(const it of sorted){if(y===null||Math.abs(it.y-y)<=tol){bucket.push(it);if(y===null)y=it.y}else{out.push(bucket.slice());bucket=[it];y=it.y}}if(bucket.length)out.push(bucket);return out.map(row=>row.sort((a,b)=>a.x-b.x).map(t=>t.s).join(' ').replace(/\s+/g,' ').trim()).filter(Boolean)}

function detectBank(text){const t=(text||'').toLowerCase();if(t.includes('vorläufiger kontoauszug')||t.includes('space iban')||t.includes('spaces zusammenfassung'))return 'n26';if(t.includes('barclays')&&(t.includes('umsatzübersicht')||t.includes('belegdatum')||t.includes('valutadatum')))return 'barclays';const bar=['umsatzübersicht','belegdatum','valutadatum','betrag (eur)','barclays'];const n26=['n26','vorläufig','space','unterkonto','kontoumsätze','kontoauszug','spaces zusammenfassung'];const score=k=>k.reduce((s,x)=>s+(t.includes(x)?1:0),0);const sb=score(bar),sn=score(n26);if(sb===0&&sn===0)return '';return sn>=sb?'n26':'barclays'}

// Barclays parser (unchanged)
function parseBarclays(lines){
  const items=[]; let sectionHint='';
  for(const ln of lines){
    const l=ln.trim(); if(/^umsatzübersicht/i.test(l))continue; if(/zinssätze/i.test(l))break; if(/sonstige umsätze/i.test(l))sectionHint='gutschrift';
    const m=l.match(/^\s*(\d{1,2}\.\d{1,2}\.(?:\d{2}|\d{4}))\s+(\d{1,2}\.\d{1,2}\.(?:\d{2}|\d{4}))\s+(.+?)\s+([0-9]{1,3}(?:\.[0-9]{3})*,\d{2})\s*([+\-–-])?\s*€?\s*$/i);
    if(m){const[,be,val,descRaw,amountRaw,tr]=m;const desc=descRaw.trim();if(/gutschrift\s+manuelle\s+lastschrift/i.test(desc))continue;const amount=amountRaw+(tr||'');let cents;try{cents=parseAmountToCents(amount)}catch{continue}items.push({source:'barclays_pdf',date:toISO(val),description:desc.replace(/\s+/g,' '),amount_cents:cents,currency:'EUR'})}
  } return items;
}

// N26 parser (more tolerant)
function parseN26(lines){
  const items=[]; let section='Hauptkonto'; let buf=[]; let pending=null;
  const isHeader=s=>/^(beschreibung\s+verbuchungsdatum\s+betrag)$/i.test(s.replace(/\s+/g,' ').trim());
  const isSummary=s=>/(zusammenfassung|spaces zusammenfassung)/i.test(s);
  const isSpaceStart=s=>/^(vorläufiger\s+space\s+kontoauszug)/i.test(s);
  const reSpaceName=/^space:\s*(.+)$/i;
  const isLabel=s=>/^(lastschriften|gutschriften|belastungen|mastercard\s*•|iban:|bic:)/i.test(s);
  const isWorthless=s=>/^(erstellt am|vorläufiger kontoauszug|kontoauszug|datum geöffnet:|\d+\s*\/\s*\d+|iban:|bic:|dein alter kontostand|ausgehende transaktionen|eingehende transaktionen|dein neuer kontostand|anmerkung|dein guthaben|team)$/i.test(s);

  const reW=/^wertstellung\s+(\d{1,2}\.\d{1,2}\.(?:\d{2}|\d{4}))$/i;
  const reP=/^(\d{1,2}\.\d{1,2}\.(?:\d{2}|\d{4}))\s+([+\-−–-]?\s*\d{1,3}(?:\.\d{3})*,\d{2})\s*€?$/;
  const reC=/wertstellung\s+(\d{1,2}\.\d{1,2}\.(?:\d{2}|\d{4}))\s+(\d{1,2}\.\d{1,2}\.(?:\d{2}|\d{4}))\s+([+\-−–-]?\s*\d{1,3}(?:\.\d{3})*,\d{2})\s*€?/i;

  for(const raw of lines){
    let line=(raw||'').trim(); if(!line) continue;
    line=line.replace(/\u00A0/g,' ').replace(/\u2212/g,'-').replace(/\s+/g,' ').trim();

    const cmb=line.match(reC);
    if(cmb){
      const verbuch=cmb[2]; const amount=cmb[3];
      const desc=chooseCounterparty(buf.length?buf:[section]);
      if(/barclays/i.test(desc)){buf=[];pending=null;continue}
      try{items.push({source:'n26_pdf',date:toISO(verbuch),description:desc,amount_cents:parseAmountToCents(amount),currency:'EUR'})}catch{}
      buf=[]; pending=null; continue;
    }

    if(isSpaceStart(line)) continue;
    const sn=line.match(reSpaceName); if(sn){section=sn[1].trim(); continue;}
    if(isSummary(line)||isHeader(line)){buf=[];pending=null;continue}
    if(isWorthless(line)||isLabel(line)) continue;

    const wm=line.match(reW); if(wm){pending=wm[1]; continue;}

    const pm=line.match(reP);
    if(pm && pending){
      const verbuch=pm[1], amount=pm[2];
      const desc=chooseCounterparty(buf.length?buf:[section]);
      if(/barclays/i.test(desc)){buf=[];pending=null;continue}
      try{items.push({source:'n26_pdf',date:toISO(verbuch),description:desc,amount_cents:parseAmountToCents(amount),currency:'EUR'})}catch{}
      buf=[]; pending=null; continue;
    }

    if(line && !/^\d{1,2}\.\d{1,2}\.(?:\d{2}|\d{4})$/.test(line)){buf.push(line); if(buf.length>6) buf.shift();}
  }
  return items;
}

// UI + actions
document.addEventListener('DOMContentLoaded', async ()=>{
  await openDB();
  await put('meta', await getCategories(), 'categories');
  $$('.tab').forEach(b=>b.addEventListener('click',()=>{$$('.tab').forEach(x=>x.classList.toggle('active',x===b));$$('.tabpane').forEach(p=>p.classList.toggle('active',p.id===`tab-${b.dataset.tab}`));}));
  document.getElementById('btn-parse-pdf')?.addEventListener('click', parseSelectedPDFs);
  document.getElementById('btn-commit-import')?.addEventListener('click', commitPreview);
  document.getElementById('btn-clear-preview')?.addEventListener('click', clearPreview);
  await refreshTransactions(); await refreshCharts(); await renderCategorySelects();
});

let preview=[];
async function parseSelectedPDFs(){
  const input=document.getElementById('pdf-input'); if(!input.files||!input.files.length){alert('Bitte PDF-Datei(en) auswählen.');return}
  document.getElementById('debug-log').textContent='';
  document.getElementById('import-log').textContent='Analysiere…'; preview=[];
  for(const f of input.files){
    try{
      const bankHint=document.getElementById('bank-hint').value||'';
      const arr=new Uint8Array(await f.arrayBuffer());
      const pdf=await pdfjsLib.getDocument({data:arr}).promise;
      logDebug(`Datei: ${f.name} • Seiten: ${pdf.numPages}`);
      for(let p=1;p<=pdf.numPages;p++){
        const page=await pdf.getPage(p); const txt=await page.getTextContent(); const lines=groupIntoLines(txt.items);
        const bank=bankHint||detectBank(lines.join(' ')); const items= bank==='barclays'?parseBarclays(lines): bank==='n26'?parseN26(lines): [];
        logDebug(`Seite ${p}: Bank=${bank||'?'}, Zeilen=${lines.length}, Treffer=${items.length}`);
        preview.push(...items);
      }
    }catch(e){console.warn('PDF parse error',e);logDebug('Fehler: '+(e.message||e));document.getElementById('import-log').textContent='Fehler beim PDF‑Import: '+(e.message||e)}
  }
  for(const it of preview) it.dedupe_key=await makeDedupeKey(it);
  const map=new Map(); preview.forEach(x=>map.set(x.dedupe_key,x)); preview=Array.from(map.values());
  renderPreview(); document.getElementById('import-log').textContent=`Vorschau: ${preview.length} erkannte Transaktionen`; document.getElementById('btn-commit-import').disabled=preview.length===0;
}

function renderPreview(){const tb=document.querySelector('#preview-table tbody');tb.innerHTML='';preview.forEach(it=>{const tr=document.createElement('tr');tr.innerHTML=`<td>${srcLabel(it.source)}</td><td>${formatDE(it.date)}</td><td>${escapeHTML(it.description||'')}</td><td class="num">${fromCents(it.amount_cents)}</td><td>Neu</td>`;tb.appendChild(tr)})}
async function commitPreview(){if(!preview.length)return;const ex=await getAll('transactions');const keys=new Set(ex.map(t=>t.dedupe_key));const add=[];for(const it of preview){it.category||=UNDEF;if(!keys.has(it.dedupe_key))add.push(it)}await putMany('transactions',add);clearPreview();alert(`Import abgeschlossen: ${add.length} neue Transaktionen.`);await refreshTransactions();await refreshCharts()}
function clearPreview(){preview=[];document.querySelector('#preview-table tbody').innerHTML='';document.getElementById('btn-commit-import').disabled=true;document.getElementById('import-log').textContent=''}

function srcLabel(s){return s==='barclays_pdf'?'Barclays':s==='n26_pdf'?'N26':s==='excel'?'Excel':'Manuell'}
function formatDE(iso){const [y,m,d]=iso.split('-');return `${d}.${m}.${y}`}
function escapeHTML(s){return(s||'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]))}

// Charts & exports (omitted here for brevity but included)
async function renderCategorySelects(){const cats=await getCategories();const sel=document.getElementById('cat-series'); if(sel){sel.innerHTML='';cats.forEach(c=>{const o=document.createElement('option');o.value=c;o.textContent=c;sel.appendChild(o)})}}
async function refreshTransactions(){/* no-op minimal for this build */}
async function refreshCharts(){/* no-op minimal for this build */}

// Update
async function forceUpdate(){try{if('serviceWorker'in navigator){const regs=await navigator.serviceWorker.getRegistrations();await Promise.all(regs.map(r=>r.update()))}if(window.caches?.keys){const ks=await caches.keys();await Promise.all(ks.map(k=>caches.delete(k)))}}catch(e){console.warn('Update-Fehler',e)}location.reload()}
