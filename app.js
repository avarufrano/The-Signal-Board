
import gtfsRealtime from "https://cdn.jsdelivr.net/npm/gtfs-realtime-bindings@1.1.1/+esm";
const { transit_realtime } = gtfsRealtime;
import JSZip from "https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm";

const ROUTES = {
  "1":"#EE352E","2":"#EE352E","3":"#EE352E",
  "4":"#00933C","5":"#00933C","6":"#00933C","6X":"#00933C",
  "7":"#B933AD","7X":"#B933AD",
  "A":"#0039A6","C":"#0039A6","E":"#0039A6",
  "B":"#FF6319","D":"#FF6319","F":"#FF6319","M":"#FF6319",
  "G":"#6CBE45","J":"#996633","Z":"#996633","L":"#A7A9AC",
  "N":"#FCCC0A","Q":"#FCCC0A","R":"#FCCC0A","W":"#FCCC0A",
  "S":"#808183","SI":"#0039A6"
};
const FEEDS = ["gtfs","gtfs-ace","gtfs-bdfm","gtfs-g","gtfs-jz","gtfs-l","gtfs-nqrw","gtfs-si"];
const GTFS_URL = "https://rrgtfsfeeds.s3.amazonaws.com/gtfs_subway.zip";
const views = {
  system:[[40.56,-74.06],[40.91,-73.70]],
  manhattan:[[40.69,-74.03],[40.89,-73.91]],
  brooklyn:[[40.56,-74.05],[40.74,-73.83]],
  queens:[[40.60,-73.97],[40.82,-73.70]],
  bronx:[[40.78,-73.95],[40.92,-73.76]]
};
let settings = JSON.parse(localStorage.getItem("signal-board-settings") || '{"worker":"","focus":"system"}');
let map, stationData = {}, stationMarkers = [], trainMarkers = [], liveTrips = [], selectedRoute = "ALL", selectedTrip = null, lastFeedTime = null;
const $ = id => document.getElementById(id);

function clock(){
  const d=new Date();
  $("clock").textContent=d.toLocaleTimeString([],{hour:"numeric",minute:"2-digit"});
  $("date").textContent=d.toLocaleDateString([],{weekday:"short",month:"short",day:"numeric"}).toUpperCase();
  if(lastFeedTime) $("feedAge").textContent=Math.max(0,Math.round((Date.now()-lastFeedTime)/1000))+" SEC";
}
setInterval(clock,1000); clock();

