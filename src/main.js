import * as THREE from 'three';
import { SparkRenderer, SplatMesh } from '@sparkjsdev/spark';
import sourceConfig from './scene-config.json';
import outdoorDefinition from './outdoor-route.json';
import { buildOutdoorRoute, buildTurnCues, guidanceAt, routeOverview } from './outdoor-guidance.js';
import { createRouteOverlay } from './route-overlay.js';
import { createHudScene } from './hud-scene.js';
import { makeRoute, routeAt, constrainedPosition } from './route.js';
import { ResourcePolicy } from './resource-policy.js';
import './style.css';

const $=id=>document.getElementById(id);
const params=new URLSearchParams(location.search);
const localHost=['localhost','127.0.0.1','::1','[::1]'].includes(location.hostname);
const guardedMode=localHost&&params.get('resources')==='guarded';
const requestedDpr=Number(params.get('qualityDpr'));
const reviewDpr=localHost&&Number.isFinite(requestedDpr)&&requestedDpr>=.5?Math.min(requestedDpr,2):1;
const outdoorMode=params.get('experience')!=='connected';
const reducedMotion=matchMedia('(prefers-reduced-motion: reduce)');
const outdoorRoute=buildOutdoorRoute(sourceConfig,outdoorDefinition);
const config=outdoorMode?{...sourceConfig,scenes:sourceConfig.scenes.filter(s=>s.id===outdoorDefinition.sceneId),connectors:[],route:{...sourceConfig.route,points:outdoorRoute.nodes,defaultStartDistance:0}}:sourceConfig;
const route=outdoorMode?outdoorRoute:makeRoute(config.route.points);
const cues=outdoorMode?buildTurnCues(route,{lookAhead:5,minSpacing:16,thresholdDegrees:40}):[];
const overviewBounds=routeOverview(route);
let viewMode='walk',routeOverlay=null,hudScene=null,overviewOrbit=0,lookTarget=null;
let measuredFps=0,fpsWindowStart=0,fpsWindowFrames=0;
const policy=new ResourcePolicy();
document.documentElement.dataset.resourceMode=guardedMode?'guarded':'interactive';
if(guardedMode){const link=document.querySelector('a[href="?experience=connected"]');if(link)link.href='?experience=connected&resources=guarded';}
const sceneDefs=new Map(config.scenes.map(s=>[s.id,s]));
const routeSceneIds=[...new Set(route.nodes.map(p=>p.sceneId).filter(id=>sceneDefs.has(id)))];
const sceneStarts=new Map(routeSceneIds.map(id=>[id,route.nodes.find(p=>p.sceneId===id).distance]));
const host=$('viewport');
let renderer,world,camera,spark,started=false,startPending=false,busy=false,decodeInFlight=false,loadError=null,loadingId=null;
let telemetry=null,telemetryAt=0,polling=false,dirty=true,lastRender=0,lastTick=0,nextFrameAt=0,frames=0;
let distance=0,lateral=0,yaw=0,pitch=0,auto=false,autoDirection=1,dragging=false,lastPointer=null,touchStep=0;
let fpsLimit=guardedMode?10:30,pixelRatio=guardedMode?.5:Math.min(devicePixelRatio,reviewDpr),stickyLowUntil=0,loadQueue=Promise.resolve();
const meshes=new Map(),loading=new Map(),keys=new Set(),events=[],resourceSamples=[];
let cameraLast=new THREE.Vector3();
const eyeHeight=config.route.eyeHeight||1.6;
const corridor=config.route.corridorHalfWidth||.35;
const speed=config.route.defaultSpeed||1.4;
const startNode=route.nodes.find(p=>p.sourceCameraId===180&&p.sceneId===config.scenes[0].id);
const defaultDistance=config.route.defaultStartDistance??startNode?.distance??0;
distance=defaultDistance;
if(outdoorMode){document.title='A walk to Avery';document.body.classList.add('outdoor-mode');$('route-start').textContent=route.start.label;$('route-end').textContent=route.end.label;$('route-note').textContent=outdoorDefinition.status;
$('about-title').textContent='A walk to Avery';$('about-description').textContent='An outdoor route through Ci Song’s campus scan, from the Low Plaza steps to the forecourt near Avery. Follow the translucent route to preview the walk, pause to look around, or see the route from above.';
$('evidence-description').textContent='This follows a selected part of the recorded walk, not a calculated shortest route. It stays within one reconstruction: no approximate scene joins or schematic indoor connection. The campus gate and final approach to a usable building door still need capture and field checking.';
$('movement-description').textContent='The guide is drawn at an estimated display height below the capture camera. It is not a surveyed pavement surface. Landmark identities are based on source panoramas and campus references; current access, metric distances and accessible routing are not verified.';
}else{$('route-panel').hidden=true;$('overview-toggle').hidden=true;$('route-cue').hidden=true;}

