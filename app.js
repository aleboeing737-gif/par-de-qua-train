const API='/api/v1',result=document.querySelector('#result');
const map=new maplibregl.Map({
 container:'map',
 style:'https://tiles.openfreemap.org/styles/fiord',
 center:[12.5,42.2],
 zoom:5.35,
 minZoom:4.5,
 maxZoom:17,
 attributionControl:true
});
map.addControl(new maplibregl.NavigationControl({showCompass:false}),'top-left');

/* v0.7.1 — REAL OSM RAIL NETWORK VIA OPENFREEMAP VECTOR TILES.
   No Overpass request is made when the page opens. The railway geometry is
   read directly from the OpenFreeMap/OpenMapTiles vector source, which is
   derived from OpenStreetMap. This keeps the map fast while retaining real
   railway geometry. */
map.on('load',async()=>{
 const layers=map.getStyle().layers||[];
 for(const layer of layers){
   const id=(layer.id||'').toLowerCase(),src=(layer['source-layer']||'').toLowerCase();
   const isLabel=layer.type==='symbol';
   const road=/road|street|highway|motorway|trunk|primary|secondary|tertiary|minor|service|path|transportation/.test(id+' '+src);
   const poi=/poi|building|house|shop|amenity|parking|airport|aeroway|transit/.test(id+' '+src);
   if(isLabel||road||poi){try{map.setLayoutProperty(layer.id,'visibility','none')}catch(_){} }
   if(id==='railway'){try{map.setLayoutProperty(layer.id,'visibility','none')}catch(_){} }
 }

 // The source already exists in the OpenFreeMap style.
 map.addLayer({id:'pdq-real-rail-main',type:'line',source:'openmaptiles',
   'source-layer':'transportation',minzoom:4,
   layout:{'line-cap':'round','line-join':'round','visibility':'visible'},
   paint:{'line-color':'#4fc3ff','line-opacity':0.95,
   'line-width':['interpolate',['linear'],['zoom'],4,1.8,6,2.4,8,3.1,11,4.2,14,5.0]},
   filter:['all',['==','class','rail'],['!=','service','yard'],['!=','service','spur']]});

 const cities={type:'FeatureCollection',features:[
  ['Torino',7.6869,45.0703],['Milano',9.1900,45.4642],['Genova',8.9463,44.4056],
  ['Verona',10.9916,45.4384],['Venezia',12.3155,45.4408],['Bologna',11.3426,44.4949],
  ['Firenze',11.2558,43.7696],['Ancona',13.5189,43.6158],['Roma',12.4964,41.9028],
  ['Napoli',14.2681,40.8518],['Bari',16.8719,41.1171],['Lecce',18.1718,40.3515],
  ['Reggio Calabria',15.6500,38.1113],['Palermo',13.3615,38.1157],['Catania',15.0873,37.5027],
  ['Messina',15.5540,38.1938],['Cagliari',9.1217,39.2238]
 ].map(c=>({type:'Feature',properties:{name:c[0]},geometry:{type:'Point',coordinates:[c[1],c[2]]}}))};
 map.addSource('pdq-cities',{type:'geojson',data:cities});
 map.addLayer({id:'pdq-city-labels',type:'symbol',source:'pdq-cities',
   layout:{'text-field':['get','name'],'text-size':['interpolate',['linear'],['zoom'],4.5,11,8,14],
   'text-allow-overlap':false,'text-padding':7},
   paint:{'text-color':'#e8f3fa','text-halo-color':'#071522','text-halo-width':1.6}});

 const badge=document.querySelector('.mapBadge');
 const refreshRailGeometry=()=>{
   try{
     const fs=map.queryRenderedFeatures({layers:['pdq-real-rail-main']});
     const out=[],seen=new Set();
     for(const f of fs){
       const g=f?.geometry;
       if(!g || !['LineString','MultiLineString'].includes(g.type))continue;
       const id=String(f.id??f.properties?.osm_id??JSON.stringify(g.coordinates).slice(0,120));
       if(seen.has(id))continue; seen.add(id);
       if(g.type==='LineString') out.push({type:'Feature',id,properties:f.properties||{},geometry:g});
       else for(const c of g.coordinates) out.push({type:'Feature',id:id+'-'+out.length,properties:f.properties||{},geometry:{type:'LineString',coordinates:c}});
     }
     window.PDQ_RAIL_GEO={type:'FeatureCollection',features:out};
     badge.innerHTML=`🚆 <b>Rete OSM reale</b> · OpenFreeMap · ${out.length} segmenti visibili`;
   }catch(e){console.warn('Rail geometry refresh failed',e)}
 };
 refreshRailGeometry();
 map.on('moveend',refreshRailGeometry);
 map.on('zoomend',refreshRailGeometry);
});

