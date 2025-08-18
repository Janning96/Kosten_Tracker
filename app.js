pdfjsLib.GlobalWorkerOptions.workerSrc='https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';

const DB_NAME='kosten-tracker-db', DB_VERSION=6; let db;
function openDB(){return new Promise((res,rej)=>{const r=indexedDB.open(DB_NAME,DB_VERSION);r.onupgradeneeded=e=>{const db=e.target.result;if(!db.objectStoreNames.contains('transactions')){const s=db.createObjectStore('transactions',{keyPath:'id',autoIncrement:true});s.createIndex('date','date');s.createIndex('dedupe','dedupe_key',{unique:true});}else{const s=r.transaction.objectStore('transactions');if(!s.indexNames.contains('date'))s.createIndex('date','date');if(!s.indexNames.contains('dedupe'))s.createIndex('dedupe','dedupe_key',{unique:true});}if(!db.objectStoreNames.contains('meta'))db.createObjectStore('meta');};r.onsuccess=()=>{db=r.result;res(db)};r.onerror=()=>rej(r.error)});}
function tx(store,mode='readonly'){return db.transaction(store,mode).objectStore(store)}
function getAll(store){return new Promise((res,rej)=>{const r=tx(store).getAll();r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)})}
function put(store,val,key){return new Promise((res,rej)=>{const r=tx(store,'readwrite').put(val,key);r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)})}
async function putMany(store,list){for(const v of list){try{await put(store,v)}catch{}}}

const CURRENCY=new Intl.NumberFormat('de-DE',{style:'currency',currency:'EUR'});
function fromCents(c){return CURRENCY.format((c||0)/100)}
function toISO(dmy){const [d,m,y]=dmy.split('.');return `${y}-${m}-${d}`}
function parseAmountToCents(raw){let s=String(raw).replace(/\s|€|\u00A0/g,'').replace(/\u2212/g,'-').replace(/\./g,'').replace(',', '.');let sign=0;if(/[\+\-–-]$/.test(s)){const last=s.slice(-1);if(last==='+')sign=+1;if(last==='-'||last==='–')sign=-1;s=s.slice(0,-1);}if(/^[\+\-–-]/.test(s)){sign=s[0]==='-'||s[0]==='–'?-1:+1;s=s.slice(1);}let value=Math.round(parseFloat(s)*100);if(isNaN(value))throw new Error('Betrag unlesbar: '+raw);if(sign===0)sign=-1;return value*sign}

function normDesc(s){return s.toLowerCase().normalize('NFKD').replace(/\p{Diacritic}/gu,'').replace(/\s+/g,' ').trim()}
async function sha256(text){if(crypto?.subtle){const enc=new TextEncoder().encode(text);const buf=await crypto.subtle.digest('SHA-256',enc);return Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,'0')).join('')}let hash=5381,i=text.length;while(i)hash=(hash*33)^text.charCodeAt(--i);return (hash>>>0).toString(16)}
async function makeDedupeKey(o){const k=`${o.source}|${o.date}|${o.amount_cents}|${normDesc(o.description||'')}`;return await sha256(k)}
function yyyymm(iso){return iso.slice(0,7)}
function inRange(d,from,to){if(from&&d<from)return false;if(to&&d>to)return false;return true}

const UNDEF='Undefiniert'; const DEFAULT_CATS=['Café','Gesundheit','Klamotten','Lebensmittel','Restaurant','Shoppen','Transport','Unterhaltung','Urlaub',UNDEF];
async function getCategories(){const r=await new Promise(res=>{const rq=tx('meta').get('categories');rq.onsuccess=()=>res(rq.result);rq.onerror=()=>res(null)});let cats=Array.isArray(r)&&r.length?r:DEFAULT_CATS.slice();cats=cats.filter(c=>c!==UNDEF).sort((a,b)=>a.localeCompare(b,'de')).concat([UNDEF]);await put('meta',cats,'categories');return cats}

const $=s=>document.querySelector(s), $$=s=>Array.from(document.querySelectorAll(s));
function switchTab(id){$$('.tab').forEach(b=>b.classList.toggle('active',b.dataset.tab===id));$$('.tabpane').forEach(p=>p.classList.toggle('active',p.id===`tab-${id}`))}