function record(type,data={}){events.push({at:Date.now(),type,...data});if(events.length>2000)events.shift();}
function status(text){$('status').hidden=!text;$('status').textContent=text||'';}
function hasHeadroom(){return !guardedMode||policy.canWork&&telemetry?.available===true&&telemetry?.stale===false&&telemetry?.guard?.allowRender===true&&Number.isFinite(telemetry.sampledAtEpochMs)&&Date.now()-telemetry.sampledAtEpochMs<2500&&Date.now()-telemetryAt<2500;}
function canRender(){return hasHeadroom()&&!document.hidden&&!$('map-dialog').open;}
function unloadMap(){const frame=$('map-dialog').querySelector('iframe');if(frame.dataset.loaded){frame.src='about:blank';delete frame.dataset.loaded;}}
function updateMap(){if(!$('map-dialog').open)return;const frame=$('map-dialog').querySelector('iframe');if(!hasHeadroom()){unloadMap();$('map-status').hidden=false;}else{if(!frame.dataset.loaded){frame.src='./campus/index.html';frame.dataset.loaded='true';}$('map-status').hidden=true;}}
function resourceNotice(){
  if(!guardedMode)return {button:'Return to this preview',detail:'Rendering pauses while this preview is in the background.'};
  const now=Date.now(),sample=telemetry;
  if(!sample||now-telemetryAt>=2500)return {button:'Resource monitor disconnected',detail:'Cannot read CPU and GPU. The preview will unlock when the local monitor reconnects.'};
  if(sample.stale||sample.available!==true||!Number.isFinite(sample.sampledAtEpochMs)||now-sample.sampledAtEpochMs>=2500||!Number.isFinite(sample.cpuPercent)||!Number.isFinite(sample.gpuPercent))return {button:'Waiting for fresh readings…',detail:'CPU and GPU readings are not available yet. The preview is paused until monitoring recovers.'};
  const readings=`CPU ${Math.round(sample.cpuPercent)}% · GPU ${Math.round(sample.gpuPercent)}%`;
  if(Math.max(sample.cpuPercent,sample.gpuPercent)>=80)return {button:'Paused — resource limit',detail:`${readings}. At least one reached 80%. Both must stay below 60% for 10 seconds to resume.`};
  if(sample.guard?.allowRender!==true||!policy.canWork){
    const remaining=[];
    if(sample.guard?.state==='paused'&&Number.isFinite(sample.guard.recoverySecondsRemaining))remaining.push(sample.guard.recoverySecondsRemaining);
    if(policy.wasTripped&&policy.coolSince!==null)remaining.push(Math.max(0,10-(now-policy.coolSince)/1000));
    const cooling=Math.max(sample.cpuPercent,sample.gpuPercent)<60&&remaining.length>0;
    return {button:cooling?`Resuming in ${Math.max(1,Math.ceil(Math.max(...remaining)))}s…`:'Waiting for lower system load…',detail:`${readings}. Both must stay below 60% for 10 seconds; a higher reading restarts the wait.`};
  }
  return {button:'Return to this preview',detail:'Rendering pauses while this preview is in the background.'};
}
function updateResources(){
  const fresh=Date.now()-telemetryAt<2500;
  if(guardedMode)policy.update(fresh?telemetry:null);
  const allow=canRender();updateMap();
  const notice=resourceNotice();
  if(!guardedMode){$('resource-detail').textContent='Interactive preview · resource pauses are off.';}
  else if(telemetry){
    $('resource-detail').textContent=`CPU ${telemetry.cpuPercent??'—'}% · GPU ${telemetry.gpuPercent??'—'}% · ${telemetry.guard?.state||'unavailable'}. Real whole-machine readings; 1-second polling. Render limit ${Math.min(fpsLimit,telemetry.guard?.fpsLimit||0)} fps.`;
  }
  if(started){
    if(!allow&&!$('map-dialog').open&&!document.hidden){status(`${notice.button} ${notice.detail}`);}
    else if(!busy&&!loadError)status('');
  }else{
    $('start').disabled=!allow||startPending;
    $('start').innerHTML=startPending?'Preparing the scene…':allow?(outdoorMode?'Preview the walk <span aria-hidden="true">→</span>':'Enter the campus <span aria-hidden="true">→</span>'):notice.button;
    $('welcome-note').hidden=allow||startPending;
    $('welcome-note').textContent=notice.detail;
  }
  if(renderer&&allow&&guardedMode){
    const scale=telemetry.guard.resolutionScale||.65;
    if((telemetry.gpuPercent??0)>=45||(telemetry.cpuPercent??0)>=55)stickyLowUntil=performance.now()+10000;
    const low=policy.state==='reduced'||scale<1||performance.now()<stickyLowUntil;
    fpsLimit=low?8:10;
    const next=Math.min(devicePixelRatio,.5)*(low?.8:1);
    if(Math.abs(next-pixelRatio)>.001){pixelRatio=next;renderer.setPixelRatio(pixelRatio);resize();record('quality',{fpsLimit,pixelRatio});}
  }
}
async function poll(){
  if(!guardedMode||polling)return;polling=true;
  try{const res=await fetch('http://127.0.0.1:8796/api/resources',{signal:AbortSignal.timeout(1800),cache:'no-store'});if(!res.ok)throw Error(`Monitor HTTP ${res.status}`);telemetry=await res.json();telemetryAt=Date.now();resourceSamples.push({at:telemetryAt,cpu:telemetry.cpuPercent,gpu:telemetry.gpuPercent,state:telemetry.guard?.state,frames,distance});if(resourceSamples.length>1200)resourceSamples.shift();}
  catch{telemetry=null;telemetryAt=0;}finally{polling=false;updateResources();}
}
if(guardedMode){setInterval(poll,1000);poll();}else updateResources();

