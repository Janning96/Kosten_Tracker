// --- Config ---
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';

// --- DB (IndexedDB) ---
const DB_NAME = 'kosten-tracker-db';
const DB_VERSION = 5;
let db;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('transactions')) {
        const store = db.createObjectStore('transactions', { keyPath: 'id', autoIncrement: true });
        store.createIndex('date', 'date');
        store.createIndex('dedupe', 'dedupe_key', { unique: true });
      } else {
        const store = req.transaction.objectStore('transactions');
        if (!store.indexNames.contains('date')) store.createIndex('date','date');
        if (!store.indexNames.contains('dedupe')) store.createIndex('dedupe','dedupe_key',{unique:true});
      }
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
    };
    req.onsuccess = () => { db = req.result; resolve(db); };
    req.onerror = () => reject(req.error);
  });
}
function tx(store, mode='readonly') { return db.transaction(store, mode).objectStore(store); }
function getAll(store) { return new Promise((res, rej) => { const r = tx(store).getAll(); r.onsuccess=()=>res(r.result); r.onerror=()=>rej(r.error); }); }
function put(store, value, key) { return new Promise((res, rej)=>{ const r = tx(store,'readwrite').put(value, key); r.onsuccess=()=>res(r.result); r.onerror=()=>rej(r.error); }); }
function del(store, key) { return new Promise((res, rej)=>{ const r = tx(store,'readwrite').delete(key); r.onsuccess=()=>res(); r.onerror=()=>rej(r.error); }); }
async function putMany(store, list){ for(const v of list) { try{ await put(store,v);}catch(e){/* duplicate dedupe_key ignored */} } }

// --- Helpers ---
const CURRENCY = new Intl.NumberFormat('de-DE', { style:'currency', currency:'EUR' });
function fromCents(c){ return CURRENCY.format((c||0)/100); }
function toISO(dmy){ const [d,m,y] = dmy.split('.'); return `${y}-${m}-${d}`; }
function parseAmountToCents(raw, opts={ bank:null, sectionHint:'' }){
  let s = String(raw).replace(/\s|€|\u00A0/g,'').replace(/\./g,'').replace(',', '.'); // "1.078,22+" -> "1078.22+"
  let sign = 0;
  if (/[\+\-–]$/.test(s)) { // trailing sign (Barclays)
    const last = s.slice(-1);
    if (last === '+' ) sign = +1;
    if (last === '-' || last === '–') sign = -1;
    s = s.slice(0,-1);
  }
  if (/^[\+\-]/.test(s)) { // leading sign (N26)
    sign = s[0] === '-' ? -1 : +1;
    s = s.slice(1);
  }
  let value = Math.round(parseFloat(s) * 100);
  if (isNaN(value)) throw new Error('Betrag unlesbar: ' + raw);
  if (sign === 0) {
    if (opts.bank === 'barclays') {
      if (/gutschrift|erstattung|credit/i.test(opts.sectionHint)) sign = +1;
      else sign = -1;
    } else {
      sign = -1;
    }
  }
  return value * sign;
}

function normDesc(s){ return s.toLowerCase().normalize('NFKD').replace(/\p{Diacritic}/gu,'').replace(/\s+/g,' ').trim(); }
async function sha256(text){
  if (crypto?.subtle) {
    const enc = new TextEncoder().encode(text);
    const buf = await crypto.subtle.digest('SHA-256', enc);
    return Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,'0')).join('');
  }
  let hash = 5381, i = text.length;
  while(i) hash = (hash * 33) ^ text.charCodeAt(--i);
  return (hash >>> 0).toString(16);
}
async function makeDedupeKey(obj){
  const key = `${obj.source}|${obj.date}|${obj.amount_cents}|${normDesc(obj.description||'')}`;
  return await sha256(key);
}
function yyyymm(dateISO){ return dateISO.slice(0,7); }
function inRange(d, from, to){ if (from && d < from) return false; if (to && d > to) return false; return true; }

