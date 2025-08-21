export function exportToCsv(rows,filename='export.csv'){
  const headers=Object.keys(rows[0]||{original:'',clean:'',amount:'',postingDate:''});
  const esc=v=>'"'+String(v??'').replace(/"/g,'""')+'"';
  const body=rows.map(r=>headers.map(h=>esc(r[h])).join(','));
  const csv=[headers.join(','),...body].join('\n');
  const blob=new Blob([csv],{type:'text/csv;charset=utf-8;'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');a.href=url;a.download=filename;a.click();
  setTimeout(()=>URL.revokeObjectURL(url),2000);
}