const DB_NAME = 'expense-tracker-db';
const DB_VERSION = 3;
let db;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('entries')) {
        const store = db.createObjectStore('entries', { keyPath: 'id', autoIncrement: true });
        store.createIndex('date', 'date');
      } else {
        const store = req.transaction.objectStore('entries');
        if (!store.indexNames.contains('date')) store.createIndex('date', 'date');
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
async function setMany(store, values) { for (const v of values) await put(store, v); }

const CURRENCY = new Intl.NumberFormat('de-DE', { style:'currency', currency:'EUR' });
function toCents(input) {
  if (typeof input !== 'string') input = String(input ?? '');
  const cleaned = input.replace(/\s|€|\u00A0/g,'').replace(/\./g,'').replace(',', '.');
  const value = Number(cleaned);
  if (isNaN(value)) throw new Error('Ungültiger Betrag');
  return Math.round(value * 100);
}
function fromCents(cents) { return CURRENCY.format((cents||0)/100); }
function yyyymm(date) { return date.slice(0,7); }
function inRange(dateISO, fromISO, toISO) {
  if (fromISO && dateISO < fromISO) return false;
  if (toISO && dateISO > toISO) return false;
  return true;
}
function formatDate(iso){ const [y,m,d]=iso.split('-'); return `${d}.${m}.${y}`; }

const UNDEF = 'Undefiniert';
const DEFAULT_CATS = ['Café','Gesundheit','Klamotten','Lebensmittel','Restaurant','Shoppen','Transport','Unterhaltung','Urlaub', UNDEF];
async function getCategories() {
  let cats = await new Promise((res)=>{ const rq = tx('meta').get('categories'); rq.onsuccess=()=>res(rq.result); rq.onerror=()=>res(undefined); });
  if (!Array.isArray(cats) || cats.length===0) { cats = [...DEFAULT_CATS]; await put('meta', cats, 'categories'); }
  cats = cats.filter(c=>c!==UNDEF).sort((a,b)=>a.localeCompare(b,'de')).concat([UNDEF]);
  await put('meta', cats, 'categories');
  return cats;
}

const $ = (id)=>document.getElementById(id);
let editId = null;

async function getSavedFileHandle() { return new Promise(res=>{ const r = tx('meta').get('fileHandle'); r.onsuccess=()=>res(r.result); r.onerror=()=>res(null); }); }
async function setSavedFileHandle(handle){ await put('meta', handle, 'fileHandle'); }

document.addEventListener('DOMContentLoaded', async () => {
  await openDB();
  await put('meta', (await getCategories()), 'categories');
  await renderCategories();
  $('date').valueAsDate = new Date();
  $('month').value = new Date().toISOString().slice(0,7);

  $('entry-form').addEventListener('submit', onAdd);
  $('btn-manage-cats').addEventListener('click', openCatsDialog);
  $('btn-cat-add').addEventListener('click', addCategory);
  $('cats-dialog').addEventListener('close', () => renderCategories());

  $('btn-this-month').addEventListener('click', () => { $('month').value = new Date().toISOString().slice(0,7); clearRange(); refresh(); });
  $('month').addEventListener('input', () => { clearRange(); refresh(); });
  $('btn-apply-range').addEventListener('click', () => { $('month').value=''; refresh(); });
  $('btn-clear-range').addEventListener('click', () => { clearRange(); refresh(); });

  $('file-load-other').addEventListener('change', onLoadOther);
  $('btn-save').addEventListener('click', onSave);
  $('btn-load').addEventListener('click', onLoadKnown);

  $('btn-export-json').addEventListener('click', exportJSON);
  $('btn-export-pdf').addEventListener('click', exportPDF);
  $('btn-export-xlsx').addEventListener('click', exportXLSX);
  $('btn-wipe').addEventListener('click', onWipe);

  await refresh();
  tryAutoLoadOnStart();
});

function clearRange(){ $('from').value=''; $('to').value=''; }

async function renderCategories(cats) {
  if (!cats) cats = await getCategories();
  ['category','edit-category','cat-series'].forEach(id => {
    const sel = $(id);
    if (!sel) return;
    sel.innerHTML = '';
    cats.forEach(c => { const o = document.createElement('option'); o.value=c; o.textContent=c; sel.appendChild(o); });
  });
}

async function openCatsDialog() {
  const dialog = $('cats-dialog');
  const ul = $('cats-list');
  const cats = await getCategories();
  ul.innerHTML = '';
  cats.forEach((c, idx) => {
    const li = document.createElement('li');
    const disabled = c===UNDEF ? 'disabled' : '';
    li.innerHTML = `<span>${c}</span>
      <span class="inline">
        <button data-action="rename" data-idx="${idx}" class="ghost" ${disabled}>Umbenennen</button>
        <button data-action="delete" data-idx="${idx}" class="danger" ${disabled}>Löschen</button>
      </span>`;
    ul.appendChild(li);
  });
  ul.onclick = async (e) => {
    const btn = e.target.closest('button'); if (!btn) return;
    const idx = Number(btn.dataset.idx);
    let cats = await getCategories();
    if (btn.dataset.action === 'rename') {
      const neu = prompt('Neuer Name:', cats[idx]); if (!neu) return;
      const name = neu.trim(); if (!name) return;
      cats[idx] = name;
      cats = cats.filter(c=>c!==UNDEF).sort((a,b)=>a.localeCompare(b,'de')).concat([UNDEF]);
      await put('meta', cats, 'categories'); await renderCategories(cats); openCatsDialog();
    } else if (btn.dataset.action === 'delete') {
      const delCat = cats[idx];
      if (delCat === UNDEF) return;
      if (!confirm(`Kategorie "${delCat}" löschen? Alle zugehörigen Einträge werden auf "${UNDEF}" gesetzt.`)) return;
      const entries = await getAll('entries');
      const updates = entries.filter(e=>e.category===delCat).map(e=>({ ...e, category: UNDEF }));
      await new Promise((res, rej)=>{
        const store = tx('entries','readwrite');
        updates.forEach(u => store.put(u));
        store.transaction.oncomplete = () => res();
        store.transaction.onerror = () => rej(store.transaction.error);
      });
      cats = cats.filter(c => c !== delCat);
      await put('meta', cats, 'categories'); await renderCategories(cats); openCatsDialog(); await refresh();
    }
  };
  dialog.showModal();
}
async function addCategory() {
  const input = $('cat-new');
  const name = (input.value||'').trim(); if (!name) return;
  let cats = await getCategories();
  if (!cats.includes(name)) cats = cats.filter(c=>c!==UNDEF).concat([name]).sort((a,b)=>a.localeCompare(b,'de')).concat([UNDEF]);
  await put('meta', cats, 'categories');
  input.value=''; await renderCategories(cats); openCatsDialog();
}

async function onAdd(e){
  e.preventDefault();
  try {
    const date = $('date').value;
    const category = $('category').value;
    const amountCents = toCents($('amount').value);
    await put('entries', { date, category, amount: amountCents });
    $('amount').value = '';
    await refresh();
  } catch(err) { alert(err.message || 'Fehler beim Speichern'); }
}

async function refresh(){
  const entries = await getAll('entries');
  const month = $('month').value;
  const from = $('from').value || null;
  const to = $('to').value || null;

  let filtered = entries.slice();
  if (month) filtered = filtered.filter(e => yyyymm(e.date) === month);
  else if (from || to) filtered = filtered.filter(e => inRange(e.date, from, to));

  const tbody = $('entries-table').querySelector('tbody');
  tbody.innerHTML = '';
  let totalCents = 0;
  filtered.sort((a,b) => a.date.localeCompare(b.date)).forEach(e => {
    totalCents += e.amount;
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${formatDate(e.date)}</td>
      <td>${e.category}</td>
      <td class="num">${fromCents(e.amount)}</td>
      <td class="inline">
        <button class="ghost" data-edit="${e.id}">Bearbeiten</button>
        <button class="danger" data-del="${e.id}">Löschen</button>
      </td>`;
    tbody.appendChild(tr);
  });
  $('total').textContent = fromCents(totalCents);

  tbody.onclick = async (ev) => {
    const btn = ev.target.closest('button'); if (!btn) return;
    if (btn.dataset.del) {
      if (!confirm('Eintrag löschen?')) return;
      await del('entries', Number(btn.dataset.del));
      await refresh();
    } else if (btn.dataset.edit) {
      openEditDialog(Number(btn.dataset.edit));
    }
  };

  const summary = {};
  filtered.forEach(e=>{ summary[e.category]=(summary[e.category]||0)+e.amount; });
  $('summary').textContent = Object.keys(summary).length
    ? 'Summe je Kategorie: ' + Object.entries(summary).sort((a,b)=>a[0].localeCompare(b[0],'de')).map(([c,v])=>`${c}: ${fromCents(v)}`).join(' · ')
    : (filtered.length ? '—' : 'Keine Einträge im ausgewählten Zeitraum');

  renderCharts(entries, filtered);
}

async function openEditDialog(id){
  const store = tx('entries');
  const req = store.get(id);
  req.onsuccess = async () => {
    const e = req.result; if (!e) return;
    document.getElementById('edit-date').value = e.date;
    await renderCategories();
    document.getElementById('edit-category').value = e.category;
    document.getElementById('edit-amount').value = fromCents(e.amount).replace(/\s?€/,''); 
    document.getElementById('edit-dialog').showModal();
    window._editId = id;
  };
}
document.getElementById('edit-form')?.addEventListener('submit', async (ev) => {
  ev.preventDefault();
  try {
    const id = window._editId;
    const date = document.getElementById('edit-date').value;
    const category = document.getElementById('edit-category').value;
    const amount = toCents(document.getElementById('edit-amount').value);
    await new Promise((res, rej) => {
      const store = tx('entries','readwrite');
      const g = store.get(id);
      g.onsuccess = () => { const cur = g.result; store.put({ ...cur, date, category, amount }).onsuccess = res; };
      g.onerror = () => rej(g.error);
    });
    document.getElementById('edit-dialog').close();
    await refresh();
  } catch(err) { alert(err.message || 'Konnte Eintrag nicht speichern'); }
});

let trendChart, barChart, pieChart, lineChart;
async function renderCharts(allEntries, filtered) {
  const cats = await getCategories();

  const agg = new Map();
  allEntries.forEach(e=>{
    const key = yyyymm(e.date);
    if (!agg.has(key)) agg.set(key, {});
    agg.get(key)[e.category] = (agg.get(key)[e.category]||0)+e.amount;
  });
  const months = Array.from(agg.keys()).sort();
  const trendDatasets = cats.map(cat => ({ label: cat, data: months.map(m => ((agg.get(m)||{})[cat]||0)/100), borderWidth: 1 }));
  if (trendChart) trendChart.destroy();
  trendChart = new Chart(document.getElementById('trend-chart'), {
    type: 'bar',
    data: { labels: months, datasets: trendDatasets },
    options: { responsive:true, scales:{ x:{stacked:true}, y:{stacked:true, ticks:{callback:v=>CURRENCY.format(v)}} }, plugins:{ legend:{position:'bottom'} } }
  });

  const byCat = {}; filtered.forEach(e => { byCat[e.category] = (byCat[e.category]||0) + e.amount; });
  const barLabels = Object.keys(byCat).sort((a,b)=>a.localeCompare(b,'de'));
  const barData = barLabels.map(k => byCat[k]/100);

  if (barChart) barChart.destroy();
  barChart = new Chart(document.getElementById('bar-chart'), {
    type: 'bar',
    data: { labels: barLabels, datasets: [{ label: 'Summe', data: barData, borderWidth: 1 }] },
    options: { responsive:true, scales:{ y:{ ticks:{callback:v=>CURRENCY.format(v)} } }, plugins:{ legend:{display:true, position:'bottom'} } }
  });

  if (pieChart) pieChart.destroy();
  pieChart = new Chart(document.getElementById('pie-chart'), {
    type: 'pie',
    data: { labels: barLabels, datasets: [{ data: barData }] },
    options: { responsive:true, plugins:{ legend:{ position:'bottom' } } }
  });

  const selected = document.getElementById('cat-series').value || cats[0];
  const byMonth = new Map();
  allEntries.forEach(e=>{
    const m = yyyymm(e.date);
    if (!byMonth.has(m)) byMonth.set(m, 0);
    if (e.category === selected) byMonth.set(m, byMonth.get(m) + e.amount);
  });
  const lm = Array.from(byMonth.keys()).sort();
  const lv = lm.map(m => (byMonth.get(m)||0)/100);
  if (lineChart) lineChart.destroy();
  lineChart = new Chart(document.getElementById('line-chart'), {
    type: 'line',
    data: { labels: lm, datasets: [{ label: selected, data: lv, tension: 0.25, pointRadius: 4 }] },
    options: { responsive:true, scales:{ y:{ ticks:{callback:v=>CURRENCY.format(v)} } }, plugins:{ legend:{ position:'bottom' } } }
  });
  document.getElementById('cat-series').onchange = ()=> renderCharts(allEntries, filtered);
}

async function getFilteredEntriesForExport(){
  const all = await getAll('entries');
  const month = document.getElementById('month').value;
  const from = document.getElementById('from').value || null;
  const to = document.getElementById('to').value || null;
  let data = all.slice();
  if (month) data = data.filter(e => yyyymm(e.date) === month);
  else if (from || to) data = data.filter(e => inRange(e.date, from, to));
  return data.sort((a,b)=>a.date.localeCompare(b.date));
}

async function exportJSON(){
  const entries = await getFilteredEntriesForExport();
  const cats = await getCategories();
  const blob = new Blob([JSON.stringify({ entries, categories: cats }, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `kosten-tracker-${new Date().toISOString().slice(0,10)}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

async function exportPDF(){
  const entries = await getFilteredEntriesForExport();
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  doc.setFontSize(14);
  doc.text('Kosten-Tracker Export', 14, 18);
  const rows = entries.map(e => [formatDate(e.date), e.category, fromCents(e.amount)]);
  doc.autoTable({ head: [['Datum','Kategorie','Betrag']], body: rows, startY: 24, styles:{ fontSize: 10 } });
  const total = entries.reduce((s,e)=>s+e.amount,0);
  doc.text(`Summe: ${fromCents(total)}`, 14, doc.lastAutoTable.finalY + 10);
  doc.save(`kosten-tracker-${new Date().toISOString().slice(0,10)}.pdf`);
}

async function exportXLSX(){
  const entries = await getFilteredEntriesForExport();
  const data = [['Datum','Kategorie','Betrag (EUR)']].concat(entries.map(e => [formatDate(e.date), e.category, (e.amount/100).toFixed(2).replace('.',',')]));
  const ws = XLSX.utils.aoa_to_sheet(data);
  ws['!cols'] = [{wch:12},{wch:20},{wch:14}];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Ausgaben');
  const wbout = XLSX.write(wb, { bookType:'xlsx', type:'array' });
  const blob = new Blob([wbout], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `kosten-tracker-${new Date().toISOString().slice(0,10)}.xlsx`;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

const TARGET_NAME = 'Kosten_Kalkulation_App.json';
async function buildSnapshot(){
  const entries = await getAll('entries');
  const categories = await getCategories();
  return JSON.stringify({ entries, categories }, null, 2);
}
async function onSave(){
  const snapshot = await buildSnapshot();
  if (window.showSaveFilePicker) {
    try {
      let handle = await getSavedFileHandle();
      if (!handle) {
        handle = await window.showSaveFilePicker({ suggestedName: TARGET_NAME, types: [{ description: 'JSON', accept: { 'application/json': ['.json'] } }] });
        await setSavedFileHandle(handle);
      }
      const writable = await handle.createWritable();
      await writable.write(new Blob([snapshot], {type:'application/json'}));
      await writable.close();
      alert('Gespeichert.');
      return;
    } catch (e) { console.warn('FS-API Save fallback', e); }
  }
  const url = URL.createObjectURL(new Blob([snapshot], {type:'application/json'}));
  const a = document.createElement('a');
  a.href = url; a.download = TARGET_NAME;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}
async function onLoadKnown(){
  if (window.showOpenFilePicker) {
    try {
      let handle = await getSavedFileHandle();
      if (!handle) {
        [handle] = await window.showOpenFilePicker({ multiple:false, types:[{ description: 'JSON', accept: { 'application/json': ['.json'] } }] });
        await setSavedFileHandle(handle);
      }
      const file = await handle.getFile();
      const text = await file.text();
      await importSnapshot(text);
      alert('Geladen.');
      return;
    } catch(e) { console.warn('FS-API Load fallback', e); }
  }
  alert('Bitte „Andere Datei laden…“ verwenden, um die Datei aus „Dateien“ auszuwählen.');
}
async function onLoadOther(ev){
  const file = ev.target.files?.[0]; if (!file) return;
  const text = await file.text();
  await importSnapshot(text);
  ev.target.value='';
  alert('Geladen.');
}
async function importSnapshot(text){
  const data = JSON.parse(text);
  if (!data || !Array.isArray(data.entries)) throw new Error('Ungültige Datei');
  await new Promise((res,rej)=>{ const r = tx('entries','readwrite').clear(); r.onsuccess=()=>res(); r.onerror=()=>rej(r.error); });
  await setMany('entries', data.entries.map(e=>({ id: e.id, date: e.date, category: e.category, amount: e.amount })));
  if (Array.isArray(data.categories) && data.categories.length) {
    let cats = data.categories.slice();
    if (!cats.includes(UNDEF)) cats.push(UNDEF);
    cats = cats.filter(c=>c!==UNDEF).sort((a,b)=>a.localeCompare(b,'de')).concat([UNDEF]);
    await put('meta', cats, 'categories');
    await renderCategories(cats);
  }
  await refresh();
}
async function tryAutoLoadOnStart(){
  if (window.showOpenFilePicker) {
    try {
      const handle = await getSavedFileHandle();
      if (handle) {
        const perm = await handle.queryPermission({ mode: 'read' });
        if (perm === 'granted') {
          const file = await handle.getFile();
          const text = await file.text();
          await importSnapshot(text);
        }
      }
    } catch (e) { console.warn('Auto-load skipped', e); }
  }
}
async function onWipe(){
  if (!confirm('Wirklich alle Daten löschen?')) return;
  await new Promise((res,rej)=>{ const r = tx('entries','readwrite').clear(); r.onsuccess=()=>res(); r.onerror=()=>rej(r.error); });
  await put('meta', DEFAULT_CATS, 'categories');
  await renderCategories();
  await refresh();
}