const UNDEF = 'Undefiniert';
const DEFAULT_CATS = ['Café','Gesundheit','Klamotten','Lebensmittel','Restaurant','Shoppen','Transport','Unterhaltung','Urlaub', UNDEF];

async function getCategories(){
  const r = await new Promise(res=>{ const rq = tx('meta').get('categories'); rq.onsuccess=()=>res(rq.result); rq.onerror=()=>res(null); });
  let cats = Array.isArray(r) && r.length ? r : DEFAULT_CATS.slice();
  cats = cats.filter(c=>c!==UNDEF).sort((a,b)=>a.localeCompare(b,'de')).concat([UNDEF]);
  await put('meta', cats, 'categories');
  return cats;
}

// --- UI helpers ---
const $ = sel => document.querySelector(sel);
const $$ = sel => Array.from(document.querySelectorAll(sel));

function switchTab(id){
  $$('.tab').forEach(b=>b.classList.toggle('active', b.dataset.tab===id));
  $$('.tabpane').forEach(p=>p.classList.toggle('active', p.id===`tab-${id}`));
}

// --- App init ---
document.addEventListener('DOMContentLoaded', async () => {
  await openDB();
  await put('meta', await getCategories(), 'categories');

  // Tabs
  $$('.tab').forEach(b => b.addEventListener('click', () => switchTab(b.dataset.tab)));

  // Categories
  await renderCategorySelects();
  $('#btn-manage-cats').addEventListener('click', openCats);
  $('#btn-cat-add').addEventListener('click', addCategory);

  // Manual entry modal
  $('#btn-open-amount').addEventListener('click', openAmountModal);
  $('#amount-form').addEventListener('submit', onAmountSubmit);

  // Filters
  $('#flt-month').value = new Date().toISOString().slice(0,7);
  $('#ana-month').value = new Date().toISOString().slice(0,7);
  $('#btn-apply-filter').addEventListener('click', refreshTransactions);
  $('#btn-clear-filter').addEventListener('click', () => { $('#flt-month').value=''; $('#flt-from').value=''; $('#flt-to').value=''; $('#flt-source').value=''; $('#flt-cat').value=''; refreshTransactions(); });
  $('#btn-ana-apply').addEventListener('click', refreshCharts);
  $('#btn-ana-clear').addEventListener('click', () => { $('#ana-month').value=''; $('#ana-from').value=''; $('#ana-to').value=''; refreshCharts(); });

  // Import PDF
  $('#btn-parse-pdf').addEventListener('click', parseSelectedPDFs);
  $('#btn-commit-import').addEventListener('click', commitPreview);
  $('#btn-clear-preview').addEventListener('click', clearPreview);
  document.getElementById('pdf-input').addEventListener('change', () => {
    const n = document.getElementById('pdf-input').files?.length || 0;
    document.getElementById('import-log').textContent = n ? `${n} PDF ausgewählt` : '';
  });

  // Excel import
  $('#btn-import-xlsx').addEventListener('click', importExcelRange);

  // Exports
  $('#btn-export-master-xlsx').addEventListener('click', exportMasterExcel);
  $('#btn-export-ana-pdf').addEventListener('click', exportAnalysisPDF);
  $('#btn-export-range-xlsx').addEventListener('click', exportRangeExcel);

  // Keyboard visibility (iOS)
  setupKeyboardFix();

  await refreshTransactions();
  await refreshCharts();
});

async function renderCategorySelects(){
  const cats = await getCategories();
  const selects = [$('#entry-cat'), $('#flt-cat'), $('#ed-cat'), $('#cat-series')].filter(Boolean);
  selects.forEach(sel => {
    sel.innerHTML = '';
    if (sel === $('#flt-cat')) {
      const optAll = document.createElement('option'); optAll.value=''; optAll.textContent='Alle Kategorien'; sel.appendChild(optAll);
    }
    cats.forEach(c => {
      const o = document.createElement('option'); o.value=c; o.textContent=c; sel.appendChild(o);
    });
  });
}

