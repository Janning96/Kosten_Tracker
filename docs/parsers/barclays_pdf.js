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
  const endIdx = lines.findIndex((l,idx)=> idx>start && /(zinssätze|wichtige hinweise|monatsabrechnung|rechnung|gesamtübersicht|seitenzahl|seite \d+)/i.test(l));
  if(endIdx>start) end = endIdx;
  const work = lines.slice(start, end);

  const rowStart = /^(\d{1,2}\.\d{1,2}\.\d{4})\s+(\d{1,2}\.\d{1,2}\.\d{4})\s+(.+)/;
  const amtTrail = /(\d{1,3}(?:\.\d{3})*,\d{2})\s*([+-])$/;
  const amtTrailSpace = /(\d{1,3}(?:\.\d{3})*,\d{2})\s*([+-])\s*$/;
  const amtLead = /^([+-])\s*(\d{1,3}(?:\.\d{3})*,\d{2})$/;
  const amtAnywhere = /([+-])?\s*(\d{1,3}(?:\.\d{3})*,\d{2})\s*([+-])?/;

  const out = [];
  let buffer = null;

  function parseAmount(s){
    let m = s.match(amtTrail) || s.match(amtTrailSpace);
    if(m){
      const num = m[1]; const signSym = m[2];
      const sign = signSym==='-'?-1:1;
      return { amount: sign * Number(num.replace(/\./g,'').replace(',','.')), consume: m[0] };
    }
    const tokens = s.split(/\s+/);
    const last = tokens.slice(-2).join(' ');
    m = last.match(amtLead);
    if(m){
      const signSym = m[1], num = m[2];
      const sign = signSym==='-'?-1:1;
      return { amount: sign * Number(num.replace(/\./g,'').replace(',','.')), consume: m[0] };
    }
    m = s.match(amtAnywhere);
    if(m){
      const lead = m[1]||''; const num = m[2]; const trail = m[3]||'';
      const signSym = trail || lead || '+';
      const sign = signSym==='-'?-1:1;
      return { amount: sign * Number(num.replace(/\./g,'').replace(',','.')), consume: m[0] };
    }
    return null;
  }

  function flushBuffer() {
    if(!buffer) return;
    const s = buffer.join(' ').replace(/\s{2,}/g,' ').trim();
    const mStart = s.match(rowStart);
    if(mStart){
      const valuta = mStart[2];
      let rest = s.slice(mStart[0].length).trim();
      const amt = parseAmount(rest);
      if(amt){
        rest = rest.replace(amt.consume,'').trim();
        const [d,m,y] = valuta.split('.');
        const iso = `${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`;
        out.push({
          description: rest.replace(/\s+[A-Z]{2}\s+Visa$/i,'').trim(),
          postingDate: iso,
          amount: amt.amount,
          source: 'Barclays'
        });
      }
    }
    buffer = null;
  }

  for(const ln of work){
    if(rowStart.test(ln)){
      if(buffer) flushBuffer();
      buffer = [ln];
      const amt = parseAmount(ln);
      if(amt) flushBuffer();
    } else if(buffer){
      buffer.push(ln);
      const joined = buffer.join(' ');
      const amt = parseAmount(joined);
      if(amt) flushBuffer();
    }
  }
  if(buffer) flushBuffer();

  return out;
}

export function diagnoseBarclays(fullText){
  const idx = fullText.toLowerCase().indexOf('umsatzübersicht');
  const windowStart = Math.max(0, idx-500);
  const windowEnd = Math.min(fullText.length, (idx<0? 2000 : idx+1500));
  return { umsatzIndex: idx, windowStart, windowEnd };
}