function resize(){if(!renderer)return;const w=host.clientWidth,h=host.clientHeight;renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix();if(spark)spark.maxPixelRadius=512*renderer.getPixelRatio();if(started)setCamera();dirty=true;}
function directionAt(d){const a=routeAt(route,d).position,b=routeAt(route,Math.min(route.total,d+2)).position;let dx=b[0]-a[0],dz=b[2]-a[2];if(Math.hypot(dx,dz)<.01){const p=routeAt(route,Math.max(0,d-1));dx=a[0]-p.position[0];dz=a[2]-p.position[2];}return Math.atan2(-dx,-dz);}
function pitchAt(d){const c=connectorAt(d);if(c?.kind!=='schematic')return 0;const a=routeAt(route,d).position,b=routeAt(route,Math.min(route.total,d+2)).position;return Math.max(-.5,Math.min(.25,Math.atan2(b[1]-a[1],Math.hypot(b[0]-a[0],b[2]-a[2]))*.85));}
function setCamera(){
  const p=constrainedPosition(route,distance,lateral,corridor);
  if(viewMode==='overview'){
    const center=new THREE.Vector3(...overviewBounds.center),span=Math.max(overviewBounds.radius,10),fit=1/Math.min(1,camera.aspect);
    camera.position.copy(center).add(new THREE.Vector3(Math.sin(overviewOrbit)*span*1.65*fit,span*1.8*fit,Math.cos(overviewOrbit)*span*1.65*fit));camera.lookAt(center);
  }else{camera.position.fromArray(p.position);camera.rotation.set(pitch,yaw,0,'YXZ');}
  camera.updateMatrixWorld();
  const active=sceneAt(distance),def=sceneDefs.get(active);
  $('segment-label').textContent=outdoorMode?'Outdoor route':def?.label||'Avery approach';
  const connector=connectorAt(distance);
  $('connector-label').hidden=!connector;
  if(connector){$('connector-label').textContent=connector.kind?.includes('schematic')?'示意连接 · Schematic connection':'Approximate alignment';if(connector.kind?.includes('schematic'))$('segment-label').textContent='Into Avery';}
  updateSceneVisibility();
  if(outdoorMode)updateGuidance();
  dirty=true;
}
function updateGuidance(){
  const g=guidanceAt(route,cues,distance,autoDirection),cue=g.nextCue;
  $('route-progress').value=String(distance/route.total*100);$('route-progress').style.setProperty('--progress',`${distance/route.total*100}%`);
  $('route-progress').setAttribute('aria-valuetext',`${Math.round(distance/route.total*100)} percent of the route`);
  const near=cue&&cue.ahead<13;
  $('cue-icon').textContent=viewMode==='overview'?'↗':g.arrived?'✓':near?({left:'↰',right:'↱','turn-around':'↶'}[cue.kind]||'↑'):'↑';
  $('cue-text').textContent=viewMode==='overview'?'Recorded route':g.arrived?`At ${g.destination}`:near?cue.label:`Continue toward ${g.destination}`;
  $('route-cue').classList.toggle('arrived',g.arrived);
  $('overview-toggle').textContent=viewMode==='overview'?'Walk view':'Overview';
  $('overview-toggle').setAttribute('aria-pressed',String(viewMode==='overview'));
}