// --- Category mgmt ---
async function openCats(){
  const ul = $('#cats-list'); ul.innerHTML = '';
  const cats = await getCategories();
  cats.forEach((c,i) => {
    const li = document.createElement('li');
    const disabled = c===UNDEF ? 'disabled' : '';
    li.innerHTML = `<div class="flex-between">
      <span>${c}</span>
      <span class="inline">
        <button class="ghost" data-ren="${i}" ${disabled}>Umbenennen</button>
        <button class="danger" data-del="${i}" ${disabled}>Löschen</button>
      </span>
    </div>`;
    ul.appendChild(li);
  });
  ul.onclick = async (e) => {
    const btn = e.target.closest('button'); if (!btn) return;
    const idx = Number(btn.dataset.ren ?? btn.dataset.del);
    let cats = await getCategories();
    if (btn.dataset.ren) {
      const neu = prompt('Neuer Name:', cats[idx]); if (!neu) return;
      cats[idx] = (neu||'').trim(); if (!cats[idx]) return;
      cats = cats.filter(x=>x!==UNDEF).sort((a,b)=>a.localeCompare(b,'de')).concat([UNDEF]);
      await put('meta', cats, 'categories'); await renderCategorySelects();
    } else if (btn.dataset.del) {
      const delName = cats[idx]; if (delName===UNDEF) return;
      if (!confirm(`Kategorie "${delName}" löschen? Einträge werden auf "${UNDEF}" gesetzt.`)) return;
      const all = await getAll('transactions');
      const upd = all.filter(t=>t.category===delName).map(t=>({...t, category:UNDEF}));
      await putMany('transactions', upd);
      cats = cats.filter(x=>x!==delName);
      await put('meta', cats, 'categories'); await renderCategorySelects(); await refreshTransactions(); await refreshCharts();
    }
  };
}

async function addCategory(){
  const input = $('#cat-new'); const name = (input.value||'').trim(); if (!name) return;
  let cats = await getCategories();
  if (!cats.includes(name)) cats = cats.filter(c=>c!==UNDEF).concat([name]).sort((a,b)=>a.localeCompare(b,'de')).concat([UNDEF]);
  await put('meta', cats, 'categories'); input.value=''; await renderCategorySelects();
}

// --- Manual entry modal ---
function openAmountModal(){
  document.getElementById('entry-date').value ||= new Date().toISOString().slice(0,10);
  document.getElementById('amount-input').value = '';
  document.getElementById('amount-dialog').showModal();
  setTimeout(()=> document.getElementById('amount-input').focus(), 0);
}
async function onAmountSubmit(ev){
  ev.preventDefault();
  if ((ev.submitter?.id||'') !== 'btn-amount-ok') { document.getElementById('amount-dialog').close(); return; }
  try{
    const date = document.getElementById('entry-date').value || new Date().toISOString().slice(0,10);
    const category = document.getElementById('entry-cat').value || UNDEF;
    const amount_cents = parseAmountToCents(document.getElementById('amount-input').value);
    const t = { source:'manual', date, description:'Manueller Eintrag', amount_cents, currency:'EUR', category };
    t.dedupe_key = await makeDedupeKey(t);
    await put('transactions', t);
    document.getElementById('amount-dialog').close();
    await refreshTransactions(); await refreshCharts();
  }catch(e){ alert(e.message||'Ungültiger Betrag'); }
}

