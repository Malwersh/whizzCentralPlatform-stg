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
