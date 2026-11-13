import test from 'node:test';
import assert from 'node:assert/strict';
import { makeRoute } from '../src/route.js';
import { hudMarkers } from '../src/hud-markers.js';

const route = positions => makeRoute(positions.map(position => ({ position })));
const straight = () => route([[0, 1.6, 0], [100, 1.6, 0]]);
const finiteUnit = vector => {
  assert.ok(vector.every(Number.isFinite));
  assert.ok(Math.abs(Math.hypot(...vector) - 1) < 1e-9);
};

test('HUD arrows stay at stable world anchors and only preview the forward interval', () => {
  const r = straight(), before = JSON.stringify(r);
  const a = hudMarkers(r, 10), b = hudMarkers(r, 10.4);
  assert.ok(a.road.length > 0 && a.road.length <= 5);
  for (const marker of a.road) {
    assert.ok(marker.ahead >= 3 && marker.ahead <= 21);
    assert.ok(marker.distance >= 0 && marker.distance <= r.total);
    assert.equal(marker.distance % 4.5, 0);
    assert.deepEqual(marker.position, [marker.distance, 1.6, 0]);
    assert.deepEqual(marker.forward, [1, 0, 0]);
    assert.deepEqual(marker.normal, [0, 0, 1]);
    assert.ok(marker.opacity >= 0 && marker.opacity <= 1);
    const same = b.road.find(other => other.id === marker.id);
    if (same) assert.deepEqual(same.position, marker.position);
  }
  assert.equal(JSON.stringify(r), before);
  a.road[0].position[0] = 999;
  assert.equal(JSON.stringify(r), before);
});

test('return arrows reverse orientation and use only the interval behind source distance', () => {
  const markers = hudMarkers(straight(), 30, -1).road;
  assert.equal(markers.length, 5);
  assert.deepEqual(markers.map(m => m.distance), [27, 22.5, 18, 13.5, 9]);
  for (const marker of markers) {
    assert.equal(marker.ahead, 30 - marker.distance);
    assert.deepEqual(marker.forward, [-1, 0, 0]);
    assert.deepEqual(marker.normal, [0, 0, -1]);
    finiteUnit(marker.forward); finiteUnit(marker.normal);
  }
  assert.equal(markers[0].opacity, 0);
  assert.equal(markers.at(-1).opacity, 0);
  assert.ok(markers[2].opacity > .99);
});

test('route ends and out-of-range positions never invent markers beyond the capture', () => {
  const r = route([[0, 2, 0], [10, 2, 0]]);
  assert.deepEqual(hudMarkers(r, 9).road, []);
  assert.deepEqual(hudMarkers(r, 1, -1).road, []);
  assert.deepEqual(hudMarkers(r, 100).road, []);
  assert.deepEqual(hudMarkers(r, -100, -1).road, []);
  const all = [...hudMarkers(r, -100).road, ...hudMarkers(r, 100, -1).road];
  assert.ok(all.every(m => m.distance >= 0 && m.distance <= 10));
});

test('turn marker uses incoming leg and swaps left/right for the return', () => {
  const r = route([[0, 2, 0], [20, 2, 0], [20, 2, 20]]);
  const cues = [{distance:20,kind:'right',label:'Turn right',geometric:true}];
  const forward = hudMarkers(r, 10, 1, cues).turn;
  assert.equal(forward.kind, 'right'); assert.equal(forward.ahead, 10);
  assert.deepEqual(forward.position, [20,2,0]);
  assert.deepEqual(forward.forward, [1,0,0]);
  assert.deepEqual(forward.normal, [0,0,1]);
  const reverse = hudMarkers(r, 30, -1, cues).turn;
  assert.equal(reverse.kind,'left'); assert.equal(reverse.label,'Turn left');
  assert.deepEqual(reverse.forward,[0,0,-1]);
  assert.deepEqual(reverse.normal,[1,0,0]);
  assert.equal(hudMarkers(r, 19, 1, cues).turn,null);
  assert.equal(hudMarkers(r, 0, 1, cues).turn,null);
});

test('nearest valid turn wins; landmarks and vertical-only headings do not create arrows', () => {
  const r = straight();
  const cues = [
    {distance:18,kind:'left',geometric:true},
    {distance:12,kind:'right',geometric:true},
    {distance:9,kind:'left',geometric:false},
    {distance:8,kind:'turn-around',geometric:true},
    {distance:Infinity,kind:'right',geometric:true},
  ];
  assert.equal(hudMarkers(r, 5, 1, cues).turn.distance,12);
  assert.deepEqual(hudMarkers(route([[0,0,0],[0,30,0]]), 0),{road:[],turn:null});
  assert.throws(()=>hudMarkers(r,NaN),/finite/);
  assert.throws(()=>hudMarkers(r,0,Infinity),/finite/);
});

test('approaching a turn hides outgoing pavement markers in both travel directions', () => {
  const r = route([[0,2,0],[20,2,0],[20,2,20]]);
  const cues = [{distance:20,kind:'right',geometric:true}];
  for (const [distance, direction, expected] of [[12,1,[18]],[28,-1,[22.5]]]) {
    const markers = hudMarkers(r,distance,direction,cues);
    assert.ok(markers.turn);
    assert.deepEqual(markers.road.map(marker => marker.distance), expected);
    assert.ok(hudMarkers(r,distance,direction).road.length > markers.road.length);
    assert.ok(markers.road.every(marker => direction * (marker.distance - 20) <= .3));
  }
  for (const [distance,direction] of [[21,1],[19,-1]]) {
    const after = hudMarkers(r,distance,direction,cues);
    assert.equal(after.turn,null);
    assert.ok(after.road.length > 0);
    assert.ok(after.road.every(marker => direction * (marker.distance - 20) > 0));
    assert.deepEqual(after.road,hudMarkers(r,distance,direction).road);
  }
});

test('turn boundary allows a small anchor tolerance and clips anything further', () => {
  const r = straight();
  const turnAt = distance => [{distance,kind:'right',geometric:true}];
  assert.ok(hudMarkers(r,12,1,turnAt(22.2)).road.some(marker => marker.distance === 22.5));
  assert.ok(!hudMarkers(r,12,1,turnAt(22.19)).road.some(marker => marker.distance === 22.5));
  assert.ok(hudMarkers(r,28,-1,turnAt(18.3)).road.some(marker => marker.distance === 18));
  assert.ok(!hudMarkers(r,28,-1,turnAt(18.31)).road.some(marker => marker.distance === 18));
});