/* v0.7.1 — LIVE PASSENGER TRAINS BETA
   I marker NON sono GPS. Sono collocati sull'ultima stazione/rilevamento
   disponibile dal provider, con provenienza esplicita. */
const PDQ_HUBS=[
 ['MILANO CENTRALE',9.2044,45.4859],['TORINO PORTA NUOVA',7.6676,45.0722],
 ['VENEZIA SANTA LUCIA',12.3210,45.4410],['VENEZIA MESTRE',12.2319,45.4824],
 ['VERONA PORTA NUOVA',10.9825,45.4298],['BOLOGNA CENTRALE',11.3417,44.5058],
 ['FIRENZE SANTA MARIA NOVELLA',11.2478,43.7766],['ROMA TERMINI',12.5018,41.9010],
 ['NAPOLI CENTRALE',14.2720,40.8520],['BARI CENTRALE',16.8703,41.1171],
 ['GENOVA PIAZZA PRINCIPE',8.9200,44.4160],['ANCONA',13.4975,43.6077],
 ['PALERMO CENTRALE',13.3676,38.1097],['CATANIA CENTRALE',15.0992,37.5062],
 ['CAGLIARI',9.1106,39.2174]
];
const PDQ_STATION_COORDS=Object.fromEntries(PDQ_HUBS.map(x=>[x[0],[x[1],x[2]]]));
let liveTrainTimer=null,liveTrainMotionTimer=null,liveTrainBusy=false,lastLiveSnapshot=null;

function normalizeStationName(s){
 return String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase()
  .replace(/\bC\.LE\b/g,'CENTRALE').replace(/\bS\. ?LUCIA\b/g,'SANTA LUCIA')
  .replace(/\bS\. ?M\. ?NOVELLA\b/g,'SANTA MARIA NOVELLA').trim();
}

// v0.6.1 — free estimated positioning.
// We interpolate only when both last and next stop coordinates are known,
// then snap the calculated point to the REAL OSM railway geometry already loaded.
const PDQ_EXTRA_STATION_COORDS={
 'ROMA TIBURTINA':[12.5308,41.9102],'MILANO ROGOREDO':[9.2380,45.4339],
 'FIRENZE SANTA MARIA NOVELLA':[11.2478,43.7766],'FIRENZE CAMPO MARTE':[11.2766,43.7779],
 'PADOVA':[11.8797,45.4161],'VICENZA':[11.5458,45.5475],'TREVISO CENTRALE':[12.2452,45.6590],
 'TRIESTE CENTRALE':[13.7714,45.6577],'UDINE':[13.2423,46.0630],
 'BRESCIA':[10.2120,45.5416],'BERGAMO':[9.6750,45.6913],
 'PARMA':[10.3280,44.8094],'MODENA':[10.9260,44.6539],'REGGIO EMILIA':[10.6430,44.6980],
 'PIACENZA':[9.6997,45.0524],'RIMINI':[12.5665,44.0631],'PESARO':[12.9042,43.9065],
 'PESCARA CENTRALE':[14.2050,42.4642],'FOGGIA':[15.5446,41.4622],
 'SALERNO':[14.7727,40.6753],'CASERTA':[14.3273,41.0728],
 'REGGIO CALABRIA CENTRALE':[15.6358,38.1035],'MESSINA CENTRALE':[15.5558,38.1870],
 'SIRACUSA':[15.2866,37.0688],'PALERMO CENTRALE':[13.3664,38.1090],
 'CATANIA CENTRALE':[15.1031,37.5062],'CAGLIARI':[9.1097,39.2168],
 'SASSARI':[8.5603,40.7267],'LA SPEZIA CENTRALE':[9.8235,44.1112],
 'PISA CENTRALE':[10.4018,43.7085],'LIVORNO CENTRALE':[10.3340,43.5543],
 'PERUGIA':[12.3660,43.1040],'TERNI':[12.6512,42.5600]
};
Object.assign(PDQ_STATION_COORDS,PDQ_EXTRA_STATION_COORDS);

