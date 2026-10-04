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
  const cod=t.codOrigine;
  const ts=t.dataPartenzaTreno;
  if(!n || !cod || !ts) return null;
  try{
    const a=await vt(`/andamentoTreno/${encodeURIComponent(cod)}/${encodeURIComponent(n)}/${encodeURIComponent(ts)}`);
    if(!a) return null;
    return {a,board:t};
  }catch{return null}
}
async function extractLast(run){
  const a=run.a, f=Array.isArray(a.fermate)?a.fermate:[];
  let last=null;
  for(const st of f){
    const effective = st.effettiva ?? st.partenzaEffettiva ?? st.arrivoEffettivo;
    const id = st.id ?? st.codStazione ?? st.codiceStazione;
    if(effective && id) last={id,station:st.stazione??st.nomeStazione??'',time:effective};
  }
  if(!last) return null;
  try{
    const c=await vt(`/getCoordinateStazione/${encodeURIComponent(last.id)}`);
    const lat=num(c?.latitudine??c?.lat??c?.latitude);
    const lon=num(c?.longitudine??c?.lon??c?.longitude);
    if(lat!=null&&lon!=null) return {...last,lat,lon};
  }catch{}
  return null;
}
function normalize(run,last){
  const b=run.board,a=run.a;
  return {
    id:key(b),
    number:String(b.numeroTreno),
    category:b.categoriaDescrizione??b.categoria??a.categoria??'',
    origin:b.origine??a.origine??'',
    destination:b.destinazione??a.destinazione??'',
    delay:num(b.ritardo??a.ritardo??0)??0,
    lat:last.lat,lon:last.lon,
    positionLabel:`Ultimo rilevamento reale: ${last.station||'stazione'}`,
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
      const last=await extractLast(run);
      if(last) out.push(normalize(run,last));
    }
  }
  return out;
}

async function asset(request,env){return env.ASSETS.fetch(request)}
export default {
 async fetch(request,env){
   const u=new URL(request.url);
   if(u.pathname==='/api/v1/source-status'){
     try{
       const x=await vt(`/statistiche/${Date.now()}`);
       return new Response(JSON.stringify({ok:true,source:'ViaggiaTreno',statistics:x}),{headers:{'content-type':'application/json','cache-control':'no-store'}});
     }catch(e){
       return new Response(JSON.stringify({ok:false,source:'ViaggiaTreno',error:String(e)}),{status:502,headers:{'content-type':'application/json','cache-control':'no-store'}});
     }
   }
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
