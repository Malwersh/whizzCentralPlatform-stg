'use strict';
const {GetCommand} = require('@aws-sdk/lib-dynamodb');
const MANAGERS = new Set(['MANAGER', 'BRANCH_MANAGER', 'LEGACY_MANAGER']);

// Read current branch ownership/membership for every request, not client IDs or JWT custom claims.
async function resolveMerchantAccess(db, tables, businessId, subject) {
    if (typeof businessId !== 'string' || !businessId.trim() || businessId.length > 150 ||
        typeof subject !== 'string' || !subject) return null;
    const get = async (TableName, Key) => (await db.send(new GetCommand({TableName, Key, ConsistentRead: true}))).Item;
    const branch = await get(tables.businesses, {businessId});
    if (!branch || branch.businessId !== businessId || typeof branch.ownerId !== 'string' || !branch.ownerId || branch.cognitoUserId !== branch.ownerId ||
        branch.isDeleted || branch.deletedAt || branch.deletionRequestId ||
        ['closed', 'closing', 'deleted'].includes(String(branch.status).toLowerCase()) ||
        ['CLOSED', 'CLOSING', 'DELETED'].includes(branch.lifecycleStatus)) return null;
    const locks = await Promise.all([...new Set([
        'ACCOUNT_LIFECYCLE#MERCHANT#' + subject,
        'ACCOUNT_LIFECYCLE#MERCHANT#' + branch.ownerId,
        'BUSINESS_LIFECYCLE#MERCHANT#' + businessId
    ])].map(pk => get(tables.lifecycle, {pk, sk: 'META'})));
    if (locks.some(Boolean)) return null;
    const result = {businessId, subjectId: subject, ownerId: branch.ownerId,
        businessName: typeof (branch.businessName || branch.name) === 'string' ? (branch.businessName || branch.name) : 'Merchant'};
    // Paused, suspended and onboarding businesses still need access to support.
    if (subject === branch.ownerId) return {...result, role: 'OWNER'};
    const member = await get(tables.memberships, {pk: 'BRANCH#' + businessId, sk: 'MEMBER#' + subject});
    if (!member || member.pk !== 'BRANCH#' + businessId || member.sk !== 'MEMBER#' + subject ||
        member.businessId !== businessId || member.subjectId !== subject || member.ownerId !== branch.ownerId ||
        member.status !== 'ACTIVE' || member.deletionRequestId || member.isDeleted || !MANAGERS.has(member.role) || !Number.isSafeInteger(member.version) || member.version < 1) return null;
    // Match the existing branch.read permission contract; do not create new staff privileges.
    if (member.permissionSchema === undefined) return member.role === 'MANAGER' ? {...result, role: 'MANAGER'} : null;
    if (member.permissionSchema !== 2 || member.grant?.roleId !== member.role ||
        !Array.isArray(member.grant?.branchIds) || !Array.isArray(member.grant?.permissions) ||
        member.grant.branchIds?.length !== 1 || member.grant.branchIds[0] !== businessId ||
        !member.grant.permissions?.includes('branch.read')) return null;
    const policy = await get(tables.settings, {pk: 'OPERATIONAL_SETTINGS#MERCHANT_STAFF_PERMISSIONS', sk: 'CURRENT'});
    return Array.isArray(policy?.enabledPermissions) && policy.enabledPermissions.includes('branch.read') ? {...result, role: 'MANAGER'} : null;
}
module.exports = {resolveMerchantAccess};