function pdqCoordForStation(name){
 return PDQ_STATION_COORDS[normalizeStationName(name)]||null;
}
function pdqProgress(t){
 const a=Number(t?.last_observation?.time), b=Number(t?.next_stop?.scheduled);
 if(!Number.isFinite(a)||!Number.isFinite(b)||b<=a)return null;
 // next scheduled time is adjusted by current delay when available
 const delay=(Number(t.delay_minutes)||0)*60000;
 const target=b+delay;
 const den=target-a;
 if(den<=0)return null;
 return Math.max(0,Math.min(.97,(Date.now()-a)/den));
}
function pdqNearestRailPoint(point,maxSegments=14000){
 const geo=window.PDQ_RAIL_GEO;
 if(!geo?.features?.length)return point;
 const [px,py]=point; let best=point,bestD=Infinity,count=0;
 // local equirectangular approximation is enough for visual snapping
 const cos=Math.cos(py*Math.PI/180);
 function test(a,b){
   const ax=(a[0]-px)*cos, ay=a[1]-py, bx=(b[0]-px)*cos, by=b[1]-py;
   const dx=bx-ax,dy=by-ay, den=dx*dx+dy*dy;
   let u=den?-(ax*dx+ay*dy)/den:0; u=Math.max(0,Math.min(1,u));
   const x=ax+u*dx,y=ay+u*dy,d=x*x+y*y;
   if(d<bestD){bestD=d;best=[a[0]+u*(b[0]-a[0]),a[1]+u*(b[1]-a[1])];}
 }
 for(const f of geo.features){
   const c=f?.geometry?.coordinates;if(!Array.isArray(c))continue;
   for(let i=1;i<c.length;i++){test(c[i-1],c[i]);if(++count>=maxSegments)return best;}
 }
 return best;
}
function pdqEstimatedPosition(t){
 const a=pdqCoordForStation(t.last_observation?.station), b=pdqCoordForStation(t.next_stop?.station);
 const p=pdqProgress(t);
 if(!a||!b||p==null)return null;
 const raw=[a[0]+(b[0]-a[0])*p,a[1]+(b[1]-a[1])*p];
 return {coordinates:pdqNearestRailPoint(raw),progress:p};
}

