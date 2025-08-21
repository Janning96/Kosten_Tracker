/**
 * Barclays CSV parser (DE account CSV export)
 * - Skip rows where description equals exactly "Gutschrift Manuelle Lastschrift"
 * - Expect columns incl. Description, Posting Date, Amount (tries to auto-detect by header names)
 */
export async function parseBarclaysCsv(file) {
  const text = await file.text();
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (!lines.length) return [];

  // Detect header
  const header = lines[0].split(';'); // Barclays often uses semicolon; fall back to comma if needed
  const delim = header.length < 2 ? ',' : ';';

  const headers = lines[0].split(delim).map(h => h.trim().toLowerCase());
  const idxDesc = headers.findIndex(h => /description|verwendungszweck|beschreibung/i.test(h));
  const idxDate = headers.findIndex(h => /posting\s*date|buchungsdatum|wertstellung/i.test(h));
  const idxAmt  = headers.findIndex(h => /amount|betrag/i.test(h));

  if (idxDesc < 0 || idxDate < 0 || idxAmt < 0) {
    throw new Error('CSV-Header nicht erkannt (benötigt Description, Posting Date, Amount).');
  }

  const out = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(delim).map(x => x.replace(/^\"|\"$/g, '').trim());
    if (!cols.length) continue;
    const desc = cols[idxDesc] || '';
    if (desc.trim().toLowerCase() === 'gutschrift manuelle lastschrift') continue; // permanent rule

    const posting = cols[idxDate] || '';
    const amount = cols[idxAmt] || '';

    // normalize amount: convert "-1.234,56" or "-1234.56" → number
    const val = Number(amount.replace(/\./g, '').replace(',', '.'));
    if (Number.isNaN(val)) continue;

    // normalize date → YYYY-MM-DD for dd.mm.yyyy
    let d = posting;
    const m = d.match(/(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})/);
    if (m) {
      const dd = String(m[1]).padStart(2, '0');
      const mm = String(m[2]).padStart(2, '0');
      const yyyy = String(m[3]).length === 2 ? '20' + m[3] : m[3];
      d = `${yyyy}-${mm}-${dd}`;
    }

    out.push({ description: desc, postingDate: d, amount: val, source: 'Barclays' });
  }

  return out;
}
