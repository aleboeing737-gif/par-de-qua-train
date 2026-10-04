const API='/api/v1';
const result=document.querySelector('#result');

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

const CITY_POINTS=[
 ['Torino',7.6869,45.0703],['Milano',9.1900,45.4642],['Genova',8.9463,44.4056],
 ['Verona',10.9916,45.4384],['Venezia',12.3155,45.4408],['Bologna',11.3426,44.4949],
 ['Firenze',11.2558,43.7696],['Ancona',13.5189,43.6158],['Roma',12.4964,41.9028],
 ['Napoli',14.2681,40.8518],['Bari',16.8719,41.1171],['Lecce',18.1718,40.3515],
 ['Reggio Calabria',15.6500,38.1113],['Palermo',13.3615,38.1157],
 ['Catania',15.0873,37.5027],['Messina',15.5540,38.1938],['Cagliari',9.1217,39.2238]
];

const STATIONS={
 'TORINO':[7.6676,45.0722],'MILANO':[9.2044,45.4859],'GENOVA':[8.9200,44.4160],
 'VERONA':[10.9825,45.4298],'VENEZIA':[12.3210,45.4410],'BOLOGNA':[11.3417,44.5058],
 'FIRENZE':[11.2478,43.7766],'ANCONA':[13.4975,43.6077],'ROMA':[12.5018,41.9010],
 'NAPOLI':[14.2720,40.8520],'BARI':[16.8703,41.1171],'LECCE':[18.1682,40.3515],
 'REGGIO CALABRIA':[15.6358,38.1035],'PALERMO':[13.3664,38.1090],
 'CATANIA':[15.1031,37.5062],'MESSINA':[15.5558,38.1870],'CAGLIARI':[9.1097,39.2168],
 'PADOVA':[11.8800,45.4160],'VICENZA':[11.5458,45.5475],'TREVISO':[12.2452,45.6590],
 'TRIESTE':[13.7714,45.6577],'UDINE':[13.2423,46.0630],'BRESCIA':[10.2120,45.5416],
 'BERGAMO':[9.6750,45.6913],'PARMA':[10.3280,44.8094],'MODENA':[10.9260,44.6539],
 'REGGIO EMILIA':[10.6430,44.6980],'PIACENZA':[9.6997,45.0524],'RIMINI':[12.5665,44.0631],
 'PESARO':[12.9042,43.9065],'PESCARA':[14.2050,42.4642],'FOGGIA':[15.5446,41.4622],
 'SALERNO':[14.7727,40.6753],'CASERTA':[14.3273,41.0728],'SIRACUSA':[15.2866,37.0688],
 'SASSARI':[8.5603,40.7267],'LA SPEZIA':[9.8235,44.1112],'PISA':[10.4018,43.7085],
 'LIVORNO':[10.3340,43.5543],'PERUGIA':[12.3660,43.1040],'TERNI':[12.6512,42.5600],
 'ROMA TIBURTINA':[12.5308,41.9102],'MILANO ROGOREDO':[9.2380,45.4339],
 'FIRENZE CAMPO MARTE':[11.2766,43.7779]
};

const HUBS=[
 ['S01700','MILANO'],['S05000','TORINO'],['S02593','VENEZIA'],['S02579','VENEZIA MESTRE'],
 ['S02400','VERONA'],['S05043','BOLOGNA'],['S06419','FIRENZE'],['S08409','ROMA'],
 ['S09218','NAPOLI'],['S11109','BARI'],['S04521','GENOVA'],['S07100','ANCONA'],
 ['S12009','PALERMO'],['S12307','CATANIA'],['S12800','CAGLIARI']
];

let liveSnapshot=null;
let refreshBusy=false;
let selectedMarker=null;

function esc(s){return String(s??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))}

function stationKey(s){
  let x=String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().trim();
  x=x.replace(/\bC\.LE\b/g,'CENTRALE').replace(/\bS\. ?LUCIA\b/g,'SANTA LUCIA');
  const aliases={
    'ROMA TERMINI':'ROMA','BARI CENTRALE':'BARI','MILANO CENTRALE':'MILANO',
    'VENEZIA SANTA LUCIA':'VENEZIA','VENEZIA S. LUCIA':'VENEZIA',
    'BOLOGNA CENTRALE':'BOLOGNA','FIRENZE SANTA MARIA NOVELLA':'FIRENZE',
    'FIRENZE S. M. NOVELLA':'FIRENZE','GENOVA PIAZZA PRINCIPE':'GENOVA',
    'NAPOLI CENTRALE':'NAPOLI','PALERMO CENTRALE':'PALERMO',
    'CATANIA CENTRALE':'CATANIA','MESSINA CENTRALE':'MESSINA',
    'REGGIO CALABRIA CENTRALE':'REGGIO CALABRIA','LA SPEZIA CENTRALE':'LA SPEZIA',
    'PESCARA CENTRALE':'PESCARA'
  };
  return aliases[x]||x;
}

