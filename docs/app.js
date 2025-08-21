window.__APP_BOOT__=true;
const APP_VERSION='v6.4-docs';

// ----- Helpers -----
const $=s=>document.querySelector(s), $$=s=>Array.from(document.querySelectorAll(s));
const CURRENCY=new Intl.NumberFormat('de-DE',{style:'currency',currency:'EUR'});
const UNDEF='Undefiniert';
const DEFAULT_CATS=['Café','Gesundheit','Klamotten','Lebensmittel','Restaurant','Shoppen','Transport','Unterhaltung','Urlaub',UNDEF];

function fromCents(c){return CURRENCY.format((c||0)/100)}
function toISO(dmy){const [d,m,y]=dmy.split('.'); return `${y.length===2?('20'+y):y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`}
function yyyymm(iso){return iso.slice(0,7)}
function logDebug(line){const el=$('#debug-log'); if(el){el.textContent += line + '\n';}}
function health(msg){const h=$('#health'); if(!msg){h.hidden=true;h.textContent='';return} h.textContent=msg; h.hidden=false}

// ----- Safe pdf.js loader -----
async function ensurePDFReady(){
  try{
    if(window.pdfjsLib && typeof pdfjsLib.getDocument==='function'){
      if(pdfjsLib.GlobalWorkerOptions){
        pdfjsLib.GlobalWorkerOptions.workerSrc='https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';
      }
      return true;
    }
    await new Promise(res=>{const s=document.createElement('script'); s.src='https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js'; s.defer=true; s.onload=s.onerror=()=>res(); document.head.appendChild(s);});
    if(window.pdfjsLib && typeof pdfjsLib.getDocument==='function'){
      if(pdfjsLib.GlobalWorkerOptions){
        pdfjsLib.GlobalWorkerOptions.workerSrc='https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';
      }
      return true;
    }
  }catch(e){console.warn('ensurePDFReady error',e)}
  return false;
}