function initMap(){
  map=L.map("map",{zoomControl:false,attributionControl:true,minZoom:9,maxZoom:15});
  L.control.zoom({position:"bottomright"}).addTo(map);
  L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png",{
    attribution:"© OpenStreetMap © CARTO",subdomains:"abcd",maxZoom:20
  }).addTo(map);
  setFocus(settings.focus);
}
function setFocus(name){
  const b=views[name]||views.system;
  map.fitBounds(b,{padding:[10,10]});
}
function parseCSV(text){
  const rows=[]; let row=[],field="",q=false;
  for(let i=0;i<text.length;i++){
    const c=text[i],n=text[i+1];
    if(c=='"'&&q&&n=='"'){field+='"';i++}
    else if(c=='"') q=!q;
    else if(c==","&&!q){row.push(field);field=""}
    else if((c=="\n"||c=="\r")&&!q){if(c=="\r"&&n=="\n")i++;row.push(field);if(row.some(v=>v!==""))rows.push(row);row=[];field=""}
    else field+=c;
  }
  if(field||row.length){row.push(field);rows.push(row)}
  const h=rows.shift(); return rows.map(r=>Object.fromEntries(h.map((k,i)=>[k,r[i]||""])));
}
async function loadStatic(){
  $("ticker").textContent="Loading the official MTA station diagram…";
  try{
    const res=await fetch(GTFS_URL); if(!res.ok)throw new Error("GTFS "+res.status);
    const zip=await JSZip.loadAsync(await res.arrayBuffer());
    const stops=parseCSV(await zip.file("stops.txt").async("string"));
    stops.filter(s=>s.location_type==="1" || (!s.parent_station && !/[NS]$/.test(s.stop_id))).forEach(s=>{
      stationData[s.stop_id]={id:s.stop_id,name:s.stop_name,lat:+s.stop_lat,lon:+s.stop_lon};
    });
    drawStations();
    $("ticker").textContent="System diagram ready. Establishing the realtime telegraph…";
  }catch(e){
    console.error(e);
    $("ticker").textContent="Static MTA diagram could not load; demonstration coordinates are in use.";
    installDemoStations();
  }
}
function installDemoStations(){
  const demo=[
    ["A24","59 St–Columbus Circle",40.7683,-73.9819],["A27","42 St–Port Authority",40.7573,-73.9897],
    ["A32","W 4 St",40.7323,-74.0005],["A36","Canal St",40.7208,-74.0052],["A42","Fulton St",40.7102,-74.0078],
    ["R16","Times Sq–42 St",40.7555,-73.9877],["R20","14 St–Union Sq",40.7357,-73.9906],
    ["R23","Canal St",40.7195,-74.0018],["R27","Whitehall St",40.7031,-74.0129],
    ["635","Grand Central–42 St",40.7518,-73.9767],["631","14 St–Union Sq",40.7347,-73.9901],
    ["621","Brooklyn Bridge–City Hall",40.7131,-74.0041]
  ]; demo.forEach(d=>stationData[d[0]]={id:d[0],name:d[1],lat:d[2],lon:d[3]}); drawStations();
}
function drawStations(){
  stationMarkers.forEach(m=>m.remove());stationMarkers=[];
  Object.values(stationData).forEach(s=>{
    const icon=L.divIcon({className:"",html:'<div class="station-marker"></div>',iconSize:[6,6],iconAnchor:[3,3]});
    stationMarkers.push(L.marker([s.lat,s.lon],{icon,interactive:false}).addTo(map));
  });
}
function makeFilters(){
  const routes=["ALL",...Object.keys(ROUTES).filter(r=>!r.endsWith("X"))];
  $("routeFilters").innerHTML=routes.map(r=>{
    const color=r==="ALL"?"#6b6049":ROUTES[r];
    return `<button class="route-filter ${r==="ALL"?"active":""}" data-route="${r}" style="background:${color}" title="${r==="ALL"?"All services":r+" train"}">${r==="ALL"?"•":r}</button>`;
  }).join("");
  $("routeFilters").addEventListener("click",e=>{
    const b=e.target.closest("button");if(!b)return;
    selectedRoute=b.dataset.route;
    document.querySelectorAll(".route-filter").forEach(x=>x.classList.toggle("active",x===b));
    renderTrains();
  });
}
function stationFor(stopId){ return stationData[(stopId||"").replace(/[NS]$/,"")] }
function normalizeRoute(r){return (r||"?").replace(/X$/,"")}
function routeColor(r){return ROUTES[r]||ROUTES[normalizeRoute(r)]||"#b58a43"}
function routeTextColor(r){return ["N","Q","R","W"].includes(normalizeRoute(r))?"#111":"#fff"}
function statusItems(){
  const routes=Object.keys(ROUTES).filter(r=>!r.endsWith("X"));
  $("statusList").innerHTML=routes.map(r=>`<div class="status-item">
    <span class="mini-bullet" style="background:${routeColor(r)};color:${routeTextColor(r)}">${r}</span>
    <span>GOOD SERVICE</span><i class="status-light good"></i></div>`).join("");
}
async function fetchFeed(name){
  const base=settings.worker.replace(/\/$/,"");
  const res=await fetch(`${base}/feed?name=${encodeURIComponent(name)}`,{cache:"no-store"});
  if(!res.ok)throw new Error(name+" "+res.status);
  const buf=new Uint8Array(await res.arrayBuffer());
  return transit_realtime.FeedMessage.decode(buf);
}
function decodeTrips(messages){
  const now=Math.floor(Date.now()/1000), out=[];
  messages.forEach(msg=>msg.entity.forEach(ent=>{
    const tu=ent.tripUpdate;if(!tu||!tu.trip)return;
    const updates=tu.stopTimeUpdate||[];
    let nextIndex=updates.findIndex(u=>{
      const t=Number(u.arrival?.time||u.departure?.time||0);return t>=now-45;
    });
    if(nextIndex<0)nextIndex=updates.length-1;
    const next=updates[nextIndex],prev=updates[Math.max(0,nextIndex-1)];
    const nextS=stationFor(next?.stopId),prevS=stationFor(prev?.stopId);
    if(!nextS && !prevS)return;
    let lat=(nextS||prevS).lat,lon=(nextS||prevS).lon,progress=.15;
    const at=Number(next?.arrival?.time||next?.departure?.time||0);
    const pt=Number(prev?.departure?.time||prev?.arrival?.time||0);
    if(nextS&&prevS&&at>pt){progress=Math.max(0,Math.min(1,(now-pt)/(at-pt)));lat=prevS.lat+(nextS.lat-prevS.lat)*progress;lon=prevS.lon+(nextS.lon-prevS.lon)*progress}
    out.push({id:tu.trip.tripId,route:normalizeRoute(tu.trip.routeId),direction:tu.trip.directionId===1?"Southbound / Downtown":"Northbound / Uptown",from:prevS?.name||nextS?.name||"Unknown",to:nextS?.name||"Unknown",arrival:at?Math.max(0,Math.round((at-now)/60)):null,lat,lon,progress});
  }));
  return out;
}
async function loadLive(){
  if(!settings.worker){useDemo();return}
  try{
    const results=await Promise.allSettled(FEEDS.map(fetchFeed));
    const messages=results.filter(r=>r.status==="fulfilled").map(r=>r.value);
    if(!messages.length)throw new Error("No feeds");
    liveTrips=decodeTrips(messages);
    lastFeedTime=Date.now();
    $("dataLamp").innerHTML='<span class="lamp live"></span><span>LIVE TELEGRAPH</span>';
    $("modeLabel").textContent="LIVE";
    $("ticker").textContent="Realtime train indications received from the MTA GTFS-Realtime telegraph.";
    renderTrains();
  }catch(e){
    console.error(e);$("ticker").textContent="Live telegraph unavailable. Demonstration movement is shown while the board retries.";
    useDemo();
  }
}
function useDemo(){
  if(!Object.keys(stationData).length)installDemoStations();
  const ids=Object.keys(stationData), routes=["A","C","E","1","2","4","6","7","L","N","Q","R","F","G"];
  const phase=Date.now()/18000;
  liveTrips=routes.map((r,i)=>{
    const a=stationData[ids[(i*3)%ids.length]],b=stationData[ids[(i*3+1)%ids.length]]||a;
    const p=(Math.sin(phase+i*.8)+1)/2;
    return {id:"demo"+i,route:r,direction:i%2?"Southbound / Downtown":"Northbound / Uptown",from:a.name,to:b.name,arrival:Math.max(1,Math.round((1-p)*6)),lat:a.lat+(b.lat-a.lat)*p,lon:a.lon+(b.lon-a.lon)*p,progress:p};
  });
  $("dataLamp").innerHTML='<span class="lamp"></span><span>DEMONSTRATION</span>';$("modeLabel").textContent="DEMO";
  renderTrains();
}
function selectTrip(t){
  selectedTrip=t;
  $("selectedBullet").textContent=t.route;$("selectedBullet").style.background=routeColor(t.route);$("selectedBullet").style.color=routeTextColor(t.route);
  $("selectedTitle").textContent=t.route+" TRAIN";$("selectedDirection").textContent=t.direction;
  $("fromStation").textContent=t.from;$("toStation").textContent=t.to;$("arrival").textContent=t.arrival===null?"—":t.arrival+" MIN";
  renderTrains(false);
}
function renderTrains(autoSelect=true){
  trainMarkers.forEach(m=>m.remove());trainMarkers=[];
  const shown=liveTrips.filter(t=>selectedRoute==="ALL"||t.route===selectedRoute);
  shown.slice(0,220).forEach(t=>{
    const selected=selectedTrip&&selectedTrip.id===t.id;
    const icon=L.divIcon({className:"",html:`<div class="train-marker ${selected?"selected":""}" style="background:${routeColor(t.route)};--amber:${routeColor(t.route)}"></div>`,iconSize:[18,18],iconAnchor:[9,9]});
    const m=L.marker([t.lat,t.lon],{icon,zIndexOffset:selected?1000:100}).addTo(map).on("click",()=>selectTrip(t));
    trainMarkers.push(m);
  });
  $("trainCount").textContent=shown.length;$("lineCount").textContent=new Set(shown.map(t=>t.route)).size;
  $("updated").textContent="UPDATED "+new Date().toLocaleTimeString([],{hour:"numeric",minute:"2-digit",second:"2-digit"});
  if(autoSelect&&shown.length&&!selectedTrip)selectTrip(shown[0]);
}
function settingsUI(){
  $("settingsButton").onclick=()=>{$("workerInput").value=settings.worker||"";$("focusInput").value=settings.focus||"system";$("settingsDialog").showModal()};
  $("cancelButton").onclick=()=>$("settingsDialog").close();
  $("demoButton").onclick=()=>{settings.worker="";localStorage.setItem("signal-board-settings",JSON.stringify(settings));$("settingsDialog").close();useDemo()};
  $("saveButton").onclick=()=>{settings.worker=$("workerInput").value.trim();settings.focus=$("focusInput").value;localStorage.setItem("signal-board-settings",JSON.stringify(settings));$("settingsDialog").close();setFocus(settings.focus);loadLive()};
}
initMap();makeFilters();statusItems();settingsUI();
await loadStatic();
await loadLive();
setInterval(()=>settings.worker?loadLive():useDemo(),15000);
