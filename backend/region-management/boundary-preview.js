'use strict';

const RBush = require('rbush');
const { booleanPointInPolygon } = require('@turf/boolean-point-in-polygon');
const { kinks } = require('@turf/kinks');
const { inspect, validate, labels, MAX_VERTICES } = require('./geometry');
const { rings, bounds, sharedInterval } = require('./shared-boundary');

const EPSILON = 1e-10;
const outsideParent = 'OUTSIDE_PARENT';
const siblingOverlap = 'SIBLING_OVERLAP';
const selfIntersection = 'GEOMETRY_SELF_INTERSECTION';

const cross = (a, b) => a[0] * b[1] - a[1] * b[0];
const subtract = (a, b) => [a[0] - b[0], a[1] - b[1]];
const interpolate = (a, step, t) => [a[0] + t * step[0], a[1] + t * step[1]];
const inSegment = value => value >= -EPSILON && value <= 1 + EPSILON;

function parameter(point, a, step) {
  const axis = Math.abs(step[0]) >= Math.abs(step[1]) ? 0 : 1;
  return (point[axis] - a[axis]) / step[axis];
}

function cutsFor(a, step, edge) {
  const otherStep = subtract(edge.b, edge.a);
  const offset = subtract(edge.a, a);
  const denominator = cross(step, otherStep);
  if (denominator === 0) {
    if (cross(offset, step) !== 0) return [];
    return [parameter(edge.a, a, step), parameter(edge.b, a, step)].filter(inSegment);
  }
  const t = cross(offset, otherStep) / denominator;
  const u = cross(offset, step) / denominator;
  return inSegment(t) && inSegment(u) ? [t] : [];
}

function previewLines(paths, checks, points) {
  const edges = new RBush();
  const areas = new RBush();
  const inverse = checks.filter(check => check.outside);
  const indexed = [];
  for (const check of checks) {
    const area = { check, minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
    for (const ring of rings(check.geometry)) {
      for (let i = 1; i < ring.length; i++) {
        const a = ring[i - 1], b = ring[i], box = bounds(a, b);
        indexed.push({ a, b, check, ...box });
        area.minX = Math.min(area.minX, box.minX);
        area.minY = Math.min(area.minY, box.minY);
        area.maxX = Math.max(area.maxX, box.maxX);
        area.maxY = Math.max(area.maxY, box.maxY);
      }
    }
    if (!check.outside && !check.matchOnly && Number.isFinite(area.minX)) areas.insert(area);
  }
  edges.load(indexed);
  const crossings = new RBush().load(points.map(point => ({ point, ...bounds(point, point) })));
  const flagged = new Set();
  const boundary = [];
  for (const path of paths) {
    let current;
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1], b = path[i], step = subtract(b, a);
      if (step[0] === 0 && step[1] === 0) continue;
      const box = bounds(a, b);
      const searchBox = {
        minX: box.minX - EPSILON, minY: box.minY - EPSILON,
        maxX: box.maxX + EPSILON, maxY: box.maxY + EPSILON,
      };
      const hasCrossing = crossings.search(searchBox).some(({ point }) => {
        const t = parameter(point, a, step);
        if (!inSegment(t)) return false;
        const projected = interpolate(a, step, t);
        return Math.hypot(projected[0] - point[0], projected[1] - point[1]) <= EPSILON;
      });
      const candidates = inverse.concat(areas.search(box).map(area => area.check));
      const nearbyEdges = edges.search(box);
      const shared = new Map();
      const cuts = [0, 1, ...nearbyEdges.flatMap(edge => {
        const interval = sharedInterval(a, b, edge.a, edge.b);
        if (!interval) return edge.check.matchOnly ? [] : cutsFor(a, step, edge);
        if (!shared.has(edge.check)) shared.set(edge.check, []);
        shared.get(edge.check).push(interval);
        return interval;
      })]
        .filter(t => t >= 0 && t <= 1).sort((x, y) => x - y);
      for (let j = 1; j < cuts.length; j++) {
        const from = cuts[j - 1], to = cuts[j];
        if (to - from <= EPSILON) continue;
        const position = (from + to) / 2;
        const point = interpolate(a, step, position);
        const matches = ([first, last]) => first <= position && position <= last;
        let invalid = hasCrossing;
        for (const check of candidates) {
          if (shared.get(check)?.some(matches)) continue;
          const inside = booleanPointInPolygon(point, check.geometry, { ignoreBoundary: check.ignoreBoundary });
          if (check.outside ? !inside : inside) {
            invalid = true;
            flagged.add(check);
          }
        }
        const matchedNeighbor = !invalid && [...shared].some(([check, intervals]) => check.neighbor && intervals.some(matches));
        const end = to === 1 ? b : interpolate(a, step, to);
        if (current && current.invalid === invalid && Boolean(current.shared) === matchedNeighbor) current.coordinates.push(end);
        else {
          current = { invalid, ...(matchedNeighbor ? { shared: true } : {}),
            coordinates: [from === 0 ? a : interpolate(a, step, from), end] };
          boundary.push(current);
        }
      }
    }
  }
  return { boundary, flagged };
}

