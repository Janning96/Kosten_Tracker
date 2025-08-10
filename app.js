// --- Kleine IndexedDB-Helfer ---
const DB_NAME = 'expense-tracker-db';
const DB_VERSION = 1;
let db;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('entries')) {
        const store = db.createObjectStore('entries', { keyPath: 'id', autoIncrement: true });
        store.createIndex('date', 'date');
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
async function getMeta(k, fallback) { const r = await new Promise((res)=>{ const rq = tx('meta').get(k); rq.onsuccess=()=>res(rq.result); rq.onerror=()=>res(undefined); }); return r ?? fallback; }

// --- Euro-Format & Parsing (de-DE) ---
const fmt = new Intl.NumberFormat('de-DE', { style:'currency', currency:'EUR' });
function toCents(input) {
  // akzeptiert "0,00", "1.234,5", "12,34 €"
  if (typeof input !== 'string') input = String(input ?? '');
  const cleaned = input.replace(/\s|€|\u00A0/g,'')
                       .replace(/\./g,'')       // tausenderpunkte raus
                       .replace(',', '.');      // komma -> punkt
  const value = Number(cleaned);
  if (isNaN(value)) throw new Error('Ungültiger Betrag');
  return Math.round(value * 100);
}
function fromCents(cents) { return fmt.format((cents||0)/100); }
function yyyymm(date) { return date.slice(0,7); } // "YYYY-MM"

// --- Kategorien ---
const DEFAULT_CATS = ['Miete', 'Lebensmittel', 'Transport', 'Freizeit', 'Gesundheit', 'Sonstiges'];

// --- DOM-Refs ---
const els = {};
function $(id){ return document.getElementById(id); }

document.addEventListener('DOMContentLoaded', async () => {
  await openDB();
  // Kategorien initialisieren
  const cats = await getMeta('categories', DEFAULT_CATS);
  await put('meta', cats, 'categories');
  renderCategories(cats);

  // Datum default: heute
  $('date').valueAsDate = new Date();

  // Events
  $('entry-form').addEventListener('submit', onAdd);
  $('btn-manage-cats').addEventListener('click', openCatsDialog);
  $('btn-cat-add').addEventListener('click', addCategory);
  $('cats-dialog').addEventListener('close', () => renderCategories());
  $('btn-this-month').addEventListener('click', () => { $('month').value = new Date().toISOString().slice(0,7); refresh(); });
  $('month').addEventListener('input', refresh);
  $('btn-export').addEventListener('click', onExport);
  $('file-import').addEventListener('change', onImport);
  $('btn-wipe').addEventListener('click', onWipe);

  // Monat default
  $('month').value = new Date().toISOString().slice(0,7);

  await refresh();
});

// --- UI: Kategorien Dropdown + Dialog ---
async function renderCategories(cats) {
  if (!cats) cats = await getMeta('categories', DEFAULT_CATS);
  const sel = $('category');
  sel.innerHTML = '';
  cats.forEach(c => { const o = document.createElement('option'); o.value=c; o.textContent=c; sel.appendChild(o); });
}

async function openCatsDialog() {
  const dialog = $('cats-dialog');
  const ul = $('cats-list');
  const cats = await getMeta('categories', DEFAULT_CATS);
  ul.innerHTML = '';
  cats.forEach((c, idx) => {
    const li = document.createElement('li');
    li.innerHTML = `<span>${c}</span>
      <span>
        <button data-action="rename" data-idx="${idx}" class="secondary">Umbenennen</button>
        <button data-action="delete" data-idx="${idx}" class="danger">Löschen</button>
      </span>`;
    ul.appendChild(li);
  });
  ul.onclick = async (e) => {
    const btn = e.target.closest('button'); if (!btn) return;
    const idx = Number(btn.dataset.idx);
    const cats = await getMeta('categories', DEFAULT_CATS);
    if (btn.dataset.action === 'rename') {
      const neu = prompt('Neuer Name:', cats[idx]); if (!neu) return;
      cats[idx] = neu.trim();
      await put('meta', cats, 'categories'); renderCategories(cats); openCatsDialog();
    } else if (btn.dataset.action === 'delete') {
      if (cats.length <= 1) return alert('Mindestens eine Kategorie wird benötigt.');
      if (!confirm(\`Kategorie "\${cats[idx]}" wirklich löschen?\`)) return;
      cats.splice(idx,1);
      await put('meta', cats, 'categories'); renderCategories(cats); openCatsDialog();
    }
  };
  dialog.showModal();
}
async function addCategory() {
  const input = $('cat-new');
  const name = (input.value||'').trim(); if (!name) return;
  const cats = await getMeta('categories', DEFAULT_CATS);
  if (!cats.includes(name)) cats.push(name);
  await put('meta', cats, 'categories');
  input.value=''; renderCategories(cats); openCatsDialog();
}

// --- Datenfluss ---
async function onAdd(e){
  e.preventDefault();
  try {
    const date = $('date').value; // "YYYY-MM-DD"
    const category = $('category').value;
    const amountCents = toCents($('amount').value);
    await put('entries', { date, category, amount: amountCents });
    $('amount').value = '';
    await refresh();
  } catch(err) {
    alert(err.message || 'Fehler beim Speichern');
  }
}

async function refresh(){
  const entries = await getAll('entries');
  // Tabelle für aktuellen Monat
  const selMonth = $('month').value; // "YYYY-MM"
  const tbody = $('entries-table').querySelector('tbody');
  tbody.innerHTML = '';
  let totalCents = 0;
  entries
    .filter(e => yyyymm(e.date) === selMonth)
    .sort((a,b) => a.date.localeCompare(b.date))
    .forEach(e => {
      totalCents += e.amount;
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${formatDate(e.date)}</td>
        <td>${e.category}</td>
        <td class="num">${fromCents(e.amount)}</td>
        <td><button class="danger" data-del="${e.id}">✕</button></td>`;
      tbody.appendChild(tr);
    });
  $('month-total').textContent = fromCents(totalCents);
  tbody.onclick = async (ev) => {
    const b = ev.target.closest('button[data-del]'); if (!b) return;
    if (!confirm('Eintrag löschen?')) return;
    await del('entries', Number(b.dataset.del));
    await refresh();
  };

  // kleine Summary
  const summary = {};
  entries.filter(e=>yyyymm(e.date)===selMonth).forEach(e=>{
    summary[e.category] = (summary[e.category]||0)+e.amount;
  });
  $('month-summary').textContent = Object.keys(summary).length
    ? 'Summe je Kategorie: ' + Object.entries(summary).map(([c,v])=>\`\${c}: \${fromCents(v)}\`).join(' · ')
    : 'Keine Einträge in diesem Monat';

  // Trends: Kategorien je Monat (Stacked Bar)
  renderTrendChart(entries);
}

function formatDate(iso){ const [y,m,d]=iso.split('-'); return `${d}.${m}.${y}`; }

// --- Chart ---
let chart;
async function renderTrendChart(entries){
  // Aggregation: map[YYYY-MM][category] = cents
  const cats = await getMeta('categories', DEFAULT_CATS);
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

// --- Export / Import / Wipe ---
async function onExport(){
  const entries = await getAll('entries');
  const cats = await getMeta('categories', DEFAULT_CATS);
  const blob = new Blob([JSON.stringify({ entries, categories: cats }, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `kosten-tracker-${new Date().toISOString().slice(0,10)}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}
async function onImport(ev){
  const file = ev.target.files?.[0]; if (!file) return;
  const text = await file.text();
  const data = JSON.parse(text);
  // simple merge
  const existing = await getAll('entries');
  const maxId = existing.reduce((m,e)=>Math.max(m, e.id||0), 0);
  const imported = (data.entries||[]).map((e,i)=>({ id: (e.id? e.id : maxId+1+i), ...e }));
  // löschen + neu schreiben (sauberer)
  await new Promise((res,rej)=>{ const r = tx('entries','readwrite').clear(); r.onsuccess=()=>res(); r.onerror=()=>rej(r.error); });
  for (const e of imported) await put('entries', e);
  if (Array.isArray(data.categories) && data.categories.length) await put('meta', data.categories, 'categories');
  ev.target.value = '';
  await renderCategories();
  await refresh();
}
async function onWipe(){
  if (!confirm('Wirklich alle Daten löschen?')) return;
  await new Promise((res,rej)=>{ const r = tx('entries','readwrite').clear(); r.onsuccess=()=>res(); r.onerror=()=>rej(r.error); });
  await put('meta', DEFAULT_CATS, 'categories');
  await renderCategories();
  await refresh();
}
