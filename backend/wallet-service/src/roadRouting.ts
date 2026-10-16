import { randomUUID } from 'node:crypto';
import { calculateDeliveryFee } from './deliveryPricing';

export class RoutingError extends Error {
  constructor(public readonly code: 'INVALID_ROUTE_INPUT' | 'ROUTING_NOT_CONFIGURED' | 'ROUTE_UNAVAILABLE' | 'OUTSIDE_COVERAGE' | 'REGION_REFERENCE_UNAVAILABLE' | 'AMBIGUOUS_COVERAGE') {
    super(code); this.name = 'RoutingError';
  }
}
export type Point = Readonly<{ latitude: number; longitude: number }>;
export type RoadRoute = Readonly<{
  id: string; source: string; quality: 'ROAD'; fallbackPolicyId: null;
  distanceMeters: number; durationSeconds: number; measuredAt: string; expiresAt: string;
}>;
export type BoundRoadRoute = Readonly<{
  schemaVersion: 1; origin: Point; destination: Point;
  profile: 'driving' | 'driving-traffic'; normalization: 'CEIL_METERS_SECONDS_V1'; route: RoadRoute;
}>;
function invalid(): never { throw new RoutingError('INVALID_ROUTE_INPUT'); }
function point(value: unknown): Point {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid();
  const p = value as Record<string, unknown>;
  if (Object.keys(p).length !== 2 || !Object.prototype.hasOwnProperty.call(p, 'latitude') || !Object.prototype.hasOwnProperty.call(p, 'longitude')) return invalid();
  if (typeof p.latitude !== 'number' || !Number.isFinite(p.latitude) || Math.abs(p.latitude) > 90 ||
      typeof p.longitude !== 'number' || !Number.isFinite(p.longitude) || Math.abs(p.longitude) > 180) return invalid();
  return Object.freeze({ latitude: p.latitude, longitude: p.longitude });
}
function bounded(value: number, min: number, max: number): number {
  if (!Number.isSafeInteger(value) || value < min || value > max) return invalid();
  return value;
}

/** Construct only in trusted server code. Never accept options, credentials or route metrics from HTTP bodies. */
export function createMapboxRoadRouter(options: {
  getAccessToken: () => Promise<string>;
  profile: 'driving' | 'driving-traffic';
  ttlSeconds: number;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
  now?: () => number;
}) {
  if (!['driving', 'driving-traffic'].includes(options.profile)) return invalid();
  const profile = options.profile;
  const ttl = bounded(options.ttlSeconds, 1, 900) * 1000;
  const timeout = bounded(options.timeoutMs, 100, 15000);
  const request = options.fetchImpl ?? fetch, now = options.now ?? Date.now;
  const getToken = options.getAccessToken;
  return Object.freeze({
    async getRoute(originValue: unknown, destinationValue: unknown): Promise<BoundRoadRoute> {
      const origin = point(originValue), destination = point(destinationValue);
      const measured = now();
      if (!Number.isSafeInteger(measured) || !Number.isFinite(new Date(measured + ttl).getTime())) return invalid();
      const controller = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      // Race the entire operation, including credential lookup and body consumption.
      const deadline = new Promise<never>((_, reject) => {
        timer = setTimeout(() => { controller.abort(); reject(new RoutingError('ROUTE_UNAVAILABLE')); }, timeout);
      });
      const operation = async (): Promise<BoundRoadRoute> => {
        let token: string;
        try { token = await getToken(); } catch { throw new RoutingError('ROUTING_NOT_CONFIGURED'); }
        if (typeof token !== 'string' || !token.trim() || /\s/.test(token)) throw new RoutingError('ROUTING_NOT_CONFIGURED');
        if (controller.signal.aborted) throw new RoutingError('ROUTE_UNAVAILABLE');
        const coordinates = `${origin.longitude},${origin.latitude};${destination.longitude},${destination.latitude}`;
        const url = new URL(`https://api.mapbox.com/directions/v5/mapbox/${profile}/${coordinates}`);
        url.search = new URLSearchParams({ access_token: token, alternatives: 'false', overview: 'false', steps: 'false' }).toString();
        const response = await request(url, { signal: controller.signal, redirect: 'error', headers: { Accept: 'application/json' } });
        if (!response.ok || !response.body) throw new RoutingError('ROUTE_UNAVAILABLE');
        const reader = response.body.getReader();
        const chunks: Uint8Array[] = [];
        let bytes = 0;
        try {
          while (true) {
            const part = await reader.read();
            if (part.done) break;
            bytes += part.value.byteLength;
            if (bytes > 65536) { await reader.cancel(); throw new RoutingError('ROUTE_UNAVAILABLE'); }
            chunks.push(part.value);
          }
        } finally { reader.releaseLock(); }
        const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        const r = payload?.routes?.[0];
        if (payload?.code !== 'Ok' || !Array.isArray(payload.routes) || payload.routes.length !== 1 ||
            !r || typeof r.distance !== 'number' || !Number.isFinite(r.distance) || r.distance < 0 ||
            typeof r.duration !== 'number' || !Number.isFinite(r.duration) || r.duration < 0 ||
            !Number.isSafeInteger(Math.ceil(r.distance)) || !Number.isSafeInteger(Math.ceil(r.duration))) {
          throw new RoutingError('ROUTE_UNAVAILABLE');
        }
        const completed = now();
        if (!Number.isSafeInteger(completed) || completed < measured || completed >= measured + ttl || controller.signal.aborted) throw new RoutingError('ROUTE_UNAVAILABLE');
        const route: RoadRoute = Object.freeze({ id: randomUUID(), source: 'MAPBOX_DIRECTIONS_V5', quality: 'ROAD', fallbackPolicyId: null,
          distanceMeters: Math.ceil(r.distance), durationSeconds: Math.ceil(r.duration),
          measuredAt: new Date(measured).toISOString(), expiresAt: new Date(measured + ttl).toISOString() });
        return Object.freeze({ schemaVersion: 1, origin, destination, profile, normalization: 'CEIL_METERS_SECONDS_V1', route });
      };
      try { return await Promise.race([operation(), deadline]); }
      catch (error) {
        // Do not expose provider bodies, URLs with credentials, coordinates or SDK error causes.
        if (error instanceof RoutingError) throw error;
        throw new RoutingError('ROUTE_UNAVAILABLE');
      } finally { if (timer) clearTimeout(timer); controller.abort(); }
    }
  });
}