function neighborChecks(region, regions, overlapIds) {
  return regions
    .filter(row => row.regionId !== region.regionId && Number(row.level) === Number(region.level) && inspect(row.geometry).valid)
    .map(row => ({
      geometry: row.geometry, ignoreBoundary: true, code: siblingOverlap,
      neighbor: !row.archived && !overlapIds?.has(row.regionId),
      regionId: row.regionId, regionName: row.name_ar || row.name,
      matchOnly: overlapIds !== undefined && !overlapIds.has(row.regionId),
    }));
}

function preview(region, regions, sketch) {
  if (sketch !== undefined) {
    if (sketch.length < 2) return { valid: true, errors: [], highlights: [], boundary: [] };
    if (sketch.length > MAX_VERTICES) return { valid: false, errors: [{ message: labels.GEOMETRY_LIMIT }], highlights: [] };
    const parent = regions.find(row => row.regionId === region.parent_id);
    const checks = neighborChecks(region, regions);
    if (Number(region.level) > 0 && parent && inspect(parent.geometry).valid) {
      checks.push({ geometry: parent.geometry, outside: true, code: outsideParent, regionId: parent.regionId });
    }
    if (region.geometry && inspect(region.geometry).valid) {
      checks.push({ geometry: region.geometry, ignoreBoundary: true, code: 'GEOMETRY_INVALID' });
    }
    const crossings = kinks({ type: 'LineString', coordinates: sketch }).features;
    const { boundary, flagged } = previewLines([sketch], checks, crossings.map(f => f.geometry.coordinates));
    const errors = [...flagged].map(({ code, regionId, regionName }) => ({ code, regionId, regionName, message: labels[code] }));
    if (crossings.length) errors.push({ code: selfIntersection, message: labels[selfIntersection] });
    if (Number(region.level) > 0 && !checks.some(check => check.outside)) {
      errors.push({
        code: parent ? 'GEOMETRY_INVALID' : 'PARENT_REQUIRED',
        message: parent ? 'حدود المنطقة الأب تحتاج تصحيحًا.' : labels.PARENT_REQUIRED,
      });
      return { valid: false, errors, highlights: crossings, boundary: boundary.filter(part => part.invalid) };
    }
    return { valid: errors.length === 0, errors, highlights: crossings, boundary };
  }

  const report = validate(region, regions);
  const paths = rings(region.geometry);
  if (!paths.length) return report;
  const overlapIds = new Set(report.errors.filter(issue => issue.code === siblingOverlap).map(issue => issue.regionId));
  const checks = report.vertices ? neighborChecks(region, regions, overlapIds) : [];
  if (report.errors.some(issue => issue.code === outsideParent)) {
    const parent = regions.find(row => row.regionId === region.parent_id);
    if (parent) checks.push({ geometry: parent.geometry, outside: true });
  }
  const points = report.highlights.filter(f => f.geometry?.type === 'Point').map(f => f.geometry.coordinates);
  if (!checks.length && !points.length && !report.valid) return report;
  const { boundary } = previewLines(paths, checks, points);
  return { ...report, boundary };
}

module.exports = { preview };