// --- Transactions list ---
async function refreshTransactions(){
  const all = await getAll('transactions');
  const month = document.getElementById('flt-month').value;
  const from = document.getElementById('flt-from').value || null;
  const to = document.getElementById('flt-to').value || null;
  const src = document.getElementById('flt-source').value || '';
  const cat = document.getElementById('flt-cat').value || '';

  let list = all.slice();
  if (month) list = list.filter(t => yyyymm(t.date) === month);
  if (from || to) list = list.filter(t => inRange(t.date, from, to));
  if (src) list = list.filter(t => t.source === src);
  if (cat) list = list.filter(t => t.category === cat);

  list.sort((a,b)=> a.date.localeCompare(b.date) || a.description.localeCompare(b.description));
  const tbody = document.querySelector('#tx-table tbody'); tbody.innerHTML='';
  let total = 0;
  list.forEach(t => {
    total += t.amount_cents;
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${formatDE(t.date)}</td>
      <td>${escapeHTML(t.description||'')}</td>
      <td>${t.category||UNDEF}</td>
      <td>${srcLabel(t.source)}</td>
      <td class="num">${fromCents(t.amount_cents)}</td>
      <td class="inline">
        <button class="ghost" data-edit="${t.id}">Bearbeiten</button>
        <button class="danger" data-del="${t.id}">Löschen</button>
      </td>`;
    tbody.appendChild(tr);
  });
  document.getElementById('tx-total').textContent = fromCents(total);
  document.getElementById('list-summary').textContent = list.length ? `${list.length} Transaktionen` : 'Keine Transaktionen im Filter';

  tbody.onclick = async (e) => {
    const btn = e.target.closest('button'); if (!btn) return;
    const id = Number(btn.dataset.edit || btn.dataset.del);
    if (btn.dataset.del){
      if (!confirm('Transaktion löschen?')) return;
      await del('transactions', id);
      await refreshTransactions(); await refreshCharts();
    } else if (btn.dataset.edit) {
      const store = tx('transactions'); const rq = store.get(id);
      rq.onsuccess = async () => {
        const t = rq.result; if (!t) return;
        document.getElementById('ed-date').value = t.date;
        await renderCategorySelects();
        document.getElementById('ed-cat').value = t.category || UNDEF;
        document.getElementById('ed-amount').value = (t.amount_cents/100).toFixed(2).replace('.',',');
        document.getElementById('edit-dialog').showModal();
        document.getElementById('edit-form').onsubmit = async (ev2) => {
          ev2.preventDefault();
          if ((ev2.submitter?.id||'') !== 'btn-save-edit') { document.getElementById('edit-dialog').close(); return; }
          try{
            const date = document.getElementById('ed-date').value;
            const category = document.getElementById('ed-cat').value;
            const amount_cents = parseAmountToCents(document.getElementById('ed-amount').value);
            const updated = { ...t, date, category, amount_cents };
            updated.dedupe_key = await makeDedupeKey(updated);
            await put('transactions', updated);
            document.getElementById('edit-dialog').close();
            await refreshTransactions(); await refreshCharts();
          }catch(e){ alert(e.message||'Fehler beim Speichern'); }
        };
      };
    }
  };
}

function srcLabel(s){ return s==='barclays_pdf'?'Barclays': s==='n26_pdf'?'N26': s==='excel'?'Excel':'Manuell'; }
function formatDE(iso){ const [y,m,d]=iso.split('-'); return `${d}.${m}.${y}`; }
function escapeHTML(s){ return (s||'').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }

// --- Charts ---
let trendChart, barChart, pieChart, lineChart;

async function refreshCharts(){
  const all = await getAll('transactions');
  const month = document.getElementById('ana-month').value;
  const from = document.getElementById('ana-from').value || null;
  const to = document.getElementById('ana-to').value || null;
  let data = all.slice();
  if (month) data = data.filter(t => yyyymm(t.date) === month);
  if (from || to) data = data.filter(t => inRange(t.date, from, to));

  const cats = await getCategories();
  const months = Array.from(new Set(all.map(t=>yyyymm(t.date)))).sort();
  const agg = new Map(months.map(m => [m, Object.fromEntries(cats.map(c=>[c,0]))]));
  all.forEach(t => { const m = yyyymm(t.date); if (agg.has(m)) agg.get(m)[t.category||UNDEF] += t.amount_cents; });
  const trendDatasets = cats.map(c => ({ label:c, data: months.map(m => (agg.get(m)[c]||0)/100) }));
  trendChart?.destroy();
  trendChart = new Chart(document.getElementById('ch-trend'), { type:'bar', data:{ labels: months, datasets: trendDatasets },
    options:{ responsive:true, scales:{ x:{stacked:true}, y:{stacked:true, ticks:{callback:v=>CURRENCY.format(v)}} }, plugins:{legend:{position:'bottom'}} } });

  const sumByCat = {};
  data.forEach(t => { sumByCat[t.category||UNDEF] = (sumByCat[t.category||UNDEF]||0) + t.amount_cents; });
  const labels = Object.keys(sumByCat).sort((a,b)=>a.localeCompare(b,'de'));
  const vals = labels.map(k => (sumByCat[k]||0)/100);
  barChart?.destroy();
  barChart = new Chart(document.getElementById('ch-bar'), { type:'bar', data:{ labels, datasets:[{ label:'Summe', data: vals }] },
    options:{ responsive:true, scales:{ y:{ ticks:{callback:v=>CURRENCY.format(v)} } }, plugins:{legend:{position:'bottom'}} } });
  pieChart?.destroy();
  pieChart = new Chart(document.getElementById('ch-pie'), { type:'pie', data:{ labels, datasets:[{ data: vals }] }, options:{ responsive:true, plugins:{legend:{position:'bottom'}} } });

  const selected = document.getElementById('cat-series').value || cats[0];
  const byMonth = new Map(months.map(m=>[m,0]));
  all.forEach(t => { if ((t.category||UNDEF)===selected) byMonth.set(yyyymm(t.date), (byMonth.get(yyyymm(t.date))||0) + t.amount_cents); });
  const lm = Array.from(byMonth.keys()); const lv = lm.map(m => (byMonth.get(m)||0)/100);
  lineChart?.destroy();
  lineChart = new Chart(document.getElementById('ch-line'), { type:'line', data:{ labels: lm, datasets:[{ label:selected, data: lv, tension:.25, pointRadius:4 }] },
    options:{ responsive:true, scales:{ y:{ ticks:{callback:v=>CURRENCY.format(v)} } }, plugins:{legend:{position:'bottom'}} } });
}

// --- PDF Import ---
let preview = []; // temp items before commit

async function parseSelectedPDFs(){
  const input = document.getElementById('pdf-input');
  if (!input.files || !input.files.length) { alert('Bitte PDF-Datei(en) auswählen.'); return; }
  document.getElementById('import-log').textContent = 'Analysiere…';
  preview = [];
  for(const f of input.files){
    try{
      const bankHint = document.getElementById('bank-hint').value || '';
      const arr = new Uint8Array(await f.arrayBuffer());
      const pdf = await pdfjsLib.getDocument({data: arr}).promise;
      for(let p=1;p<=pdf.numPages;p++){
        const page = await pdf.getPage(p);
        const txt = await page.getTextContent();
        const lines = groupIntoLines(txt.items);
        const bank = bankHint || detectBank(lines.join(' '));
        const items = bank==='barclays' ? parseBarclays(lines) : bank==='n26' ? parseN26(lines) : [];
        preview.push(...items);
      }
    }catch(e){
      console.warn('PDF parse error', e); document.getElementById('import-log').textContent = 'Fehler beim PDF-Import: ' + (e.message||e);
    }
  }
  for (const it of preview) it.dedupe_key = await makeDedupeKey(it);
  const map = new Map(); preview.forEach(x=>map.set(x.dedupe_key, x));
  preview = Array.from(map.values());
  renderPreview();
  document.getElementById('import-log').textContent = `Vorschau: ${preview.length} erkannte Transaktionen`;
  document.getElementById('btn-commit-import').disabled = preview.length===0;
}

function groupIntoLines(items){
  const byY = {};
  items.forEach(it => {
    const y = Math.round(it.transform[5]);
    byY[y] = (byY[y] || []) .concat([{x: it.transform[4], s: it.str}]);
  });
  const ys = Object.keys(byY).map(n=>Number(n)).sort((a,b)=>a-b);
  const lines = ys.map(y => byY[y].sort((a,b)=>a.x-b.x).map(t=>t.s).join(' ').replace(/\\s+/g,' ').trim()).filter(s=>s);
  return lines;
}

function detectBank(text){
  const t = text.toLowerCase();
  if (t.includes('barclays') && (t.includes('umsatzübersicht') || t.includes('betrag (eur)') || t.includes('belegdatum'))) return 'barclays';
  if (t.includes('vorläufiger kontoauszug') || t.includes(' n26')) return 'n26';
  return '';
}

// Barclays parser
function parseBarclays(lines){
  const items = [];
  let sectionHint = '';
  for(const ln of lines){
    const l = ln.trim();
    if (/^umsatzübersicht/i.test(l)) { continue; }
    if (/zinssätze/i.test(l)) { break; }
    if (/sonstige umsätze/i.test(l)) { sectionHint = 'gutschrift'; }
    // Format: "DD.MM.YYYY  DD.MM.YYYY  BESCHREIBUNG   1.234,56–" (oder +)
    const m = l.match(/^\\s*(\\d{2}\\.\\d{2}\\.\\d{4})\\s+(\\d{2}\\.\\d{2}\\.\\d{4})\\s+(.+?)\\s+([0-9]{1,3}(?:\\.[0-9]{3})*,\\d{2})([+\\-–])?\\s*$/i);
    if (m){
      const [, beleg, val, descRaw, amountRaw, trailing] = m;
      const descNorm = (descRaw||'').toString().trim();
      // IGNORE: "Gutschrift Manuelle Lastschrift"
      if (/gutschrift\\s+manuelle\\s+lastschrift/i.test(descNorm)) { continue; }
      const amountStr = amountRaw + (trailing || '');
      let amount_cents;
      try { amount_cents = parseAmountToCents(amountStr, { bank:'barclays', sectionHint }); } catch(e){ continue; }
      items.push({
        source:'barclays_pdf',
        date: toISO(val),
        description: descNorm.replace(/\\s+/g,' '),
        amount_cents,
        currency:'EUR'
      });
    }
  }
  return items;
}

// N26 parser (enhanced for sections/spaces + ignore 'Barclays' descriptions)
function parseN26(lines){
  const items = [];
  let bufferDesc = [];
  let currentSection = 'Hauptkonto';
  const sectionRe = /^(space|unterkonto)\\s*[:\\-]\\s*(.+)$/i;

  for (const ln of lines){
    const l = ln.trim();
    if (!l) continue;

    // Abschnitts-/Space-Erkennung
    const sec = l.match(sectionRe);
    if (sec){
      currentSection = sec[2].trim();
      continue;
    }

    if (/^vorläufiger kontoauszug/i.test(l)) { continue; }

    // Transaktionszeile: "... DD.MM.YYYY +/-1.234,56 €"
    const m = l.match(/^(.*)\\s+(\\d{2}\\.\\d{2}\\.\\d{4})\\s+([+\\-]?\\d{1,3}(?:\\.\\d{3})*,\\d{2})\\s*€?\\s*$/);
    if (m){
      const [, descLead, dateStr, amtStr] = m;
      const desc = (bufferDesc.concat([descLead])).join('; ').replace(/\\s+/g,' ').trim();
      bufferDesc = [];

      // IGNORE: jede N26-Transaktion deren Beschreibung "Barclays" enthält
      if (/barclays/i.test(desc)) continue;

      try{
        items.push({
          source:'n26_pdf',
          date: toISO(dateStr),
          description: desc || currentSection,
          amount_cents: parseAmountToCents(amtStr),
          currency:'EUR'
        });
      }catch(e){/* skip */}
    } else {
      // Mehrzeilige Beschreibung, aber gängige Labels auslassen
      if (!/^(beschreibung|verbuchungsdatum|betrag|datum|konto|space|unterkonto)\\b/i.test(l)) {
        bufferDesc.push(l);
      }
    }
  }
  return items;
}

function renderPreview(){
  const tb = document.querySelector('#preview-table tbody'); tb.innerHTML='';
  preview.forEach(it => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${srcLabel(it.source)}</td>
      <td>${formatDE(it.date)}</td>
      <td>${escapeHTML(it.description||'')}</td>
      <td class="num">${fromCents(it.amount_cents)}</td>
      <td>Neu</td>`;
    tb.appendChild(tr);
  });
}

