'use strict';

const RBush = require('rbush');
const { booleanPointInPolygon } = require('@turf/boolean-point-in-polygon');
const { bounds, rings } = require('./shared-boundary');
const { inspect } = require('./geometry');

function createBoundarySnap(region, references) {
  const parent = references.find(row => row.regionId === region.parent_id);
  const parentGeometry = parent && inspect(parent.geometry).valid ? parent.geometry : null;
  const vertices = new Map();
  for (const ref of references) {
    const onParent = ref === parent;
    if (ref.regionId === region.regionId || ref.archived ||
        (!onParent && Number(ref.level) !== Number(region.level)) || !inspect(ref.geometry).valid) continue;
    for (const ring of rings(ref.geometry)) {
      for (const point of ring.slice(0, -1)) {
        const key = point.join(',');
        if (onParent || !vertices.has(key)) vertices.set(key, { point, onParent, ...bounds(point, point) });
      }
    }
  }
  const index = new RBush().load([...vertices.values()]);
  return (low, high) => index.search(bounds(low, high))
    .filter(({ point, onParent }) => onParent || !parentGeometry || booleanPointInPolygon(point, parentGeometry))
    .map(({ point }) => point);
}

module.exports = { createBoundarySnap };
