'use strict';

const {createHash} = require('node:crypto');
const {REGISTRY} = require('../../../backend/staff-service/staff-capabilities');
const {validatePolicy} = require('../../../backend/staff-service/staff-permission-policy');

const financeCapabilities = new Set([
  'branch.read', 'wallet.balance.read', 'wallet.transactions.read', 'reports.finance.read',
  'wallet.settlements.read', 'finance.payout.request', 'finance.payout.receive',
]);

const orderCapabilities = ['orders.read', 'orders.accept', 'orders.reject', 'orders.prepare', 'orders.ready'];
const catalogAndHours = ['menu.read', 'menu.create', 'menu.edit', 'menu.delete',
  'menu.price.write', 'menu.availability.write', 'hours.read', 'hours.write'];
const discountCapabilities = ['discounts.read', 'discounts.create', 'discounts.edit', 'discounts.activate', 'discounts.delete'];
const capabilities = new Set([...financeCapabilities, ...orderCapabilities, ...catalogAndHours, ...discountCapabilities]);

function initialPolicy(staging) {
  validatePolicy(staging, REGISTRY);
  const {version, enabledPermissions, roles} = staging;
  const selected = enabledPermissions.filter(permission => financeCapabilities.has(permission));
  const supportedRoles = roles.map(({id, enabled, version, nameAr, nameEn, description, order, permissions}) => {
    const supported = permissions.filter(permission => financeCapabilities.has(permission));
    return {id, version, nameAr, nameEn, description, order, permissions: supported,
      enabled: enabled && supported.includes('wallet.settlements.read') &&
        supported.every(permission => selected.includes(permission))};
  });
  const policy = {
    version: 1,
    enabledPermissions: selected,
    roles: supportedRoles,
    sourcePolicyVersion: version,
    sourcePolicySha256: createHash('sha256').update(JSON.stringify({version, enabledPermissions, roles})).digest('hex'),
  };
  validatePolicy(policy, REGISTRY);
  if (selected.length !== financeCapabilities.size || !policy.roles.some(role => role.enabled &&
      role.permissions.includes('finance.payout.request') && role.permissions.includes('finance.payout.receive'))) {
    throw Error('FINANCE_POLICY_PREREQUISITES_UNAVAILABLE');
  }
  return policy;
}

function enableOrders(current, staging) {
  validatePolicy(current, REGISTRY);
  validatePolicy(staging, REGISTRY);
  if (!current.enabledPermissions.includes('branch.read') ||
      !orderCapabilities.every(permission => staging.enabledPermissions.includes(permission))) {
    throw Error('ORDER_POLICY_PREREQUISITES_UNAVAILABLE');
  }
  const enabledPermissions = [...new Set([...current.enabledPermissions, ...orderCapabilities])];
  const roles = current.roles.map(role => {
    if (!['BRANCH_MANAGER', 'OPERATIONAL_EMPLOYEE'].includes(role.id)) return role;
    const source = staging.roles.find(candidate => candidate.id === role.id);
    if (!source?.enabled) throw Error('ORDER_POLICY_PRESET_UNAVAILABLE');
    const permissions = [...new Set([...role.permissions, ...source.permissions.filter(id => orderCapabilities.includes(id))])];
    const enabled = role.enabled || role.id === 'OPERATIONAL_EMPLOYEE';
    if (permissions.length === role.permissions.length && enabled === role.enabled) return role;
    return {...role, permissions, enabled, version: role.version + 1};
  });
  if (enabledPermissions.length === current.enabledPermissions.length &&
      roles.every((role, index) => role === current.roles[index])) return current;
  const next = {...current, version: current.version + 1, enabledPermissions, roles,
    orderSourcePolicyVersion: staging.version};
  validatePolicy(next, REGISTRY);
  return next;
}

function enableCatalogAndHours(current, staging) {
  validatePolicy(current, REGISTRY);
  validatePolicy(staging, REGISTRY);
  if (!current.enabledPermissions.includes('branch.read') ||
      !catalogAndHours.every(permission => staging.enabledPermissions.includes(permission))) {
    throw Error('BRANCH_OPERATIONS_POLICY_PREREQUISITES_UNAVAILABLE');
  }
  const source = staging.roles.find(role => role.id === 'BRANCH_MANAGER' && role.enabled);
  if (!source) throw Error('BRANCH_OPERATIONS_POLICY_PRESET_UNAVAILABLE');
  const enabledPermissions = [...new Set([...current.enabledPermissions, ...catalogAndHours])];
  const roles = current.roles.map(role => {
    if (role.id !== source.id) return role;
    const permissions = [...new Set([...role.permissions, ...source.permissions.filter(id => catalogAndHours.includes(id))])];
    return permissions.length === role.permissions.length ? role : {...role, permissions, version: role.version + 1};
  });
  if (enabledPermissions.length === current.enabledPermissions.length &&
      roles.every((role, index) => role === current.roles[index])) return current;
  const next = {...current, version:current.version+1, enabledPermissions, roles, branchOperationsSourcePolicyVersion:staging.version};
  validatePolicy(next, REGISTRY);
  return next;
}

function enableDiscounts(current, staging) {
  validatePolicy(current, REGISTRY);
  validatePolicy(staging, REGISTRY);
  if (!current.enabledPermissions.includes('branch.read') ||
      !discountCapabilities.every(permission => staging.enabledPermissions.includes(permission))) {
    throw Error('DISCOUNT_POLICY_PREREQUISITES_UNAVAILABLE');
  }
  const source = staging.roles.find(role => role.id === 'BRANCH_MANAGER' && role.enabled);
  if (!source) throw Error('DISCOUNT_POLICY_PRESET_UNAVAILABLE');
  const enabledPermissions = [...new Set([...current.enabledPermissions, ...discountCapabilities])];
  const roles = current.roles.map(role => {
    if (role.id !== source.id || !role.enabled) return role;
    const permissions = [...new Set([...role.permissions, ...source.permissions.filter(id => discountCapabilities.includes(id))])];
    return permissions.length === role.permissions.length ? role : {...role, permissions, version:role.version+1};
  });
  if (enabledPermissions.length === current.enabledPermissions.length &&
      roles.every((role, index) => role === current.roles[index])) return current;
  const next = {...current, version:current.version+1, enabledPermissions, roles, discountSourcePolicyVersion:staging.version};
  validatePolicy(next, REGISTRY);
  return next;
}

module.exports = {initialPolicy, capabilities, enableOrders, enableCatalogAndHours, enableDiscounts};