document.addEventListener('DOMContentLoaded',async()=>{
  await openDB(); await put('meta',await getCategories(),'categories');
  $$('.tab').forEach(b=>b.addEventListener('click',()=>switchTab(b.dataset.tab)));
  await renderCategorySelects();
  $('#btn-apply-filter').addEventListener('click',refreshTransactions);
  $('#btn-clear-filter').addEventListener('click',()=>{$('#flt-month').value='';$('#flt-from').value='';$('#flt-to').value='';$('#flt-source').value='';$('#flt-cat').value='';refreshTransactions()});
  $('#btn-ana-apply').addEventListener('click',refreshCharts);
  $('#btn-ana-clear').addEventListener('click',()=>{$('#ana-month').value='';$('#ana-from').value='';$('#ana-to').value='';refreshCharts()});
  $('#btn-parse-pdf').addEventListener('click',parseSelectedPDFs);
  $('#btn-commit-import').addEventListener('click',commitPreview);
  $('#btn-clear-preview').addEventListener('click',clearPreview);
  document.getElementById('pdf-input').addEventListener('change',()=>{const n=document.getElementById('pdf-input').files?.length||0;document.getElementById('import-log').textContent=n?`${n} PDF ausgewählt`:''});
  $('#btn-export-master-xlsx').addEventListener('click',exportMasterExcel);
  $('#btn-export-ana-pdf').addEventListener('click',exportAnalysisPDF);
  $('#btn-export-range-xlsx').addEventListener('click',exportRangeExcel);
  await refreshTransactions(); await refreshCharts();
});

async function renderCategorySelects(){const cats=await getCategories();const selects=[$('#flt-cat'),$('#cat-series')].filter(Boolean);selects.forEach(sel=>{sel.innerHTML='';if(sel===$('#flt-cat')){const o=document.createElement('option');o.value='';o.textContent='Alle Kategorien';sel.appendChild(o)}cats.forEach(c=>{const o=document.createElement('option');o.value=c;o.textContent=c;sel.appendChild(o)})})}

// ---- Counterparty normalization ----
const CP_STOP_WORDS=['gesendet mit n26','abo','dein alter kontostand','dein neuer kontostand','wertstellung','ihr einkauf bei','mastercard','lastschriften','gutschriften','belastungen','buchungstag'];
function looksLikeIdToken(tok){if(!tok)return true;const t=tok.trim();if(!t)return true;if(/^[0-9]{4,}$/.test(t))return true;if(/^[0-9A-Z]{5,}$/.test(t))return true;if(/^[A-Z]{2,}\d+/.test(t))return true;return false}
function stripPrefixes(s){return s.replace(/^ny[ay]\*/i,'').replace(/^uzr\*/i,'').replace(/^sumup\s*\*/i,'').replace(/^zettle_\*/i,'').replace(/^pp\.\s*/i,'').replace(/^\d{4,}([\-\/][0-9A-Za-z]{2,})*\s*/,'').trim()}
function stripTrailingNoise(s){return s.replace(/\s+\d{2}\.\d{2}\.(?:\d{2}|\d{4}).*$/,'').replace(/\s+[A-Z]{2,}\d.*$/,'').replace(/\s+\d{3,}$/,'').replace(/\s*[•,]\s*$/,'').trim()}
function brandMap(s){const lower=s.toLowerCase();if(lower.includes('amzn')||lower.includes('amazon'))return 'AMAZON PAYMENTS EUROPE S.C.A.';if(lower.includes('paypal')||lower.includes('pp.'))return 'PayPal Europe S.a.r.l. et Cie S.C.A.';return null}
function chooseCounterparty(lines){const cand=[...lines].reverse().map(s=>s.replace(/\u00A0/g,' ').replace(/\u2212/g,'-').trim());for(let raw of cand){if(!raw)continue;const lr=raw.toLowerCase();if(CP_STOP_WORDS.some(sw=>lr.startsWith(sw)))continue;let s=stripPrefixes(raw);s=stripTrailingNoise(s);const brand=brandMap(s);if(brand)return brand;const star=s.split('*');if(star.length>1&&star[1].trim())s=star.slice(1).join('*').trim();const tokens=s.split(/\s+/);const good=tokens.filter(t=>!looksLikeIdToken(t));const candidate=(good.length?good.join(' '):s).trim();if(candidate&&/[A-Za-zÄÖÜäöüß]/.test(candidate))return candidate}return (lines[lines.length-1]||'').trim()}

