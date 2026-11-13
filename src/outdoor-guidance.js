import { makeRoute, routeAt } from './route.js';

const EPSILON = 1e-7;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const cameraId = value => typeof value === 'number'
  ? `frame_${String(value).padStart(6, '0')}` : value;
const separation = (a, b) => Math.hypot(...a.map((v, i) => v - b[i]));

/**
 * Select a contiguous, possibly reversed capture segment from ONE outdoor scene.
 * Coordinates remain unchanged. This does not infer access, shortest paths,
 * metric scale, ground height, entrance identity or a geographic registration.
 */
export function buildOutdoorRoute(config, definition) {
  const { sceneId } = definition;
  const scene = config.scenes.find(item => item.id === sceneId);
  if (!scene || !(scene.environment === 'outdoor' || /^outdoor(?:-|$)/.test(scene.id))) {
    throw new Error('An explicitly outdoor scene is required.');
  }
  const source = config.route.points;
  const startId = cameraId(definition.startCameraId);
  const endId = cameraId(definition.endCameraId);
  const find = id => source.findIndex(p => p.sceneId === sceneId && p.sourceCameraId === id);
  const first = find(startId), last = find(endId);
  if (first < 0 || last < 0) throw new Error('The selected endpoint camera is absent.');
  if (first === last) throw new Error('Choose two distinct endpoint cameras.');
  const points = source.slice(Math.min(first, last), Math.max(first, last) + 1);
  if (points.some(p => p.sceneId !== sceneId || p.kind !== 'capture')) {
    throw new Error('An outdoor route cannot cross a connector or another scene.');
  }
  if (points.some(p => !Array.isArray(p.position) || p.position.length !== 3 || !p.position.every(Number.isFinite))) {
    throw new Error('Every route point needs a finite three-dimensional position.');
  }
  if (last < first) points.reverse();
  const unique = [];
  for (let i = 0; i < points.length; i++) {
    const point = { ...points[i], position: [...points[i].position] };
    if (!unique.length || separation(point.position, unique.at(-1).position) > EPSILON) unique.push(point);
    // Keep the requested arrival camera when two final captures coincide.
    else if (i === points.length - 1 && unique.length > 1) unique[unique.length - 1] = point;
  }
  if (unique.length < 2) throw new Error('The selected cameras have no traversable geometric span.');
  const route = makeRoute(unique);
  if (route.total <= EPSILON) throw new Error('The selected segment has zero length.');
  for (let i = 0; i < route.nodes.length; i++) {
    route.nodes[i].routeForward = routeAt(route, route.nodes[i].distance).tangent;
  }
  return {
    ...route,
    id: definition.id || `${sceneId}:${startId}:${endId}`,
    sceneId,
    metric: false,
    definition: { ...definition },
    start: { label: definition.startLabel || 'Route start', cameraId: startId, position: [...points[0].position] },
    end: { label: definition.endLabel || 'Route end', cameraId: endId, position: [...points.at(-1).position] },
  };
}

function turnKind(angle) {
  if (Math.abs(angle) >= 150) return 'turn-around';
  return angle > 0 ? 'right' : 'left';
}
function turnText(kind) {
  return kind === 'turn-around' ? 'Turn around' : kind === 'right' ? 'Turn right' : 'Turn left';
}

/**
 * Sparse geometric cues using headings on either side of a look-ahead window.
 * All parameters use model display units, NOT metres. Candidate peaks are
 * clustered, then nearby weaker turns are suppressed to reduce capture jitter.
 * Semantic landmarks can be supplied with explicit distance and label. Their
 * wording is supplied by the caller, never inferred from splat geometry.
 */