async function commitPreview(){
  if (!preview.length) return;
  const existing = await getAll('transactions');
  const existingKeys = new Set(existing.map(t=>t.dedupe_key));
  const newOnes = [];
  for (const it of preview){
    it.category ||= UNDEF;
    if (!existingKeys.has(it.dedupe_key)) newOnes.push(it);
  }
  await putMany('transactions', newOnes);
  clearPreview();
  alert(`Import abgeschlossen: ${newOnes.length} neue Transaktionen.`);
  await refreshTransactions(); await refreshCharts();
}
function clearPreview(){
  preview = [];
  document.querySelector('#preview-table tbody').innerHTML = '';
  document.getElementById('btn-commit-import').disabled = true;
  document.getElementById('import-log').textContent = '';
}

// --- Excel Import (range) ---
async function importExcelRange(){
  const input = document.getElementById('xlsx-input'); if (!input.files.length) { alert('Bitte Excel-Datei wählen.'); return; }
  const from = document.getElementById('imp-from').value || null; const to = document.getElementById('imp-to').value || null;
  const file = input.files[0];
  const data = await file.arrayBuffer();
  const wb = XLSX.read(data, { type:'array' });
  let rows = [];
  wb.SheetNames.forEach(name => {
    const sheet = wb.Sheets[name];
    const aoa = XLSX.utils.sheet_to_json(sheet, {header:1, raw:false});
    const header = (aoa[0]||[]).map(h => String(h||'').trim().toLowerCase());
    const idxDate = header.findIndex(h => h.includes('datum'));
    const idxDesc = header.findIndex(h => h.includes('beschreibung'));
    const idxAmt  = header.findIndex(h => h.includes('betrag'));
    const idxCat  = header.findIndex(h => h.includes('kategorie'));
    for (let i=1;i<aoa.length;i++){
      const r = aoa[i]; if (!r || !r.length) continue;
      const d = (r[idxDate]||'').trim(); const desc = (r[idxDesc]||'').trim(); const amt = (r[idxAmt]||'').toString().trim();
      if (!d || !desc || !amt) continue;
      const iso = normalizeDateExcel(d); if (!iso) continue;
      if (!inRange(iso, from, to)) continue;
      let cent;
      try { cent = parseAmountToCents(amt); } catch{ continue; }
      rows.push({ source:'excel', date: iso, description: desc, amount_cents: cent, currency:'EUR', category: r[idxCat]||UNDEF });
    }
  });
  for (const it of rows) it.dedupe_key = await makeDedupeKey(it);
  const existing = await getAll('transactions'); const ek = new Set(existing.map(t=>t.dedupe_key));
  const newOnes = rows.filter(r => !ek.has(r.dedupe_key));
  await putMany('transactions', newOnes);
  alert(`Excel-Import: ${newOnes.length} neue Transaktionen übernommen.`);
  await refreshTransactions(); await refreshCharts();
}
function normalizeDateExcel(v){
  if (/^\\d{2}\\.\\d{2}\\.\\d{4}$/.test(v)) return toISO(v);
  if (/^\\d{4}-\\d{2}-\\d{2}$/.test(v)) return v;
  const n = Number(v);
  if (!isNaN(n) && n>20000 && n<60000){
    const base = new Date(Date.UTC(1899,11,30));
    const dt = new Date(base.getTime() + n * 86400000);
    return dt.toISOString().slice(0,10);
  }
  return null;
}

