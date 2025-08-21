/**
 * N26 PDF parser (client-side, lightweight heuristic):
 * - Scans entire text (main + spaces)
 * - Recognizes tables with headers containing Description | Posting Date | Amount
 * - Handles separate rows (Value Date + Posting Date + Amount) OR combined rows
 * - Normalizes Unicode minus and NBSP
 * NOTE: This uses a best-effort text extraction via File.text() fallback.
 */
export async function parseN26Pdf(file) {
  // try a best-effort text read; if binary or encrypted, throw
  let text = '';
  if (file.text) {
    try { text = await file.text(); } catch (e) { /* ignore */ }
  }
  if (!text || !/description\s*\|\s*posting\s*date\s*\|\s*amount/i.test(text)) {
    // As a fallback, try to read as arrayBuffer and decode a bit – still best-effort
    const buf = await file.arrayBuffer();
    const ascii = new TextDecoder('latin1', { fatal: false }).decode(new Uint8Array(buf));
    text = ascii;
  }

  if (!/description\s*\|\s*posting\s*date\s*\|\s*amount/i.test(text)) {
    throw new Error('Tabellen-Header nicht gefunden. Stelle sicher, dass die PDF den Export mit "Description | Posting Date | Amount" enthält.');
  }

  // Normalize whitespace, unicode minus
  text = text
    .replace(/\u00A0/g, ' ')
    .replace(/[\u2212\u2012\u2013\u2014]/g, '-')
    .replace(/\r/g, '')
    .replace(/ +/g, ' ');

  // Extract lines
  const lines = text.split(/\n/).map(l => l.trim()).filter(Boolean);

  const results = [];
  const pushTx = (desc, postingDate, amount) => {
    if (!desc || !postingDate || !amount) return;
    // normalize amount: allow "-12,34" or "-12.34"
    const amt = String(amount).replace(/\./g, '').replace(',', '.');
    const val = Number(amt);
    if (Number.isNaN(val)) return;
    // normalize date as YYYY-MM-DD if possible (N26: dd.mm.yyyy)
    let d = postingDate;
    const m = d.match(/(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})/);
    if (m) {
      const dd = String(m[1]).padStart(2, '0');
      const mm = String(m[2]).padStart(2, '0');
      const yyyy = String(m[3]).length === 2 ? '20' + m[3] : m[3];
      d = `${yyyy}-${mm}-${dd}`;
    }
    results.push({ description: desc, postingDate: d, amount: val, source: 'N26' });
  };

  // Heuristic parse: find header index, then parse until next header or section
  for (let i = 0; i < lines.length; i++) {
    if (/description\s*\|\s*posting\s*date\s*\|\s*amount/i.test(lines[i])) {
      // parse subsequent lines until next header or a totals line
      for (let j = i + 1; j < lines.length; j++) {
        const line = lines[j];
        if (!line) continue;
        // Stop if we hit another header or a totals line
        if (/^description\b/i.test(line) || /^(total|summe)\b/i.test(line)) break;

        // Combined row variant: "Some Merchant | 12.03.2025 | -12,34"
        if (/\s*\|\s*/.test(line)) {
          const parts = line.split(/\s*\|\s*/);
          if (parts.length >= 3) {
            const [desc, posting, amount] = parts;
            pushTx(desc, posting, amount);
            continue;
          }
        }

        // Separate rows variant – try to sniff next two lines for date and amount
        const l1 = line;
        const l2 = lines[j + 1] || '';
        const l3 = lines[j + 2] || '';
        if (/(\d{1,2}[./-]\d{1,2}[./-]\d{2,4})/.test(l2) && /[-+]?\d+[.,]\d{2}/.test(l3)) {
          pushTx(l1, l2, l3);
          j += 2; // consumed l1..l3
          continue;
        }
      }
    }
  }

  return results;
}
