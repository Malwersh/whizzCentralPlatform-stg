'use strict';

const BigNumber = require('bignumber.js');
const RBush = require('rbush');
const { lineString } = require('@turf/helpers');
const { length } = require('@turf/length');

const samePoint = (a, b) => a[0] === b[0] && a[1] === b[1];
const bounds = (a, b) => ({
  minX: Math.min(a[0], b[0]), minY: Math.min(a[1], b[1]),
  maxX: Math.max(a[0], b[0]), maxY: Math.max(a[1], b[1]),
});

function rings(geometry) {
  if (geometry?.type === 'Polygon') return geometry.coordinates;
  if (geometry?.type === 'MultiPolygon') return geometry.coordinates.flat();
  return [];
}

function edges(geometry) {
  return rings(geometry).flatMap(ring => ring.slice(1).map((b, index) => {
    const a = ring[index];
    return { a, b, ...bounds(a, b) };
  }));
}

function collinear(a, b, point) {
  if (samePoint(point, a) || samePoint(point, b)) return true;
  if (a[0] === b[0]) return point[0] === a[0];
  if (a[1] === b[1]) return point[1] === a[1];
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const x = point[0] - a[0], y = point[1] - a[1];
  const roundoff = 1440 * Number.EPSILON * (Math.abs(dx) + Math.abs(dy) + Math.abs(x) + Math.abs(y));
  if (Math.abs(dx * y - dy * x) > roundoff) return false;
  // Near zero, compare the stored decimal coordinates exactly instead of accepting a gap.
  const difference = (first, second) => new BigNumber(first).minus(second);
  return difference(b[0], a[0]).times(difference(point[1], a[1]))
    .eq(difference(b[1], a[1]).times(difference(point[0], a[0])));
}

/** Positive-length common interval, parameterized along the first segment. */
function sharedInterval(a, b, c, d) {
  if (samePoint(a, b) || samePoint(c, d) || !collinear(a, b, c) || !collinear(a, b, d)) return null;
  const axis = Math.abs(b[0] - a[0]) >= Math.abs(b[1] - a[1]) ? 0 : 1;
  const delta = b[axis] - a[axis];
  const from = (c[axis] - a[axis]) / delta, to = (d[axis] - a[axis]) / delta;
  const start = Math.max(0, Math.min(from, to)), end = Math.min(1, Math.max(from, to));
  return start < end ? [start, end] : null;
}

function sharedBoundaryKm(first, second) {
  const index = new RBush().load(edges(second));
  let km = 0;
  for (const edge of edges(first)) {
    const { a, b } = edge;
    const intervals = index.search(edge).map(other => sharedInterval(a, b, other.a, other.b))
      .filter(Boolean).sort((left, right) => left[0] - right[0]);
    const merged = [];
    for (const interval of intervals) {
      const previous = merged.at(-1);
      if (previous && interval[0] <= previous[1]) previous[1] = Math.max(previous[1], interval[1]);
      else merged.push(interval);
    }
    const pointAt = t => t === 0 ? a : t === 1 ? b :
      [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
    for (const [start, end] of merged) km += length(lineString([pointAt(start), pointAt(end)]), { units: 'kilometers' });
  }
  return km;
}

module.exports = { rings, bounds, sharedInterval, sharedBoundaryKm };
