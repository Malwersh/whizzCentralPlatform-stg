/** Explicit environment bindings; production never inherits staging resources. */
const legacyPools = [
  {kind:'customer',userPoolId:'us-east-1_TpyyrVkEE',clientId:'4a9e8o3em311eq2rgckp0pd2s9'},
  {kind:'driver',userPoolId:'us-east-1_RGTqUXF5C',clientId:'2d26d3muq0vvcuf42lkpgmkgsr'},
  {kind:'restaurant',userPoolId:'us-east-1_gtCR3ndzT',clientId:'4qabvh11nmghmf9fmc6e6ludd2'},
  {kind:'service',userPoolId:'us-east-1_1oxqmSN5P',clientId:'5erchruuvc35dfrcpld2gaeiq3'},
  {kind:'central',userPoolId:'us-east-1_wz7vwZZxz',clientId:'17mu2qlqis0qcs1n1n980q7e3j'}
];
const defaults: Record<string,string> = {
  ORDERS_TABLE:'WizzOrders', STAFF_TABLE:'staging-PlatformStaff',
  BUSINESSES_TABLE:'WhizzMerchants_Businesses', OFFER_JOURNEY_TABLE:'staging-WizzOfferJourney',
  MERCHANT_DISCOUNTS_TABLE:'WhizzMerchants_Discounts', PLATFORM_DISCOUNTS_TABLE:'WizzCentral_Platform_Discounts'
};
export function orderBindings(env: NodeJS.ProcessEnv = process.env) {
  const production = ['production','prod'].includes(env.ENVIRONMENT || '');
  const invalid = (name:string):never => {
    throw Object.assign(new Error('ORDER_BINDING_NOT_CONFIGURED: '+name), {status:503});
  };
  const tables: Record<string,string> = {};
  for (const [name,fallback] of Object.entries(defaults)) {
    const raw = (env[name] || '').trim();
    const value = !raw || ['null','undefined'].includes(raw.toLowerCase()) ? fallback : raw;
    if (production && !/^wizz-production-[A-Za-z0-9_-]+$/.test(value)) invalid(name);
    tables[name] = value;
  }
  const pools = legacyPools.map(p => {
    if (!production) return {...p};
    const prefix = p.kind === 'restaurant' ? 'MERCHANT' : p.kind.toUpperCase();
    const userPoolId = env[prefix+'_USER_POOL_ID'] || '';
    const clientId = env[prefix+'_CLIENT_ID'] || '';
    if (!/^us-east-1_[A-Za-z0-9]+$/.test(userPoolId) || !/^[a-z0-9]+$/.test(clientId) ||
      legacyPools.some(old => old.userPoolId === userPoolId || old.clientId === clientId)) invalid(prefix+'_IDENTITY');
    return {kind:p.kind,userPoolId,clientId};
  });
  if (production && new Set(pools.map(p=>p.userPoolId)).size !== pools.length) invalid('DISTINCT_IDENTITY_POOLS');
  return {tables,pools};
}
