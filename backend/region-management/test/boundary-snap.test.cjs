'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createBoundarySnap } = require('../boundary-snap');

const box = (left, bottom, right, top) => ({
  type: 'Polygon', coordinates: [[[left,bottom],[right,bottom],[right,top],[left,top],[left,bottom]]],
});

test('manual snapping offers exact same-level vertices and keeps them inside the selected parent', () => {
  const references = [
    { regionId:'parent', level:2, geometry:box(0,0,5,5) },
    { regionId:'other-parent', level:2, geometry:box(5.1,0,6,5) },
    { regionId:'neighbor', level:3, geometry:box(4.9,0.5,5.1,1) },
    { regionId:'self', level:3, geometry:box(4.95,0.5,4.96,1) },
  ];
  const nearby = createBoundarySnap({ regionId:'self', parent_id:'parent', level:3 },references);
  assert.deepEqual(nearby([4.8,0.4],[5.2,1.1]).sort(), [[4.9,0.5],[4.9,1]]);
  assert.deepEqual(nearby([4.99,-0.01],[5.11,0.01]), [[5,0]]);
});
