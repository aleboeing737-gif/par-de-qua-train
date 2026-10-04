const BACKEND='https://par-de-qua-train-api.onrender.com';

const json=(data,status=200,cache='no-store')=>new Response(JSON.stringify(data,null,2),{
  status,headers:{'content-type':'application/json; charset=utf-8','cache-control':cache,'x-content-type-options':'nosniff','referrer-policy':'same-origin'}
});

function normalizeTrain(d,n){
  const stops=Array.isArray(d?.fermate)?d.fermate:[];
  const lastDone=[...stops].reverse().find(s=>s.effettiva||s.actualFermataType===1||s.partenzaReale||s.arrivoReale);
  const next=stops.find(s=>!s.effettiva&&!s.partenzaReale&&!s.arrivoReale&&s.actualFermataType!==1);
  let category=null;
  if(typeof d?.compNumeroTreno==='string'){
    const m=d.compNumeroTreno.trim().match(/^([A-Za-z]+)\s+\d+/);
    if(m) category=m[1].toUpperCase();
  }
  if(!category&&d?.categoria) category=d.categoria;
  return {
    train_number:String(d?.numeroTreno||n),category:category||'Treno',operator_code:d?.codiceCliente??null,
    origin:d?.origine||d?.origineZero||stops[0]?.stazione||null,
    destination:d?.destinazione||d?.destinazioneZero||stops.at(-1)?.stazione||null,
    circulating:Boolean(d?.circolante),
    delay_minutes:Number.isFinite(Number(d?.ritardo))?Number(d.ritardo):null,
    last_observation:lastDone?{station:lastDone.stazione,time:lastDone.effettiva||lastDone.partenzaReale||lastDone.arrivoReale||null}:
      (d?.stazioneUltimoRilevamento?{station:d.stazioneUltimoRilevamento,time:d.oraUltimoRilevamento||null}:null),
    next_stop:next?{station:next.stazione,scheduled:next.programmata||next.partenza_teorica||next.arrivo_teorico||null}:null,
    position:{status:'estimated',note:'Ultimo rilevamento operativo reale; posizione continua non GPS, da stimare sulla rete ferroviaria.'},
    rolling_stock:{status:d?.materiale_label?'identified':'unknown',label:d?.materiale_label||null,confidence:d?.materiale_label?'provider':'none'},
    stops:stops.map(s=>({station:s.stazione,id:s.id||null,scheduled:s.programmata||null,actual:s.effettiva||null,
      delay:Number.isFinite(Number(s.ritardo))?Number(s.ritardo):null})),
    source:{name:'ViaggiaTreno via Par de Qua Train API',retrieved_at:new Date().toISOString()}
  };
}

async function backend(path){
  const r=await fetch(BACKEND+path,{headers:{accept:'application/json'},redirect:'follow'});
  const text=await r.text(); let data=null;
  try{data=text?JSON.parse(text):null}catch{throw new Error(`Backend HTTP ${r.status}: risposta non JSON`)}
  return {r,data};
}


const OVERPASS_ENDPOINTS=[
 'https://overpass-api.de/api/interpreter',
 'https://overpass.kumi.systems/api/interpreter'
];

async function fetchWithTimeout(url,options={},ms=22000){
 const controller=new AbortController();
 const timer=setTimeout(()=>controller.abort(),ms);
 try{
   return await fetch(url,{...options,signal:controller.signal});
 }finally{clearTimeout(timer);}
}

function overpassToGeoJSON(data){
 const features=[];
 for(const e of (data?.elements||[])){
   if(e.type!=='way'||!Array.isArray(e.geometry)||e.geometry.length<2)continue;
   const coordinates=e.geometry.map(p=>[Number(p.lon),Number(p.lat)]).filter(p=>Number.isFinite(p[0])&&Number.isFinite(p[1]));
   if(coordinates.length<2)continue;
   features.push({type:'Feature',id:e.id,properties:{
     osm_id:e.id,railway:e.tags?.railway||null,usage:e.tags?.usage||null,
     service:e.tags?.service||null,name:e.tags?.name||null,ref:e.tags?.ref||null,
     highspeed:e.tags?.highspeed||null,electrified:e.tags?.electrified||null
   },geometry:{type:'LineString',coordinates}});
 }
 return {type:'FeatureCollection',features};
}