function stationCoord(name){
  const k=stationKey(name);
  if(STATIONS[k])return STATIONS[k];
  for(const [key,p] of Object.entries(STATIONS)){
    if(k.includes(key)||key.includes(k))return p;
  }
  return null;
}

function addBaseLayers(){
  const layers=map.getStyle().layers||[];
  for(const layer of layers){
    const text=((layer.id||'')+' '+(layer['source-layer']||'')).toLowerCase();
    const hide=layer.type==='symbol' || /road|street|highway|motorway|trunk|primary|secondary|tertiary|minor|service|path|building|house|shop|amenity|parking|airport|aeroway/.test(text);
    if(hide){try{map.setLayoutProperty(layer.id,'visibility','none')}catch{}}
  }
  const source='openmaptiles';
  if(!map.getLayer('pdq-rail')){
    map.addLayer({
      id:'pdq-rail',type:'line',source,'source-layer':'transportation',minzoom:4,
      layout:{'line-cap':'round','line-join':'round'},
      paint:{
        'line-color':'#4fc3ff','line-opacity':0.95,
        'line-width':['interpolate',['linear'],['zoom'],4,1.5,6,2.2,8,3.0,11,4.0,14,5.0]
      },
      filter:['all',['==','class','rail'],['!=','service','yard'],['!=','service','spur']]
    });
  }
  if(!map.getSource('pdq-cities')){
    map.addSource('pdq-cities',{type:'geojson',data:{
      type:'FeatureCollection',
      features:CITY_POINTS.map(c=>({type:'Feature',properties:{name:c[0]},geometry:{type:'Point',coordinates:[c[1],c[2]]}}))
    }});
    map.addLayer({
      id:'pdq-city-labels',type:'symbol',source:'pdq-cities',
      layout:{'text-field':['get','name'],'text-size':['interpolate',['linear'],['zoom'],4.5,10,8,14],
              'text-allow-overlap':false,'text-padding':6},
      paint:{'text-color':'#e8f3fa','text-halo-color':'#071522','text-halo-width':1.6}
    });
  }
}

function createTrainLayers(){
  if(map.getSource('pdq-live-trains'))return;
  map.addSource('pdq-live-trains',{type:'geojson',data:{type:'FeatureCollection',features:[]}});
  map.addLayer({
    id:'pdq-train-halo',type:'circle',source:'pdq-live-trains',
    paint:{'circle-radius':['interpolate',['linear'],['zoom'],4.5,7,7,9,10,11],
           'circle-color':'#071522','circle-opacity':0.95}
  });
  map.addLayer({
    id:'pdq-live-trains',type:'circle',source:'pdq-live-trains',
    paint:{
      'circle-radius':['interpolate',['linear'],['zoom'],4.5,4.5,7,6,10,8],
      'circle-color':['case',['>', ['coalesce',['get','delay_minutes'],0],5],'#ffb347','#68d5ff'],
      'circle-stroke-width':1.4,'circle-stroke-color':'#f5fcff'
    }
  });
  map.on('mouseenter','pdq-live-trains',()=>map.getCanvas().style.cursor='pointer');
  map.on('mouseleave','pdq-live-trains',()=>map.getCanvas().style.cursor='');
  map.on('click','pdq-live-trains',e=>{
    const f=e.features?.[0];if(!f)return;
    const p=f.properties||{};
    const delay=p.delay_minutes==null?'n/d':`${Number(p.delay_minutes)>=0?'+':''}${p.delay_minutes} min`;
    new maplibregl.Popup({offset:14,maxWidth:'340px'})
      .setLngLat(f.geometry.coordinates)
      .setHTML(`<div class="pdq-popup-inner"><b>${esc(p.category)} ${esc(p.train_number)}</b>
      <br>${esc(p.origin||'n/d')} → ${esc(p.destination||'n/d')}
      <br>Ritardo: ${esc(delay)}
      <br>Ultimo rilevamento: ${esc(p.station||'n/d')}
      ${p.next_station?`<br>Prossima fermata: ${esc(p.next_station)}`:''}
      <br><small>📍 ${esc(p.provenance==='estimated_on_rail'?'Posizione stimata sulla rete ferroviaria':'Ultimo rilevamento reale')}</small>
      </div>`).addTo(map);
  });
}

function trainGeo(data){
  const features=[];
  for(const t of (data?.trains||[])){
    const p=stationCoord(t.last_observation?.station);
    if(!p)continue;
    features.push({
      type:'Feature',
      properties:{
        train_number:String(t.train_number||''),
        category:t.category||'Treno',
        origin:t.origin||'',
        destination:t.destination||'',
        delay_minutes:t.delay_minutes??null,
        station:t.last_observation?.station||'',
        next_station:t.next_stop?.station||'',
        provenance:'observed_station'
      },
      geometry:{type:'Point',coordinates:p}
    });
  }
  return {type:'FeatureCollection',features};
}

