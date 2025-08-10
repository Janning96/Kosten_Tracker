const DB_NAME = 'expense-tracker-db';
const DB_VERSION = 2;
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
        if (!store.indexNames.contains('date')) {
          store.createIndex('date', 'date');
        }
      }
      if (!db.objectStoreNames.contains('meta')) {
        db.createObjectStore('meta');
      }
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
async function updateEntry(id, patch) {
  return new Promise((res, rej) => {
    const store = tx('entries','readwrite');
    const g = store.get(id);
    g.onsuccess = () => {
      const cur = g.result; if (!cur) return rej(new Error('Eintrag nicht gefunden'));
      const upd = { ...cur, ...patch };
      store.put(upd).onsuccess = () => res(upd);
    };
    g.onerror = () => rej(g.error);
  });
}

const fmt = new Intl.NumberFormat('de-DE', { style:'currency', currency:'EUR' });
function toCents(input) {
  if (typeof input !== 'string') input = String(input ?? '');
  const cleaned = input.replace(/\s|€|\u00A0/g,'').replace(/\./g,'').replace(',', '.');
  const value = Number(cleaned);
  if (isNaN(value)) throw new Error('Ungültiger Betrag');
  return Math.round(value * 100);
}
function fromCents(cents) { return fmt.format((cents||0)/100); }
function yyyymm(date) { return date.slice(0,7); }
function inRange(dateISO, fromISO, toISO) {
  if (fromISO && dateISO < fromISO) return false;
  if (toISO && dateISO > toISO) return false;
  return true;
}

const UNDEF = 'Undefiniert';
const DEFAULT_CATS = ['Café','Gesundheit','Klamotten','Lebensmittel','Restaurant','Shoppen','Transport','Unterhaltung','Urlaub', UNDEF];
async function getCategories() {
  let cats = await new Promise((res)=>{ const rq = tx('meta').get('categories'); rq.onsuccess=()=>res(rq.result); rq.onerror=()=>res(undefined); });
  if (!Array.isArray(cats) || cats.length===0) {
    cats = [...DEFAULT_CATS];
    await put('meta', cats, 'categories');
  }
  cats = cats.filter(c=>c!==UNDEF).sort((a,b)=>a.localeCompare(b,'de')).concat([UNDEF]);
  await put('meta', cats, 'categories');
  return cats;
}

function $(id){ return document.getElementById(id); }
let editId = null;

document.addEventListener('DOMContentLoaded', async () => {
  await openDB();
  await put('meta', (await getCategories()), 'categories');
  await renderCategories();
  $('date').valueAsDate = new Date();

  $('entry-form').addEventListener('submit', onAdd);
  $('btn-manage-cats').addEventListener('click', openCatsDialog);
  $('btn-cat-add').addEventListener('click', addCategory);
  $('cats-dialog').addEventListener('close', () => renderCategories());
  $('btn-this-month').addEventListener('click', () => { $('month').value = new Date().toISOString().slice(0,7); clearRange(); refresh(); });
  $('month').addEventListener('input', () => { clearRange(); refresh(); });
  $('btn-apply-range').addEventListener('click', () => { $('month').value=''; refresh(); });
  $('btn-clear-range').addEventListener('click', () => { clearRange(); refresh(); });
  $('btn-export').addEventListener('click', onExportJSON);
  $('btn-export-pdf').addEventListener('click', onExportPDF);
  $('btn-export-xlsx').addEventListener('click', onExportXLSX);
  $('file-import').addEventListener('change', onImport);
  $('btn-wipe').addEventListener('click', onWipe);

  $('month').value = new Date().toISOString().slice(0,7);
  await refresh();
});

function clearRange(){ $('from').value=''; $('to').value=''; }

async function renderCategories(cats) {
  if (!cats) cats = await getCategories();
  ['category','edit-category'].forEach(id => {
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
      <span class="action">
        <button data-action="rename" data-idx="${idx}" class="secondary" ${disabled}>Umbenennen</button>
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
      const name = neu.trim();
      if (!name) return;
      const old = cats[idx];
      cats[idx] = name;
      cats = cats.filter(c=>c!==UNDEF).sort((a,b)=>a.localeCompare(b,'de')).concat([UNDEF]);
      await put('meta', cats, 'categories');
      await renderCategories(cats);
      openCatsDialog();
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
      await put('meta', cats, 'categories');
      await renderCategories(cats);
      openCatsDialog();
      await refresh();
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
  } catch(err) {
    alert(err.message || 'Fehler beim Speichern');
  }
}

function formatDate(iso){ const [y,m,d]=iso.split('-'); return `${d}.${m}.${y}`; }

async function refresh(){
  const entries = await getAll('entries');
  const month = $('month').value;
  const from = $('from').value || null;
  const to = $('to').value || null;

  let filtered = entries.slice();
  if (month) {
    filtered = filtered.filter(e => yyyymm(e.date) === month);
  } else if (from || to) {
    filtered = filtered.filter(e => inRange(e.date, from, to));
  }

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
      <td class="action">
        <button class="secondary" data-edit="${e.id}">Bearbeiten</button>
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
      const id = Number(btn.dataset.edit);
      openEditDialog(id);
    }
  };

  const summary = {};
  filtered.forEach(e=>{ summary[e.category]=(summary[e.category]||0)+e.amount; });
  $('month-summary').textContent = Object.keys(summary).length
    ? 'Summe je Kategorie: ' + Object.entries(summary).sort((a,b)=>a[0].localeCompare(b[0],'de')).map(([c,v])=>`${c}: ${fromCents(v)}`).join(' · ')
    : (filtered.length ? '—' : 'Keine Einträge im ausgewählten Zeitraum');

  renderTrendChart(entries);
}

