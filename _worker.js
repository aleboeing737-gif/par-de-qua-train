const VT = 'https://www.viaggiatreno.it/infomobilita/resteasy/viaggiatreno';
const HUBS = [
'S01700','S01604','S01702','S00817','S00219','S00306','S01316','S01820',
'S09218','S03201','S03317','S04203','S05000','S06000','S08400','S11781',
'S08700','S08900','S01424','S01385','S08408','S08500','S09400','S11200'
];

function nowVT(){
  const d=new Date();
  const days=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'], mon=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${days[d.getDay()]} ${mon[d.getMonth()]} ${String(d.getDate()).padStart(2,'0')} ${d.getFullYear()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}:${String(d.getSeconds()).padStart(2,'0')}`;
}
async function vt(path){
  const r=await fetch(`${VT}${path}`,{headers:{'Accept':'application/json,text/plain,*/*'},cf:{cacheTtl:0}});
  if(!r.ok) throw new Error(`VT ${r.status}`);
  const txt=await r.text(); if(!txt.trim()) return null;
  try{return JSON.parse(txt)}catch{return txt}
}
function num(x){const n=Number(x);return Number.isFinite(n)?n:null}
function stationCoords(f){
  const lat=num(f.latitudine??f.lat??f.latitude), lon=num(f.longitudine??f.lon??f.longitude);
  return lat!=null&&lon!=null?[lat,lon]:null;
}
function isCirculating(x){
  if(x?.circolante===false) return false;
  const s=JSON.stringify(x).toLowerCase();
  return !s.includes('cancellato') && !s.includes('soppresso');
}
function key(t){return `${t.numeroTreno||t.number}|${t.codOrigine||t.origine||''}|${t.dataPartenzaTreno||''}`}

async function getStationBoard(id){
  try{
    const x=await vt(`/partenze/${id}/${encodeURIComponent(nowVT())}`);
    return Array.isArray(x)?x:[];
  }catch{return []}
}
async function getRun(t){
  const n=t.numeroTreno;
  try{
    const info=await vt(`/cercaNumeroTreno/${encodeURIComponent(n)}`);
    if(!info?.codLocOrig || !info?.millisDataPartenza) return null;
    const a=await vt(`/andamentoTreno/${info.codLocOrig}/${n}/${info.millisDataPartenza}`);
    if(!a) return null;
    return {info,a,board:t};
  }catch{return null}
}
function extractLast(run){
  const a=run.a, f=Array.isArray(a.fermate)?a.fermate:[];
  let last=null;
  for(const s of f){
    const lat=num(s.latitudine??s.lat??s.latitude), lon=num(s.longitudine??s.lon??s.longitude);
    const eff=s.effettiva??s.arrivoEffettivo??s.partenzaEffettiva;
    if(lat!=null&&lon!=null && eff) last={lat,lon,station:s.stazione??s.nomeStazione??'',time:eff};
  }
  return last;
}
function normalize(run,last){
  const b=run.board,a=run.a, i=run.info;
  const p=last||{};
  return {
    id:key(b),number:String(i.numeroTreno??b.numeroTreno),category:b.categoriaDescrizione??b.categoria??a.categoria??'',
    origin:i.descLocOrig??b.origine??a.origine??'',destination:b.destinazione??a.destinazione??'',
    delay:num(b.ritardo??a.ritardo??0)??0,
    lat:p.lat,lon:p.lon,positionLabel:`Ultimo rilevamento reale: ${p.station||'stazione'}`,
    estimated:false
  }
}

async function livePassenger(){
  const boards=(await Promise.all(HUBS.map(getStationBoard))).flat();
  const uniq=new Map();
  for(const t of boards) if(t?.numeroTreno!=null && isCirculating(t)) uniq.set(key(t),t);
  const candidates=[...uniq.values()];
  const out=[];
  const batch=20;
  for(let i=0;i<candidates.length;i+=batch){
    const rs=await Promise.all(candidates.slice(i,i+batch).map(getRun));
    for(const run of rs){
      if(!run) continue;
      const last=extractLast(run);
      if(last) out.push(normalize(run,last));
    }
  }
  return out;
}

async function asset(request,env){return env.ASSETS.fetch(request)}
export default {
 async fetch(request,env){
   const u=new URL(request.url);
   if(u.pathname==='/api/v1/live/passenger'){
     try{
       const trains=await livePassenger();
       return new Response(JSON.stringify({ok:true,count:trains.length,trains,source:'ViaggiaTreno'}),{headers:{'content-type':'application/json','cache-control':'no-store'}});
     }catch(e){
       return new Response(JSON.stringify({ok:false,count:0,trains:[],error:String(e)}),{status:502,headers:{'content-type':'application/json','cache-control':'no-store'}});
     }
   }
   if(u.pathname.startsWith('/api/')) return new Response(JSON.stringify({error:'not found'}),{status:404,headers:{'content-type':'application/json'}});
   return asset(request,env);
 }
}
