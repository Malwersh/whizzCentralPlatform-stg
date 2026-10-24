/** Unified policy contract, not a scheduler or an authorization decision.
 * No defaults are added to submitted policies. Observed legacy recovery values
 * are references only; configuring this schema never enables a financial path.
 */
export type DispatchEngine = 'LEGACY' | 'FINANCIAL';
export interface DispatchWaveRule {
  number: number;
  radiusMeters: number;
  recipients: number | 'ALL';
  minimumAcceptancePercent: number;
  minimumCompletionPercent: number;
  maximumConsecutiveDeclines: number;
}
export interface DispatchProfile {
  normalWaves: DispatchWaveRule[];
  offerTtlSeconds: number;
  waveDurationSeconds: number;
  totalDispatchSeconds: number;
  reassignmentWindowSeconds: number;
  positionMaxAgeSeconds: number | null;
  newDriverExemption: { belowCompletedTrips: number; missingHistory: 'LEGACY_COMPAT' | 'NOT_EXEMPT' };
  repeatOffers: { reofferFromWave: number | null; excludeUnassignedDrivers: true; policy: 'LEGACY_COMPAT' };
  recovery: {
    enabled: false;
    radiusMeters: number | null;
    boostBasisPoints: number | null;
    maximumPickupEtaSeconds: number | null;
    durationSeconds: number | null;
    budgetMinor: number | null;
    legacyReference: { radiusMeters: number; boostBasisPoints: number } | null;
  };
}
export interface DispatchPolicy {
  schemaVersion: 2;
  performanceMode: 'LEGACY_METRICS';
  profiles: { LEGACY: DispatchProfile; FINANCIAL: DispatchProfile };
}
const invalid = (): never => { throw Object.assign(Error('INVALID_DISPATCH_POLICY'), { code: 'INVALID_DISPATCH_POLICY', status: 400 }); };
function object(value: any, keys: string[]) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join(',') !== [...keys].sort().join(',')) return invalid();
  return value;
}
function integer(value: any, min: number, max: number) {
  if (!Number.isSafeInteger(value) || value < min || value > max) return invalid();
  return value as number;
}
export function validateDispatchPolicy(value: unknown): DispatchPolicy {
  const root = object(value, ['schemaVersion', 'performanceMode', 'profiles']);
  if (root.schemaVersion !== 2 || root.performanceMode !== 'LEGACY_METRICS') return invalid();
  const profiles = object(root.profiles, ['LEGACY', 'FINANCIAL']);
  for (const engine of ['LEGACY', 'FINANCIAL'] as const) {
    const p = object(profiles[engine], ['normalWaves', 'offerTtlSeconds', 'waveDurationSeconds', 'totalDispatchSeconds', 'reassignmentWindowSeconds', 'positionMaxAgeSeconds', 'newDriverExemption', 'repeatOffers', 'recovery']);
    if (!Array.isArray(p.normalWaves) || p.normalWaves.length < 1 || p.normalWaves.length > 10) return invalid();
    for (const [i, rule] of p.normalWaves.entries()) {
      const w = object(rule, ['number', 'radiusMeters', 'recipients', 'minimumAcceptancePercent', 'minimumCompletionPercent', 'maximumConsecutiveDeclines']);
      if (w.number !== i + 1) return invalid();
      integer(w.radiusMeters, 1, 50000);
      if (w.recipients !== 'ALL') integer(w.recipients, 1, 25);
      if (engine === 'FINANCIAL' && w.recipients === 'ALL') return invalid(); // Current financial plan's proven bound.
      integer(w.minimumAcceptancePercent, 0, 100);
      integer(w.minimumCompletionPercent, 0, 100);
      integer(w.maximumConsecutiveDeclines, 0, 999);
    }
    integer(p.offerTtlSeconds, 1, 900);
    integer(p.waveDurationSeconds, p.offerTtlSeconds, 900);
    integer(p.totalDispatchSeconds, 30, 3600);
    integer(p.reassignmentWindowSeconds, 30, 900);
    if (p.positionMaxAgeSeconds !== null) integer(p.positionMaxAgeSeconds, p.offerTtlSeconds, 900);
    if (engine === 'FINANCIAL' && p.positionMaxAgeSeconds === null) return invalid();
    const exemption = object(p.newDriverExemption, ['belowCompletedTrips', 'missingHistory']);
    integer(exemption.belowCompletedTrips, 0, 100);
    if (!['LEGACY_COMPAT', 'NOT_EXEMPT'].includes(exemption.missingHistory)) return invalid();
    const repeat = object(p.repeatOffers, ['reofferFromWave', 'excludeUnassignedDrivers', 'policy']);
    if (repeat.reofferFromWave !== null) integer(repeat.reofferFromWave, 1, p.normalWaves.length);
    if (repeat.excludeUnassignedDrivers !== true || repeat.policy !== 'LEGACY_COMPAT') return invalid();
    const recovery = object(p.recovery, ['enabled', 'radiusMeters', 'boostBasisPoints', 'maximumPickupEtaSeconds', 'durationSeconds', 'budgetMinor', 'legacyReference']);
    // A funded recovery writer and approved bounds are not implemented yet.
    if (recovery.enabled !== false) return invalid();
    for (const [field, min, max] of [['radiusMeters', 1, 50000], ['boostBasisPoints', 0, 10000], ['maximumPickupEtaSeconds', 1, 7200], ['durationSeconds', 1, 1800], ['budgetMinor', 0, Number.MAX_SAFE_INTEGER]] as const)
      if (recovery[field] !== null) integer(recovery[field], min, max);
    if (recovery.legacyReference !== null) {
      object(recovery.legacyReference, ['radiusMeters', 'boostBasisPoints']);
      integer(recovery.legacyReference.radiusMeters, 1, 50000);
      integer(recovery.legacyReference.boostBasisPoints, 0, 10000);
    }
  }
  if (Buffer.byteLength(JSON.stringify(root)) > 32000) return invalid();
  return JSON.parse(JSON.stringify(root));
}
