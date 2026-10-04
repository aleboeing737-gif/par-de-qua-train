const BACKEND='https://par-de-qua-train-api.onrender.com';
const VT_BASES=[
  'https://www.viaggiatreno.it/infomobilita/resteasy/viaggiatreno',
  'https://www.viaggiatreno.it/viaggiatrenonew/resteasy/viaggiatreno'
];

const json=(data,status=200,cache='no-store')=>new Response(JSON.stringify(data),{
  status,
  headers:{
    'content-type':'application/json; charset=utf-8',
    'cache-control':cache,
    'x-content-type-options':'nosniff'
  }
});

async function fetchTimeout(url,options={},ms=10000){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),ms);
  try{return await fetch(url,{...options,signal:controller.signal})}
  finally{clearTimeout(timer)}
}

async function backend(path){
  const r=await fetchTimeout(BACKEND+path,{headers:{accept:'application/json'}},12000);
  const text=await r.text();
  let data=null;
  try{data=text?JSON.parse(text):null}catch{}
  return {r,data};
}

async function vt(path,ms=10000){
  let last=null;
  for(const base of VT_BASES){
    try{
      const r=await fetchTimeout(base+path,{
        headers:{
          accept:'application/json,text/plain,*/*',
          'user-agent':'ParDeQuaTrain/0.7.2 (+https://train.pardequa.cloud)'
        }
      },ms);
      if(!r.ok)throw new Error(`ViaggiaTreno HTTP ${r.status}`);
      return await r.json();
    }catch(e){last=e}
  }
  throw last||new Error('ViaggiaTreno non disponibile');
}

function mapLimit(items,limit,fn){
  const out=new Array(items.length);let next=0;
  async function worker(){
    while(true){
      const i=next++;
      if(i>=items.length)return;
      try{out[i]=await fn(items[i])}catch{out[i]=null}
    }
  }
  return Promise.all(Array.from({length:Math.min(limit,items.length)},worker)).then(()=>out);
}

function normalizeTrain(d,n){
  const stops=Array.isArray(d?.fermate)?d.fermate:[];
  const last=[...stops].reverse().find(s=>s?.effettiva||s?.actualFermataType===1||s?.partenzaReale||s?.arrivoReale);
  const next=stops.find(s=>!s?.effettiva&&!s?.partenzaReale&&!s?.arrivoReale&&s?.actualFermataType!==1);
  let category=d?.categoria||null;
  if(!category&&typeof d?.compNumeroTreno==='string'){
    const m=d.compNumeroTreno.trim().match(/^([A-Za-z]+)\s+\d+/);
    if(m)category=m[1].toUpperCase();
  }
  return {
    train_number:String(d?.numeroTreno||n),
    category:category||'Treno',
    operator_code:d?.codiceCliente??null,
    origin:d?.origine||d?.origineZero||stops[0]?.stazione||null,
    destination:d?.destinazione||d?.destinazioneZero||stops.at(-1)?.stazione||null,
    circulating:Boolean(d?.circolante),
    delay_minutes:Number.isFinite(Number(d?.ritardo))?Number(d.ritardo):null,
    last_observation:last?{
      station:last.stazione,
      time:last.effettiva||last.partenzaReale||last.arrivoReale||null
    }:(d?.stazioneUltimoRilevamento?{
      station:d.stazioneUltimoRilevamento,
      time:d.oraUltimoRilevamento||null
    }:null),
    next_stop:next?{
      station:next.stazione,
      scheduled:next.programmata||next.partenza_teorica||next.arrivo_teorico||null
    }:null,
    position:{status:'estimated_station_based',note:'Ultimo rilevamento operativo reale; nessun GPS inventato.'},
    rolling_stock:{
      status:d?.materiale_label?'identified':'unknown',
      label:d?.materiale_label||null,
      confidence:d?.materiale_label?'provider':'none'
    },
    stops:stops.map(s=>({
      station:s?.stazione||null,
      scheduled:s?.programmata||null,
      actual:s?.effettiva||null,
      delay:Number.isFinite(Number(s?.ritardo))?Number(s.ritardo):null
    })),
    source:{name:'ViaggiaTreno',retrieved_at:new Date().toISOString()}
  };
}

