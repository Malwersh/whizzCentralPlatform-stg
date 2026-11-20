/** Resolve the wallet endpoint before constructing a client. */
export function walletTarget(env: NodeJS.ProcessEnv = process.env): string {
  if (!['prod', 'production'].includes(env.ENVIRONMENT || '')) {
    return env.WALLET_SERVICE_URL ||
      'https://er7d8mkxi5.execute-api.us-east-1.amazonaws.com/dev';
  }
  const id = env.WALLET_SERVICE_API_ID || '';
  const expected = `https://${id}.execute-api.us-east-1.amazonaws.com/production`;
  if (!/^[a-z0-9]{10}$/.test(id) || id === 'er7d8mkxi5' ||
      env.WALLET_SERVICE_URL !== expected) {
    throw Object.assign(new Error('PRODUCTION_WALLET_NOT_CONFIGURED'), { status: 503 });
  }
  return expected;
}