// ---- PDF Import ----
let preview=[];
async function parseSelectedPDFs(){
  const input=document.getElementById('pdf-input'); if(!input.files||!input.files.length){alert('Bitte PDF-Datei(en) auswählen.');return}
  document.getElementById('import-log').textContent='Analysiere…'; preview=[];
  for(const f of input.files){
    try{
      const bankHint=document.getElementById('bank-hint').value||'';
      const arr=new Uint8Array(await f.arrayBuffer());
      const pdf=await pdfjsLib.getDocument({data:arr}).promise;
      for(let p=1;p<=pdf.numPages;p++){
        const page=await pdf.getPage(p); const txt=await page.getTextContent();
        const lines=groupIntoLines(txt.items); const bank=bankHint||detectBank(lines.join(' '));
        const items= bank==='barclays'?parseBarclays(lines): bank==='n26'?parseN26(lines): [];
        console.debug('Bank erkannt (Seite',p,'):',bank,'Items:',items.length); preview.push(...items);
      }
    }catch(e){console.warn('PDF parse error',e);document.getElementById('import-log').textContent='Fehler beim PDF-Import: '+(e.message||e)}
  }
  for(const it of preview) it.dedupe_key=await makeDedupeKey(it);
  const map=new Map(); preview.forEach(x=>map.set(x.dedupe_key,x)); preview=Array.from(map.values());
  renderPreview(); document.getElementById('import-log').textContent=`Vorschau: ${preview.length} erkannte Transaktionen`; document.getElementById('btn-commit-import').disabled=preview.length===0;
}
function groupIntoLines(items){const byY={};items.forEach(it=>{const y=Math.round(it.transform[5]);(byY[y]||(byY[y]=[])).push({x:it.transform[4],s:it.str})});const ys=Object.keys(byY).map(n=>Number(n)).sort((a,b)=>a-b);return ys.map(y=>byY[y].sort((a,b)=>a.x-b.x).map(t=>t.s).join(' ').replace(/\s+/g,' ').trim()).filter(Boolean)}
function detectBank(text){const t=(text||'').toLowerCase();if(t.includes('vorläufiger kontoauszug')||t.includes('space iban')||t.includes('spaces zusammenfassung'))return 'n26';if(t.includes('barclays')&&(t.includes('umsatzübersicht')||t.includes('belegdatum')||t.includes('valutadatum')))return 'barclays';const bar=['umsatzübersicht','belegdatum','valutadatum','betrag (eur)','barclays'];const n26=['n26','vorläufig','space','unterkonto','kontoumsätze','kontoauszug','spaces zusammenfassung'];const score=k=>k.reduce((s,x)=>s+(t.includes(x)?1:0),0);const sb=score(bar),sn=score(n26);if(sb===0&&sn===0)return '';return sn>=sb?'n26':'barclays'}

// Barclays parser
function parseBarclays(lines){
  const items=[]; let sectionHint='';
  for(const ln of lines){
    const l=ln.trim(); if(/^umsatzübersicht/i.test(l))continue; if(/zinssätze/i.test(l))break; if(/sonstige umsätze/i.test(l))sectionHint='gutschrift';
    const m=l.match(/^\s*(\d{2}\.\d{2}\.\d{4})\s+(\d{2}\.\d{2}\.\d{4})\s+(.+?)\s+([0-9]{1,3}(?:\.[0-9]{3})*,\d{2})([+\-–])?\s*$/i);
    if(m){const[,beleg,val,descRaw,amountRaw,trail]=m;const desc=descRaw.trim(); if(/gutschrift\s+manuelle\s+lastschrift/i.test(desc))continue; let amount=amountRaw+(trail||''); let cents; try{cents=parseAmountToCents(amount,{bank:'barclays',sectionHint})}catch{continue}
      items.push({source:'barclays_pdf',date:toISO(val),description:desc.replace(/\s+/g,' '),amount_cents:cents,currency:'EUR'})}
  } return items;
}

