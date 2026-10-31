import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { RoutingError } from './roadRouting';
import { createStagingDeliveryRouting } from './regionCoverage';

const unavailable = (): never => { throw new RoutingError('ROUTING_NOT_CONFIGURED'); };

/** Server configuration only. No secret name, token or provider options may come from a request body. */
export function createMapboxSecretReader(options: {
  secrets: Pick<SecretsManagerClient, 'send'>;
  secretArn: string;
  accountId: string;
  region: string;
  timeoutMs: number;
}): () => Promise<string> {
  const { secrets, secretArn, accountId, region, timeoutMs } = options;
  const prefix = `arn:aws:secretsmanager:${region}:${accountId}:secret:`;
  if (!/^\d{12}$/.test(accountId) || !/^[a-z]{2}(?:-[a-z]+)+-\d$/.test(region) ||
      typeof secretArn !== 'string' || /\s/.test(secretArn) || !secretArn.startsWith(prefix) ||
      !/^[A-Za-z0-9/_+=.@-]+-[A-Za-z0-9]{6}$/.test(secretArn.slice(prefix.length)) ||
      !Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 10000) return unavailable();
  return async (): Promise<string> => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const deadline = new Promise<never>((_, reject) => {
        timer = setTimeout(() => { controller.abort(); reject(new RoutingError('ROUTING_NOT_CONFIGURED')); }, timeoutMs);
      });
      // No process-wide token cache: a failed current read never returns a previous credential.
      const response = await Promise.race([
        secrets.send(new GetSecretValueCommand({ SecretId: secretArn, VersionStage: 'AWSCURRENT' }), { abortSignal: controller.signal }),
        deadline
      ]);
      if (controller.signal.aborted || response.ARN !== secretArn || !response.VersionStages?.includes('AWSCURRENT') ||
          response.SecretBinary !== undefined || typeof response.SecretString !== 'string' ||
          Buffer.byteLength(response.SecretString, 'utf8') > 8192) return unavailable();
      const value = JSON.parse(response.SecretString);
      if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== 1 ||
          !Object.prototype.hasOwnProperty.call(value, 'accessToken') || typeof value.accessToken !== 'string' ||
          /\s/.test(value.accessToken) || !/^(?:pk|sk)\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value.accessToken) ||
          value.accessToken.length > 4096) return unavailable();
      return value.accessToken;
    } catch { return unavailable(); }
    finally { if (timer) clearTimeout(timer); controller.abort(); }
  };
}

/** Staging composition; the application frontend is never a runtime credential source. */
export function createStagingSecretDeliveryRouting(options: {
  db: Pick<DynamoDBDocumentClient, 'send'>;
  secrets: Pick<SecretsManagerClient, 'send'>;
  secretArn: string;
  profile: 'driving' | 'driving-traffic';
  ttlSeconds: number;
  timeoutMs: number;
  credentialTimeoutMs: number;
  fetchImpl?: typeof fetch;
  now?: () => number;
}) {
  if (options.credentialTimeoutMs >= options.timeoutMs) return unavailable();
  const getAccessToken = createMapboxSecretReader({ secrets: options.secrets, secretArn: options.secretArn,
    accountId: '699561669180', region: 'us-east-1', timeoutMs: options.credentialTimeoutMs });
  return createStagingDeliveryRouting({ db: options.db, getAccessToken, profile: options.profile,
    ttlSeconds: options.ttlSeconds, timeoutMs: options.timeoutMs, fetchImpl: options.fetchImpl, now: options.now });
}