function liveTrainGeo(data){
 const features=[];
 for(const t of (data?.trains||[])){
   const estimate=pdqEstimatedPosition(t);
   const key=normalizeStationName(t.last_observation?.station||t.station);
   const fallback=PDQ_STATION_COORDS[key]||t.position?.coordinates;
   const p=estimate?.coordinates||fallback;
   if(!Array.isArray(p)||p.length!==2)continue;
   features.push({type:'Feature',properties:{
     train_number:String(t.train_number||''),category:t.category||'Treno',
     origin:t.origin||'',destination:t.destination||'',
     delay_minutes:t.delay_minutes??null,station:t.last_observation?.station||t.station||'',
     next_station:t.next_stop?.station||'',
     provenance:estimate?'estimated_on_rail':'observed_station',
     progress:estimate?Math.round(estimate.progress*100):null
   },geometry:{type:'Point',coordinates:p}});
 }
 return {type:'FeatureCollection',features};
}
async function refreshLiveTrains(){
 if(liveTrainBusy||!map.getSource('pdq-live-trains'))return;
 liveTrainBusy=true;
 try{
   const r=await fetch('/api/v1/live/passenger',{headers:{Accept:'application/json'}});
   const d=await r.json();
   if(!r.ok)throw new Error(d?.error||'Treni live non disponibili');
   lastLiveSnapshot=d;
   map.getSource('pdq-live-trains').setData(liveTrainGeo(d));
   const badge=document.querySelector('.liveBadge');
   if(badge)badge.innerHTML=`🚆 <b>${d.trains?.length||0} treni attivi</b> · dati reali ViaggiaTreno · ${new Date().toLocaleTimeString('it-IT',{hour:'2-digit',minute:'2-digit'})}`;
   console.log('[PDQ] live snapshot',d);
 }catch(e){console.warn('live trains:',e)}
 finally{liveTrainBusy=false}
}
map.on('load',()=>{
 map.addSource('pdq-live-trains',{type:'geojson',data:{type:'FeatureCollection',features:[]}});
 map.addLayer({id:'pdq-live-train-halo',type:'circle',source:'pdq-live-trains',
  paint:{'circle-radius':['interpolate',['linear'],['zoom'],5,6,10,9],
   'circle-color':'#071522','circle-opacity':0.92}});
 map.addLayer({id:'pdq-live-trains',type:'circle',source:'pdq-live-trains',
  paint:{'circle-radius':['interpolate',['linear'],['zoom'],4.5,6,5,7,7,8.5,10,10],
   'circle-color':['case',['>', ['coalesce',['get','delay_minutes'],0],5],'#ffb347','#68d5ff'],
   'circle-stroke-width':1.2,'circle-stroke-color':'#eaf9ff'}});
 map.on('mouseenter','pdq-live-trains',()=>map.getCanvas().style.cursor='pointer');
 map.on('mouseleave','pdq-live-trains',()=>map.getCanvas().style.cursor='');
 map.on('click','pdq-live-trains',e=>{
   const f=e.features?.[0];if(!f)return;
   const p=f.properties||{},delay=p.delay_minutes==null?'n/d':`${Number(p.delay_minutes)>=0?'+':''}${p.delay_minutes} min`;
   const popup=new maplibregl.Popup({offset:14,maxWidth:'330px'}).setLngLat(f.geometry.coordinates)
    .setHTML(`<div class="pdq-popup-inner"><b>${esc(p.category)} ${esc(p.train_number)}</b><br>${esc(p.origin||'n/d')} → ${esc(p.destination||'n/d')}<br>Ritardo: ${esc(delay)}<br>Ultimo rilevamento: ${esc(p.station||'n/d')}<br><small>📍 ${esc(p.provenance==='estimated_on_rail'?'Posizione stimata sulla rete ferroviaria':'Ultimo rilevamento reale')}</small>${p.next_station?`<br><small>Prossima fermata: ${esc(p.next_station)}${p.progress?` · avanzamento ~${esc(p.progress)}%`:''}</small>`:''}</div>`)
    .addTo(map);
   const el=popup.getElement();
   el.classList.add('pdq-train-popup');
   const content=el.querySelector('.maplibregl-popup-content');
   if(content){
     content.style.setProperty('background','#071522','important');
     content.style.setProperty('color','#f2fbff','important');
     content.style.setProperty('border','1px solid rgba(104,213,255,.65)','important');
     content.style.setProperty('border-radius','12px','important');
   }
   const close=el.querySelector('.maplibregl-popup-close-button');
   if(close) close.style.setProperty('color','#f2fbff','important');
 });
 refreshLiveTrains();
 liveTrainTimer=setInterval(refreshLiveTrains,60000);
 liveTrainMotionTimer=setInterval(()=>{
   if(lastLiveSnapshot&&map.getSource('pdq-live-trains'))
     map.getSource('pdq-live-trains').setData(liveTrainGeo(lastLiveSnapshot));
 },10000);
});