const RAIL_BOXES=[
 [35.25,6.35,39.6,13.8],[35.25,13.8,39.6,18.75],[39.6,6.35,43.0,13.8],
 [39.6,13.8,43.0,18.75],[43.0,6.35,46.0,12.0],[43.0,12.0,46.0,18.75],
 [46.0,6.35,47.25,18.75]
];

async function fetchRailBox(index){
 const box=RAIL_BOXES[index];
 if(!box)throw new Error('Zona ferroviaria non valida');
 const [s,w,n,e]=box;
 // One Overpass query per request: avoids the 6-connection Worker ceiling and
 // respects Overpass guidance against parallel scripts.
 const q=`[out:json][timeout:45];way["railway"="rail"]["usage"~"^(main|branch)$"](${s},${w},${n},${e});out geom;`;
 let last='Overpass non disponibile';
 for(const ep of OVERPASS_ENDPOINTS){
  try{
   const r=await fetchWithTimeout(ep,{method:'POST',headers:{
    'content-type':'application/x-www-form-urlencoded;charset=UTF-8',
    'user-agent':'ParDeQuaTrain/0.6.4 (+https://train.pardequa.cloud)',
    'referer':'https://train.pardequa.cloud/'
   },body:'data='+encodeURIComponent(q)},50000);
   if(!r.ok){last=`HTTP ${r.status}`;continue;}
   const geo=overpassToGeoJSON(await r.json());
   if(geo.features.length)return geo;
   last='nessun segmento';
  }catch(e){last=e?.name==='AbortError'?'timeout':String(e?.message||e)}
 }
 throw new Error(last);
}

async function cachedRailBox(index,cache){
 const key=new Request(new URL(`/_cache/rail/tile/${index}`, 'https://cache.invalid').toString());
 // Cloudflare Cache keys may use arbitrary absolute URLs; host is normalized below
 const hit=await cache.match(key);
 if(hit)return hit;
 const geo=await fetchRailBox(index);
 const response=new Response(JSON.stringify(geo),{headers:{
  'content-type':'application/geo+json; charset=utf-8',
  'cache-control':'public, max-age=604800',
  'x-pdq-source':'OpenStreetMap via Overpass',
  'x-pdq-version':'0.7.1'
 }});
 await cache.put(key,response.clone());
 return response;
}

async function combineCachedRail(cache,origin){
 const features=[]; const seen=new Set();
 for(let i=0;i<RAIL_BOXES.length;i++){
  const key=new Request(new URL(`/_cache/rail/tile/${i}`, origin).toString());
  const r=await cache.match(key); if(!r)continue;
  try{
   const g=await r.json();
   for(const f of (g.features||[])){
    const id=String(f.id??f.properties?.osm_id??'');
    if(id&&seen.has(id))continue; if(id)seen.add(id); features.push(f);
   }
  }catch{}
 }
 return {type:'FeatureCollection',features};
}


const VT_BASES=[
 'https://www.viaggiatreno.it/infomobilita/resteasy/viaggiatreno',
 'https://www.viaggiatreno.it/viaggiatrenonew/resteasy/viaggiatreno'
];

async function vtRaw(path,ms=10000){
 let last=null;
 for(const base of VT_BASES){
  try{
   const r=await fetchWithTimeout(base+path,{headers:{
    accept:'application/json,text/plain,*/*',
    'user-agent':'ParDeQuaTrain/0.7.1 (+https://train.pardequa.cloud)'
   }},ms);
   if(!r.ok)throw new Error('VT HTTP '+r.status);
   return await r.json();
  }catch(e){last=e}
 }
 throw last||new Error('ViaggiaTreno unavailable');
}

function findTrainNumbers(value,out=new Set()){
 if(value==null)return out;
 if(Array.isArray(value)){for(const x of value)findTrainNumbers(x,out);return out}
 if(typeof value!=='object')return out;
 const n=value.numeroTreno??value.numTreno??value.codTreno??value.numero;
 if(n!=null && /^\d{1,6}$/.test(String(n)))out.add(String(n));
 for(const v of Object.values(value)) {
  if(v && typeof v==='object')findTrainNumbers(v,out);
 }
 return out;
}