export function buildTurnCues(route, options = {}) {
  const lookAhead = options.lookAhead ?? 5;
  const sampleStep = options.sampleStep ?? Math.min(1, lookAhead / 3);
  const minSpacing = options.minSpacing ?? lookAhead * 2;
  const thresholdDegrees = options.thresholdDegrees ?? 35;
  if (!(lookAhead > 0 && sampleStep > 0 && minSpacing >= 0 && thresholdDegrees > 0)) {
    throw new Error('Turn cue parameters must be positive.');
  }
  const candidates = [];
  for (let distance = lookAhead; distance <= route.total - lookAhead + EPSILON; distance += sampleStep) {
    const a = routeAt(route, distance - lookAhead).position;
    const b = routeAt(route, distance).position;
    const c = routeAt(route, distance + lookAhead).position;
    const incoming = [b[0] - a[0], b[2] - a[2]];
    const outgoing = [c[0] - b[0], c[2] - b[2]];
    if (Math.hypot(...incoming) < EPSILON || Math.hypot(...outgoing) < EPSILON) continue;
    // Positive rotation in X/Z is a right turn when viewed from above (+Y).
    const angle = Math.atan2(incoming[0] * outgoing[1] - incoming[1] * outgoing[0],
      incoming[0] * outgoing[0] + incoming[1] * outgoing[1]) * 180 / Math.PI;
    if (Math.abs(angle) >= thresholdDegrees) candidates.push({ distance, angle });
  }
  const clusters = [];
  for (const candidate of candidates) {
    const cluster = clusters.at(-1), previous = cluster?.at(-1);
    if (previous && candidate.distance - previous.distance <= sampleStep * 1.51
        && Math.sign(candidate.angle) === Math.sign(previous.angle)) cluster.push(candidate);
    else clusters.push([candidate]);
  }
  const peaks = clusters.map(cluster => {
    const max = Math.max(...cluster.map(c => Math.abs(c.angle)));
    const tied = cluster.filter(c => Math.abs(Math.abs(c.angle) - max) < EPSILON);
    return tied[Math.floor(tied.length / 2)];
  }).sort((a, b) => Math.abs(b.angle) - Math.abs(a.angle));
  const selected = [];
  for (const peak of peaks) {
    if (selected.every(cue => Math.abs(cue.distance - peak.distance) >= minSpacing)) selected.push(peak);
  }
  const turns = selected.map(cue => {
    const kind = turnKind(cue.angle);
    return { ...cue, kind, label: turnText(kind), position: routeAt(route, cue.distance).position, geometric: true };
  });
  const landmarks = options.landmarks ?? route.definition?.landmarks ?? [];
  for (const landmark of landmarks) {
    if (!Number.isFinite(landmark.distance) || landmark.distance < 0 || landmark.distance > route.total || !landmark.label) {
      throw new Error('A landmark needs an in-range distance and a label.');
    }
    turns.push({ ...landmark, kind: 'landmark', position: routeAt(route, landmark.distance).position, geometric: false });
  }
  return turns.sort((a, b) => a.distance - b.distance);
}

/** Progress is relative to travel direction. At arrival, nextCue is null. */
export function guidanceAt(route, cues, distance, direction = 1) {
  if (!Number.isFinite(distance)) throw new Error('Guidance distance must be finite.');
  const sign = direction < 0 ? -1 : 1;
  const d = clamp(distance, 0, route.total);
  const remaining = sign > 0 ? route.total - d : d;
  const tolerance = Math.min(.35, route.total * .01);
  const arrived = remaining <= tolerance;
  const destination = sign > 0 ? route.end?.label || 'Route end' : route.start?.label || 'Route start';
  const ordered = sign > 0 ? cues : [...cues].reverse();
  const source = arrived ? null : ordered.find(cue => sign * (cue.distance - d) >= -tolerance);
  let nextCue = null;
  if (source) {
    const angle = Number.isFinite(source.angle) ? source.angle * sign : null;
    const kind = source.geometric && angle !== null ? turnKind(angle) : source.kind;
    nextCue = { ...source, angle, kind, label: source.geometric ? turnText(kind) : source.label,
      ahead: Math.max(0, sign * (source.distance - d)) };
  }
  return {
    distance: d,
    direction: sign,
    progress: route.total ? clamp(1 - remaining / route.total, 0, 1) : 1,
    remaining,
    arrived,
    destination,
    nextCue,
    instruction: arrived ? `Arrived · ${destination}` : nextCue?.label || `Continue to ${destination}`,
  };
}

/** 3D bounds for a route overview camera; geometry is not flattened or rotated. */
export function routeOverview(route) {
  if (!route.nodes.length) throw new Error('Cannot frame an empty route.');
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const { position } of route.nodes) for (let i = 0; i < 3; i++) {
    min[i] = Math.min(min[i], position[i]); max[i] = Math.max(max[i], position[i]);
  }
  const center = min.map((v, i) => (v + max[i]) / 2);
  const size = min.map((v, i) => max[i] - v);
  const radius = Math.max(...route.nodes.map(p => separation(p.position, center)));
  return { min, max, center, size, radius, horizontalSpan: Math.hypot(size[0], size[2]) };
}