// N26 parser with combined-line support + counterparty detection
function parseN26(lines){
  const items=[]; let section='Hauptkonto'; let buf=[]; let pendingValueDate=null;
  const isHeader=s=>/^(beschreibung\s+verbuchungsdatum\s+betrag)$/i.test(s.replace(/\s+/g,' ').trim());
  const isSummary=s=>/(zusammenfassung|spaces zusammenfassung)/i.test(s);
  const isSpaceStart=s=>/^(vorläufiger\s+space\s+kontoauszug)/i.test(s);
  const reSpaceName=/^space:\s*(.+)$/i;
  const isLabel=s=>/^(lastschriften|gutschriften|belastungen|mastercard\s*•|iban:|bic:)/i.test(s);
  const isWorthless=s=>/^(erstellt am|vorläufiger kontoauszug|kontoauszug|datum geöffnet:|\d+\s*\/\s*\d+|iban:|bic:|dein alter kontostand|ausgehende transaktionen|eingehende transaktionen|dein neuer kontostand|anmerkung|dein guthaben|team)$/i.test(s);
  const reW=/^wertstellung\s+(\d{2}\.\d{2}\.\d{4})$/i;
  const reP=/^(\d{2}\.\d{2}\.\d{4})\s+([+\-−]?\d{1,3}(?:\.\d{3})*,\d{2})€?$/;
  const reC=/wertstellung\s+(\d{2}\.\d{2}\.\d{4})\s+(\d{2}\.\d{2}\.\d{4})\s+([+\-−]?\d{1,3}(?:\.\d{3})*,\d{2})€?/i;

  for(let raw of lines){
    let line=(raw||'').trim(); if(!line)continue;
    line=line.replace(/\u00A0/g,' ').replace(/\u2212/g,'-').replace(/\s+/g,' ').trim();
    const cmb=line.match(reC);
    if(cmb){const verbuch=cmb[2], amount=cmb[3]; const desc=chooseCounterparty(buf.length?buf:[section]); if(/barclays/i.test(desc)){buf=[];pendingValueDate=null;continue}
      try{items.push({source:'n26_pdf',date:toISO(verbuch),description:desc,amount_cents:parseAmountToCents(amount),currency:'EUR'})}catch{} buf=[]; pendingValueDate=null; continue}
    if(isSpaceStart(line))continue;
    const sn=line.match(reSpaceName); if(sn){section=sn[1].trim(); continue}
    if(isSummary(line)||isHeader(line)){buf=[];pendingValueDate=null;continue}
    if(isWorthless(line)||isLabel(line))continue;
    const wm=line.match(reW); if(wm){pendingValueDate=wm[1];continue}
    const pm=line.match(reP);
    if(pm&&pendingValueDate){const verbuch=pm[1], amount=pm[2]; const desc=chooseCounterparty(buf.length?buf:[section]); if(/barclays/i.test(desc)){buf=[];pendingValueDate=null;continue}
      try{items.push({source:'n26_pdf',date:toISO(verbuch),description:desc,amount_cents:parseAmountToCents(amount),currency:'EUR'})}catch{} buf=[]; pendingValueDate=null; continue}
    if(line&&!/^\d{2}\.\d{2}\.\d{4}$/.test(line)){buf.push(line); if(buf.length>6)buf.shift()}
  }
  return items;
}

function renderPreview(){const tb=document.querySelector('#preview-table tbody');tb.innerHTML='';preview.forEach(it=>{const tr=document.createElement('tr');tr.innerHTML=`<td>${srcLabel(it.source)}</td><td>${formatDE(it.date)}</td><td>${escapeHTML(it.description||'')}</td><td class="num">${fromCents(it.amount_cents)}</td><td>Neu</td>`;tb.appendChild(tr)})}
async function commitPreview(){if(!preview.length)return;const ex=await getAll('transactions');const keys=new Set(ex.map(t=>t.dedupe_key));const add=[];for(const it of preview){it.category||=UNDEF;if(!keys.has(it.dedupe_key))add.push(it)}await putMany('transactions',add);clearPreview();alert(`Import abgeschlossen: ${add.length} neue Transaktionen.`);await refreshTransactions();await refreshCharts()}
function clearPreview(){preview=[];document.querySelector('#preview-table tbody').innerHTML='';document.getElementById('btn-commit-import').disabled=true;document.getElementById('import-log').textContent=''}