async function refreshLive(){
  if(refreshBusy||!map.getSource('pdq-live-trains'))return;
  refreshBusy=true;
  try{
    const r=await fetch(`${API}/live/passenger?ts=${Date.now()}`,{cache:'no-store',headers:{Accept:'application/json'}});
    const d=await r.json();
    if(!r.ok)throw new Error(d?.error||'Servizio live non disponibile');
    liveSnapshot=d;
    map.getSource('pdq-live-trains').setData(trainGeo(d));
    const badge=document.querySelector('.liveBadge');
    if(badge)badge.innerHTML=`🚆 <b>${d.trains_count||d.trains?.length||0} treni attivi</b> · ViaggiaTreno · ${new Date().toLocaleTimeString('it-IT',{hour:'2-digit',minute:'2-digit'})}`;
    document.querySelector('#status').innerHTML='<i></i> ITALIA • LIVE';
  }catch(e){
    console.warn('[PDQ] live:',e);
    const badge=document.querySelector('.liveBadge');
    if(badge)badge.innerHTML='⚠️ <b>Dati live temporaneamente non disponibili</b>';
    document.querySelector('#status').innerHTML='<i class="off"></i> ITALIA • OFFLINE LIVE';
  }finally{refreshBusy=false}
}

function showSearchMarker(d){
  if(selectedMarker){selectedMarker.remove();selectedMarker=null}
  const p=stationCoord(d.last_observation?.station);
  if(!p)return;
  const el=document.createElement('div');
  el.className='train-map-marker';
  el.textContent='🚆';
  selectedMarker=new maplibregl.Marker({element:el,anchor:'center'})
    .setLngLat(p)
    .setPopup(new maplibregl.Popup({offset:24}).setHTML(
      `<b>${esc(d.category)} ${esc(d.train_number)}</b><br>Ultimo rilevamento: ${esc(d.last_observation?.station||'n/d')}`
    )).addTo(map);
  selectedMarker.togglePopup();
  map.flyTo({center:p,zoom:9,duration:1100});
}

async function searchTrain(){
  const n=document.querySelector('#search').value.trim();
  if(!/^\d{1,6}$/.test(n)){
    result.innerHTML='<p class="error">Inserisci un numero treno valido.</p>';return;
  }
  result.innerHTML='<div class="empty"><span>⌛</span><b>Interrogo la circolazione…</b></div>';
  try{
    const r=await fetch(`${API}/trains/${encodeURIComponent(n)}?ts=${Date.now()}`,{cache:'no-store',headers:{Accept:'application/json'}});
    const d=await r.json();
    if(!r.ok)throw new Error(d?.error||'Servizio non disponibile');
    showSearchMarker(d);
    const delay=d.delay_minutes==null?'n/d':`${d.delay_minutes>=0?'+':''}${d.delay_minutes} min`;
    const material=d.rolling_stock?.status==='unknown'?'Non identificato':d.rolling_stock?.label||'Identificato';
    result.innerHTML=`<div class="trainCard">
      <div class="trainTop"><h3>${esc(d.category)} ${esc(d.train_number)}</h3><span class="delay">${esc(delay)}</span></div>
      <div class="route">${esc(d.origin||'n/d')} <span>→</span> ${esc(d.destination||'n/d')}</div>
      <div class="dataGrid">
        <div class="dataBox"><small>Ultimo rilevamento</small><b>${esc(d.last_observation?.station||'n/d')}</b></div>
        <div class="dataBox"><small>Prossima fermata</small><b>${esc(d.next_stop?.station||'n/d')}</b></div>
        <div class="dataBox"><small>Materiale</small><b>${esc(material)}</b></div>
        <div class="dataBox"><small>Stato</small><b>${d.circulating?'In circolazione':'Non circolante'}</b></div>
      </div>
      <div class="provenance">📡 <b>FONTE LIVE</b><br>Dati di circolazione da ViaggiaTreno. Il marker indica l'ultimo rilevamento disponibile e non un GPS.</div>
      <details><summary>Dettagli tecnici</summary><pre>${esc(JSON.stringify(d,null,2))}</pre></details>
    </div>`;
  }catch(e){
    result.innerHTML=`<p class="error">${esc(e.message)}</p><p class="muted">Il treno può non essere in servizio oppure il provider può essere temporaneamente irraggiungibile.</p>`;
  }
}

map.on('load',()=>{
  addBaseLayers();
  createTrainLayers();
  refreshLive();
  setInterval(refreshLive,60000);
});
document.querySelector('#search').addEventListener('keydown',e=>{if(e.key==='Enter')searchTrain()});
document.querySelector('#searchBtn').addEventListener('click',searchTrain);
