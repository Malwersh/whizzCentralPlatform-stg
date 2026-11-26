'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { fixture } = require('./fixture.cjs');
const { TABLES } = require('../repository');
const { preview } = require('../boundary-preview');
const { sharedInterval, sharedBoundaryKm } = require('../shared-boundary');
const { editable } = require('../model');

const polygon = points => ({ type: 'Polygon', coordinates: [[...points, points[0]]] });
const north = polygon([[44,31],[44.02,31],[44.02,31.01],[44,31.01]]);
const south = polygon([[44.01,31],[44.01,30.99],[44.03,30.99],[44.03,31]]);

test('precise partial angled edges count, while a shifted edge and a single point do not', () => {
  assert.deepEqual(sharedInterval([0,0],[2,2],[1,1],[3,3]), [0.5,1]);
  assert(sharedInterval([44,31],[44.02,31.02],[44.01,31.01],[44.03,31.03]));
  assert.equal(sharedInterval([44,31],[44.02,31.02],[44.01,31.0100001],[44.03,31.0300001]), null);
  assert.equal(sharedInterval([0,0],[2,2],[2,2],[3,3]), null);
  assert(Math.abs(sharedBoundaryKm(north,south)-sharedBoundaryKm(south,north)) < 1e-6);
});

test('partial shared border passes drawing, draft and publication and writes adjacency both ways', async () => {
  const f=fixture();
  const a=f.region('a',3,'district',north);
  const b=f.region('b',3,'district',south);
  f.put(TABLES.base,a);
  const catalog=await f.route('get');
  const sketch=preview({...b,geometry:null},catalog.regions,[[44.03,31],[44.01,31]]);
  assert(sketch.valid);
  assert(sketch.boundary.every(edge=>!edge.invalid));
  assert((await f.saveDraft(editable(b))).validation.valid);
  const request=await f.publish(['b']);
  assert.equal((await f.drain(request.job.jobId)).status,'PUBLISHED');
  for(const id of ['a#b','b#a']){
    const row=f.get(TABLES.neighbors,{neighbor_pair_id:id});
    assert.equal(row.relationship_type,'adjacent');
    assert(row.shared_boundary_km>0.9 && row.shared_boundary_km<1);
  }
  assert.deepEqual(f.get(TABLES.base,{regionId:'a'}).geometry,north);
});

test('an actual overlap is reported in preview and rejected by the publication gate', async () => {
  const f=fixture();
  f.put(TABLES.base,f.region('a',3,'district',north));
  const b=f.region('b',3,'district',polygon([[44.01,31.00001],[44.01,30.99],[44.03,30.99],[44.03,31.00001]]));
  const refs=(await f.route('get')).regions;
  const sketch=preview({...b,geometry:null},refs,[[44.03,31.00001],[44.01,31.00001]]);
  assert(sketch.errors.some(error=>error.code==='SIBLING_OVERLAP'));
  assert.equal((await f.saveDraft(editable(b))).validation.valid,false);
  await assert.rejects(f.publish(['b']),error=>error.code==='REGION_GEOMETRY_REVIEW_REQUIRED');
});