/** Coverage adapters must read the existing region reference and verify its polygon, not nearest-region fallback. */
export type CoverageMatch = Readonly<{
  regionId: string; active: boolean; hierarchyActive: boolean; insidePolygon: boolean;
  referenceVersion: string;
}>;
export function createCoveredDeliveryRouter(options: {
  resolveCoverage: (point: Point) => Promise<CoverageMatch | null>;
  router: ReturnType<typeof createMapboxRoadRouter>;
}) {
  const resolveCoverage = options.resolveCoverage, router = options.router;
  return Object.freeze({
    async getDeliveryRoute(branchLocation: unknown, customerLocation: unknown) {
      const origin = point(branchLocation), destination = point(customerLocation);
      const matches = await Promise.all([resolveCoverage(origin), resolveCoverage(destination)]);
      const coverage = matches.map(m => {
        if (!m || m.active !== true || m.hierarchyActive !== true || m.insidePolygon !== true ||
            typeof m.regionId !== 'string' || !/^[A-Za-z0-9_.:-]{1,150}$/.test(m.regionId) ||
            typeof m.referenceVersion !== 'string' || !m.referenceVersion.trim()) throw new RoutingError('OUTSIDE_COVERAGE');
        return Object.freeze({ regionId: m.regionId, active: true, hierarchyActive: true, insidePolygon: true, referenceVersion: m.referenceVersion });
      });
      const bound = await router.getRoute(origin, destination);
      // Revalidate after provider I/O; a deactivated or changed reference cannot be silently accepted.
      const latest = await Promise.all([resolveCoverage(origin), resolveCoverage(destination)]);
      if (latest.some((m, i) => !m || m.active !== true || m.hierarchyActive !== true || m.insidePolygon !== true ||
          m.regionId !== coverage[i].regionId || m.referenceVersion !== coverage[i].referenceVersion)) {
        throw new RoutingError('OUTSIDE_COVERAGE');
      }
      return Object.freeze({ ...bound, originCoverage: coverage[0], destinationCoverage: coverage[1] });
    }
  });
}

/** Internal server composition; context/rules/locations must come from authenticated reference readers. */
export async function calculateCoveredRoadDeliveryFee(
  router: ReturnType<typeof createCoveredDeliveryRouter>,
  input: { origin: Point; destination: Point;
    context: { branchId: string; merchantId: string; zoneId: string; cityId: string; governorateId: string; vehicleType: string };
    rules: unknown; discount: unknown },
  now: () => number = Date.now
) {
  // Snapshot mutable server input before I/O; later caller mutation cannot change the quoted endpoints or rule set.
  const snapshot = JSON.parse(JSON.stringify(input)) as typeof input;
  const binding = await router.getDeliveryRoute(snapshot.origin, snapshot.destination);
  if (snapshot.context.zoneId !== binding.destinationCoverage.regionId) throw new RoutingError('OUTSIDE_COVERAGE');
  const calculation = calculateDeliveryFee({ schemaVersion: 1, at: new Date(now()).toISOString(), context: snapshot.context,
    rules: snapshot.rules, deliveryRoute: binding.route, discount: snapshot.discount });
  return Object.freeze({ binding, calculation });
}
