import {isFinancialOrderProduction} from './walletBindings';

const productionTables = {
  quotes: 'wizz-production-DeliveryQuotes', customers: 'wizz-production-Customers',
  orders: 'wizz-production-Orders', branches: 'wizz-production-Merchants',
  addresses: 'wizz-production-Addresses', policy: 'wizz-production-PlatformStaff',
  platform: 'wizz-production-MerchantPlatform', deletion: 'wizz-production-AccountDeletion',
  regions: 'wizz-production-Regions', derived: 'wizz-production-RegionsDerived',
  neighbors: 'wizz-production-RegionNeighbors',
  index: 'wizz-production-RegionIndex', lifecycle: 'wizz-production-WalletLifecycle',
  holds: 'wizz-production-Holds', ledger: 'wizz-production-LedgerEntries',
  wallets: 'wizz-production-Wallets', audit: 'wizz-production-AuditLog',
  journey: 'wizz-production-OfferJourney', products: 'wizz-production-Products',
  categories: 'wizz-production-MenuCategories',
  merchantDiscounts: 'wizz-production-MerchantDiscounts', platformDiscounts: 'wizz-production-PlatformDiscounts',
  dispatchJobs: 'wizz-production-DispatchJobs',
};
const stagingTables: typeof productionTables = {
  quotes: 'staging-DeliveryQuotes', customers: 'WizzUser_users_staging',
  orders: 'WizzOrders', branches: 'WhizzMerchants_Businesses',
  addresses: 'WizzUser_addresses_staging', policy: 'staging-PlatformStaff',
  platform: 'staging-MerchantPlatform', deletion: 'staging-AccountDeletion',
  regions: 'WizzCentral_Regions', derived: 'WizzCentral_RegionsDerived_staging',
  neighbors: 'WizzCentral_RegionNeighbors_staging',
  index: 'WizzCentral_RegionIndex_staging', lifecycle: 'staging-WalletLifecycle',
  holds: 'staging-Holds', ledger: 'staging-LedgerEntries',
  wallets: 'staging-Wallets', audit: 'staging-AuditLog', journey: 'staging-WizzOfferJourney',
  products: 'WhizzMerchants_Products', categories: 'WhizzMerchants_Categories',
  merchantDiscounts: 'WhizzMerchants_Discounts', platformDiscounts: 'WizzCentral_Platform_Discounts',
  dispatchJobs: 'WizzDispatchJobs_staging',
};

export function checkoutTables(env: NodeJS.ProcessEnv = process.env) {
  const production = isFinancialOrderProduction(env);
  if (production && env.AWS_REGION !== 'us-east-1') throw Error('CHECKOUT_BINDINGS_NOT_CONFIGURED');
  return {...(production ? productionTables : stagingTables)};
}

export function requiredQuoteReferences(tables: ReturnType<typeof checkoutTables>) {
  const {branches, addresses, policy, deletion, regions, derived} = tables;
  return [branches, addresses, policy, deletion, regions, derived];
}


export function dispatchRegionTables(env: NodeJS.ProcessEnv = process.env) {
  const { regions: base, derived, neighbors } = checkoutTables(env);
  return { base, derived, neighbors };
}
