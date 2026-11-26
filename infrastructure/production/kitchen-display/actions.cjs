'use strict';

const ownerPath = '/auth/kitchen-screens';
const actionPath = '/kitchen-display/advance';

function createRoutes({ authenticate, service, advance, env = process.env }) {
 return async event => {
  const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store',
   'Access-Control-Allow-Origin': env.KITCHEN_ORIGIN || 'https://invalid.local',
   'Access-Control-Allow-Headers': 'Authorization,Content-Type',
   'Access-Control-Allow-Methods': 'POST,OPTIONS', Vary: 'Origin' };
  const reply = (statusCode, value) => ({ statusCode, headers, body: value ? JSON.stringify(value) : '' });
  if (env.ENVIRONMENT !== 'production' || env.KITCHEN_DISPLAY_ENABLED !== 'true') {
   return reply(503, { code: 'KITCHEN_NOT_ENABLED' });
  }
  if (event?.requestContext?.stage !== 'production' || ![ownerPath, actionPath].includes(event.path)) {
   return reply(404, { code: 'NOT_FOUND' });
  }
  if (event.httpMethod === 'OPTIONS') return reply(204);
  if (event.httpMethod !== 'POST') return reply(405, { code: 'METHOD_NOT_ALLOWED' });
  let input;
  try {
   if (event.isBase64Encoded || typeof event.body !== 'string' || Buffer.byteLength(event.body) > 4096) throw Error();
   input = JSON.parse(event.body);
   if (!input || typeof input !== 'object' || Array.isArray(input)) throw Error();
  } catch {
   return reply(400, { code: 'INVALID_KITCHEN_REQUEST' });
  }
  try {
   if (event.path === ownerPath) {
    const { sub } = await authenticate(event);
    return reply(200, await service.management({ sub }, input));
   }
   const token = (event.headers?.Authorization || event.headers?.authorization || '').replace(/^Bearer /, '');
   return reply(200, await advance(token, input));
  } catch (error) {
   return reply(error.status || 503, { code: error.status ? error.message : 'KITCHEN_UNAVAILABLE' });
  }
 };
}

module.exports = { createRoutes };
