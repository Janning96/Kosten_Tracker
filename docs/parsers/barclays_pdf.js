export function parseBarclaysPdfRobust(fullText){
  if(!fullText||typeof fullText!=='string') throw new Error('Leerer PDF-Text.');
  const lines = fullText
    .replace(/\u00A0/g,' ')
    .replace(/[\u2212\u2012\u2013\u2014]/g,'-')
    .replace(/\r/g,'')
    .split(/\n/)
    .map(s=>s.trim())
    .filter(Boolean);

  let start = lines.findIndex(l=>/umsatzübersicht/i.test(l));
  if(start < 0) start = 0;
  let end = lines.length;
  const endIdx = lines.findIndex((l,idx)=> idx>start && /(zinssätze|wichtige hinweise|monatsabrechnung|rechnung|gesamtübersicht)/i.test(l));
  if(endIdx>start) end = endIdx;
  const work = lines.slice(start, end);

  const rowStart = /^(\d{1,2}\.\d{1,2}\.\d{4})\s+(\d{1,2}\.\d{1,2}\.\d{4})\s+(.+)/;
  const rowEndAmount = /(\d{1,3}(?:\.\d{3})*,\d{2})\s*([+-])$/;

  const out = [];
  let buffer = null;

  function flushBuffer() {
    if(!buffer) return;
    const s = buffer.join(' ').replace(/\s{2,}/g,' ').trim();
    const mStart = s.match(rowStart);
    const mEnd = s.match(rowEndAmount);
    if(mStart && mEnd){
      const valuta = mStart[2];
      const descPart = s.slice(mStart[0].length).replace(mEnd[0],'').trim();
      const amountStr = mEnd[1];
      const signSym = mEnd[2];
      const sign = signSym === '-' ? -1 : 1;
      const amount = sign * Number(amountStr.replace(/\./g,'').replace(',','.'));
      const [d,m,y] = valuta.split('.');
      const iso = `${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`;
      out.push({ description: descPart.replace(/\s+[A-Z]{2}\s+Visa$/i,'').trim(), postingDate: iso, amount, source: 'Barclays' });
    }
    buffer = null;
  }

  for(const ln of work){
    if(rowStart.test(ln)){
      if(buffer) flushBuffer();
      buffer = [ln];
      if(rowEndAmount.test(ln)) flushBuffer();
    } else if(buffer){
      buffer.push(ln);
      if(rowEndAmount.test(ln)) flushBuffer();
    }
  }
  if(buffer) flushBuffer();

  return out;
}