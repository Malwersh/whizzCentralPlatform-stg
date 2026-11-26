/** Financial tables must be explicitly bound before a production client is created. */
const defaults = {
  WALLETS: ['WALLETS_TABLE', 'dev-Wallets'],
  LEDGER: ['LEDGER_TABLE', 'dev-LedgerEntries'],
  HOLDS: ['HOLDS_TABLE', 'dev-Holds'],
  TOPUP_REQUESTS: ['TOPUP_REQUESTS_TABLE', 'dev-TopupRequests'],
  AUDIT_LOG: ['AUDIT_LOG_TABLE', 'dev-AuditLog'],
  IDEMPOTENCY_KEYS: ['IDEMPOTENCY_KEYS_TABLE', 'dev-IdempotencyKeys'],
} as const;

export function walletBindings(env: NodeJS.ProcessEnv = process.env) {
  const stages = [env.ENVIRONMENT, env.PLATFORM_ENVIRONMENT].filter(Boolean);
  const production = stages.some(stage => stage === 'production' || stage === 'prod');
  const invalid = (field: string): never => {
    throw new Error('WALLET_BINDING_NOT_CONFIGURED: ' + field);
  };
  if (production && stages.some(stage => stage !== 'production' && stage !== 'prod')) {
    invalid('ENVIRONMENT_CONFLICT');
  }
  if (production && env.AWS_REGION !== 'us-east-1') invalid('AWS_REGION');
  const tables = {} as Record<keyof typeof defaults, string>;
  for (const key of Object.keys(defaults) as (keyof typeof defaults)[]) {
    const [variable, fallback] = defaults[key];
    const value = env[variable] || fallback;
    if (production && !/^wizz-production-[A-Za-z0-9_-]+$/.test(value)) invalid(variable);
    tables[key] = value;
  }
  if (production && new Set(Object.values(tables)).size !== Object.keys(tables).length) {
    invalid('DISTINCT_FINANCIAL_TABLES');
  }
  return { tables, region: env.AWS_REGION || 'me-south-1' };
}

/** Resolve owner verification stores without falling back across environments. */
export function merchantFinancialBindings(env: NodeJS.ProcessEnv = process.env) {
  walletBindings(env);
  const production = [env.ENVIRONMENT, env.PLATFORM_ENVIRONMENT].some(v => v === 'production' || v === 'prod');
  const resolve = (name: string, fallback: string) => {
    const value = env[name] || fallback;
    if (production && !/^wizz-production-[A-Za-z0-9_-]+$/.test(value)) {
      throw new Error('WALLET_BINDING_NOT_CONFIGURED: ' + name);
    }
    return value;
  };
  const result = {
    merchants: resolve('MERCHANTS_TABLE', 'WhizzMerchants_Businesses'),
    deletion: resolve('ACCOUNT_DELETION_TABLE', 'staging-AccountDeletion'),
    sessions: resolve('MERCHANT_PLATFORM_TABLE', 'staging-MerchantPlatform'),
  };
  if (production && new Set(Object.values(result)).size !== 3) {
    throw new Error('WALLET_BINDING_NOT_CONFIGURED: DISTINCT_OWNER_TABLES');
  }
  return result;
}

/** The order condition belongs to this deployment, never to a legacy order store. */
export function walletOrderTable(env: NodeJS.ProcessEnv = process.env) {
  const bindings = walletBindings(env);
  const production = [env.ENVIRONMENT, env.PLATFORM_ENVIRONMENT].some(v => v === 'production' || v === 'prod');
  const table = env.ORDERS_TABLE || 'WizzOrders';
  if (production && (!/^wizz-production-[A-Za-z0-9_-]+$/.test(table) || Object.values(bindings.tables).includes(table))) {
    throw new Error('WALLET_BINDING_NOT_CONFIGURED: ORDERS_TABLE');
  }
  return table;
}

/** Production holds must always record their lifecycle in an isolated store. */
export function walletLifecycleTable(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const bindings = walletBindings(env);
  const production = [env.ENVIRONMENT, env.PLATFORM_ENVIRONMENT].some(v => v === 'production' || v === 'prod');
  const table = env.WALLET_LIFECYCLE_TABLE;
  if (production && (!table || !/^wizz-production-[A-Za-z0-9_-]+$/.test(table) ||
      Object.values(bindings.tables).includes(table) || table === env.ORDERS_TABLE)) {
    throw new Error('WALLET_BINDING_NOT_CONFIGURED: WALLET_LIFECYCLE_TABLE');
  }
  return table;
}

/** The transactional notification outbox must not alias money or order records. */
export function walletNotificationTable(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const bindings = walletBindings(env);
  const production = [env.ENVIRONMENT, env.PLATFORM_ENVIRONMENT].some(v => v === 'production' || v === 'prod');
  const table = env.WALLET_NOTIFICATIONS_TABLE;
  if (production && (!table || !/^wizz-production-[A-Za-z0-9_-]+$/.test(table) ||
      Object.values(bindings.tables).includes(table) || table === env.ORDERS_TABLE ||
      table === env.WALLET_LIFECYCLE_TABLE)) {
    throw new Error('WALLET_BINDING_NOT_CONFIGURED: WALLET_NOTIFICATIONS_TABLE');
  }
  return table;
}

