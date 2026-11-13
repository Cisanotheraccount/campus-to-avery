import test from 'node:test';
import assert from 'node:assert/strict';
import { makeRoute, routeAt } from '../src/route.js';
import { createHudScene } from '../src/hud-scene.js';

const route = () => makeRoute([{position:[0,1.6,0]},{position:[20,1.6,0]},{position:[20,1.6,20]}]);
const cues = [{distance:20,geometric:true,kind:'right'}];
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 2e-5, `${actual} != ${expected}`);
const ribbon = hud => hud.group.getObjectByName('hud-road-ribbon');

test('ribbon preserves the source route centerline and estimated floor at bends', () => {
  const source = route(), original = JSON.stringify(source), hud = createHudScene(source,1.6,cues);
  const mesh = ribbon(hud), { position, aDistance, aAcross } = mesh.geometry.attributes;
  assert.equal(hud.group.children.length,1);
  assert.ok(mesh.material.isShaderMaterial && mesh.material.transparent);
  assert.equal(mesh.material.depthWrite,false);
  assert.ok(position.array.every(Number.isFinite));
  for (let i = 0; i < position.count; i += 2) {
    const p = routeAt(source,aDistance.getX(i)).position;
    near((position.getX(i) + position.getX(i+1))/2,p[0]);
    near((position.getZ(i) + position.getZ(i+1))/2,p[2]);
    near(position.getY(i),p[1]-1.6+.035); near(position.getY(i+1),position.getY(i));
    assert.ok(Math.hypot(position.getX(i)-p[0],position.getZ(i)-p[2]) <= .62 * 1.35 + 2e-5);
    near(aAcross.getX(i),-1); near(aAcross.getX(i+1),1);
  }
  assert.ok([...aDistance.array].includes(20));
  assert.equal(JSON.stringify(source),original);
  hud.dispose();
});

test('forward and return windows end on the incoming leg of the next turn', () => {
  const hud = createHudScene(route(),1.6,cues), u = ribbon(hud).material.uniforms;
  for (const [distance,direction,kind] of [[12,1,'right'],[28,-1,'left']]) {
    hud.update(distance,false,direction,2);
    assert.deepEqual(hud.group.userData.hud,{roadCount:1,turnKind:kind});
    near(u.uDistance.value,distance); near(u.uDirection.value,direction);
    near(u.uFar.value,8.1); near(u.uTime.value,2);
  }
  hud.update(19,false,1); near(u.uFar.value,1.1);
  assert.equal(ribbon(hud).visible,false);
  hud.update(21,false,1); near(u.uFar.value,18);
  assert.equal(hud.group.userData.hud.turnKind,null);
  assert.equal(ribbon(hud).visible,true);
  hud.dispose();
});

test('endpoints and overview hide guidance; reverse travel changes direction', () => {
  const hud = createHudScene(route(),1.6,cues), u = ribbon(hud).material.uniforms;
  hud.update(40,false,1); assert.equal(ribbon(hud).visible,false);
  hud.update(0,false,-1); assert.equal(ribbon(hud).visible,false);
  hud.update(12,true,1);
  assert.equal(hud.group.visible,false);
  assert.deepEqual(hud.group.userData.hud,{roadCount:0,turnKind:null});
  hud.update(12,false,-1); assert.equal(hud.group.visible,true);
  near(u.uDirection.value,-1); near(u.uFar.value,12);
  hud.dispose();
});

test('hairpins and vertical source segments remain finite without miter spikes', () => {
  const r = makeRoute([{position:[0,1.6,0]},{position:[10,1.6,0]},
    {position:[.05,2.1,.05]},{position:[.05,3.1,.05]}]);
  const hud = createHudScene(r), attributes = ribbon(hud).geometry.attributes;
  assert.ok(attributes.position.array.every(Number.isFinite));
  for (let i=0;i<attributes.position.count;i+=2) {
    const p = routeAt(r,attributes.aDistance.getX(i)).position;
    assert.ok(Math.hypot(attributes.position.getX(i)-p[0],attributes.position.getZ(i)-p[2]) <= .62*1.35+2e-5);
  }
  hud.dispose();
});

test('updates reuse buffers and objects; disposal is idempotent', () => {
  const hud = createHudScene(route(),1.6,cues), mesh = ribbon(hud);
  const geometry = mesh.geometry, material = mesh.material, uniforms = material.uniforms;
  const positions = geometry.attributes.position.array;
  let disposals = 0;
  geometry.addEventListener('dispose',()=>disposals++); material.addEventListener('dispose',()=>disposals++);
  for (let step = 0; step <= 40; step++) hud.update(step,false,step%2 ? 1 : -1,step/30);
  assert.equal(ribbon(hud),mesh); assert.equal(mesh.geometry,geometry);
  assert.equal(geometry.attributes.position.array,positions);
  assert.equal(mesh.material,material); assert.equal(material.uniforms,uniforms);
  hud.dispose(); hud.dispose();
  assert.equal(disposals,2); assert.equal(hud.group.visible,false);
});
