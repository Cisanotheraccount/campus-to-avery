import * as THREE from 'three';
import { routeAt } from './route.js';
import { hudMarkers } from './hud-markers.js';

// Project world-anchored guidance through the actual scan camera. The small SVG
// layer shares the renderer's update cadence and stops with the resource guard.
// Estimated display height does not establish pavement or scanned occlusion.
export function createRouteOverlay(route, eyeHeight=1.6, cues=[]) {
  const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg');
  svg.classList.add('route-guide');svg.setAttribute('aria-hidden','true');
  document.getElementById('viewport').appendChild(svg);
  const group=new THREE.Group();
  function element(tag,attrs,parent=svg){const e=document.createElementNS(ns,tag);for(const [k,v]of Object.entries(attrs))e.setAttribute(k,v);parent.appendChild(e);return e;}
  const defs=element('defs',{});
  const gradient=element('linearGradient',{id:'hud-blue',x1:'0%',y1:'100%',x2:'0%',y2:'0%'},defs);
  element('stop',{offset:'0%','stop-color':'#3988ce','stop-opacity':.45},gradient);
  element('stop',{offset:'100%','stop-color':'#c7efff','stop-opacity':.92},gradient);
  const overviewLine=element('path',{'data-role':'overview-line',fill:'none',stroke:'#497f9d','stroke-width':3,'stroke-linejoin':'round','stroke-linecap':'round'});
  const overviewArrows=element('path',{'data-role':'overview-arrows',fill:'none',stroke:'#497f9d','stroke-width':2.5,'stroke-linejoin':'round','stroke-linecap':'round'});
  function marker(kind){
    const container=element('g',{'data-role':kind});
    // Two narrow strokes make a soft edge without full-scene bloom or a filter.
    const aura=element('path',{fill:'none',stroke:'#73c9ff','stroke-width':7,'stroke-linejoin':'round',opacity:.12},container);
    const rim=element('path',{fill:'none',stroke:'#7dcaff','stroke-width':3,'stroke-linejoin':'round',opacity:.26},container);
    const body=element('path',{fill:'url(#hud-blue)',stroke:'#d3f2ff','stroke-width':1,'stroke-linejoin':'round'},container);
    return {container,paths:[aura,rim,body]};
  }
  const road=Array.from({length:5},()=>marker('road-chevron'));
  const turn=marker('turn-chevron');
  const dots=[0,1].map(()=>element('circle',{r:6,fill:'#427b98',stroke:'#fff','stroke-width':3}));
  const labels=[route.start?.label||'Start',route.end?.label||'End'].map(label=>{const e=element('text',{'text-anchor':'middle',fill:'#314e5b','font-size':14,'font-weight':500});e.textContent=label;return e;});
  const current=element('circle',{r:5,fill:'#fff',stroke:'#1d4f91','stroke-width':3});
  const asPath=points=>{let pen=false;return points.map(p=>{if(!p){pen=false;return '';}const command=`${pen?'L':'M'}${p.x.toFixed(2)},${p.y.toFixed(2)}`;pen=true;return command;}).join(' ');};
  function paintMarker(marker,path,opacity){
    marker.container.style.display=path&&opacity>.015?'':'none';
    marker.container.setAttribute('opacity',opacity);
    for(const p of marker.paths)p.setAttribute('d',path);
  }
  return {group,setVisible(visible){svg.style.display=visible?'':'none';},update(distance,overview=false,direction=1,camera){
    if(!camera)return;
    const w=svg.clientWidth,h=svg.clientHeight;svg.setAttribute('viewBox',`0 0 ${w} ${h}`);
    const project=v=>{
      const q=v.clone().applyMatrix4(camera.matrixWorldInverse);if(q.z>=-.1)return null;
      v=v.clone().project(camera);return {x:(v.x+1)*w/2,y:(1-v.y)*h/2};
    };
    const floor=d=>new THREE.Vector3(...routeAt(route,d).position).add(new THREE.Vector3(0,-eyeHeight+.06,0));
    const polygon=points=>{const p=points.map(project);return p.every(Boolean)?asPath(p)+' Z':'';};
    overviewLine.style.display=overview?'':'none';overviewArrows.style.display=overview?'':'none';
    if(overview){
      const points=[];for(let d=0;d<route.total;d+=1)points.push(project(floor(d)));points.push(project(floor(route.total)));
      overviewLine.setAttribute('d',asPath(points));
      let arrows='';
      for(let d=3;d<route.total-1;d+=28){
        const p=floor(d),t=routeAt(route,d).tangent,f=new THREE.Vector3(...t).multiplyScalar(direction),s=new THREE.Vector3(-t[2],0,t[0]);
        const projected=[p.clone().addScaledVector(f,-1.8).addScaledVector(s,-1.26),p.clone().addScaledVector(f,.36),p.clone().addScaledVector(f,-1.8).addScaledVector(s,1.26)].map(project);
        if(projected.every(Boolean))arrows+=asPath(projected)+' ';
      }
      overviewArrows.setAttribute('d',arrows);
    }
    const markers=overview?{road:[],turn:null}:hudMarkers(route,distance,direction,cues);
    for(let i=0;i<road.length;i++){
      const m=markers.road[i];
      if(!m){paintMarker(road[i],'',0);continue;}
      const center=new THREE.Vector3(...m.position).add(new THREE.Vector3(0,-eyeHeight+.24,0));
      const f=new THREE.Vector3(...m.forward),s=new THREE.Vector3(...m.normal);
      const shape=[[-.68,-.44],[0,.18],[.68,-.44],[.68,-.12],[0,.52],[-.68,-.12]];
      const path=polygon(shape.map(([x,z])=>center.clone().addScaledVector(s,x).addScaledVector(f,z)));
      road[i].container.setAttribute('data-anchor',m.id);paintMarker(road[i],path,m.opacity*.86);
    }
    if(markers.turn){
      const m=markers.turn,center=new THREE.Vector3(...m.position).add(new THREE.Vector3(0,-eyeHeight+.92,0));
      const side=new THREE.Vector3(...m.normal),up=new THREE.Vector3(0,1,0),sign=m.kind==='right'?1:-1;
      const shape=[[-.21,.40],[.19,0],[-.21,-.40],[-.04,-.40],[.36,0],[-.04,.40]];
      let path='';
      for(const offset of [-.58,0,.58])path+=polygon(shape.map(([x,y])=>center.clone().addScaledVector(side,(x+offset)*sign).addScaledVector(up,y)))+' ';
      turn.container.setAttribute('data-kind',m.kind);paintMarker(turn,path.trim(),m.opacity*.9);
    }else paintMarker(turn,'',0);
    for(let i=0;i<2;i++){
      const d=i?route.total:0,p=project(floor(d)),show=!!p&&(overview||Math.abs(distance-d)<10);
      dots[i].style.display=show?'':'none';labels[i].style.display=show&&overview?'':'none';
      if(p){dots[i].setAttribute('cx',p.x);dots[i].setAttribute('cy',p.y);labels[i].setAttribute('x',p.x);labels[i].setAttribute('y',p.y-17);}
    }
    const p=project(floor(distance));current.style.display=overview&&p?'':'none';if(p){current.setAttribute('cx',p.x);current.setAttribute('cy',p.y);}
  }};
}
