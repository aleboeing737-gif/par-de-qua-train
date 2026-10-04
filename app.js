const map = new maplibregl.Map({
  container:'map',
  style:'https://tiles.openfreemap.org/styles/liberty',
  center:[12.45,42.5], zoom:5.4
});
map.addControl(new maplibregl.NavigationControl(),'top-right');

const markers = new Map();
const statusEl=document.getElementById('status');
const countEl=document.getElementById('count');
const lastEl=document.getElementById('last');
const errorEl=document.getElementById('error');

function esc(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}

function showTrain(t){
  if(!Number.isFinite(t.lat)||!Number.isFinite(t.lon)) return;
  let m=markers.get(t.id);
  if(!m){
    const el=document.createElement('div'); el.className='train';
    m=new maplibregl.Marker({element:el}).setLngLat([t.lon,t.lat]).addTo(map);
    markers.set(t.id,m);
    m.setPopup(new maplibregl.Popup({offset:12}).setHTML(
      `<b>Treno ${esc(t.number)}</b><br>${esc(t.category)}<br>${esc(t.origin)} → ${esc(t.destination)}<br>Ritardo: ${esc(t.delay)} min<br><small>${esc(t.positionLabel)}</small>`
    ));
  } else {
    m.setLngLat([t.lon,t.lat]);
    if(m.getPopup()) m.getPopup().setHTML(
      `<b>Treno ${esc(t.number)}</b><br>${esc(t.category)}<br>${esc(t.origin)} → ${esc(t.destination)}<br>Ritardo: ${esc(t.delay)} min<br><small>${esc(t.positionLabel)}</small>`
    );
  }
}

async function refresh(){
  try{
    statusEl.textContent='Aggiornamento…'; errorEl.textContent='';
    const r=await fetch('/api/v1/live/passenger',{cache:'no-store'});
    if(!r.ok) throw new Error(`API ${r.status}`);
    const data=await r.json();
    const trains=Array.isArray(data)?data:(data.trains||data.results||[]);
    const seen=new Set();
    for(const t of trains){
      const id=String(t.id??`${t.number}-${t.originCode??''}`);
      const x={
        id,number:t.number??t.numeroTreno,category:t.category??t.categoria??'',
        origin:t.origin??t.origine??'',destination:t.destination??t.destinazione??'',
        delay:t.delay??t.ritardo??0,lat:Number(t.lat),lon:Number(t.lon),
        positionLabel:t.positionLabel??(t.estimated?'Posizione stimata':'Posizione reale')
      };
      if(!x.number||!Number.isFinite(x.lat)||!Number.isFinite(x.lon)) continue;
      seen.add(id); showTrain(x);
    }
    for(const [id,m] of markers) if(!seen.has(id)){m.remove();markers.delete(id);}
    countEl.textContent=String(seen.size);
    lastEl.textContent='Ultimo aggiornamento: '+new Date().toLocaleTimeString('it-IT');
    statusEl.textContent='LIVE';
  }catch(e){
    statusEl.textContent='ERRORE API';
    errorEl.textContent='Nessun dato ricevuto da ViaggiaTreno: '+e.message;
  }
}
refresh(); setInterval(refresh,30000);
