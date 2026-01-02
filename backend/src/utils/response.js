/**
 * Standard response utilities for API Gateway Lambda functions
 */

const corsHeaders = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS'
};

/**
 * Create a successful response
 * @param {Object} data - Response data
 * @param {number} statusCode - HTTP status code (default: 200)
 * @returns {Object} API Gateway response object
 */
function successResponse(data, statusCode = 200) {
    return {
        statusCode,
        headers: corsHeaders,
        body: JSON.stringify({
            success: true,
            data,
            timestamp: new Date().toISOString()
        })
    };
}

/**
 * Create an error response
 * @param {string} message - Error message
 * @param {number} statusCode - HTTP status code (default: 500)
 * @param {Object} details - Additional error details
 * @returns {Object} API Gateway response object
 */
function errorResponse(message, statusCode = 500, details = null) {
    const response = {
        statusCode,
      headers: corsHeaders,
      body: JSON.stringify({
          success: false,
          error: {
              message,
              details,
        timestamp: new Date().toISOString()
      }
    })
  };

    // Log error for debugging
    console.error(`Error ${statusCode}: ${message}`, details);

    return response;
}

/**
 * Create a validation error response
 * @param {Array} errors - Array of validation errors
 * @returns {Object} API Gateway response object
 */
function validationErrorResponse(errors) {
    return errorResponse('Validation failed', 400, { validationErrors: errors });
}

module.exports = {
    successResponse,
    errorResponse,
    validationErrorResponse,
    corsHeaders
};