async function openEditDialog(id){
  editId = id;
  const store = tx('entries');
  const req = store.get(id);
  req.onsuccess = async () => {
    const e = req.result; if (!e) return;
    $('edit-date').value = e.date;
    await renderCategories();
    $('edit-category').value = e.category;
    $('edit-amount').value = fromCents(e.amount).replace(/\s?€/,''); 
    const dlg = $('edit-dialog');
    dlg.showModal();
  };
}
$('edit-form')?.addEventListener('submit', async (ev) => {
  ev.preventDefault();
  try {
    const date = $('edit-date').value;
    const category = $('edit-category').value;
    const amount = toCents($('edit-amount').value);
    await updateEntry(editId, { date, category, amount });
    $('edit-dialog').close();
    await refresh();
  } catch(err) {
    alert(err.message || 'Konnte Eintrag nicht speichern');
  }
});

let chart;
async function renderTrendChart(entries){
  const cats = await getCategories();
  const agg = new Map();
  entries.forEach(e=>{
    const key = yyyymm(e.date);
    if (!agg.has(key)) agg.set(key, {});
    agg.get(key)[e.category] = (agg.get(key)[e.category]||0)+e.amount;
  });
  const months = Array.from(agg.keys()).sort();
  const datasets = cats.map(cat => ({
    label: cat,
    data: months.map(m => ((agg.get(m)||{})[cat]||0)/100),
    borderWidth: 1,
    backgroundColor: undefined
  }));

  const ctx = document.getElementById('trend-chart');
  if (chart) chart.destroy();
  chart = new Chart(ctx, {
    type: 'bar',
    data: { labels: months, datasets },
    options: {
      responsive: true,
      scales: {
        x: { stacked: true },
        y: { stacked: true, ticks: { callback: v => fmt.format(v).replace(' ', ' ') } }
      },
      plugins: {
        tooltip: {
          callbacks: {
            label: (ctx) => `${ctx.dataset.label}: ${fmt.format(ctx.parsed.y).replace(' ',' ')}`
          }
        },
        legend: { position: 'bottom' }
      }
    }
  });
}

async function getFilteredEntriesForExport(){
  const all = await getAll('entries');
  const month = $('month').value;
  const from = $('from').value || null;
  const to = $('to').value || null;
  let data = all.slice();
  if (month) data = data.filter(e => yyyymm(e.date) === month);
  else if (from || to) data = data.filter(e => inRange(e.date, from, to));
  return data.sort((a,b)=>a.date.localeCompare(b.date));
}

async function onExportJSON(){
  const entries = await getFilteredEntriesForExport();
  const cats = await getCategories();
  const blob = new Blob([JSON.stringify({ entries, categories: cats }, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `kosten-tracker-${new Date().toISOString().slice(0,10)}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

async function onExportPDF(){
  const entries = await getFilteredEntriesForExport();
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  doc.setFontSize(14);
  doc.text('Kosten-Tracker Export', 14, 18);
  const rows = entries.map(e => [formatDate(e.date), e.category, fromCents(e.amount)]);
  doc.autoTable({
    head: [['Datum','Kategorie','Betrag']],
    body: rows,
    startY: 24,
    styles: { fontSize: 10 }
  });
  const total = entries.reduce((s,e)=>s+e.amount,0);
  doc.text(`Summe: ${fromCents(total)}`, 14, doc.lastAutoTable.finalY + 10);
  doc.save(`kosten-tracker-${new Date().toISOString().slice(0,10)}.pdf`);
}

async function onExportXLSX(){
  const entries = await getFilteredEntriesForExport();
  const data = [['Datum','Kategorie','Betrag (EUR)']].concat(
    entries.map(e => [formatDate(e.date), e.category, (e.amount/100).toFixed(2).replace('.',',')])
  );
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

async function onImport(ev){
  const file = ev.target.files?.[0]; if (!file) return;
  const text = await file.text();
  const data = JSON.parse(text);
  const existing = await getAll('entries');
  let nextId = existing.reduce((m,e)=>Math.max(m, e.id||0), 0) + 1;
  const imported = (data.entries||[]).map(e => ({ id: nextId++, ...e }));
  await setMany('entries', imported);
  if (Array.isArray(data.categories) && data.categories.length) {
    let cats = await getCategories();
    data.categories.forEach(c => { if (!cats.includes(c)) cats.splice(cats.length-1,0,c); });
    cats = cats.filter(c=>c!==UNDEF).sort((a,b)=>a.localeCompare(b,'de')).concat([UNDEF]);
    await put('meta', cats, 'categories');
    await renderCategories(cats);
  }
  ev.target.value = '';
  await refresh();
}
async function onWipe(){
  if (!confirm('Wirklich alle Daten löschen?')) return;
  await new Promise((res,rej)=>{ const r = tx('entries','readwrite').clear(); r.onsuccess=()=>res(); r.onerror=()=>rej(r.error); });
  await put('meta', DEFAULT_CATS, 'categories');
  await renderCategories();
  await refresh();
}