/** Receipt uploads must retain the deletion fence in production. */
export function fundingReceiptBindings(env: NodeJS.ProcessEnv = process.env) {
  const bindings = walletBindings(env);
  const production = [env.ENVIRONMENT, env.PLATFORM_ENVIRONMENT].some(v => v === 'production' || v === 'prod');
  const deletion = env.ACCOUNT_DELETION_TABLE;
  const bucket = env.FUNDING_RECEIPTS_BUCKET || '';
  if (production) {
    if (!deletion || !/^wizz-production-[A-Za-z0-9_-]+$/.test(deletion) ||
        Object.values(bindings.tables).includes(deletion) ||
        [env.ORDERS_TABLE, env.WALLET_LIFECYCLE_TABLE, env.WALLET_NOTIFICATIONS_TABLE].includes(deletion)) {
      throw new Error('WALLET_BINDING_NOT_CONFIGURED: ACCOUNT_DELETION_TABLE');
    }
    if (!/^wizz-production-[a-z0-9-]+-746727375268(?:-us-east-1)?$/.test(bucket)) {
      throw new Error('WALLET_BINDING_NOT_CONFIGURED: FUNDING_RECEIPTS_BUCKET');
    }
  } else if (deletion && (deletion !== 'staging-AccountDeletion' || env.ENVIRONMENT !== 'staging')) {
    throw new Error('INVALID_LIFECYCLE_CONFIGURATION');
  }
  return { deletion, bucket };
}

export function isFinancialOrderProduction(env: NodeJS.ProcessEnv) {
  const stages = [env.ENVIRONMENT, env.PLATFORM_ENVIRONMENT, env.STAGE].filter(Boolean);
  const production = stages.some(stage => stage === 'production' || stage === 'prod');
  if (production && stages.some(stage => stage !== 'production' && stage !== 'prod')) {
    throw new Error('WALLET_BINDING_NOT_CONFIGURED: ENVIRONMENT_CONFLICT');
  }
  return production;
}

/** Store bindings for an order's atomic release, including promotional funding. */
export function financialOrderTables(env: NodeJS.ProcessEnv = process.env) {
  if (!isFinancialOrderProduction(env)) {
    return {
      orders: 'WizzOrders',
      wallets: 'staging-Wallets',
      holds: 'staging-Holds',
      ledger: 'staging-LedgerEntries',
      audit: 'staging-AuditLog',
      lifecycle: 'staging-WalletLifecycle',
      staff: 'staging-PlatformStaff',
      offerJourney: 'staging-WizzOfferJourney',
    };
  }
  const production = { ...env, ENVIRONMENT: 'production' };
  const { tables } = walletBindings(production);
  const orders = walletOrderTable(production);
  const lifecycle = walletLifecycleTable(production)!;
  const staff = env.STAFF_TABLE ?? '';
  const offerJourney = env.OFFER_JOURNEY_TABLE ?? '';
  for (const [field, table] of [['STAFF_TABLE', staff], ['OFFER_JOURNEY_TABLE', offerJourney]]) {
    if (!/^wizz-production-[A-Za-z0-9_-]+$/.test(table)) {
      throw new Error('WALLET_BINDING_NOT_CONFIGURED: ' + field);
    }
  }
  const names = [...Object.values(tables), orders, lifecycle, staff, offerJourney];
  if (new Set(names).size !== names.length) {
    throw new Error('WALLET_BINDING_NOT_CONFIGURED: DISTINCT_ORDER_FINANCIAL_TABLES');
  }
  return {
    orders, lifecycle, staff, offerJourney,
    wallets: tables.WALLETS, holds: tables.HOLDS, ledger: tables.LEDGER, audit: tables.AUDIT_LOG,
  };
}

export function financialDispatchTables(env: NodeJS.ProcessEnv = process.env) {
  const tables = financialOrderTables(env);
  const defaults = {
    jobs: ['DISPATCH_JOBS_TABLE', 'WizzDispatchJobs_staging'],
    live: ['DRIVER_LIVE_STATE_TABLE', 'WizzDriverLiveState_staging'],
    offers: ['WAVE_OFFERS_TABLE', 'WaveOffers_staging'],
    quotes: ['DELIVERY_QUOTES_TABLE', 'staging-DeliveryQuotes'],
    driver: ['DRIVERS_TABLE', 'WhizzDrivers_staging'],
    branch: ['MERCHANTS_TABLE', 'WhizzMerchants_Businesses'],
    deletion: ['ACCOUNT_DELETION_TABLE', 'staging-AccountDeletion'],
  } as const;
  const production = isFinancialOrderProduction(env);
  const dispatch = {} as Record<keyof typeof defaults, string>;
  for (const key of Object.keys(defaults) as (keyof typeof defaults)[]) {
    const [variable, fallback] = defaults[key];
    const value = production ? env[variable] || '' : fallback;
    if (production && !/^wizz-production-[A-Za-z0-9_-]+$/.test(value)) {
      throw new Error('WALLET_BINDING_NOT_CONFIGURED: ' + variable);
    }
    dispatch[key] = value;
  }
  const names = [...Object.values(tables), ...Object.values(dispatch), env.TOPUP_REQUESTS_TABLE, env.IDEMPOTENCY_KEYS_TABLE];
  if (production && new Set(names).size !== names.length) {
    throw new Error('WALLET_BINDING_NOT_CONFIGURED: DISTINCT_DISPATCH_TABLES');
  }
  return { ...tables, ...dispatch };
}