/*
 * ViaggiaTreno's map endpoints are undocumented reverse-engineered interfaces.
 * elencoTratte gives the current rail segments; dettagliTratta gives the
 * trains associated with a segment. This is used as a second discovery path,
 * rather than relying only on the 15 large stations.
 */

function vtNowString(){
  // ViaggiaTreno accepts the browser-style local date/time string.
  return new Date().toString();
}

async function discoverFromHubsLive(){
 const stations=[
  'S01700','S05000','S02593','S02579','S02400','S05043','S06419','S08409',
  'S09218','S11109','S04521','S07100','S12009','S12307','S12800'
 ];
 const now=vtNowString();
 const lists=await mapLimit(stations,5,async id=>{
   try{
     const rows=await vtRaw('/partenze/'+encodeURIComponent(id)+'/'+encodeURIComponent(now),9000);
     return Array.isArray(rows)?rows:[];
   }catch{return []}
 });
 const all=lists.flat();
 const byKey=new Map();
 for(const row of all){
   const n=String(row?.numeroTreno??row?.numTreno??'').trim();
   if(!/^\d{1,6}$/.test(n))continue;
   // Keep the richest row for each train number.
   const old=byKey.get(n);
   if(!old || Object.keys(row||{}).length>Object.keys(old||{}).length)byKey.set(n,row);
 }
 return [...byKey.entries()].slice(0,180).map(([number,row])=>({number,row}));
}

async function resolveTrainExact(number){
  try{
    const info=await vtRaw('/cercaNumeroTreno/'+encodeURIComponent(number),8000);
    if(!info?.codLocOrig || !info?.millisDataPartenza)return null;
    const run=await vtRaw('/andamentoTreno/'+encodeURIComponent(info.codLocOrig)+'/'+encodeURIComponent(number)+'/'+encodeURIComponent(info.millisDataPartenza),9000);
    if(!run || typeof run!=='object')return null;
    return normalizeTrain(run,number);
  }catch{return null}
}

async function livePassengerSnapshot(){
 const discovered=await discoverFromHubsLive();
 // First resolve a limited number so the page stays responsive.
 const trains=(await mapLimit(discovered.slice(0,100),8,async x=>{
   const t=await resolveTrainExact(x.number);
   return t&&t.circulating?t:null;
 })).filter(Boolean);
 return {
  status:'live-hub-departures',
  position_model:'estimated_between_real_observations',
  generated_at:new Date().toISOString(),
  discovered:discovered.length,
  trains_count:trains.length,
  trains
 };
}

async function fetchDiscoveredTrain(n){
 try{
  const {r,data}=await backend(`/train/${encodeURIComponent(n)}`);
  if(!r.ok||!data?.train)return null;
  const t=normalizeTrain(data.train,n);
  if(!t.circulating)return null;
  return t;
 }catch{return null}
}

async function mapLimit(items,limit,fn){
 const out=new Array(items.length); let i=0;
 async function workerFn(){
  while(true){
   const k=i++;
   if(k>=items.length)return;
   out[k]=await fn(items[k]);
  }
 }
 await Promise.all(Array.from({length:Math.min(limit,items.length)},workerFn));
 return out;
}

async function livePassengerSnapshot(){
 let numbers=await discoverPassengerNumbers();
 // Always keep a robust fallback: departures from the main hubs are live provider data.
 // The map-discovery endpoint can temporarily return an empty set.
 if(numbers.length===0){
   numbers=await discoverFromHubs();
 }
 const trains=(await mapLimit(numbers,16,fetchDiscoveredTrain)).filter(Boolean);
 return {
  status:'map-discovery-beta',
  position_model:'estimated_between_real_observations',
  generated_at:new Date().toISOString(),
  discovered:numbers.length,
  trains_count:trains.length,
  trains
 };
}

