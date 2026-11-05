'use strict';

const SUPPORT_GROUPS = new Set(['admin', 'admins', 'support', 'support_admin']);
function normalizeRole(role) {
    if (role === 'support') return 'agent';
    return ['agent', 'driver', 'merchant', 'customer'].includes(role) ? role : null;
}

// Claims must come from the verifier for the requested app pool, never a decoded JWT.
function principalFromClaims(claims, requestedRole) {
    const role = normalizeRole(requestedRole);
    const groups = Array.isArray(claims?.['cognito:groups']) ? claims['cognito:groups'] : [];
    if (!role || typeof claims?.sub !== 'string' || !claims.sub ||
        !Number.isFinite(claims.exp) || claims.exp <= Date.now() / 1000 ||
        (role === 'agent' && !groups.some(group => SUPPORT_GROUPS.has(group)))) {
        throw new Error('Invalid support identity');
    }
    return {
        userId: claims.sub,
        userType: role,
        authSubject: claims.sub,
        authVersion: 2,
        authExpiresAt: claims.exp,
        authenticated: true,
        groups,
        email: claims.email || null
    };
}

function isTrustedConnection(connection) {
    return connection?.authenticated === true && connection.authVersion === 2 &&
        typeof connection.authSubject === 'string' && !!connection.authSubject &&
        connection.userId === connection.authSubject &&
        normalizeRole(connection.userType) === connection.userType &&
        Number.isFinite(connection.authExpiresAt) && connection.authExpiresAt > Date.now() / 1000 &&
        (connection.userType !== 'agent' ||
            (Array.isArray(connection.groups) && connection.groups.some(group => SUPPORT_GROUPS.has(group))));
}

function canReadSession(connection, session) {
    if (!isTrustedConnection(connection) || !session) return false;
    if (connection.userType === 'agent') return true;
    const role = session.userType || (session.merchantId ? 'merchant' : 'driver');
    const ownerId = session.userId || (role === 'merchant' ? session.merchantId :
        role === 'driver' ? session.driverId : session.customerId);
    return role === connection.userType && ownerId === connection.authSubject;
}

module.exports = {normalizeRole, principalFromClaims, isTrustedConnection, canReadSession};
