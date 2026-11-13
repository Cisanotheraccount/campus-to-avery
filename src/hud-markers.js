import { routeAt } from './route.js';

const SPACING = 4.5;
const EPSILON = 1e-7;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const smoothstep = value => {
  const t = clamp(value, 0, 1);
  return t * t * (3 - 2 * t);
};
const fade = (ahead, near, solidNear, solidFar, far) =>
  smoothstep((ahead - near) / (solidNear - near)) *
  smoothstep((far - ahead) / (far - solidFar));

function headingBetween(route, first, last) {
  const a = routeAt(route, clamp(first, 0, route.total)).position;
  const b = routeAt(route, clamp(last, 0, route.total)).position;
  const dx = b[0] - a[0], dz = b[2] - a[2], length = Math.hypot(dx, dz);
  if (length < EPSILON) return null;
  const forward = [dx / length, 0, dz / length].map(v => v === 0 ? 0 : v);
  return { forward, normal: [-forward[2], 0, forward[0]].map(v => v === 0 ? 0 : v) };
}

/**
 * World-anchored AR-HUD chevrons for a captured route. All coordinates and
 * spacing are uncalibrated display units, never metres. Positions stay at the
 * original capture-camera height; the renderer applies its display-only lift.
 * No timing loop, mutation, GPU operation, path shortcut or new route is used.
 */
export function hudMarkers(route, distance, direction = 1, cues = []) {
  if (!Number.isFinite(distance) || !Number.isFinite(direction)) {
    throw new Error('HUD distance and direction must be finite.');
  }
  if (!route || !Array.isArray(route.nodes) || route.nodes.length < 2 ||
      !Number.isFinite(route.total) || route.total <= 0) {
    throw new Error('HUD markers need a non-empty, positive-length route.');
  }
  const d = clamp(distance, 0, route.total), sign = direction < 0 ? -1 : 1;
  const firstIndex = sign > 0 ? Math.ceil((d + 3) / SPACING) : Math.floor((d - 3) / SPACING);
  const road = [];
  for (let i = firstIndex; road.length < 5; i += sign) {
    const anchor = i * SPACING, ahead = sign * (anchor - d);
    if (anchor < 0 || anchor > route.total || ahead > 21 + EPSILON) break;
    if (ahead < 3 - EPSILON) continue;
    const frame = headingBetween(route, anchor - sign * .6, anchor + sign * .6);
    // A purely vertical source segment does not establish a pavement heading.
    if (!frame) continue;
    road.push({
      id: `${route.id || 'route'}:hud:${i}`,
      distance: anchor,
      ahead,
      position: [...routeAt(route, anchor).position],
      ...frame,
      opacity: fade(ahead, 3, 5, 14, 21),
    });
  }

  const next = cues.filter(cue => cue.geometric === true && ['left', 'right'].includes(cue.kind) &&
    Number.isFinite(cue.distance) && cue.distance >= 0 && cue.distance <= route.total)
    .map(cue => ({ cue, ahead: sign * (cue.distance - d) }))
    .filter(({ ahead }) => ahead >= 2 && ahead <= 18)
    .sort((a, b) => a.ahead - b.ahead)[0];
  let turn = null;
  if (next) {
    const { cue, ahead } = next;
    // Face the incoming leg, rather than the outgoing tangent at a sharp bend.
    const frame = headingBetween(route, cue.distance - sign * 2.4, cue.distance - sign * .3);
    if (frame) {
      const kind = sign < 0 ? (cue.kind === 'right' ? 'left' : 'right') : cue.kind;
      turn = {
        kind,
        label: kind === 'right' ? 'Turn right' : 'Turn left',
        distance: cue.distance,
        ahead,
        position: [...routeAt(route, cue.distance).position],
        ...frame,
        opacity: fade(ahead, 2, 4, 13, 18),
      };
    }
  }
  // The screen-space layer cannot occlude guidance behind a bend. Keep its
  // ground markers on the incoming leg while the standing turn cue is shown.
  const visibleRoad = turn
    ? road.filter(marker => sign * (marker.distance - turn.distance) <= .3 + EPSILON)
    : road;
  return { road: visibleRoad, turn };
}
