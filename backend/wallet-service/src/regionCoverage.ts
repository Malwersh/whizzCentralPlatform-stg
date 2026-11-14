import { GetCommand, QueryCommand, DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { createHash } from 'node:crypto';
import { latLngToCell, cellToParent, gridDisk } from 'h3-js';
import { booleanPointInPolygon } from '@turf/boolean-point-in-polygon';
import type { Polygon, MultiPolygon } from 'geojson';
import { Point, CoverageMatch, RoutingError, createCoveredDeliveryRouter, createMapboxRoadRouter } from './roadRouting';

type Row = Record<string, unknown>;
export type RegionCoverage = CoverageMatch & Readonly<{
  countryId: string; governorateId: string; districtId: string;
  regionPath: readonly string[]; cellId: string;
}>;
const refError = (): never => { throw new RoutingError('REGION_REFERENCE_UNAVAILABLE'); };
const id = (v: unknown): string => typeof v === 'string' && /^[A-Za-z0-9_.:-]{1,150}$/.test(v) ? v : refError();
const enabled = (v: unknown) => v === true || v === 1 || v === '1' || v === 'true';
function canonical(v: unknown): string {
  if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
  if (v && typeof v === 'object') return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + canonical((v as Row)[k])).join(',') + '}';
  return JSON.stringify(v) ?? 'null';
}
function geometry(v: unknown): Polygon | MultiPolygon {
  if (!v || typeof v !== 'object') return refError();
  const g = v as Row;
  if (g.type !== 'Polygon' && g.type !== 'MultiPolygon') return refError();
  const polygons = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
  if (!Array.isArray(polygons) || !polygons.length) return refError();
  let points = 0;
  for (const polygon of polygons) {
    if (!Array.isArray(polygon) || !polygon.length) return refError();
    for (const ring of polygon) {
      if (!Array.isArray(ring) || ring.length < 4) return refError();
      for (const position of ring) {
        if (++points > 50000 || !Array.isArray(position) || position.length !== 2 ||
            typeof position[0] !== 'number' || !Number.isFinite(position[0]) || Math.abs(position[0]) > 180 ||
            typeof position[1] !== 'number' || !Number.isFinite(position[1]) || Math.abs(position[1]) > 90) return refError();
      }
      if (ring[0][0] !== ring[ring.length - 1][0] || ring[0][1] !== ring[ring.length - 1][1]) return refError();
    }
  }
  // Omit bbox/foreign fields: a stale bbox must not change containment.
  return { type: g.type, coordinates: g.coordinates } as Polygon | MultiPolygon;
}
function readPoint(p: Point): Point {
  if (!p || typeof p.latitude !== 'number' || !Number.isFinite(p.latitude) || Math.abs(p.latitude) > 90 ||
      typeof p.longitude !== 'number' || !Number.isFinite(p.longitude) || Math.abs(p.longitude) > 180) {
    throw new RoutingError('INVALID_ROUTE_INPUT');
  }
  return Object.freeze({ latitude: p.latitude, longitude: p.longitude });
}