const coords={
'LECCE':[18.1682,40.3515],'BRINDISI':[17.9467,40.6383],'BARI':[16.8703,41.1171],'BARLETTA':[16.2801,41.3156],
'FOGGIA':[15.5446,41.4622],'BENEVENTO':[14.7784,41.1307],'CASERTA':[14.3273,41.0728],'ROMA':[12.5018,41.9010],
'NAPOLI':[14.2720,40.8520],'SALERNO':[14.7727,40.6753],'FIRENZE':[11.2478,43.7766],'BOLOGNA':[11.3417,44.5058],
'VENEZIA':[12.3210,45.4410],'PADOVA':[11.8800,45.4160],'VERONA':[10.9825,45.4298],'MILANO':[9.2044,45.4859],
'TORINO':[7.6676,45.0722],'GENOVA':[8.9200,44.4160],'ANCONA':[13.4975,43.6077],'REGGIO CALABRIA':[15.6358,38.1035]
};
let marker=null;
function esc(s){return String(s??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))}
function stationKey(s){let x=String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().trim();const aliases={'ROMA TERMINI':'ROMA','BARI CENTRALE':'BARI','VENEZIA S. LUCIA':'VENEZIA','VENEZIA SANTA LUCIA':'VENEZIA','MILANO CENTRALE':'MILANO','NAPOLI CENTRALE':'NAPOLI','BOLOGNA CENTRALE':'BOLOGNA','FIRENZE S. M. NOVELLA':'FIRENZE'};return aliases[x]||x}
function showOnMap(d){
 if(marker){marker.remove();marker=null}
 const k=stationKey(d.last_observation?.station),p=coords[k]; if(!p)return;
 const node=document.createElement('div');node.className='train-map-marker';node.textContent='🚆';
 marker=new maplibregl.Marker({element:node,anchor:'center'}).setLngLat(p)
  .setPopup(new maplibregl.Popup({offset:24}).setHTML(`<b>${esc(d.category)} ${esc(d.train_number)}</b><br>Ultimo rilevamento: ${esc(d.last_observation.station)}`))
  .addTo(map);
 marker.togglePopup();
 map.flyTo({center:p,zoom:9,duration:1100});
}
async function searchTrain(){
 const n=document.querySelector('#search').value.trim();
 if(!/^\d{1,6}$/.test(n)){result.innerHTML='<p class="error">Inserisci un numero treno valido.</p>';return}
 result.innerHTML='<div class="empty"><span>⌛</span><b>Interrogo la circolazione…</b></div>';
 try{
  const r=await fetch(`${API}/trains/${encodeURIComponent(n)}`,{headers:{Accept:'application/json'}}),d=await r.json();
  if(!r.ok)throw new Error(d?.error||'Servizio non disponibile');
  showOnMap(d);
  const delay=d.delay_minutes==null?'n/d':`${d.delay_minutes>=0?'+':''}${d.delay_minutes} min`;
  const rs=d.rolling_stock?.status==='unknown'?'Non identificato':d.rolling_stock?.label||'Identificato';
  result.innerHTML=`<div class="trainCard"><div class="trainTop"><h3>${esc(d.category)} ${esc(d.train_number)}</h3><span class="delay">${esc(delay)}</span></div>
  <div class="route">${esc(d.origin||'n/d')} <span>→</span> ${esc(d.destination||'n/d')}</div>
  <div class="dataGrid"><div class="dataBox"><small>Ultimo rilevamento</small><b>${esc(d.last_observation?.station||'n/d')}</b></div><div class="dataBox"><small>Prossima fermata</small><b>${esc(d.next_stop?.station||'n/d')}</b></div><div class="dataBox"><small>Materiale</small><b>${esc(rs)}</b></div><div class="dataBox"><small>Stato</small><b>${d.circulating?'In circolazione':'Non circolante'}</b></div></div>
  <div class="provenance">📡 <b>ULTIMO RILEVAMENTO</b><br>Il marker indica la stazione dell'ultimo rilevamento fornito dalla fonte. Non è una posizione GPS.</div>
  <details><summary>Dettagli tecnici</summary><pre>${esc(JSON.stringify(d,null,2))}</pre></details></div>`;
 }catch(e){result.innerHTML=`<p class="error">${esc(e.message)}</p><p class="muted">Il treno può non essere in servizio oppure il provider può essere temporaneamente irraggiungibile.</p>`}
}
document.querySelector('#search').addEventListener('keydown',e=>{if(e.key==='Enter')searchTrain()});
document.querySelector('#searchBtn').addEventListener('click',searchTrain);
