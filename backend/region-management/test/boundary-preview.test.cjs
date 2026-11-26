'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { preview } = require('../boundary-preview');

const box = (left, bottom, right, top) => ({
  type: 'Polygon', coordinates: [[[left, bottom], [right, bottom], [right, top], [left, top], [left, bottom]]],
});
const row = (regionId, level, parent_id, geometry) => ({
  regionId, name: regionId, name_ar: regionId, level, parent_id, geometry,
});
const region = row('current', 2, 'parent', box(1, 1, 5, 2));
const refs = [row('parent', 1, null, box(0, 0, 6, 6)), row('neighbor', 2, 'parent', box(4, 0, 5.5, 4))];

test('one open edge changes color exactly at the neighboring and parent boundaries', () => {
  const report = preview({ ...region, geometry: null }, refs, [[1, 1], [7, 1]]);
  assert.deepEqual(report.boundary, [
    { invalid: false, coordinates: [[1, 1], [4, 1]] },
    { invalid: true, coordinates: [[4, 1], [5.5, 1]] },
    { invalid: false, coordinates: [[5.5, 1], [6, 1]] },
    { invalid: true, coordinates: [[6, 1], [7, 1]] },
  ]);
  assert.deepEqual(report.errors.map(issue => issue.code), ['SIBLING_OVERLAP', 'OUTSIDE_PARENT']);
});

test('sharing an edge with a neighbor is valid during drawing', () => {
  const report = preview({ ...region, geometry: null }, refs, [[4, 3], [4, 1]]);
  assert.equal(report.valid, true);
  assert.deepEqual(report.boundary, [{ invalid: false, shared: true, coordinates: [[4, 3], [4, 1]] }]);
});

test('copied angled boundaries stay valid even when their computed midpoint rounds inside the neighbor', () => {
  const points = [[44.01, 31], [44.012, 31.005], [44.01, 31.01]];
  const neighbor = row('a', 3, 'district', {
    type: 'Polygon', coordinates: [[[44, 31], ...points, [44, 31.01], [44, 31]]],
  });
  const parent = row('district', 2, 'governorate', box(42, 30, 45, 33));
  const current = row('b', 3, 'district', null);
  for (const path of [points, [...points].reverse()]) {
    const report = preview(current, [neighbor, parent], path);
    assert.equal(report.valid, true);
    assert.deepEqual(report.boundary, [{ invalid: false, shared: true, coordinates: path }]);
  }
  assert.equal(preview(current, [neighbor, parent], [...points, [44, 31.005]]).valid, false);
});

test('closed outlines keep separate styles for impacted and unaffected portions', () => {
  const mixed = preview(region, refs);
  assert.equal(mixed.valid, false);
  assert(mixed.boundary.some(part => part.invalid));
  assert(mixed.boundary.some(part => !part.invalid));
  assert(mixed.highlights.length > 0);
  const corrected = preview({ ...region, geometry: box(1, 1, 4, 2) }, refs);
  assert.equal(corrected.valid, true);
  assert(corrected.boundary.every(part => !part.invalid));
  assert(corrected.boundary.some(part => part.shared));
});


test('only the matching interval is marked shared, including during a partial match', () => {
  const draft = { ...region, geometry: null };
  const references = [refs[0], row('two', 2, 'parent', box(2, 3, 4, 4))];
  assert.deepEqual(preview(draft, references, [[1, 3], [5, 3]]).boundary, [
    { invalid: false, coordinates: [[1, 3], [2, 3]] },
    { invalid: false, shared: true, coordinates: [[2, 3], [4, 3]] },
    { invalid: false, coordinates: [[4, 3], [5, 3]] },
  ]);
  for (const path of [[[1, 2.999999], [5, 2.999999]], [[1, 2], [2, 3]], [[0, 1], [0, 5]]]) {
    assert(preview(draft, references, path).boundary.every(part => !part.shared));
  }
});

test('the shared highlight does not override an error or make an overlapping polygon appear adjacent', () => {
  const draft = { ...region, geometry: null };
  const crossing = [refs[0], row('outside', 2, 'parent', box(6, 1, 7, 3))];
  assert.deepEqual(preview(draft, crossing, [[6, 1], [7, 1]]).boundary, [
    { invalid: true, coordinates: [[6, 1], [7, 1]] },
  ]);
  const overlap = preview({ ...region, geometry: refs[1].geometry }, refs);
  assert.equal(overlap.valid, false);
  assert(!overlap.boundary?.some(part => part.shared));
});