async function resolveTrain(number){
  try{
    const info=await vt('/cercaNumeroTreno/'+encodeURIComponent(number),9000);
    if(!info?.codLocOrig||!info?.millisDataPartenza)return null;
    const run=await vt(
      '/andamentoTreno/'+encodeURIComponent(info.codLocOrig)+'/'+encodeURIComponent(number)+'/'+encodeURIComponent(info.millisDataPartenza),
      10000
    );
    if(!run||typeof run!=='object')return null;
    return normalizeTrain(run,number);
  }catch{return null}
}

function nowString(){return new Date().toString()}

async function discoverFromHubs(){
  const stationIds=[
    'S01700','S05000','S02593','S02579','S02400','S05043','S06419','S08409',
    'S09218','S11109','S04521','S07100','S12009','S12307','S12800'
  ];
  const lists=await mapLimit(stationIds,5,async id=>{
    try{
      const rows=await vt('/partenze/'+encodeURIComponent(id)+'/'+encodeURIComponent(nowString()),9000);
      return Array.isArray(rows)?rows:[];
    }catch{return []}
  });
  const numbers=new Set();
  for(const rows of lists){
    for(const row of rows){
      const n=String(row?.numeroTreno??row?.numTreno??'').trim();
      if(/^\d{1,6}$/.test(n))numbers.add(n);
    }
  }
  return [...numbers].slice(0,120);
}

async function livePassengerSnapshot(){
  const numbers=await discoverFromHubs();
  const trains=(await mapLimit(numbers,10,resolveTrain))
    .filter(t=>t&&t.circulating);
  return {
    status:'live',
    position_model:'last_real_observation_station',
    generated_at:new Date().toISOString(),
    discovered:numbers.length,
    trains_count:trains.length,
    trains
  };
}

async function api(request,url){
  if(url.pathname==='/api/v1/health'){
    try{
      const {r,data}=await backend('/health');
      return json({
        service:'Par de Qua Train',
        version:'0.7.2',
        backend:r.ok?'online':'error',
        backend_status:r.status,
        upstream:data
      },r.ok?200:502);
    }catch(e){
      return json({service:'Par de Qua Train',version:'0.7.2',backend:'offline',error:String(e)},502);
    }
  }

  if(url.pathname==='/api/v1/live/passenger'){
    try{
      const snapshot=await livePassengerSnapshot();
      return json(snapshot,200,'no-store');
    }catch(e){
      return json({
        error:'Snapshot treni passeggeri non disponibile',
        detail:String(e)
      },502);
    }
  }

  const match=url.pathname.match(/^\/api\/v1\/trains\/(\d{1,6})$/);
  if(match){
    const n=match[1];
    const train=await resolveTrain(n);
    if(train)return json(train,200,'public, max-age=10');
    try{
      const {r,data}=await backend('/train/'+encodeURIComponent(n));
      if(r.ok&&data?.train)return json(normalizeTrain(data.train,n),200,'public, max-age=10');
      return json({error:'Treno non trovato oppure provider temporaneamente non disponibile',train_number:n},r.status===404?404:502);
    }catch(e){
      return json({error:'Treno non disponibile',train_number:n,detail:String(e)},502);
    }
  }

  return json({error:'Not found'},404);
}

export default {
  async fetch(request,env){
    const url=new URL(request.url);
    if(url.pathname.startsWith('/api/')){
      if(request.method!=='GET')return json({error:'Method not allowed'},405);
      return api(request,url);
    }

    const response=await env.ASSETS.fetch(request);
    const headers=new Headers(response.headers);
    headers.set('X-Frame-Options','DENY');
    headers.set('X-Content-Type-Options','nosniff');
    headers.set('Referrer-Policy','strict-origin-when-cross-origin');
    headers.set('Permissions-Policy','geolocation=(),camera=(),microphone=()');
    return new Response(response.body,{
      status:response.status,
      statusText:response.statusText,
      headers
    });
  }
};