function srcLabel(s){return s==='barclays_pdf'?'Barclays':s==='n26_pdf'?'N26':s==='excel'?'Excel':'Manuell'}
function formatDE(iso){const [y,m,d]=iso.split('-');return `${d}.${m}.${y}`}
function escapeHTML(s){return(s||'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]))}

// ---- Transactions/Charts/Exports (kept from previous build) ----
async function refreshTransactions(){
  const all=await getAll('transactions');
  const month=$('#flt-month')?.value; const from=$('#flt-from')?.value||null; const to=$('#flt-to')?.value||null;
  const src=$('#flt-source')?.value||''; const cat=$('#flt-cat')?.value||'';
  let list=all.slice(); if(month)list=list.filter(t=>yyyymm(t.date)===month); if(from||to)list=list.filter(t=>inRange(t.date,from,to)); if(src)list=list.filter(t=>t.source===src); if(cat)list=list.filter(t=>t.category===cat);
  list.sort((a,b)=>a.date.localeCompare(b.date)||a.description.localeCompare(b.description));
  const tbody=document.querySelector('#tx-table tbody'); if(!tbody)return; tbody.innerHTML=''; let total=0;
  list.forEach(t=>{total+=t.amount_cents;const tr=document.createElement('tr');tr.innerHTML=`<td>${formatDE(t.date)}</td><td>${escapeHTML(t.description||'')}</td><td>${t.category||UNDEF}</td><td>${srcLabel(t.source)}</td><td class="num">${fromCents(t.amount_cents)}</td><td></td>`;tbody.appendChild(tr)});
  const tot=$('#tx-total'); if(tot)tot.textContent=fromCents(total);
}

let trendChart,barChart,pieChart,lineChart;
async function refreshCharts(){
  const all=await getAll('transactions'); const month=$('#ana-month')?.value; const from=$('#ana-from')?.value||null; const to=$('#ana-to')?.value||null;
  let data=all.slice(); if(month)data=data.filter(t=>yyyymm(t.date)===month); if(from||to)data=data.filter(t=>inRange(t.date,from,to));
  const cats=await getCategories(); const months=Array.from(new Set(all.map(t=>yyyymm(t.date)))).sort();
  const agg=new Map(months.map(m=>[m,Object.fromEntries(cats.map(c=>[c,0]))])); all.forEach(t=>{const m=yyyymm(t.date); if(agg.has(m))agg.get(m)[t.category||UNDEF]+=t.amount_cents});
  const trendDatasets=cats.map(c=>({label:c,data:months.map(m=>(agg.get(m)[c]||0)/100)}));
  trendChart?.destroy(); trendChart=new Chart(document.getElementById('ch-trend'),{type:'bar',data:{labels:months,datasets:trendDatasets},options:{responsive:true,scales:{x:{stacked:true},y:{stacked:true,ticks:{callback:v=>CURRENCY.format(v)}}},plugins:{legend:{position:'bottom'}}}});
  const sumByCat={}; data.forEach(t=>{sumByCat[t.category||UNDEF]=(sumByCat[t.category||UNDEF]||0)+t.amount_cents}); const labels=Object.keys(sumByCat).sort((a,b)=>a.localeCompare(b,'de')); const vals=labels.map(k=>(sumByCat[k]||0)/100);
  barChart?.destroy(); barChart=new Chart(document.getElementById('ch-bar'),{type:'bar',data:{labels,datasets:[{label:'Summe',data:vals}]},options:{responsive:true,scales:{y:{ticks:{callback:v=>CURRENCY.format(v)}}},plugins:{legend:{position:'bottom'}}}});
  pieChart?.destroy(); pieChart=new Chart(document.getElementById('ch-pie'),{type:'pie',data:{labels,datasets:[{data:vals}]} ,options:{responsive:true,plugins:{legend:{position:'bottom'}}}});
  const selected=$('#cat-series')?.value||cats[0]; const byMonth=new Map(months.map(m=>[m,0])); all.forEach(t=>{if((t.category||UNDEF)===selected)byMonth.set(yyyymm(t.date),(byMonth.get(yyyymm(t.date))||0)+t.amount_cents)});
  const lm=Array.from(byMonth.keys()), lv=lm.map(m=>(byMonth.get(m)||0)/100);
  lineChart?.destroy(); lineChart=new Chart(document.getElementById('ch-line'),{type:'line',data:{labels:lm,datasets:[{label:selected,data:lv,tension:.25,pointRadius:4}]},options:{responsive:true,scales:{y:{ticks:{callback:v=>CURRENCY.format(v)}}},plugins:{legend:{position:'bottom'}}}});
}

// ---- Exports ----
async function exportMasterExcel(){
  const all=await getAll('transactions'); const months=Array.from(new Set(all.map(t=>yyyymm(t.date)))).sort(); const wb=XLSX.utils.book_new();
  const cats=await getCategories(); const sumByMonthCat={}; months.forEach(m=>sumByMonthCat[m]=Object.fromEntries(cats.map(c=>[c,0])));
  all.forEach(t=>{const m=yyyymm(t.date); if(sumByMonthCat[m])sumByMonthCat[m][t.category||UNDEF]+=t.amount_cents});
  const sumData=[['Monat',...cats]]; months.forEach(m=>sumData.push([m,...cats.map(c=>(sumByMonthCat[m][c]||0)/100)])); const wsSum=XLSX.utils.aoa_to_sheet(sumData); XLSX.utils.book_append_sheet(wb,wsSum,'Zusammenfassung');
  for(const m of months){const rows=[['Datum','Beschreibung','Betrag (€)','Kategorie','Quelle']]; all.filter(t=>yyyymm(t.date)===m).sort((a,b)=>a.date.localeCompare(b.date)).forEach(t=>rows.push([formatDE(t.date),t.description,(t.amount_cents/100).toFixed(2).replace('.',','),t.category||UNDEF,srcLabel(t.source)]));const ws=XLSX.utils.aoa_to_sheet(rows);ws['!cols']=[{wch:12},{wch:48},{wch:14},{wch:18},{wch:12}];XLSX.utils.book_append_sheet(wb,ws,m)}
  const out=XLSX.write(wb,{bookType:'xlsx',type:'array'}); const blob=new Blob([out],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}); const url=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download='Finanzen.xlsx'; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
}
async function exportRangeExcel(){const from=$('#ana-from')?.value||null; const to=$('#ana-to')?.value||null; const month=$('#ana-month')?.value||null; const all=await getAll('transactions'); let data=all.slice(); if(month)data=data.filter(t=>yyyymm(t.date)===month); if(from||to)data=data.filter(t=>inRange(t.date,from,to)); data.sort((a,b)=>a.date.localeCompare(b.date));
  const rows=[['Datum','Beschreibung','Betrag (€)','Kategorie','Quelle']]; data.forEach(t=>rows.push([formatDE(t.date),t.description,(t.amount_cents/100).toFixed(2).replace('.',','),t.category||UNDEF,srcLabel(t.source)])); const ws=XLSX.utils.aoa_to_sheet(rows); const wb=XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb,ws,'Zeitraum'); const out=XLSX.write(wb,{bookType:'xlsx',type:'array'}); const blob=new Blob([out],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}); const url=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download='Ausgaben_Zeitraum.xlsx'; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url)}
async function exportAnalysisPDF(){const {jsPDF}=window.jspdf; const doc=new jsPDF(); doc.setFontSize(14); doc.text('Analyse-Report',14,16); const add=(id,y)=>{const c=document.getElementById(id); const img=c.toDataURL('image/png',0.9); doc.addImage(img,'PNG',14,y,182,80)}; add('ch-trend',22); doc.addPage(); add('ch-bar',16); add('ch-pie',100); doc.addPage(); add('ch-line',16); doc.save('Analyse.pdf')}
