/** Resolve outbound wallet authentication without production legacy fallbacks. */
export function serviceCredentials(env: NodeJS.ProcessEnv = process.env) {
  const production = ['prod', 'production'].includes(env.ENVIRONMENT || '');
  const invalid = (): never => {
    throw Object.assign(new Error('PRODUCTION_SERVICE_CREDENTIALS_NOT_CONFIGURED'), {status: 503});
  };
  const clientId = production ? env.SERVICE_CLIENT_ID : env.SERVICE_COGNITO_CLIENT_ID;
  const username = env.SERVICE_USERNAME || (production ? '' : 'order-service-dev');
  const password = env.SERVICE_PASSWORD;
  if (production && (!clientId || !/^[a-z0-9]+$/.test(clientId) ||
      clientId === '5erchruuvc35dfrcpld2gaeiq3' ||
      (env.SERVICE_COGNITO_CLIENT_ID && env.SERVICE_COGNITO_CLIENT_ID !== clientId) ||
      !username.trim() || username === 'order-service-dev' || !password?.trim())) invalid();
  if (!clientId || !password) throw new Error(
    'Missing Cognito Service Pool credentials: SERVICE_COGNITO_CLIENT_ID or SERVICE_PASSWORD');
  return {clientId, username, password, clientSecret: env.SERVICE_COGNITO_CLIENT_SECRET};
}