// ----- DB -----
const DB_NAME='kosten-tracker-db', DB_VERSION=8; let db;
function openDB(){return new Promise((res,rej)=>{const r=indexedDB.open(DB_NAME,DB_VERSION);r.onupgradeneeded=e=>{const db=e.target.result; if(!db.objectStoreNames.contains('transactions')){const s=db.createObjectStore('transactions',{keyPath:'id',autoIncrement:true}); s.createIndex('date','date'); s.createIndex('dedupe','dedupe_key',{unique:true}); } if(!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');}; r.onsuccess=()=>{db=r.result;res(db)}; r.onerror=()=>rej(r.error)});}
function tx(store,mode='readonly'){return db.transaction(store,mode).objectStore(store)}
function getAll(store){return new Promise((res,rej)=>{const rq=tx(store).getAll();rq.onsuccess=()=>res(rq.result);rq.onerror=()=>rej(rq.error)})}
function put(store,val,key){return new Promise((res,rej)=>{const rq=tx(store,'readwrite').put(val,key);rq.onsuccess=()=>res(rq.result);rq.onerror=()=>rej(rq.error)})}
async function putMany(store, list){for(const v of list){try{await put(store,v)}catch{}}}
async function getCategories(){const r=await new Promise(res=>{const q=tx('meta').get('categories');q.onsuccess=()=>res(q.result);q.onerror=()=>res(null)});let cats=Array.isArray(r)&&r.length?r:DEFAULT_CATS.slice();cats=cats.filter(c=>c!==UNDEF).sort((a,b)=>a.localeCompare(b,'de')).concat([UNDEF]);await put('meta',cats,'categories');return cats}

// ----- Dedupe -----
function normDesc(s){return (s||'').toLowerCase().normalize('NFKD').replace(/\p{Diacritic}/gu,'').replace(/\s+/g,' ').trim()}
async function sha256(text){if(crypto?.subtle){const buf=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text));return Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,'0')).join('')}let h=5381,i=text.length;while(i)h=(h*33)^text.charCodeAt(--i);return (h>>>0).toString(16)}
async function makeDedupeKey(o){return await sha256(`${o.source}|${o.date}|${o.amount_cents}|${normDesc(o.description||'')}`)}

// ----- Amount parsing -----
function parseAmountToCents(raw){
  let s=String(raw).replace(/\u00A0/g,' ').replace(/\s?€/, '').replace(/\u2212/g,'-').trim();
  s=s.replace(/\./g,'').replace(',', '.');
  let sign=0;
  if(/^[\+\-–-]/.test(s)){sign=(s[0]==='-'||s[0]==='–')?-1:+1; s=s.slice(1);}
  else if(/[\+\-–-]$/.test(s)){sign=(/[-–]$/.test(s))?-1:+1; s=s.slice(0,-1);}
  const value=Math.round(parseFloat(s)*100);
  if(isNaN(value)) throw new Error('Betrag unlesbar: '+raw);
  if(sign===0) sign=-1;
  return value*sign;
}

// ----- Counterparty Normalization -----
const CP_STOP_WORDS=['gesendet mit n26','abo','dein alter kontostand','dein neuer kontostand','wertstellung','ihr einkauf bei','mastercard','lastschriften','gutschriften','belastungen','buchungstag'];
function looksLikeIdToken(tok){if(!tok)return true;const t=tok.trim();if(!t)return true;if(/^[0-9]{4,}$/.test(t))return true;if(/^[0-9A-Z]{5,}$/.test(t))return true;if(/^[A-Z]{2,}\d+/.test(t))return true;return false}
function stripPrefixes(s){return s.replace(/^ny[ay]\*/i,'').replace(/^uzr\*/i,'').replace(/^sumup\s*\*/i,'').replace(/^zettle_\*/i,'').replace(/^pp\.\s*/i,'').replace(/^\d{4,}([\-\/][0-9A-Za-z]{2,})*\s*/,'').trim()}
function stripTrailingNoise(s){return s.replace(/\s+\d{2}\.\d{2}\.(?:\d{2}|\d{4}).*$/,'').replace(/\s+[A-Z]{2,}\d.*$/,'').replace(/\s+\d{3,}$/,'').replace(/\s*[•,]\s*$/,'').trim()}
function brandMap(s){const lower=s.toLowerCase(); if(lower.includes('amzn')||lower.includes('amazon'))return 'AMAZON PAYMENTS EUROPE S.C.A.'; if(lower.includes('paypal')||lower.includes('pp.'))return 'PayPal Europe S.a.r.l. et Cie S.C.A.'; return null}
function chooseCounterparty(lines){const cand=[...lines].reverse().map(s=>s.replace(/\u00A0/g,' ').replace(/\u2212/g,'-').trim());for(let raw of cand){if(!raw)continue;const lr=raw.toLowerCase();if(CP_STOP_WORDS.some(sw=>lr.startsWith(sw)))continue;let s=stripPrefixes(raw);s=stripTrailingNoise(s);const brand=brandMap(s);if(brand)return brand;const star=s.split('*');if(star.length>1&&star[1].trim())s=star.slice(1).join('*').trim();const tokens=s.split(/\s+/);const good=tokens.filter(t=>!looksLikeIdToken(t));const candidate=(good.length?good.join(' '):s).trim();if(candidate&&/[A-Za-zÄÖÜäöüß]/.test(candidate))return candidate}return (lines[lines.length-1]||'').trim()}

// ----- PDF helpers -----
function groupIntoLines(items){const sorted=items.map(it=>({y:it.transform[5],x:it.transform[4],s:it.str})).sort((a,b)=>a.y-b.y||a.x-b.x);const tol=3;const out=[];let bucket=[],y=null;for(const it of sorted){if(y===null||Math.abs(it.y-y)<=tol){bucket.push(it);if(y===null)y=it.y}else{out.push(bucket.slice());bucket=[it];y=it.y}}if(bucket.length)out.push(bucket);return out.map(row=>row.sort((a,b)=>a.x-b.x).map(t=>t.s).join(' ').replace(/\s+/g,' ').trim()).filter(Boolean)}
function detectBank(text){const t=(text||'').toLowerCase();if(t.includes('vorläufiger kontoauszug')||t.includes('space iban')||t.includes('spaces zusammenfassung'))return 'n26';if(t.includes('barclays')&&(t.includes('umsatzübersicht')||t.includes('belegdatum')||t.includes('valutadatum')))return 'barclays';const bar=['umsatzübersicht','belegdatum','valutadatum','betrag (eur)','barclays'];const n26=['n26','vorläufig','space','unterkonto','kontoumsätze','kontoauszug','spaces zusammenfassung'];const score=k=>k.reduce((s,x)=>s+(t.includes(x)?1:0),0);const sb=score(bar),sn=score(n26);if(sb===0&&sn===0)return '';return sn>=sb?'n26':'barclays'}

// ----- Barclays Parser -----
function parseBarclays(lines){
  const items=[];
  for(const ln of lines){
    const l=ln.trim(); if(/^umsatzübersicht/i.test(l))continue; if(/zinssätze/i.test(l))break;
    const m=l.match(/^\s*(\d{1,2}\.\d{1,2}\.(?:\d{2}|\d{4}))\s+(\d{1,2}\.\d{1,2}\.(?:\d{2}|\d{4}))\s+(.+?)\s+([0-9]{1,3}(?:\.[0-9]{3})*,\d{2})\s*([+\-–-])?\s*€?\s*$/i);
    if(m){const[,be,val,descRaw,amountRaw,tr]=m;const desc=descRaw.trim(); if(/gutschrift\s+manuelle\s+lastschrift/i.test(desc))continue; const amount=amountRaw+(tr||''); let cents; try{cents=parseAmountToCents(amount)}catch{continue} items.push({source:'barclays_pdf',date:toISO(val),description:desc.replace(/\s+/g,' '),amount_cents:cents,currency:'EUR'})}
  }
  return items;
}

// ----- N26 Parser (robust) -----
function parseN26(lines){
  const items=[]; let section='Hauptkonto'; let buf=[]; let pending=null;
  const isHeader=s=>/beschreibung/i.test(s)&&/betrag/i.test(s);
  const isSummary=s=>/(zusammenfassung|spaces zusammenfassung)/i.test(s);
  const isSpaceStart=s=>/vorläufiger\s+space\s+kontoauszug/i.test(s);
  const reSpaceName=/^space:\s*(.+)$/i;
  const isLabel=s=>/^(lastschriften|gutschriften|belastungen|mastercard\s*•|iban:|bic:)/i.test(s);
  const isWorthless=s=>/^(erstellt am|vorläufiger kontoauszug|kontoauszug|datum geöffnet:|\d+\s*\/\s*\d+|iban:|bic:|dein alter kontostand|ausgehende transaktionen|eingehende transaktionen|dein neuer kontostand|anmerkung|dein guthaben|team)$/i.test(s);
  const reW=/^wertstellung(?:sdatum)?\s*:?\s*(\d{1,2}\.\d{1,2}\.(?:\d{2}|\d{4}))$/i;
  const reTwoDateAmt=/^(\d{1,2}\.\d{1,2}\.(?:\d{2}|\d{4}))\s+(\d{1,2}\.\d{1,2}\.(?:\d{2}|\d{4}))\s+([+\-−–-]?\s*\d{1,3}(?:\.\d{3})*,\d{2})\s*€?$/i;
  const reDateAmt=/^(\d{1,2}\.\d{1,2}\.(?:\d{2}|\d{4}))\s+([+\-−–-]?\s*\d{1,3}(?:\.\d{3})*,\d{2})\s*€?$/i;
  for(const raw of lines){
    let line=(raw||'').trim(); if(!line)continue;
    line=line.replace(/\u00A0/g,' ').replace(/\u2212/g,'-').replace(/\s+/g,' ').trim();
    if(isSpaceStart(line)) continue;
    const sn=line.match(reSpaceName); if(sn){section=sn[1].trim(); continue;}
    if(isSummary(line)||isHeader(line)){buf=[];pending=null;continue}
    if(isWorthless(line)||isLabel(line)) continue;
    let m=line.match(reTwoDateAmt);
    if(m){const[, ,verbuch,amount]=m; const desc=chooseCounterparty(buf.length?buf:[section]); if(/barclays/i.test(desc)){buf=[];pending=null;continue} try{items.push({source:'n26_pdf',date:toISO(verbuch),description:desc,amount_cents:parseAmountToCents(amount),currency:'EUR'})}catch{} buf=[];pending=null;continue}
    const w=line.match(reW); if(w){pending=w[1]; continue;}
    const d=line.match(reDateAmt); if(d && pending){const[,verbuch,amount]=d; const desc=chooseCounterparty(buf.length?buf:[section]); if(/barclays/i.test(desc)){buf=[];pending=null;continue} try{items.push({source:'n26_pdf',date:toISO(verbuch),description:desc,amount_cents:parseAmountToCents(amount),currency:'EUR'})}catch{} buf=[];pending=null;continue}
    if(!/^\d{1,2}\.\d{1,2}\.(?:\d{2}|\d{4})$/.test(line)){buf.push(line); if(buf.length>8) buf.shift();}
  }
  return items;
}

// ----- UI Boot -----
document.addEventListener('DOMContentLoaded', async ()=>{
  $('#ver').textContent='Offline‑fähig • IndexedDB • PWA • '+APP_VERSION;
  $$('.tab').forEach(b=>b.addEventListener('click',()=>{$$('.tab').forEach(x=>x.classList.toggle('active',x===b));$$('.tabpane').forEach(p=>p.classList.toggle('active',p.id===`tab-${b.dataset.tab}`));}));
  $('#btn-force-update')?.addEventListener('click', forceUpdate);
  await openDB(); await put('meta', await getCategories(), 'categories');
  $('#btn-parse-pdf')?.addEventListener('click', parseSelectedPDFs);
  $('#btn-commit-import')?.addEventListener('click', commitPreview);
  $('#btn-clear-preview')?.addEventListener('click', clearPreview);
  await refreshTransactions(); await refreshCharts(); await renderCategorySelects();
});

// ----- Import Flow -----
let preview=[];
async function parseSelectedPDFs(){
  if(!await ensurePDFReady()){health('PDF‑Engine konnte nicht geladen werden (CDN geblockt?). Import abgebrochen.');return}
  const input=$('#pdf-input'); if(!input.files||!input.files.length){alert('Bitte PDF-Datei(en) auswählen.');return}
  $('#debug-log').textContent=''; $('#import-log').textContent='Analysiere…'; preview=[];
  for(const f of input.files){
    try{
      const bankHint=$('#bank-hint').value||'';
      const arr=new Uint8Array(await f.arrayBuffer());
      const pdf=await pdfjsLib.getDocument({data:arr}).promise;
      logDebug(`Datei: ${f.name} • Seiten: ${pdf.numPages}`);
      for(let p=1;p<=pdf.numPages;p++){
        const page=await pdf.getPage(p); const txt=await page.getTextContent(); const lines=groupIntoLines(txt.items);
        const bank=bankHint||detectBank(lines.join(' '))||(/n26/i.test(f.name)?'n26':'');
        const items = bank==='barclays'?parseBarclays(lines): bank==='n26'?parseN26(lines): [];
        logDebug(`Seite ${p}: Bank=${bank||'?'} Zeilen=${lines.length} Treffer=${items.length}`);
        preview.push(...items);
      }
    }catch(e){console.warn('PDF parse error',e);logDebug('Fehler: '+(e.message||e));}
  }
  for(const it of preview) it.dedupe_key=await makeDedupeKey(it);
  const map=new Map(); preview.forEach(x=>map.set(x.dedupe_key,x)); preview=Array.from(map.values());
  renderPreview(); $('#import-log').textContent=`Vorschau: ${preview.length} erkannte Transaktionen`; $('#btn-commit-import').disabled=preview.length===0;
}

function renderPreview(){const tb=$('#preview-table tbody');tb.innerHTML='';preview.forEach(it=>{const tr=document.createElement('tr');tr.innerHTML=`<td>${srcLabel(it.source)}</td><td>${formatDE(it.date)}</td><td>${escapeHTML(it.description||'')}</td><td class="num">${fromCents(it.amount_cents)}</td><td>Neu</td>`;tb.appendChild(tr)})}
async function commitPreview(){if(!preview.length)return;const ex=await getAll('transactions');const keys=new Set(ex.map(t=>t.dedupe_key));const add=[];for(const it of preview){it.category||=UNDEF;if(!keys.has(it.dedupe_key))add.push(it)}await putMany('transactions',add);clearPreview();alert(`Import abgeschlossen: ${add.length} neue Transaktionen.`);await refreshTransactions();await refreshCharts()}
function clearPreview(){preview=[];$('#preview-table tbody').innerHTML='';$('#btn-commit-import').disabled=true;$('#import-log').textContent=''}

function srcLabel(s){return s==='barclays_pdf'?'Barclays':s==='n26_pdf'?'N26':s==='excel'?'Excel':'Manuell'}
function formatDE(iso){const [y,m,d]=iso.split('-');return `${d}.${m}.${y}`}
function escapeHTML(s){return(s||'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]))}

// ----- Transactions List -----
async function refreshTransactions(){
  const rows=await getAll('transactions'); rows.sort((a,b)=>a.date.localeCompare(b.date));
  const tb=$('#tx-table tbody'); tb.innerHTML='';
  let total=0;
  const cats=await getCategories();
  for(const t of rows){
    total+=t.amount_cents||0;
    const tr=document.createElement('tr');
    const catSel = `<select data-id="${t.id}" class="cat">${cats.map(c=>`<option ${t.category===c?'selected':''}>${c}</option>`).join('')}</select>`;
    tr.innerHTML=`<td>${formatDE(t.date)}</td><td>${escapeHTML(t.description||'')}</td><td>${catSel}</td><td>${srcLabel(t.source)}</td><td class="num">${fromCents(t.amount_cents)}</td><td></td>`;
    tb.appendChild(tr);
  }
  $('#tx-total').textContent=fromCents(total);
  // Update handler
  tb.querySelectorAll('select.cat').forEach(sel=>sel.addEventListener('change', async (e)=>{
    const id = Number(e.target.getAttribute('data-id'));
    const val = e.target.value;
    const list = await getAll('transactions');
    const txo = list.find(r=>r.id===id); if(txo){txo.category=val; await put('transactions', txo);}
    await refreshCharts();
  }));
}

// ----- Charts (defensiv) -----
async function refreshCharts(){
  if(!window.Chart){console.warn('Chart.js fehlt – Charts übersprungen');return}
  const rows=await getAll('transactions'); rows.sort((a,b)=>a.date.localeCompare(b.date));
  const byMonth={}, byCat={}, byCatMonth={};
  for(const t of rows){const m=yyyymm(t.date); byMonth[m]=(byMonth[m]||0)+(t.amount_cents||0); const c=t.category||UNDEF; byCat[c]=(byCat[c]||0)+(t.amount_cents||0); byCatMonth[c]=byCatMonth[c]||{}; byCatMonth[c][m]=(byCatMonth[c][m]||0)+(t.amount_cents||0);}
  const trendCtx=$('#ch-trend'), barCtx=$('#ch-bar'), pieCtx=$('#ch-pie'), lineCtx=$('#ch-line'); const labels=Object.keys(byMonth).sort();
  renderChart(trendCtx,'line',{labels,datasets:[{label:'Summe/Monat',data:labels.map(m=>byMonth[m]/100)}]});
  const catLabels=Object.keys(byCat).sort((a,b)=>a.localeCompare(b,'de')); renderChart(barCtx,'bar',{labels:catLabels,datasets:[{label:'Summe',data:catLabels.map(c=>byCat[c]/100)}]});
  renderChart(pieCtx,'pie',{labels:catLabels,datasets:[{data:catLabels.map(c=>Math.abs(byCat[c]/100))}]});
  // Linie je Kategorie (Dropdown)
  const sel=$('#cat-series'); sel.innerHTML=''; catLabels.forEach(c=>{const o=document.createElement('option');o.value=c;o.textContent=c;sel.appendChild(o)});
  sel.onchange=()=>updateCatLine(); updateCatLine();
  function updateCatLine(){const c=sel.value||catLabels[0]||UNDEF; const mlabels=labels; const data=mlabels.map(m=>(byCatMonth[c]&&byCatMonth[c][m]?byCatMonth[c][m]:0)/100); renderChart(lineCtx,'line',{labels:mlabels,datasets:[{label:c,data}]});}
}
let _charts=[];
function renderChart(ctx,type,data){if(!ctx)return; if(_charts.find(x=>x.ctx===ctx)){_charts.find(x=>x.ctx===ctx).chart.destroy(); _charts=_charts.filter(x=>x.ctx!==ctx);} const chart=new Chart(ctx,{type,data,options:{responsive:true,maintainAspectRatio:false}}); _charts.push({ctx,chart})}

// ----- Exports -----
$('#btn-export-master-xlsx')?.addEventListener('click', async ()=>{
  if(!window.XLSX){alert('XLSX Bibliothek fehlt');return}
  const rows=await getAll('transactions'); const ws=XLSX.utils.json_to_sheet(rows.map(r=>({Datum:formatDE(r.date),Beschreibung:r.description,Kategorie:r.category||'',Quelle:srcLabel(r.source),Betrag:(r.amount_cents||0)/100})));
  const wb=XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb,ws,'Transaktionen'); const out=XLSX.write(wb,{bookType:'xlsx',type:'array'});
  const blob=new Blob([out],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}); const url=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download='Finanzen.xlsx'; a.click(); URL.revokeObjectURL(url);
});

// ----- Force update -----
async function forceUpdate(){try{if('serviceWorker'in navigator){const regs=await navigator.serviceWorker.getRegistrations();await Promise.all(regs.map(r=>r.update()))}if(window.caches?.keys){const ks=await caches.keys();await Promise.all(ks.map(k=>caches.delete(k)))}}catch(e){console.warn('Update-Fehler',e)}location.reload()}
