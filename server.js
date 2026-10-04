const http = require('http');
const { URL } = require('url');

const PORT = process.env.PORT || 10000;
const VT = 'http://www.viaggiatreno.it/infomobilita/resteasy/viaggiatreno';

const HUBS = [
  'S01700','S01604','S01702','S00817','S00219','S00306','S01316','S01820',
  'S09218','S03201','S03317','S04203','S05000','S06000','S08400','S11781',
  'S08700','S08900','S01424','S01385','S08408','S08500','S09400','S11200'
];

const cache = { at: 0, value: null, running: null };
const TTL = 25_000;

function vtDate(d = new Date()) {
  // ViaggiaTreno accepts a Date.toUTCString-like value; keep the local CET/CEST offset.
  const days=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const mon=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const off=-d.getTimezoneOffset(), sign=off>=0?'+':'-', mins=Math.abs(off);
  const hh=String(Math.floor(mins/60)).padStart(2,'0');
  const mm=String(mins%60).padStart(2,'0');
  return `${days[d.getDay()]} ${mon[d.getMonth()]} ${String(d.getDate()).padStart(2,'0')} ${d.getFullYear()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}:${String(d.getSeconds()).padStart(2,'0')} GMT${sign}${hh}${mm}`;
}

async function vt(path) {
  const r=await fetch(VT+path, {
    headers:{
      'Accept':'application/json,text/plain,*/*',
      'User-Agent':'Mozilla/5.0 (compatible; ParDeQuaTrain/0.9)'
    }
  });
  if(!r.ok) throw new Error(`VT ${r.status}`);
  const text=await r.text();
  if(!text.trim()) return null;
  try { return JSON.parse(text); } catch { return text; }
}
const n=x=>Number.isFinite(Number(x))?Number(x):null;
const key=t=>`${t.numeroTreno}|${t.codOrigine||''}|${t.dataPartenzaTreno||''}`;

async function board(id){
  return vt(`/partenze/${id}/${encodeURIComponent(vtDate())}`);
}
async function run(t){
  if(!t.numeroTreno || !t.codOrigine || !t.dataPartenzaTreno) return null;
  try {
    const a=await vt(`/andamentoTreno/${encodeURIComponent(t.codOrigine)}/${encodeURIComponent(t.numeroTreno)}/${encodeURIComponent(t.dataPartenzaTreno)}`);
    return a ? {t,a} : null;
  } catch { return null; }
}
async function lastReal(run) {
  const f=Array.isArray(run.a?.fermate)?run.a.fermate:[];
  let last=null;
  for(const s of f) {
    const effective=s.effettiva??s.partenzaEffettiva??s.arrivoEffettivo;
    const id=s.id??s.codStazione??s.codiceStazione;
    if(effective && id) last={id,station:s.stazione??s.nomeStazione??'',time:effective};
  }
  if(!last) return null;
  try {
    const c=await vt(`/getCoordinateStazione/${encodeURIComponent(last.id)}`);
    const lat=n(c?.latitudine??c?.lat??c?.latitude), lon=n(c?.longitudine??c?.lon??c?.longitude);
    return lat!==null&&lon!==null?{...last,lat,lon}:null;
  } catch { return null; }
}
async function snapshot() {
  if(cache.value && Date.now()-cache.at<TTL) return cache.value;
  if(cache.running) return cache.running;
  cache.running=(async()=>{
    const boards=await Promise.all(HUBS.map(async id=>{
      try{return await board(id)}catch{return []}
    }));
    const uniq=new Map();
    boards.flat().forEach(t=>{
      if(t?.numeroTreno!=null && t.tipoTreno!=='ST' && t.tipoTreno!=='SI') uniq.set(key(t),t);
    });
    const candidates=[...uniq.values()], out=[];
    for(let i=0;i<candidates.length;i+=16) {
      const rs=await Promise.all(candidates.slice(i,i+16).map(run));
      for(const r of rs) {
        if(!r) continue;
        const p=await lastReal(r);
        if(!p) continue;
        const t=r.t,a=r.a;
        out.push({
          id:key(t),number:String(t.numeroTreno),
          category:t.categoriaDescrizione??t.categoria??a.categoria??'',
          origin:t.origine??a.origine??'',destination:t.destinazione??a.destinazione??'',
          delay:n(t.ritardo??a.ritardo??0)??0,
          lat:p.lat,lon:p.lon,estimated:false,
          positionLabel:`Ultimo rilevamento reale: ${p.station||'stazione'}`
        });
      }
    }
    const value={ok:true,count:out.length,trains:out,source:'ViaggiaTreno',updatedAt:new Date().toISOString(),
      diagnostics:{hubs:HUBS.length,boards:boards.reduce((a,b)=>a+b.length,0),candidates:candidates.length}};
    cache.value=value; cache.at=Date.now(); return value;
  })().finally(()=>{cache.running=null});
  return cache.running;
}
function send(res,status,data) {
  res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store',
    'access-control-allow-origin':'*','access-control-allow-methods':'GET,OPTIONS'});
  res.end(JSON.stringify(data));
}
const server=http.createServer(async(req,res)=>{
  if(req.method==='OPTIONS'){res.writeHead(204,{'access-control-allow-origin':'*','access-control-allow-methods':'GET,OPTIONS'});return res.end();}
  const u=new URL(req.url,`http://${req.headers.host}`);
  try {
    if(u.pathname==='/health') return send(res,200,{ok:true,service:'par-de-qua-train-api',version:'0.9.0'});
    if(u.pathname==='/api/v1/live/passenger') return send(res,200,await snapshot());
    if(u.pathname==='/api/v1/source-status') {
      try { const x=await vt(`/statistiche/${Date.now()}`); return send(res,200,{ok:true,source:'ViaggiaTreno',statistics:x}); }
      catch(e){ return send(res,502,{ok:false,source:'ViaggiaTreno',error:e.message});}
    }
    return send(res,404,{error:'not found'});
  } catch(e){ return send(res,502,{ok:false,error:e.message}); }
});
server.listen(PORT,()=>console.log(`Par De Qua Train API 0.9.0 listening on ${PORT}`));
