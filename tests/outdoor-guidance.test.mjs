import test from 'node:test';
import assert from 'node:assert/strict';
import { makeRoute, routeAt } from '../src/route.js';
import { buildOutdoorRoute, buildTurnCues, guidanceAt, routeOverview } from '../src/outdoor-guidance.js';

const point = (id, position, extra = {}) => ({ sourceCameraId: `frame_${String(id).padStart(6, '0')}`, position, sceneId: 'outdoor-main', kind: 'capture', ...extra });
const config = points => ({ scenes: [{ id: 'outdoor-main' }, { id: 'indoor' }], route: { points } });
const definition = { sceneId: 'outdoor-main', startCameraId: 0, endCameraId: 3, startLabel: 'Verified start', endLabel: 'Verified building entrance' };
const rightAngle = () => buildOutdoorRoute(config([point(0,[0,2,0]),point(1,[20,2,0]),point(2,[20,2,20]),point(3,[20,2,40])]),definition);

test('outdoor selection preserves source coordinates, clamps endpoints and supports reverse', () => {
  const input = config([point(0,[0,2,0]),point(1,[20,2,0]),point(2,[20,2,20]),point(3,[20,2,40])]);
  const snapshot = JSON.stringify(input);
  const forward = buildOutdoorRoute(input, definition);
  const reverse = buildOutdoorRoute(input, { ...definition, startCameraId: 3, endCameraId: 0, startLabel: definition.endLabel, endLabel: definition.startLabel });
  assert.equal(forward.total, 60);
  assert.deepEqual(routeAt(forward,-100).position,[0,2,0]);
  assert.deepEqual(routeAt(forward,100).position,[20,2,40]);
  assert.deepEqual(reverse.nodes.map(p=>p.position), [...forward.nodes].reverse().map(p=>p.position));
  assert.deepEqual(routeAt(reverse,0).tangent,[0,0,-1]);
  assert.equal(JSON.stringify(input), snapshot);
  reverse.nodes[0].position[0] = 999;
  assert.equal(JSON.stringify(input), snapshot);
});

test('missing, indoor, connector, cross-scene and degenerate selections fail explicitly', () => {
  const input = config([point(0,[0,0,0]),point(1,[1,0,0]),point(2,[2,0,0]),point(3,[3,0,0])]);
  assert.throws(()=>buildOutdoorRoute(input,{...definition,endCameraId:99}),/absent/);
  assert.throws(()=>buildOutdoorRoute(input,{...definition,sceneId:'indoor'}),/outdoor/);
  assert.throws(()=>buildOutdoorRoute(input,{...definition,endCameraId:0}),/distinct/);
  input.route.points[1].kind='connector';
  assert.throws(()=>buildOutdoorRoute(input,definition),/connector/);
  input.route.points[1].kind='capture'; input.route.points[1].sceneId='indoor';
  assert.throws(()=>buildOutdoorRoute(input,definition),/another scene/);
  assert.throws(()=>buildOutdoorRoute(config([point(0,[0,0,0]),point(3,[0,0,0])]),definition),/geometric span/);
});

test('coincident captures are removed without dropping the chosen arrival identity', () => {
  const route=buildOutdoorRoute(config([point(0,[0,1,0]),point(1,[0,1,0]),point(2,[4,1,0]),point(3,[4,1,0])]),definition);
  assert.equal(route.nodes.length,2);
  assert.equal(route.nodes[0].sourceCameraId,'frame_000000');
  assert.equal(route.nodes.at(-1).sourceCameraId,'frame_000003');
  assert.equal(route.total,4);
});

test('a right-angle bend yields one right cue; reverse travel swaps its turn', () => {
  const route=rightAngle(), cues=buildTurnCues(route,{lookAhead:5,minSpacing:10,sampleStep:.5});
  assert.equal(cues.length,1);
  assert.equal(cues[0].kind,'right');
  assert.equal(cues[0].distance,20);
  const reverse = guidanceAt(route,cues,35,-1);
  assert.equal(reverse.nextCue.kind,'left');
  assert.equal(reverse.nextCue.label,'Turn left');
  assert.equal(reverse.nextCue.ahead,15);
  assert.equal(reverse.destination,definition.startLabel);
});

test('straight and gently jittering captures do not create turn instructions', () => {
  const route=makeRoute(Array.from({length:51},(_,i)=>({position:[i*2,2,Math.sin(i)*.08]})));
  assert.deepEqual(buildTurnCues(route),[]);
});

test('guidance arrival and progress are bounded in both directions; no stale cue on arrival', () => {
  const route=rightAngle(), cues=buildTurnCues(route);
  const start=guidanceAt(route,cues,-20), end=guidanceAt(route,cues,100);
  assert.equal(start.progress,0); assert.equal(start.arrived,false);
  assert.equal(end.progress,1); assert.equal(end.arrived,true); assert.equal(end.nextCue,null);
  assert.equal(end.instruction,`Arrived · ${definition.endLabel}`);
  const returnStart=guidanceAt(route,cues,60,-1), returnEnd=guidanceAt(route,cues,-2,-1);
  assert.equal(returnStart.progress,0); assert.equal(returnEnd.progress,1);
  assert.equal(returnEnd.instruction,`Arrived · ${definition.startLabel}`);
  assert.throws(()=>guidanceAt(route,cues,NaN),/finite/);
});

test('landmark wording stays explicit and route bounds include elevation', () => {
  const route=rightAngle();
  const cues=buildTurnCues(route,{landmarks:[{distance:45,label:'Pass the photographed arch'}]});
  assert.equal(guidanceAt(route,cues,30).nextCue.label,'Pass the photographed arch');
  const overview=routeOverview(route);
  assert.deepEqual(overview.min,[0,2,0]); assert.deepEqual(overview.max,[20,2,40]);
  assert.deepEqual(overview.center,[10,2,20]); assert.equal(overview.radius,Math.sqrt(500));
  assert.throws(()=>buildTurnCues(route,{landmarks:[{distance:100,label:'Outside route'}]}),/in-range/);
});