function updateSceneVisibility(){
  const weights=new Map(config.scenes.map(s=>[s.id,0]));
  weights.set(config.scenes[0].id,1);
  for(const c of config.connectors||[]){
    if(distance<c.startDistance)break;
    const t=THREE.MathUtils.clamp((distance-c.startDistance)/(c.endDistance-c.startDistance),0,1);
    if(c.kind==='schematic'){
      // Keep the unsupported interior link visibly schematic. Fade the source
      // scans only at its thresholds; do not make the missing zone photoreal.
      weights.set(c.fromScene,Math.max(0,1-t/.18));
      weights.set(c.toScene,Math.max(0,(t-.82)/.18));
    }else{weights.set(c.fromScene,1-t);weights.set(c.toScene,t);}
  }
  for(const [id,mesh] of meshes){const weight=weights.get(id)||0;mesh.opacity=weight;mesh.visible=weight>.001&&viewMode!=='overview';}
}
function sceneAt(d){let active=routeSceneIds[0];for(const id of routeSceneIds)if(d>=sceneStarts.get(id))active=id;return active;}
function connectorAt(d){return (config.connectors||[]).find(c=>{const points=c.points||[];if(!points.length)return false;const start=c.startDistance??nearestDistance(points[0].position||points[0]);const end=c.endDistance??nearestDistance(points.at(-1).position||points.at(-1));return d>=Math.min(start,end)-.1&&d<=Math.max(start,end)+.1;});}
function nearestDistance(pos){let best=Infinity,result=0;for(const p of route.nodes){const gap=Math.hypot(...p.position.map((v,i)=>v-pos[i]));if(gap<best){best=gap;result=p.distance;}}return result;}

