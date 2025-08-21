// N26 (deutsch) parser tuned for lines like:
// "Wertstellung DD.MM.YYYYDD.MM.YYYY -123,45€"  (two dates sometimes concatenated by PDF extraction)
// Use the 2nd date as posting/Verbuchungsdatum if present; fallback to the first.
export function parseN26PdfText(fullText) {
  if (!fullText || typeof fullText !== 'string') throw new Error('Leerer PDF-Text.');

  let text = fullText
    .replace(/\u00A0/g, ' ')
    .replace(/[\u2212\u2012\u2013\u2014]/g, '-') // unicode minus
    .replace(/\r/g, '');

  const lines = text.split(/\n/).map(l => l.trim()).filter(Boolean);
  const results = [];

  function findDescription(idx) {
    // Look upward for the last merchant-like line (skip section headers/IBAN lines)
    for (let k = idx - 1; k >= Math.max(0, idx - 8); k--) {
      const s = lines[k];
      if (!s) continue;
      if (/^(lastschriften|gutschriften|belastungen|kartenzahlungen|kartenumsätze)/i.test(s)) continue;
      if (/^(iban|bic)\b/i.test(s)) continue;
      if (/^beschreibung\s+verbuchungsdatum\s+betrag/i.test(s)) continue;
      if (/^wertstellung\b/i.test(s)) continue;
      if (/^\d{1,2}\.\d{1,2}\.\d{2,4}$/.test(s)) continue;
      return s;
    }
    return '';
  }

  // Pattern with two dates (optional space), then amount with optional €
  const pat = /^wertstellung\s+(\d{1,2}\.\d{1,2}\.\d{4})\s*(\d{1,2}\.\d{1,2}\.\d{4})?\s+([+\-]?\d{1,3}(?:\.\d{3})*,\d{2})\s*€?$/i;

  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(pat);
    if (!m) continue;
    const d1 = m[1];
    const d2 = m[2] || m[1];
    const amountStr = m[3];
    const val = Number(amountStr.replace(/\./g, '').replace(',', '.'));
    const [dd2, mm2, yyyy2] = d2.split('.');
    const iso = `${yyyy2}-${mm2.padStart(2,'0')}-${dd2.padStart(2,'0')}`;

    let desc = findDescription(i);
    if (/barclays/i.test(desc)) continue; // permanent ignore rule

    results.push({ description: desc, postingDate: iso, amount: val, source: 'N26' });
  }

  // Fallback: German 3-column header "Beschreibung Verbuchungsdatum Betrag"
  if (!results.length) {
    const idx = lines.findIndex(l => /beschreibung\s+verbuchungsdatum\s+betrag/i.test(l));
    if (idx >= 0) {
      for (let j = idx + 1; j < lines.length - 2; j++) {
        const desc = lines[j];
        const dline = lines[j + 1];
        const aline = lines[j + 2];
        if (!/^\d{1,2}\.\d{1,2}\.\d{4}$/.test(dline)) continue;
        const am = aline.match(/^([+\-]?\d{1,3}(?:\.\d{3})*,\d{2})\s*€?$/);
        if (!am) continue;
        const val = Number(am[1].replace(/\./g, '').replace(',', '.'));
        const [dd, mm, yyyy] = dline.split('.');
        const iso = `${yyyy}-${mm.padStart(2,'0')}-${dd.padStart(2,'0')}`;
        if (/barclays/i.test(desc)) { j += 2; continue; }
        results.push({ description: desc, postingDate: iso, amount: val, source: 'N26' });
        j += 2;
      }
    }
  }

  return results;
}
