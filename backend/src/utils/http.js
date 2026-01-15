const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Internal-Key, x-internal-key',
  'Content-Type': 'application/json'
};

function jsonResponse(statusCode, body) {
  return {
    statusCode,
    headers: corsHeaders,
    body: JSON.stringify(body)
  };
}

function ok(body) {
  return jsonResponse(200, body);
}

function badRequest(message, extra = {}) {
  return jsonResponse(400, { success: false, error: message, ...extra });
}

function unauthorized(message = 'Unauthorized') {
  return jsonResponse(401, { success: false, error: message });
}

function forbidden(message = 'Forbidden') {
  return jsonResponse(403, { success: false, error: message });
}

function serverError(message = 'Internal server error', extra = {}) {
  return jsonResponse(500, { success: false, error: message, ...extra });
}

module.exports = {
  corsHeaders,
  jsonResponse,
  ok,
  badRequest,
  unauthorized,
  forbidden,
  serverError
};