function buildConnectors(){
  const floorMaterial=new THREE.MeshStandardMaterial({color:'#d5d8d1',roughness:1,side:THREE.DoubleSide});
  const frameMaterial=new THREE.LineBasicMaterial({color:'#98a79c'});
  for(const c of config.connectors||[]){
    const points=c.points.map(p=>new THREE.Vector3().fromArray(p.position||p));
    for(let i=0;i<points.length-1;i++){
      const a=points[i].clone(),b=points[i+1].clone();a.y-=eyeHeight;b.y-=eyeHeight;
      const along=b.clone().sub(a),flat=along.clone();flat.y=0;flat.normalize();
      const side=new THREE.Vector3(-flat.z,0,flat.x).multiplyScalar(corridor+0.45);
      const v=[a.clone().sub(side),a.clone().add(side),b.clone().sub(side),b.clone().add(side)];
      const g=new THREE.BufferGeometry().setFromPoints([v[0],v[2],v[1],v[1],v[2],v[3]]);g.computeVertexNormals();world.add(new THREE.Mesh(g,floorMaterial));
      // A deliberately schematic ramp beneath the walking path; step outlines
      // communicate stairs without asserting surveyed riser dimensions.
      if(Math.abs(b.y-a.y)>.3){const n=Math.max(3,Math.ceil(Math.abs(b.y-a.y)/.2));for(let k=0;k<n;k++){const t=k/n,p=a.clone().lerp(b,t);world.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([p.clone().sub(side),p.clone().add(side)]),frameMaterial));const depth=Math.hypot(b.x-a.x,b.z-a.z)/n;const step=new THREE.Mesh(new THREE.BoxGeometry(side.length()*2,.10,depth),floorMaterial);step.position.copy(a.clone().lerp(b,(k+.5)/n));step.position.y=p.y-.05;step.rotation.y=Math.atan2(flat.x,flat.z);world.add(step);}}
      for(const sign of [-1,1]){const edge=[a.clone().addScaledVector(side,sign),b.clone().addScaledVector(side,sign)].map(v=>v.add(new THREE.Vector3(0,.85,0)));world.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(edge),frameMaterial));}
      if(c.kind==='schematic')for(const sign of [-1,1]){
        const loA=a.clone().addScaledVector(side,sign),loB=b.clone().addScaledVector(side,sign),hiA=loA.clone().add(new THREE.Vector3(0,.95,0)),hiB=loB.clone().add(new THREE.Vector3(0,.95,0));
        const wall=new THREE.BufferGeometry().setFromPoints([loA,hiA,loB,loB,hiA,hiB]);wall.computeVertexNormals();
        world.add(new THREE.Mesh(wall,new THREE.MeshStandardMaterial({color:sign===1?'#e0e2da':'#d2d8d0',roughness:1,side:THREE.DoubleSide})));
      }
    }
    if(c.kind?.includes('schematic')){
      for(const [i,p] of points.entries()){
        if(i!==0&&i!==points.length-1)continue;
        const toward=points[i===0?1:i-1].clone().sub(p);toward.y=0;toward.normalize();
        const side=new THREE.Vector3(-toward.z,0,toward.x).multiplyScalar(corridor+.45);
        const base=p.clone().add(new THREE.Vector3(0,-eyeHeight,0));
        const v=[base.clone().sub(side),base.clone().sub(side).add(new THREE.Vector3(0,2.4,0)),base.clone().add(side).add(new THREE.Vector3(0,2.4,0)),base.clone().add(side)];
        world.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(v),frameMaterial));
      }
    }
  }
}
function initRenderer(){
  world=new THREE.Scene();world.background=new THREE.Color('#e5e7e1');
  camera=new THREE.PerspectiveCamera(66,1,.035,800);camera.up.set(0,1,0);
  renderer=new THREE.WebGLRenderer({antialias:false,alpha:false,powerPreference:'low-power',preserveDrawingBuffer:guardedMode});renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.setPixelRatio(pixelRatio);host.appendChild(renderer.domElement);
  spark=new SparkRenderer({renderer,enableLod:false,accumExtSplats:true,sortRadial:false,onDirty:()=>{dirty=true;},maxPixelRadius:512*pixelRatio});world.add(spark);
  world.add(new THREE.HemisphereLight(0xffffff,0x7e837b,2));const light=new THREE.DirectionalLight(0xffffff,1.4);light.position.set(12,25,9);world.add(light);
  buildConnectors();if(outdoorMode){routeOverlay=createRouteOverlay(route,eyeHeight,cues);routeOverlay.setVisible(false);hudScene=createHudScene(route,eyeHeight,cues);world.add(hudScene.group);}new ResizeObserver(resize).observe(host);resize();yaw=directionAt(distance);setCamera();
  host.addEventListener('pointerdown',e=>{if(e.target!==renderer.domElement||dragging)return;dragging=true;lookTarget=null;lastPointer=[e.clientX,e.clientY];host.setPointerCapture(e.pointerId);host.focus({preventScroll:true});auto=false;updateAuto();});
  host.addEventListener('pointermove',e=>{if(!dragging||!lastPointer||!canRender())return;if(viewMode==='overview'){overviewOrbit-=(e.clientX-lastPointer[0])*.006;lastPointer=[e.clientX,e.clientY];setCamera();return;}yaw-=(e.clientX-lastPointer[0])*.003;pitch=Math.max(-1.1,Math.min(1.1,pitch-(e.clientY-lastPointer[1])*.003));lastPointer=[e.clientX,e.clientY];setCamera();});
  host.addEventListener('pointerup',()=>{dragging=false;lastPointer=null;});host.addEventListener('pointercancel',()=>{dragging=false;lastPointer=null;});
}
async function waitForHeadroom(){while(!canRender()){await new Promise(r=>setTimeout(r,500));}}
async function loadScene(id){
  if(meshes.has(id))return meshes.get(id);if(loading.has(id))return loading.get(id);
  const task=loadQueue.then(async()=>{
    await waitForHeadroom();
    const def=sceneDefs.get(id);if(!def)throw Error(`Unknown model ${id}`);
    // Lazy-load each of the three bounded source models once. Hidden scenes
    // stay cached, avoiding repeated decode/compile spikes on the return walk.
    // Only the current scene (two at the short seam) participates in rendering.
    loadingId=id;status(`Loading ${def.label||id}…`);record('load-start',{sceneId:id});
    const res=await fetch(new URL(def.url,document.baseURI));if(!res.ok)throw Error(`Model request failed (${res.status}).`);
    const fileBytes=new Uint8Array(await res.arrayBuffer());await waitForHeadroom();
    decodeInFlight=true;
    const mesh=new SplatMesh({fileBytes,fileName:def.url.split('/').pop(),extSplats:true,lod:false,enableLod:false});
    try{await mesh.initialized;}catch(e){mesh.dispose();throw e;}finally{decodeInFlight=false;}
    const count=mesh.extSplats?.numSplats??mesh.packedSplats?.numSplats;
    if(count!==def.count){mesh.dispose();throw Error(`Decoded ${count} splats; expected ${def.count}.`);}
    await waitForHeadroom();
    mesh.position.fromArray(def.transform.position);mesh.quaternion.fromArray(def.transform.quaternion);mesh.scale.setScalar(def.transform.scale);mesh.updateMatrixWorld();
    world.add(mesh);meshes.set(id,mesh);updateSceneVisibility();loadingId=null;dirty=true;record('load-end',{sceneId:id,count});return mesh;
  }).catch(e=>{loadError=e.message;loadingId=null;auto=false;updateAuto();status(e.message);$('retry').hidden=false;record('load-error',{sceneId:id,error:e.message});throw e;}).finally(()=>{loading.delete(id);});
  loadQueue=task.catch(()=>{});
  loading.set(id,task);return task;
}
function upcomingScene(d){const index=routeSceneIds.indexOf(sceneAt(d));const next=routeSceneIds[index+1];return next&&sceneStarts.get(next)-d<12?next:null;}
async function ensureScene(d){const id=sceneAt(d);if(!meshes.has(id)){busy=true;await loadScene(id);busy=false;status('');}const upcoming=upcomingScene(d);if(upcoming&&!meshes.has(upcoming)&&loading.size===0&&canRender()){loadScene(upcoming).then(()=>{if(!busy&&!loadError)status('');}).catch(()=>{});}}
async function begin(){
  if(startPending||started||!canRender())return;startPending=true;updateResources();
  try{if(!renderer)initRenderer();busy=true;await loadScene(sceneAt(distance));started=true;$('cover').hidden=true;$('welcome').hidden=true;$('walk-ui').hidden=false;$('route-panel').hidden=!outdoorMode;busy=false;status('');updateAuto();host.focus({preventScroll:true});record('started');}
  catch(e){if(!loadError){loadError='This device could not start the 3D scene. Try again, or open the Columbia map.';status(loadError);$('retry').hidden=false;record('renderer-error',{error:String(e)});}}finally{startPending=false;updateResources();}
}
function updateAuto(){$('auto-walk').innerHTML=auto?'Pause <span aria-hidden="true">Ⅱ</span>':distance>=route.total-.1?'Walk back <span aria-hidden="true">←</span>':outdoorMode?'Walk the route <span aria-hidden="true">→</span>':'Follow the path <span aria-hidden="true">→</span>';$('auto-walk').setAttribute('aria-pressed',String(auto));}
function move(dt){
  if(viewMode==='overview')return false;
  let advance=0,side=0;
  if(auto)advance=autoDirection*speed*dt;
  else if(touchStep)advance=touchStep*speed*dt;
  else{
    const fw=(keys.has('KeyW')||keys.has('ArrowUp')?1:0)-(keys.has('KeyS')||keys.has('ArrowDown')?1:0);
    const lr=(keys.has('KeyD')||keys.has('ArrowRight')?1:0)-(keys.has('KeyA')||keys.has('ArrowLeft')?1:0);
    const point=routeAt(route,distance),forward=[-Math.sin(yaw),0,-Math.cos(yaw)],right=[Math.cos(yaw),0,-Math.sin(yaw)];
    const worldDir=forward.map((v,i)=>fw*v+lr*right[i]);advance=worldDir.reduce((s,v,i)=>s+v*point.tangent[i],0)*speed*dt;side=worldDir.reduce((s,v,i)=>s+v*point.normal[i],0)*speed*dt;
  }
  if(!advance&&!side)return false;
  const next=Math.max(0,Math.min(route.total,distance+advance));
  if(!meshes.has(sceneAt(next))){if(!busy)ensureScene(next).catch(()=>{busy=false;});return false;}
  distance=next;lateral=Math.max(-corridor,Math.min(corridor,lateral+side));
  if(auto){lateral*=Math.exp(-dt*5);const wanted=directionAt(distance)+(autoDirection<0?Math.PI:0);let diff=Math.atan2(Math.sin(wanted-yaw),Math.cos(wanted-yaw));yaw+=diff*Math.min(1,dt*2.5);pitch+=(pitchAt(distance)*autoDirection-pitch)*(1-Math.exp(-dt*3));}
  if(distance===0||distance===route.total){if(outdoorMode&&auto&&distance===route.total&&autoDirection>0)lookTarget=directionAt(route.total)+THREE.MathUtils.degToRad(outdoorDefinition.arrivalHeadingOffsetDegrees||0);auto=false;touchStep=0;updateAuto();record('endpoint',{distance});}
  setCamera();return true;
}
function settleView(dt){
  if(lookTarget===null||viewMode!=='walk')return false;const diff=Math.atan2(Math.sin(lookTarget-yaw),Math.cos(lookTarget-yaw));
  yaw+=diff*(1-Math.exp(-dt*4));if(Math.abs(diff)<.004){yaw=lookTarget;lookTarget=null;}setCamera();return true;
}
function animate(now){
  requestAnimationFrame(animate);
  if(!started||!renderer||!canRender()||busy||decodeInFlight||loadError||$('about-dialog').open){lastTick=now;nextFrameAt=0;fpsWindowStart=0;fpsWindowFrames=0;return;}
  const cap=guardedMode?Math.min(fpsLimit,telemetry?.guard?.fpsLimit||0):fpsLimit;if(!cap)return;
  const interval=1000/cap;
  if(!nextFrameAt||now-nextFrameAt>interval*2)nextFrameAt=now;
  if(now<nextFrameAt)return;
  nextFrameAt+=interval;
  const dt=Math.min(.15,(now-(lastTick||now))/1000);lastTick=now;
  const moved=move(dt);settleView(dt);if(moved)ensureScene(distance).catch(()=>{});
  if(!dirty&&!(outdoorMode&&viewMode==='walk')&&now-lastRender<1500)return;
  const began=performance.now();
  if(outdoorMode)hudScene?.update(distance,viewMode==='overview',autoDirection,reducedMotion.matches?0:now/1000);
  renderer.render(world,camera);
  if(outdoorMode){routeOverlay?.setVisible(viewMode==='overview');if(viewMode==='overview')routeOverlay?.update(distance,true,autoDirection,camera);}
  lastRender=now;frames++;dirty=false;
  if(!fpsWindowStart)fpsWindowStart=now;fpsWindowFrames++;
  if(now-fpsWindowStart>=1000){measuredFps=Number((fpsWindowFrames*1000/(now-fpsWindowStart)).toFixed(1));host.dataset.renderFps=String(measuredFps);fpsWindowStart=now;fpsWindowFrames=0;}
  const took=performance.now()-began;if(guardedMode&&took>50){stickyLowUntil=performance.now()+10000;fpsLimit=8;}
  cameraLast.copy(camera.position);
}
requestAnimationFrame(animate);
$('start').addEventListener('click',begin);
$('auto-walk').addEventListener('click',()=>{if(!started||!canRender())return;lookTarget=null;if(viewMode==='overview'){viewMode='walk';setCamera();}auto=!auto;if(auto){autoDirection=distance>route.total-.1?-1:distance<.1?1:autoDirection;}updateAuto();host.focus({preventScroll:true});record('auto',{enabled:auto});});
$('reset').addEventListener('click',async()=>{if(!canRender())return;auto=false;lookTarget=null;autoDirection=1;viewMode='walk';distance=defaultDistance;updateAuto();lateral=0;pitch=0;yaw=directionAt(distance);setCamera();await ensureScene(distance);record('reset');});
$('retry').addEventListener('click',async()=>{loadError=null;$('retry').hidden=true;busy=false;if(!started)await begin();else await ensureScene(distance).catch(()=>{});});
$('help').addEventListener('click',()=>{$('controls-hint').hidden=!$('controls-hint').hidden;$('help').setAttribute('aria-expanded',String(!$('controls-hint').hidden));});
window.addEventListener('keydown',e=>{if(e.key==='Escape'){auto=false;lookTarget=null;keys.clear();updateAuto();return;}if(!started||!canRender()||e.target.closest('input,button,select,textarea')||$('about-dialog').open||$('map-dialog').open||!['KeyW','KeyS','KeyA','KeyD','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.code))return;e.preventDefault();lookTarget=null;viewMode='walk';keys.add(e.code);auto=false;updateAuto();});
window.addEventListener('keyup',e=>keys.delete(e.code));window.addEventListener('blur',()=>{keys.clear();touchStep=0;});
document.addEventListener('visibilitychange',()=>{keys.clear();touchStep=0;auto=false;updateAuto();lastTick=0;if(!document.hidden){dirty=true;updateResources();poll();}});
for(const b of document.querySelectorAll('[data-step]')){b.addEventListener('pointerdown',e=>{e.preventDefault();if(!canRender())return;lookTarget=null;viewMode='walk';b.setPointerCapture(e.pointerId);touchStep=Number(b.dataset.step);auto=false;updateAuto();});for(const n of ['pointerup','pointercancel'])b.addEventListener(n,()=>touchStep=0);}
for(const [button,dialog] of [['about-open','about-dialog'],['map-open','map-dialog']])$(button).addEventListener('click',()=>{auto=false;lookTarget=null;keys.clear();updateAuto();$(dialog).showModal();updateMap();});
for(const dialog of document.querySelectorAll('dialog')){dialog.querySelector('.dialog-close').addEventListener('click',()=>dialog.close());dialog.addEventListener('close',()=>{if(dialog.id==='map-dialog')unloadMap();dirty=true;host.focus({preventScroll:true});});}
window.addEventListener('message',e=>{if(e.origin!==location.origin||e.source!==$('map-dialog').querySelector('iframe').contentWindow)return;if(e.data?.type==='avery-explore'){if(outdoorMode){location.href=guardedMode?'?experience=connected&resources=guarded':'?experience=connected';return;}$('map-dialog').close();if(!started)begin();}});

$('overview-toggle').addEventListener('click',()=>{if(!started||!canRender())return;auto=false;lookTarget=null;keys.clear();touchStep=0;updateAuto();viewMode=viewMode==='walk'?'overview':'walk';setCamera();record('view',{viewMode});});
$('route-progress').addEventListener('input',e=>{if(!started||!canRender()){e.target.value=String(distance/route.total*100);return;}auto=false;lookTarget=null;keys.clear();touchStep=0;distance=Number(e.target.value)/100*route.total;lateral=0;yaw=directionAt(distance)+(autoDirection<0?Math.PI:0);pitch=0;if(distance>=route.total-.1&&autoDirection>0)lookTarget=directionAt(route.total)+THREE.MathUtils.degToRad(outdoorDefinition.arrivalHeadingOffsetDegrees||0);updateAuto();setCamera();});

// Read-only diagnostics and a route traversal harness for reproducible local QA.
window.campusQA={
  snapshot:()=>({resourceMode:guardedMode?'guarded':'interactive',outdoorMode,viewMode,lookTarget,yaw,auto,autoDirection,routeId:route.id,cues,guide:outdoorMode?guidanceAt(route,cues,distance,autoDirection):null,routeOverlay:!!routeOverlay,started,busy,decodeInFlight,loadError,loadingId,distance,total:route.total,defaultDistance,scene:sceneAt(distance),connector:connectorAt(distance)?.id,loaded:[...meshes.keys()],visible:[...meshes].filter(([,m])=>m.visible).map(([id])=>id),frames,fpsLimit,measuredFps,hud:hudScene?.group.userData.hud,pixelRatio,camera:camera?.position.toArray(),telemetry,policy:policy.state,events:[...events],resourceSamples:[...resourceSamples]}),
  travel:async(d)=>{if(!started)await begin();auto=false;updateAuto();if(!started||!canRender())return;distance=Math.max(0,Math.min(route.total,d));lateral=0;yaw=directionAt(distance);pitch=pitchAt(distance);if(outdoorMode&&distance>=route.total-.1)yaw+=THREE.MathUtils.degToRad(outdoorDefinition.arrivalHeadingOffsetDegrees||0);updateAuto();setCamera();await ensureScene(distance);dirty=true;},
  walk:(direction=1)=>{if(!canRender())return;viewMode='walk';auto=true;autoDirection=direction;updateAuto();},
  pause:()=>{auto=false;lookTarget=null;keys.clear();touchStep=0;updateAuto();},
  config,definition:outdoorDefinition,
};
