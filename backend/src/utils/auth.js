/**
 * Authentication utilities for JWT validation
 */

const { CognitoJwtVerifier } = require('aws-jwt-verify');
const jwt = require('jsonwebtoken');

// Create a verifier for Cognito JWT tokens
const verifier = CognitoJwtVerifier.create({
    userPoolId: process.env.USER_POOL_ID,
    tokenUse: "access",
    clientId: null, // Allow any client ID
});

/**
 * Validate JWT token from API Gateway event
 * @param {Object} event - API Gateway event
 * @returns {Object|null} User data if valid, null if invalid
 */
async function validateJWT(event) {
    try {
      // Get token from Authorization header
      const authHeader = event.headers?.Authorization || event.headers?.authorization;

      if (!authHeader) {
          console.log('No Authorization header found');
          return null;
      }

      const token = authHeader.replace('Bearer ', '');

      if (!token) {
          console.log('No token found in Authorization header');
          return null;
      }

      // Verify the Cognito JWT token
      const payload = await verifier.verify(token);

      console.log('JWT validation successful:', {
          sub: payload.sub,
          username: payload.username,
          email: payload.email
      });

      return {
          userId: payload.sub,
          username: payload.username,
          email: payload.email,
          groups: payload['cognito:groups'] || [],
          ...payload
    };

  } catch (error) {
      console.error('JWT validation failed:', error.message);
      return null;
  }
}

/**
 * Generate a JWT token for internal service communication
 * @param {Object} payload - Token payload
 * @param {string} secret - JWT secret
 * @param {string} expiresIn - Expiration time (e.g., '1h', '24h')
 * @returns {string} JWT token
 */
function generateInternalJWT(payload, secret = process.env.JWT_SECRET, expiresIn = '1h') {
    return jwt.sign(payload, secret, { expiresIn });
}

/**
 * Verify internal JWT token
 * @param {string} token - JWT token
 * @param {string} secret - JWT secret
 * @returns {Object|null} Decoded payload if valid, null if invalid
 */
function verifyInternalJWT(token, secret = process.env.JWT_SECRET) {
    try {
        return jwt.verify(token, secret);
    } catch (error) {
        console.error('Internal JWT verification failed:', error.message);
        return null;
  }
}

/**
 * Extract user ID from event (either from JWT or path parameters)
 * @param {Object} event - API Gateway event
 * @returns {string|null} User ID if found
 */
async function extractUserId(event) {
    // First try to get from JWT
    const user = await validateJWT(event);
    if (user) {
        return user.userId;
    }

    // Fallback to path parameters
    return event.pathParameters?.userId || null;
}

module.exports = {
    validateJWT,
    generateInternalJWT,
    verifyInternalJWT,
    extractUserId
};