export default {
 async fetch(request,env){
  const url=new URL(request.url);
  if(url.pathname.startsWith('/api/')){
   if(request.method!=='GET') return json({error:'Method not allowed'},405);
   if(url.pathname==='/api/v1/health'){
    try{const {r,data}=await backend('/health');return json({service:'Par de Qua Train',version:'0.7.1',backend:r.ok?'online':'error',backend_status:r.status,upstream:data},r.ok?200:502)}
    catch(e){return json({service:'Par de Qua Train',version:'0.7.1',backend:'offline',error:String(e)},502)}
   }
   if(url.pathname==='/api/v1/rail/italy-main'){
    const cache=await caches.open('pdq-rail-v070');
    const geo=await combineCachedRail(cache,url.origin);
    if(!geo.features.length)return json({error:'Rete non ancora disponibile: caricare le zone ferroviarie'},503);
    return new Response(JSON.stringify(geo),{headers:{'content-type':'application/geo+json; charset=utf-8','cache-control':'public, max-age=60','x-pdq-version':'0.7.1'}});
   }
   const tileMatch=url.pathname.match(/^\/api\/v1\/rail\/tile\/(\d+)$/);
   if(tileMatch){
    const index=Number(tileMatch[1]);
    if(!Number.isInteger(index)||index<0||index>=RAIL_BOXES.length)return json({error:'Zona non valida'},400);
    const cache=await caches.open('pdq-rail-v070');
    const key=new Request(new URL(`/_cache/rail/tile/${index}`,url.origin).toString());
    const hit=await cache.match(key);
    if(hit)return new Response(hit.body,hit);
    try{
      const geo=await fetchRailBox(index);
      const response=new Response(JSON.stringify(geo),{headers:{'content-type':'application/geo+json; charset=utf-8','cache-control':'public, max-age=604800','x-pdq-source':'OpenStreetMap via Overpass','x-pdq-version':'0.7.1'} });
      await cache.put(key,response.clone());
      return response;
    }catch(e){return json({error:`Zona ${index+1}: ${e?.message||'Overpass non disponibile'}`},502)}
   }
   if(url.pathname==='/api/v1/live/passenger'){
    try{
      const cache=await caches.open('pdq-live-passenger-v070');
      const key=new Request(new URL('/_cache/live/passenger',url.origin).toString());
      const hit=await cache.match(key); if(hit)return hit;
      const snapshot=await livePassengerSnapshot();
      const response=json(snapshot,200,'public, max-age=60');
      await cache.put(key,response.clone());
      return response;
    }catch(e){return json({error:'Snapshot treni passeggeri non disponibile',detail:String(e)},502)}
   }
   const tm=url.pathname.match(/^\/api\/v1\/trains\/(\d{1,6})$/);
   if(tm){
    try{
     const n=tm[1],{r,data}=await backend(`/train/${encodeURIComponent(n)}`);
     if(!r.ok)return json({error:'Treno non trovato oppure provider temporaneamente non disponibile',train_number:n,backend_status:r.status},r.status===404?404:502);
     if(!data?.train||typeof data.train!=='object')return json({error:'Risposta ferroviaria non valida',train_number:n},502);
     return json(normalizeTrain(data.train,n),200,'public, max-age=15');
    }catch(e){return json({error:'Backend ferroviario non raggiungibile',detail:String(e)},502)}
   }
   return json({error:'Not found'},404);
  }
  const response=await env.ASSETS.fetch(request),h=new Headers(response.headers);
  h.set('X-Frame-Options','DENY');h.set('X-Content-Type-Options','nosniff');h.set('Referrer-Policy','same-origin');
  h.set('Permissions-Policy','geolocation=(), camera=(), microphone=()');
  h.set('Content-Security-Policy',"default-src 'self'; script-src 'self' https://unpkg.com; style-src 'self' 'unsafe-inline' https://unpkg.com; img-src 'self' data: blob: https://tiles.openfreemap.org https://tiles.openrailwaymap.org; connect-src 'self' https://tiles.openfreemap.org https://tiles.openrailwaymap.org; worker-src blob:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
  return new Response(response.body,{status:response.status,statusText:response.statusText,headers:h});
 }
};