import { CognitoIdentityProviderClient, GetUserCommand, AdminGetUserCommand } from '@aws-sdk/client-cognito-identity-provider';
import { isFinancialOrderProduction } from './walletBindings';

const stagingPools = {
  STAFF: 'us-east-1_wz7vwZZxz',
  CUSTOMER: 'us-east-1_TpyyrVkEE',
  DRIVER: 'us-east-1_RGTqUXF5C',
  MERCHANT_OWNER: 'us-east-1_gtCR3ndzT',
} as const;
const productionPrefixes = { STAFF: 'ADMIN', CUSTOMER: 'CUSTOMER', DRIVER: 'DRIVER', MERCHANT_OWNER: 'MERCHANT' } as const;
type Kind = keyof typeof stagingPools;
const unauthorized = (): never => { throw Object.assign(Error('UNAUTHORIZED'), { code: 'UNAUTHORIZED' }); };

function productionIdentities(env: NodeJS.ProcessEnv) {
  const bindings = (Object.keys(productionPrefixes) as Kind[]).map(kind => {
    const prefix = productionPrefixes[kind];
    return { kind, pool: env[prefix + '_USER_POOL_ID'] || '', clientId: env[prefix + '_CLIENT_ID'] || '' };
  });
  if (env.AWS_REGION !== 'us-east-1' ||
      bindings.some(({ pool, clientId }) =>
        !/^us-east-1_[A-Za-z0-9]+$/.test(pool) || Object.values(stagingPools).some(value => value === pool) ||
        !/^[a-z0-9]{1,128}$/.test(clientId)) ||
      new Set(bindings.map(item => item.pool)).size !== bindings.length ||
      new Set(bindings.map(item => item.clientId)).size !== bindings.length) {
    throw Error('FINANCIAL_IDENTITY_NOT_CONFIGURED');
  }
  return bindings;
}

/** Cognito validates the original access token. Server actions choose the allowed identity. */
export async function authenticateFinancialIdentity<K extends Kind>(
  cognito: Pick<CognitoIdentityProviderClient, 'send'>,
  accessToken: string,
  kind: K,
  env: NodeJS.ProcessEnv = process.env,
) {
  if (!Object.prototype.hasOwnProperty.call(stagingPools, kind) || typeof accessToken !== 'string' ||
      !accessToken.length || accessToken.length > 16000) return unauthorized();
  const production = isFinancialOrderProduction(env);
  const binding = production ? productionIdentities(env).find(item => item.kind === kind)! : undefined;
  const pool = binding?.pool ?? stagingPools[kind];
  let claims;
  try {
    claims = JSON.parse(Buffer.from(accessToken.split('.')[1], 'base64url').toString());
  } catch {
    return unauthorized();
  }
  if (claims?.iss !== 'https://cognito-idp.us-east-1.amazonaws.com/' + pool ||
      claims.token_use !== 'access' || (binding && claims.client_id !== binding.clientId)) return unauthorized();

  const user = await cognito.send(new GetUserCommand({ AccessToken: accessToken }));
  const subjects = (user.UserAttributes ?? []).filter(attribute => attribute.Name === 'sub');
  const sub = subjects[0]?.Value;
  if (!sub || sub !== claims.sub || subjects.length !== 1 || !user.Username ||
      (!production && kind === 'DRIVER' && user.Username !== sub)) return unauthorized();

  // Production enrollment may use a phone-derived username. Bind orders to the
  // stable subject independently, and use the username only for the live lookup.
  const live = await cognito.send(new AdminGetUserCommand({ UserPoolId: pool, Username: user.Username }));
  const liveSubjects = (live.UserAttributes ?? []).filter(attribute => attribute.Name === 'sub');
  if (live.Enabled !== true || live.UserStatus !== 'CONFIRMED' || live.Username !== user.Username ||
      liveSubjects.length !== 1 || liveSubjects[0].Value !== sub) return unauthorized();
  if (kind === 'STAFF' && !live.UserMFASettingList?.includes('SOFTWARE_TOKEN_MFA')) return unauthorized();
  return { kind, subjectId: sub };
}
