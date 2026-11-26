/** Production targets must be supplied and verified by the deployment. */
export function runtimeTargets(env: NodeJS.ProcessEnv = process.env) {
  const production = ['prod', 'production'].includes(env.ENVIRONMENT || '');
  const table = env.WEBSOCKET_CONNECTIONS_TABLE || 'WizzUser_websocket_connections_staging';
  const endpoint = env.WEBSOCKET_ENDPOINT || 'https://igcrhwc84c.execute-api.us-east-1.amazonaws.com/staging';
  const dispatch = env.CREATE_DISPATCH_JOB_LAMBDA || 'WaveSystem_CreateDispatchJob';
  const fail = (target: string): never => {
    throw Object.assign(new Error('PRODUCTION_RUNTIME_TARGET_NOT_CONFIGURED: ' + target), {status: 503});
  };
  if (production) {
    if (!/^wizz-production-[A-Za-z0-9_-]+$/.test(table)) fail('WEBSOCKET_CONNECTIONS_TABLE');
    const apiId = env.ORDER_WEBSOCKET_API_ID || '';
    if (!/^[a-z0-9]{10}$/.test(apiId) || apiId === 'igcrhwc84c' ||
      endpoint !== `https://${apiId}.execute-api.us-east-1.amazonaws.com/production`) fail('WEBSOCKET_ENDPOINT');
    if (!/^arn:aws:lambda:us-east-1:746727375268:function:wizz-production-[A-Za-z0-9_-]+$/.test(dispatch)) fail('CREATE_DISPATCH_JOB_LAMBDA');
  }
  return {table, endpoint, dispatch};
}
