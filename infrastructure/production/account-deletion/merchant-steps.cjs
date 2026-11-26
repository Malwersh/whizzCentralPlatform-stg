'use strict';

const steps = Object.freeze({
  BUSINESS: Object.freeze(['branchAssets', 'branchMemberships', 'branchOrders', 'branchData', 'branchClosure']),
  ACCOUNT: Object.freeze(['disableIdentity', 'memberships', 'personalData', 'identityClosure']),
});

module.exports = { merchantSteps: scope => steps[scope.kind] || [] };
