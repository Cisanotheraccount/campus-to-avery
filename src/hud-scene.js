import * as THREE from 'three';
import { hudMarkers } from './hud-markers.js';
import { routeAt } from './route.js';

const HALF_WIDTH = .62, SAMPLE_STEP = .5, LOOK_AHEAD = 18, EPSILON = 1e-7;
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

function ribbonGeometry(route, eyeHeight) {
  // Every original capture vertex is retained: no spline shortcuts at bends.
  const distances = new Set(route.nodes.map(node => node.distance));
  for (let d = SAMPLE_STEP; d < route.total; d += SAMPLE_STEP) distances.add(d);
  distances.add(0); distances.add(route.total);
  const stations = [...distances].sort((a, b) => a - b);
  const samples = stations.map(distance => routeAt(route, distance).position);
  const positions = [], across = [], arc = [], indices = [];
  function normalAt(index, direction) {
    const center = samples[index];
    for (let i = index + direction; i >= 0 && i < samples.length; i += direction) {
      const dx = (samples[i][0] - center[0]) * direction;
      const dz = (samples[i][2] - center[2]) * direction;
      const length = Math.hypot(dx, dz);
      if (length > EPSILON) return [-dz / length, dx / length];
    }
    return null;
  }
  for (let i = 0; i < samples.length; i++) {
    const before = normalAt(i, -1), after = normalAt(i, 1);
    const a = before || after || [1, 0], b = after || before || [1, 0];
    let nx = a[0] + b[0], nz = a[1] + b[1], length = Math.hypot(nx, nz);
    if (length < EPSILON) { nx = b[0]; nz = b[1]; length = 1; }
    nx /= length; nz /= length;
    // Bound joints even at hairpins, keeping the center on the source route.
    const offset = Math.min(HALF_WIDTH * 1.35, HALF_WIDTH / Math.max(.01, nx * b[0] + nz * b[1]));
    for (const side of [-1, 1]) {
      positions.push(samples[i][0] + side * nx * offset,
        samples[i][1] - eyeHeight + .035, samples[i][2] + side * nz * offset);
      across.push(side); arc.push(stations[i]);
    }
    if (i < samples.length - 1) {
      const j = i * 2;
      indices.push(j, j + 1, j + 2, j + 1, j + 3, j + 2);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('aAcross', new THREE.Float32BufferAttribute(across, 1));
  geometry.setAttribute('aDistance', new THREE.Float32BufferAttribute(arc, 1));
  geometry.setIndex(indices);
  geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  return geometry;
}

/**
 * Translucent pavement guidance following the recorded camera trajectory.
 * Lengths are uncalibrated display units. Height is camera minus estimated eye
 * height, NOT a surveyed floor mesh. Splat depth is not a verified occluder;
 * the guide is restricted to the incoming leg at the next geometric turn.
 */
export function createHudScene(route, eyeHeight = 1.6, cues = []) {
  if (!Number.isFinite(eyeHeight)) throw new Error('HUD eye height must be finite.');
  hudMarkers(route, 0);
  if (route.nodes.some(node => !Number.isFinite(node.distance) || !Array.isArray(node.position) ||
      node.position.length !== 3 || !node.position.every(Number.isFinite))) {
    throw new Error('HUD route coordinates must be finite.');
  }
  const group = new THREE.Group();
  group.name = 'world-hud'; group.renderOrder = 1000;
  const state = { roadCount: 0, turnKind: null };
  group.userData.hud = state;
  group.userData.occlusion = 'Translucent AR guide; estimated ground height, no measured scan occlusion';
  group.userData.style = 'pavement-ribbon';
  const turns = cues.filter(cue => cue.geometric === true && ['left', 'right'].includes(cue.kind) &&
    Number.isFinite(cue.distance) && cue.distance >= 0 && cue.distance <= route.total);
  const uniforms = {
    uDistance: { value: 0 }, uDirection: { value: 1 }, uFar: { value: LOOK_AHEAD },
    uTime: { value: 0 }, uColor: { value: new THREE.Color('#8ccdea') },
  };
  const material = new THREE.ShaderMaterial({
    uniforms, transparent: true, depthTest: false, depthWrite: false,
    side: THREE.DoubleSide, toneMapped: false,
    vertexShader: `
      attribute float aAcross;
      attribute float aDistance;
      varying float vAcross;
      varying float vDistance;
      void main() {
        vAcross = aAcross; vDistance = aDistance;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform float uDistance;
      uniform float uDirection;
      uniform float uFar;
      uniform float uTime;
      uniform vec3 uColor;
      varying float vAcross;
      varying float vDistance;
      void main() {
        float ahead = (vDistance - uDistance) * uDirection;
        if (ahead < 1.25 || ahead > uFar) discard;
        float nearFade = smoothstep(1.25, 2.8, ahead);
        float farFade = 1.0 - smoothstep(max(1.25, uFar - 2.5), uFar, ahead);
        float side = abs(vAcross);
        float softEdge = 1.0 - smoothstep(.72, 1.0, side);
        float edge = smoothstep(.68, .85, side) * (1.0 - smoothstep(.85, .99, side));
        // Low contrast light flows toward the destination. No bloom/postprocess.
        float phase = (vDistance * uDirection - uTime * .85) / 6.5;
        float pulse = pow(.5 + .5 * cos(phase * 6.2831853), 10.0);
        // Sparse V marks belong to the same transparent surface, not 3D blocks.
        float cycle = mod(vDistance * uDirection + 580.0, 5.8);
        float tip = 2.9 + .48 * (1.0 - side / .62);
        float chevron = (1.0 - smoothstep(.025, .11, abs(cycle - tip))) *
          (1.0 - smoothstep(.52, .67, side));
        float alpha = (.15 * softEdge + .10 * edge + .065 * pulse * softEdge + .16 * chevron) * nearFade * farFade;
        if (alpha < .003) discard;
        vec3 color = mix(uColor, vec3(.88, .97, 1.0), clamp(.25 * edge + .45 * chevron, 0.0, 1.0));
        gl_FragColor = vec4(color, alpha);
        #include <colorspace_fragment>
      }
    `,
  });
  const geometry = ribbonGeometry(route, eyeHeight);
  const ribbon = new THREE.Mesh(geometry, material);
  ribbon.name = 'hud-road-ribbon'; ribbon.renderOrder = 1000; ribbon.frustumCulled = false;
  group.add(ribbon);
  let disposed = false;
  function update(distance, overview = false, direction = 1, timeSeconds = 0) {
    if (disposed) return;
    if (!Number.isFinite(distance) || !Number.isFinite(direction)) throw new Error('HUD distance and direction must be finite.');
    group.visible = !overview; state.roadCount = 0; state.turnKind = null;
    if (overview) return;
    const d = clamp(distance, 0, route.total), sign = direction < 0 ? -1 : 1;
    let far = Math.min(LOOK_AHEAD, sign > 0 ? route.total - d : d);
    let next = null, nextAhead = Infinity;
    for (let i = 0; i < turns.length; i++) {
      const ahead = sign * (turns[i].distance - d);
      if (ahead > .35 && ahead <= LOOK_AHEAD && ahead < nextAhead) {
        next = turns[i]; nextAhead = ahead;
      }
    }
    if (next) {
      far = Math.min(far, nextAhead + .1);
      state.turnKind = sign > 0 ? next.kind : (next.kind === 'right' ? 'left' : 'right');
    }
    uniforms.uDistance.value = d; uniforms.uDirection.value = sign;
    uniforms.uFar.value = far; uniforms.uTime.value = Number.isFinite(timeSeconds) ? timeSeconds : 0;
    ribbon.visible = far > 1.3; state.roadCount = ribbon.visible ? 1 : 0;
  }
  function dispose() {
    if (disposed) return;
    disposed = true; group.visible = false; state.roadCount = 0; state.turnKind = null;
    geometry.dispose(); material.dispose(); group.removeFromParent();
  }
  update(0);
  return { group, update, dispose };
}
