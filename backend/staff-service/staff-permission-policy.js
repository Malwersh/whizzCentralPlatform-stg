'use strict';

// Pure contract for the central policy. Not yet wired into live authorization.
// Supported IDs must come from a server-owned capability registry, never the UI.
const fail = code => { throw Object.assign(new Error(code), { code }); };
const OWNER_ONLY = new Set([
  'ownership.transfer', 'business.close', 'settlements.manage', 'person.delete',
]);
const validId = value => typeof value === 'string' && /^[a-zA-Z][a-zA-Z0-9_.-]{0,99}$/.test(value);
function ids(values) {
  if (!Array.isArray(values) || values.some(v => !validId(v)) || new Set(values).size !== values.length) fail('INVALID_PERMISSION_LIST');
  return [...values];
}
function version(value) {
  if (!Number.isSafeInteger(value) || value < 1) fail('INVALID_VERSION');
  return value;
}
function registryMap(registry) {
  if (!Array.isArray(registry)) fail('CAPABILITIES_UNAVAILABLE');
  const map = new Map();
  for (const entry of registry) {
    if (!entry || !validId(entry.id) || map.has(entry.id) || typeof entry.implemented !== 'boolean') fail('INVALID_CAPABILITY');
    map.set(entry.id, { ...entry, requires: ids(entry.requires || []) });
  }
  for (const entry of map.values()) {
    for (const id of entry.requires) if (!map.has(id) || id === entry.id) fail('INVALID_DEPENDENCY');
  }
  const visiting = new Set(), visited = new Set();
  function visit(id) {
    if (visiting.has(id)) fail('INVALID_DEPENDENCY');
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dependency of map.get(id).requires) visit(dependency);
    visiting.delete(id); visited.add(id);
  }
  for (const id of map.keys()) visit(id);
  return map;
}
function validatePolicy(policy, registry) {
  const map = registryMap(registry);
  if (!policy) fail('POLICY_UNAVAILABLE');
  version(policy.version);
  const enabled = ids(policy.enabledPermissions);
  for (const id of enabled) {
    const capability = map.get(id);
    if (!capability || capability.implemented !== true || OWNER_ONLY.has(id) || capability.delegable !== true) fail('PERMISSION_NOT_DELEGABLE');
    for (const dependency of capability.requires) if (!enabled.includes(dependency)) fail('DEPENDENCY_REQUIRED');
  }
  if (!Array.isArray(policy.roles)) fail('INVALID_ROLES');
  const seen = new Set();
  for (const role of policy.roles) {
    if (!role || !validId(role.id) || role.id === 'OWNER' || seen.has(role.id) ||
        !Number.isSafeInteger(role.version) || role.version < 1 || typeof role.enabled !== 'boolean' ||
        typeof role.nameAr !== 'string' || !role.nameAr.trim() || role.nameAr.length > 100) fail('INVALID_ROLE');
    seen.add(role.id);
    const defaults = ids(role.permissions);
    for (const id of defaults) {
      if (!map.has(id) || OWNER_ONLY.has(id) || map.get(id).delegable !== true || map.get(id).implemented !== true) fail('PERMISSION_NOT_DELEGABLE');
      for (const dependency of map.get(id).requires) if (!defaults.includes(dependency)) fail('DEPENDENCY_REQUIRED');
    }
  }
  return map;
}
function effectivePermissions(grant, policy, registry, branchId) {
  const map = validatePolicy(policy, registry);
  if (grant?.status !== 'ACTIVE' || !Array.isArray(grant.branchIds) || !grant.branchIds.includes(branchId)) return [];
  version(grant.version);
  const selected = ids(grant.permissions);
  // Unknown or disabled permissions never become authority, including old grants.
  const effective = new Set(selected.filter(id => map.get(id)?.implemented === true &&
    map.get(id)?.delegable === true && !OWNER_ONLY.has(id) && policy.enabledPermissions.includes(id)));
  let changed = true;
  while (changed) {
    changed = false;
    for (const id of effective) if (map.get(id).requires.some(dep => !effective.has(dep))) {
      effective.delete(id); changed = true;
    }
  }
  return [...effective].sort();
}
function snapshotGrant({ policy, registry, roleId, selectedPermissions, branchIds, expectedPolicyVersion }) {
  const map = validatePolicy(policy, registry);
  if (policy.version !== expectedPolicyVersion) fail('POLICY_VERSION_CONFLICT');
  const role = policy.roles.find(r => r.id === roleId && r.enabled);
  if (!role) fail('ROLE_UNAVAILABLE');
  // Explicit selection may exceed the template, within the central ceiling.
  const permissions = ids(selectedPermissions === undefined ? role.permissions : selectedPermissions);
  for (const id of permissions) {
    if (!policy.enabledPermissions.includes(id) || !map.get(id)?.implemented || !map.get(id)?.delegable || OWNER_ONLY.has(id)) fail('PERMISSION_UNAVAILABLE');
    for (const dependency of map.get(id).requires) if (!permissions.includes(dependency)) fail('DEPENDENCY_REQUIRED');
  }
  if (!Array.isArray(branchIds) || !branchIds.length || branchIds.some(b => typeof b !== 'string' || !b.trim()) || new Set(branchIds).size !== branchIds.length) fail('BRANCH_SCOPE_REQUIRED');
  return { roleId, roleNameAr: role.nameAr, roleVersion: role.version, policyVersion: policy.version,
    permissions: permissions.sort(), branchIds: [...branchIds] };
}
function assertDelegation({ actor, targetSubjectId, requested, policy, registry }) {
  if (!actor?.subjectId || actor.subjectId === targetSubjectId) fail('SELF_GRANT_FORBIDDEN');
  if (!requested?.branchIds?.length) fail('BRANCH_SCOPE_REQUIRED');
  ids(requested.permissions);
  const map = validatePolicy(policy, registry);
  for (const permission of requested.permissions) {
    if (!map.has(permission) || !policy.enabledPermissions.includes(permission) || !map.get(permission).implemented || !map.get(permission).delegable || OWNER_ONLY.has(permission)) fail('PERMISSION_UNAVAILABLE');
    for (const dependency of map.get(permission).requires) if (!requested.permissions.includes(dependency)) fail('DEPENDENCY_REQUIRED');
  }
  for (const branchId of requested.branchIds) {
    const allowed = new Set(effectivePermissions(actor, policy, registry, branchId));
    if (!allowed.has('staff.grants.write')) fail('PERMISSION_REQUIRED');
    for (const permission of requested.permissions) if (!allowed.has(permission)) fail('PRIVILEGE_ESCALATION');
  }
  return true;
}
module.exports = { validatePolicy, snapshotGrant, effectivePermissions, assertDelegation };
