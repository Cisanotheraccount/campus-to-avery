import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {makeRoute} from '../src/route.js';
import {createRouteOverlay} from '../src/route-overlay.js';

test('projected guide breaks across the camera plane and updates viewport size',()=>{
  const previous=globalThis.document;
  const nodes=[];
  const node=tag=>({tag,attrs:{},children:[],style:{},classList:{add(){}},clientWidth:1360,clientHeight:900,setAttribute(k,v){this.attrs[k]=String(v);},appendChild(x){this.children.push(x);}});
  const host=node('host');
  globalThis.document={createElementNS(_ns,tag){const el=node(tag);nodes.push(el);return el;},getElementById(){return host;}};
  try{
    // Two visible legs separated by a section behind the viewer.
    const route=makeRoute([[-1,1.6,-2],[-1,1.6,2],[1,1.6,2],[1,1.6,-2]].map(position=>({position})));
    const overlay=createRouteOverlay(route),camera=new THREE.PerspectiveCamera(66,1360/900,.035,800);
    camera.position.set(0,1.6,0);camera.lookAt(0,1.6,-1);camera.updateMatrixWorld();
    overlay.update(0,true,1,camera);
    const svg=nodes.find(x=>x.tag==='svg'),path=nodes.find(x=>x.attrs['data-role']==='overview-line');
    assert.equal((path.attrs.d.match(/M/g)||[]).length,2,'A hidden section must not become a connecting line');
    assert.doesNotMatch(path.attrs.d,/NaN|Infinity/);
    svg.clientWidth=390;svg.clientHeight=844;camera.aspect=390/844;camera.updateProjectionMatrix();
    overlay.update(0,true,1,camera);assert.equal(svg.attrs.viewBox,'0 0 390 844');
  }finally{globalThis.document=previous;}
});