// --- Exports ---
async function exportMasterExcel(){
  const all = await getAll('transactions');
  const months = Array.from(new Set(all.map(t=>yyyymm(t.date)))).sort();
  const wb = XLSX.utils.book_new();

  const cats = await getCategories();
  const sumByMonthCat = {};
  months.forEach(m => { sumByMonthCat[m] = Object.fromEntries(cats.map(c=>[c,0])); });
  all.forEach(t => { const m = yyyymm(t.date); if (sumByMonthCat[m]) sumByMonthCat[m][t.category||UNDEF] += t.amount_cents; });
  const sumSheetData = [['Monat', ...cats]];
  months.forEach(m => sumSheetData.push([m, ...cats.map(c => (sumByMonthCat[m][c]||0)/100)]));
  const wsSum = XLSX.utils.aoa_to_sheet(sumSheetData);
  XLSX.utils.book_append_sheet(wb, wsSum, 'Zusammenfassung');

  for (const m of months){
    const rows = [['Datum','Beschreibung','Betrag (€)','Kategorie','Quelle']];
    all.filter(t => yyyymm(t.date)===m).sort((a,b)=>a.date.localeCompare(b.date))
      .forEach(t => rows.push([formatDE(t.date), t.description, (t.amount_cents/100).toFixed(2).replace('.',','), t.category||UNDEF, srcLabel(t.source)]));
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws['!cols'] = [{wch:12},{wch:48},{wch:14},{wch:18},{wch:12}];
    XLSX.utils.book_append_sheet(wb, ws, m);
  }
  const wbout = XLSX.write(wb, { bookType:'xlsx', type:'array' });
  const blob = new Blob([wbout], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href=url; a.download='Finanzen.xlsx'; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
}

async function exportRangeExcel(){
  const from = document.getElementById('ana-from').value || null; const to = document.getElementById('ana-to').value || null; const month = document.getElementById('ana-month').value || null;
  const all = await getAll('transactions');
  let data = all.slice();
  if (month) data = data.filter(t => yyyymm(t.date) === month);
  if (from || to) data = data.filter(t => inRange(t.date, from, to));
  data.sort((a,b)=>a.date.localeCompare(b.date));

  const rows = [['Datum','Beschreibung','Betrag (€)','Kategorie','Quelle']];
  data.forEach(t => rows.push([formatDE(t.date), t.description, (t.amount_cents/100).toFixed(2).replace('.',','), t.category||UNDEF, srcLabel(t.source)]));
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Zeitraum');
  const wbout = XLSX.write(wb, { bookType:'xlsx', type:'array' });
  const blob = new Blob([wbout], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href=url; a.download='Ausgaben_Zeitraum.xlsx'; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
}

async function exportAnalysisPDF(){
  const { jsPDF } = window.jspdf; const doc = new jsPDF();
  doc.setFontSize(14); doc.text('Analyse-Report', 14, 16);
  const addCanvas = (id, y) => {
    const c = document.getElementById(id);
    const img = c.toDataURL('image/png', 0.9);
    doc.addImage(img, 'PNG', 14, y, 182, 80);
  };
  addCanvas('ch-trend', 22);
  doc.addPage();
  addCanvas('ch-bar', 16);
  addCanvas('ch-pie', 100);
  doc.addPage();
  addCanvas('ch-line', 16);
  doc.save('Analyse.pdf');
}

// --- iOS keyboard fix ---
function setupKeyboardFix(){
  const spacer = document.getElementById('keyboard-spacer');
  const focusables = ['entry-date','entry-cat','amount-input','ed-date','ed-amount','ed-cat'].map(id=>document.getElementById(id)).filter(Boolean);
  function ensureVisible(el){ setTimeout(()=> el?.scrollIntoView({block:'center', behavior:'smooth'}), 50); }
  focusables.forEach(el => {
    el.addEventListener('focus', () => { document.body.classList.add('kbd-open'); ensureVisible(el); });
    el.addEventListener('blur', () => setTimeout(()=>document.body.classList.remove('kbd-open'),250));
  });
  if (window.visualViewport) {
    const onVV = () => {
      const vv = window.visualViewport;
      const overlap = Math.max(0, (window.innerHeight - (vv.height + vv.offsetTop)));
      spacer.style.height = overlap > 0 ? (overlap + 80) + 'px' : '0px';
    };
    visualViewport.addEventListener('resize', onVV);
    visualViewport.addEventListener('scroll', onVV);
    onVV();
  }
}