/** Read-only adapter for the existing Staging index and region references. No Scan or inferred nearest region. */
export function createDynamoRegionCoverage(options: {
  db: Pick<DynamoDBDocumentClient, 'send'>;
  tables: { regions: string; derived: string; index: string };
}) {
  const { db } = options, tables = { ...options.tables };
  for (const table of Object.values(tables)) if (!/^[A-Za-z0-9_.-]{3,255}$/.test(table)) return refError();
  return async (value: Point): Promise<RegionCoverage | null> => {
    const p = readPoint(value);
    try {
      const cellId = latLngToCell(p.latitude, p.longitude, 9);
      // Neighbor cells supply candidates near a polyfill edge; polygons still decide coverage.
      const cells = new Set(gridDisk(cellId, 1));
      for (let resolution = 8; resolution >= 6; resolution--) cells.add(cellToParent(cellId, resolution));
      const candidates = new Set<string>();
      let evaluated = 0;
      for (const cell of cells) {
        let cursor: Record<string, unknown> | undefined;
        let pages = 0;
        do {
          const result = await db.send(new QueryCommand({ TableName: tables.index, IndexName: 'h3-index',
            KeyConditionExpression: '#cell = :cell', ExpressionAttributeNames: { '#cell': 'h3_cell', '#region': 'regionId' },
            ExpressionAttributeValues: { ':cell': cell }, ProjectionExpression: '#cell, #region', Limit: 32,
            ...(cursor ? { ExclusiveStartKey: cursor } : {}) }));
          for (const row of result.Items ?? []) {
            if (++evaluated > 256 || row.h3_cell !== cell) return refError();
            candidates.add(id(row.regionId));
            if (candidates.size > 32) return refError();
          }
          cursor = result.LastEvaluatedKey;
          if (++pages >= 4 && cursor) return refError();
        } while (cursor);
      }
      // Per-resolution read cache only: a new resolve always rereads source and derived records strongly.
      const rows = new Map<string, Promise<{ base: Row; derived: Row }>>();
      const get = (regionId: string) => {
        let pending = rows.get(regionId);
        if (!pending) {
          pending = (async () => {
            const [a, b] = await Promise.all([
              db.send(new GetCommand({ TableName: tables.regions, Key: { regionId }, ConsistentRead: true,
                ProjectionExpression: 'regionId, #level, parent_id, is_active, geometry, #version',
                ExpressionAttributeNames: { '#level': 'level', '#version': 'version' } })),
              db.send(new GetCommand({ TableName: tables.derived, Key: { regionId }, ConsistentRead: true,
                ProjectionExpression: 'regionId, effective_is_active, #version', ExpressionAttributeNames: { '#version': 'version' } }))
            ]);
            if (!a.Item || !b.Item || a.Item.regionId !== regionId || b.Item.regionId !== regionId) return refError();
            return { base: a.Item, derived: b.Item };
          })();
          rows.set(regionId, pending);
        }
        return pending;
      };
      const matches: RegionCoverage[] = [];
      for (const candidate of [...candidates].sort()) {
        const leaf = await get(candidate);
        const level = Number(leaf.base.level);
        if (!Number.isInteger(level) || level < 0 || level > 3) return refError();
        if (level !== 3) continue; // Country/governorate/district alone cannot prove a service neighborhood.
        if (!enabled(leaf.base.is_active) || !enabled(leaf.derived.effective_is_active)) continue;
        const shape = geometry(leaf.base.geometry);
        if (!booleanPointInPolygon([p.longitude, p.latitude], shape, { ignoreBoundary: true })) continue;
        const chain = [leaf];
        let active = true;
        for (let expected = 2; expected >= 0; expected--) {
          const parentId = id(chain[chain.length - 1].base.parent_id);
          if (chain.some(r => r.base.regionId === parentId)) return refError();
          const parent = await get(parentId);
          if (Number(parent.base.level) !== expected) return refError();
          if (!enabled(parent.base.is_active) || !enabled(parent.derived.effective_is_active)) active = false;
          chain.push(parent);
        }
        const rootParent = chain[3].base.parent_id;
        if (rootParent !== undefined && rootParent !== null && rootParent !== '' && rootParent !== 'ROOT' && rootParent !== 'root') return refError();
        if (!active) continue;
        chain.reverse();
        const path = Object.freeze(chain.map(r => id(r.base.regionId)));
        const proof = chain.map(r => ({ id: r.base.regionId, level: r.base.level, parentId: r.base.parent_id ?? null,
          active: r.base.is_active, effectiveActive: r.derived.effective_is_active,
          version: r.base.version ?? null, derivedVersion: r.derived.version ?? null }));
        const referenceVersion = createHash('sha256').update(canonical({ schemaVersion: 1, proof, geometry: shape })).digest('hex');
        matches.push(Object.freeze({ regionId: candidate, countryId: path[0], governorateId: path[1], districtId: path[2],
          regionPath: path, cellId, referenceVersion, active: true, hierarchyActive: true, insidePolygon: true }));
      }
      if (matches.length > 1) throw new RoutingError('AMBIGUOUS_COVERAGE');
      return matches[0] ?? null;
    } catch (error) {
      if (error instanceof RoutingError) throw error;
      return refError();
    }
  };
}

/** Composition for a future authenticated request/quote handler; no handler is opened by this factory. */
export function createStagingDeliveryRouting(options: {
  db: Pick<DynamoDBDocumentClient, 'send'>;
  getAccessToken: () => Promise<string>;
  profile: 'driving' | 'driving-traffic'; ttlSeconds: number; timeoutMs: number;
  fetchImpl?: typeof fetch; now?: () => number;
}) {
  const resolveCoverage = createDynamoRegionCoverage({ db: options.db, tables: {
    regions: 'WizzCentral_Regions', derived: 'WizzCentral_RegionsDerived_staging', index: 'WizzCentral_RegionIndex_staging'
  } });
  return createCoveredDeliveryRouter({ resolveCoverage, router: createMapboxRoadRouter(options) });
}
