/** ZainCash wallet funding. Provider success is inquired server-side; redirects never credit money.
 * Durable sessions and immutable config revisions intentionally have NO TTL.
 */
import { createHmac, timingSafeEqual, randomUUID, createHash } from "crypto";
import {
  SecretsManagerClient,
  GetSecretValueCommand,
  CreateSecretCommand,
} from "@aws-sdk/client-secrets-manager";
import {
  docClient,
  TABLES,
  GetCommand,
  QueryCommand,
  TransactWriteCommand,
} from "./db";
import { fundingError } from "./fundingService";
import { financialStaff, staffGuard } from "./staffAccess";
import { getPlatformWalletId, generateDatePartition } from "./utils";
import { walletNotification } from "./walletNotifications";
type Row = Record<string, any>;
const UAT = "https://pg-api-uat.zaincash.iq";
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const key = (id: string, sk = "META") => ({ idempotencyKey: `ZC#${id}`, sk });
const secretClient = new SecretsManagerClient({});
function fail(message: string, code = "ZAINCASH_INVALID", status = 409): never {
  throw fundingError(message, code, status);
}
export const gatewayIO = {
  now: () => Date.now(),
  async get(k: Row): Promise<Row | undefined> {
    return (
      await docClient.send(
        new GetCommand({
          TableName: TABLES.IDEMPOTENCY_KEYS,
          Key: k,
          ConsistentRead: true,
        }),
      )
    ).Item;
  },
  async tx(TransactItems: any[]) {
    await docClient.send(new TransactWriteCommand({ TransactItems }));
  },
  async query(id: string, cursor?: Row) {
    return docClient.send(
      new QueryCommand({
        TableName: TABLES.IDEMPOTENCY_KEYS,
        KeyConditionExpression: "idempotencyKey = :p",
        ExpressionAttributeValues: { ":p": `ZC#${id}` },
        Limit: 25,
        ScanIndexForward: false,
        ExclusiveStartKey: cursor,
        ConsistentRead: true,
      }),
    );
  },
  async read(table: string, k: Row): Promise<Row | undefined> {
    return (
      await docClient.send(
        new GetCommand({ TableName: table, Key: k, ConsistentRead: true }),
      )
    ).Item;
  },
  async secret(c: Row): Promise<Row> {
    return JSON.parse(
      (
        await secretClient.send(
          new GetSecretValueCommand({
            SecretId: c.secretId,
            VersionId: c.secretVersion,
          }),
        )
      ).SecretString || "{}",
    );
  },
  async storeSecret(mode: string, values: Row): Promise<Row> {
    // A distinct immutable secret per credential revision keeps old pending sessions recoverable.
    const name = `wizz/${process.env.ENVIRONMENT}/payments/zaincash/gateway-${mode.toLowerCase()}-${randomUUID()}`;
    const result = await secretClient.send(
      new CreateSecretCommand({
        Name: name,
        SecretString: JSON.stringify(values),
      }),
    );
    return { secretId: result.ARN, secretVersion: result.VersionId };
  },
  async request(url: string, options: Row): Promise<Row> {
    const response = await fetch(url, {
      ...options,
      redirect: "error",
      signal: AbortSignal.timeout(7000),
    });
    if (!response.ok)
      fail(
        "تعذر التحقق من بوابة زين كاش. احتُفظ بالعملية للمطابقة.",
        "ZAINCASH_UNAVAILABLE",
        502,
      );
    return response.json() as Promise<Row>;
  },
};
const put = (item: Row, before?: Row): any => ({
  Put: {
    TableName: TABLES.IDEMPOTENCY_KEYS,
    Item: item,
    ConditionExpression: before
      ? "revision = :rev"
      : "attribute_not_exists(idempotencyKey)",
    ...(before
      ? { ExpressionAttributeValues: { ":rev": before.revision } }
      : {}),
  },
});
const audit = (action: string, actor: string, data: Row) => ({
  Put: {
    TableName: TABLES.AUDIT_LOG,
    Item: {
      datePartition: generateDatePartition(new Date(gatewayIO.now())),
      sk: `${new Date(gatewayIO.now()).toISOString()}#${randomUUID()}`,
      action,
      actorId: actor,
      ...data,
    },
  },
});
async function staff(actor: string, authTime: number) {
  if (!process.env.STAFF_TABLE)
    fail(
      "إعداد صلاحيات الإدارة غير مكتمل",
      "ZAINCASH_STAFF_CONFIGURATION",
      503,
    );
  const employee = await financialStaff(actor, "finance.settings.request");
  if (
    !employee ||
    authTime > gatewayIO.now() / 1000 + 60 ||
    gatewayIO.now() / 1000 - authTime > 600
  )
    fail("سجّل الدخول مجددًا لإدارة بوابة الدفع", "REAUTH_REQUIRED", 403);
  return employee;
}
export function gatewayOrigin(value: unknown): string {
  if (typeof value !== "string") return fail("عنوان البوابة غير صالح");
  const u = new URL(value);
  // No arbitrary hosts, IPs, userinfo, paths or ports. Production domain is supplied at onboarding.
  if (
    u.protocol !== "https:" ||
    u.username ||
    u.password ||
    u.port ||
    u.pathname !== "/" ||
    u.search ||
    u.hash ||
    !/(^|\.)zaincash\.iq$/.test(u.hostname)
  )
    fail("يجب أن يكون عنوان HTTPS رسميًا ضمن نطاق zaincash.iq");
  return u.origin;
}
export function verifyZainToken(token: string, apiKey: string): Row {
  if (typeof token !== "string" || token.length > 8192 || !apiKey)
    return fail("إشعار الدفع غير صالح", "ZAINCASH_SIGNATURE", 401);
  try {
    const parts = token.split(".");
    if (parts.length !== 3) throw Error();
    const header = JSON.parse(Buffer.from(parts[0], "base64url").toString());
    if (header.alg !== "HS256" || header.crit) throw Error();
    const expected = createHmac("sha256", apiKey)
      .update(`${parts[0]}.${parts[1]}`)
      .digest();
    const actual = Buffer.from(parts[2], "base64url");
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
      throw Error();
    const body = JSON.parse(Buffer.from(parts[1], "base64url").toString());
    if (
      body.exp != null &&
      (!Number.isFinite(body.exp) || body.exp < gatewayIO.now() / 1000)
    )
      throw Error();
    if (
      body.nbf != null &&
      (!Number.isFinite(body.nbf) || body.nbf > gatewayIO.now() / 1000 + 60)
    )
      throw Error();
    return body;
  } catch {
    return fail("تعذر التحقق من توقيع زين كاش", "ZAINCASH_SIGNATURE", 401);
  }
}
async function token(c: Row) {
  const s = await gatewayIO.secret(c);
  const r = await gatewayIO.request(c.apiOrigin + "/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: s.clientId,
      client_secret: s.clientSecret,
      scope: "payment:read payment:write",
    }).toString(),
  });
  if (typeof r.access_token !== "string" || !r.access_token)
    fail("استجابة المصادقة غير صالحة", "ZAINCASH_AUTH", 502);
  return r.access_token;
}
export async function gatewaySettings() {
  const c = await gatewayIO.get(key("CONFIG"));
  if (!c)
    return {
      revision: 0,
      enabled: false,
      mode: "UAT",
      minimum: 25000,
      maximum: 500000,
      credentialsConfigured: false,
    };
  const { secretId, secretVersion, ...safe } = c;
  return {
    ...safe,
    credentialsConfigured: !!secretId && !!secretVersion,
    webhookUrl: process.env.ZAINCASH_WEBHOOK_URL,
    returnUrl: process.env.ZAINCASH_RETURN_URL,
    uatPaymentVerified: !!(await gatewayIO.get(key("UAT_ACCEPTANCE"))),
    liveWebhookVerified: !!(await gatewayIO.get(
      key(`LIVE_WEBHOOK_PROOF#${secretVersion}`),
    )),
  };
}
export async function saveGatewaySettings(
  actor: string,
  authTime: number,
  input: Row,
) {
  const employee = await staff(actor, authTime);
  const previous = await gatewayIO.get(key("CONFIG"));
  if (input.revision !== (previous?.revision || 0))
    fail("الإعدادات تغيرت. حدّث الصفحة", "CONFIG_CONFLICT");
  if (!["UAT", "LIVE"].includes(input.mode))
    fail("اختر الاختبار أو التشغيل الفعلي");
  const apiOrigin = gatewayOrigin(input.apiOrigin);
  if (
    (input.mode === "UAT" && apiOrigin !== UAT) ||
    (input.mode === "LIVE" && /uat|sandbox|test/i.test(apiOrigin))
  )
    fail("عنوان البوابة لا يطابق بيئة الدفع");
  const hosts = input.checkoutHosts;
  if (
    !Array.isArray(hosts) ||
    !hosts.length ||
    hosts.length > 5 ||
    hosts.some(
      (h: any) =>
        typeof h !== "string" ||
        gatewayOrigin("https://" + h) !== "https://" + h,
    )
  )
    fail("نطاقات صفحة الدفع غير صالحة");
  const returnUrl = process.env.ZAINCASH_RETURN_URL;
  if (!returnUrl || !returnUrl.startsWith("https://"))
    fail(
      "رابط العودة إلى التطبيق غير مهيأ",
      "ZAINCASH_DEPLOYMENT_REQUIRED",
      503,
    );
  const minimum = input.minimum,
    maximum = input.maximum;
  if (
    !Number.isSafeInteger(minimum) ||
    minimum < 25000 ||
    !Number.isSafeInteger(maximum) ||
    maximum < minimum ||
    maximum > 500000
  )
    fail("حدود الشحن بين 25,000 و500,000 دينار");
  let credentials: Row =
    previous && previous.mode === input.mode
      ? { secretId: previous.secretId, secretVersion: previous.secretVersion }
      : {};
  if (input.credentials) {
    if (
      Object.keys(input.credentials).sort().join(",") !==
        "apiKey,clientId,clientSecret" ||
      ["clientId", "clientSecret"].some(
        (k) =>
          typeof input.credentials[k] !== "string" ||
          input.credentials[k].length < 4 ||
          input.credentials[k].length > 2048,
      ) ||
      typeof input.credentials.apiKey !== "string" ||
      input.credentials.apiKey.length > 2048 ||
      (input.mode === "LIVE" && input.credentials.apiKey.length < 4)
    )
      fail("أدخل Client ID وClient Secret ومفتاح توقيع API للتشغيل الفعلي");
    credentials = await gatewayIO.storeSecret(input.mode, input.credentials);
  }
  if (
    input.pilotDriverIds != null &&
    (!Array.isArray(input.pilotDriverIds) ||
      input.pilotDriverIds.length > 5 ||
      input.pilotDriverIds.some(
        (id: any) => typeof id !== "string" || !UUID.test(id),
      ))
  )
    fail("حسابات تجربة التشغيل الفعلي غير صالحة");
  const changed =
    !previous ||
    previous.mode !== input.mode ||
    previous.apiOrigin !== apiOrigin ||
    JSON.stringify(hosts) !== JSON.stringify(previous.checkoutHosts) ||
    !!input.credentials;
  const next: Row = {
    ...key("CONFIG"),
    revision: (previous?.revision || 0) + 1,
    mode: input.mode,
    apiOrigin,
    checkoutHosts: hosts,
    minimum,
    maximum,
    ...credentials,
    pilotDriverIds: input.pilotDriverIds || [],
    pilotAuthorized: changed ? false : previous?.pilotAuthorized === true,
    enabled: input.enabled === true,
    updatedBy: actor,
    updatedAt: new Date(gatewayIO.now()).toISOString(),
    verifiedAt: changed ? null : previous?.verifiedAt,
    liveAcceptance: changed ? false : previous?.liveAcceptance === true,
  };
  if (
    next.enabled &&
    (!next.secretId ||
      !next.verifiedAt ||
      (next.mode === "LIVE" &&
        !next.liveAcceptance &&
        !(next.pilotAuthorized && next.pilotDriverIds.length)))
  )
    fail(
      "احفظ البيانات ثم اختبر الاتصال وأكمل قبول التشغيل قبل التفعيل",
      "ZAINCASH_NOT_READY",
    );
  await gatewayIO.tx([
    put(next, previous),
    staffGuard(employee),
    audit("ZAINCASH_SETTINGS_UPDATED", actor, {
      revision: next.revision,
      mode: next.mode,
      enabled: next.enabled,
      credentialsChanged: !!input.credentials,
    }),
  ]);
  return gatewaySettings();
}
export async function testGatewaySettings(
  actor: string,
  authTime: number,
  input: Row,
) {
  const employee = await staff(actor, authTime),
    c = await gatewayIO.get(key("CONFIG"));
  if (!c || c.revision !== input.revision || !c.secretVersion)
    fail("احفظ بيانات الاتصال أولًا");
  await token(c); // Authentication only: no charge or payment creation.
  const next = {
    ...c,
    revision: c.revision + 1,
    verifiedAt: new Date(gatewayIO.now()).toISOString(),
    enabled: false,
  };
  await gatewayIO.tx([
    put(next, c),
    staffGuard(employee),
    audit("ZAINCASH_AUTH_TEST_PASSED", actor, {
      revision: next.revision,
      mode: c.mode,
    }),
  ]);
  return gatewaySettings();
}
export async function acceptGatewayLive(
  actor: string,
  authTime: number,
  input: Row,
) {
  const employee = await staff(actor, authTime),
    c = await gatewayIO.get(key("CONFIG"));
  // This is a recorded administrator/provider acceptance, NOT an automated claim.
  if (
    !c ||
    c.revision !== input.revision ||
    !c.verifiedAt ||
    c.mode !== "LIVE" ||
    typeof input.evidence !== "string" ||
    input.evidence.trim().length < 20 ||
    input.webhookRegistered !== true ||
    input.walletFundingApproved !== true ||
    input.uatCompleted !== true
  )
    fail(
      "وثّق موافقة الشركة على شحن المحافظ، واختبار UAT، وتسجيل رابط الإشعارات",
    );
  if (
    !(await gatewayIO.get(key("UAT_ACCEPTANCE"))) ||
    !(await gatewayIO.get(key(`LIVE_WEBHOOK_PROOF#${c.secretVersion}`)))
  )
    fail(
      "يلزم نجاح دفع UAT ثم نجاح دفع فعلي لحساب تجربة ووصول إشعاره الموقّع قبل التفعيل العام",
      "ZAINCASH_ACCEPTANCE_EVIDENCE_REQUIRED",
    );
  const next = {
    ...c,
    revision: c.revision + 1,
    liveAcceptance: true,
    acceptedBy: actor,
    acceptedAt: new Date(gatewayIO.now()).toISOString(),
    acceptanceEvidence: input.evidence.trim().slice(0, 1000),
    enabled: false,
  };
  await gatewayIO.tx([
    put(next, c),
    staffGuard(employee),
    audit("ZAINCASH_LIVE_ACCEPTANCE_RECORDED", actor, {
      revision: next.revision,
      evidence: next.acceptanceEvidence,
    }),
  ]);
  return gatewaySettings();
}
export async function publicGatewayConfig(driver?: string) {
  const c = await gatewayIO.get(key("CONFIG"));
  return {
    enabled:
      c?.enabled === true &&
      (c.mode !== "LIVE" ||
        c.liveAcceptance === true ||
        (c.pilotAuthorized === true && c.pilotDriverIds?.includes(driver))),
    pilot: c?.mode === "LIVE" && !c.liveAcceptance,
    mode: c?.mode || "UAT",
    minimum: c?.minimum || 25000,
    maximum: c?.maximum || 500000,
  };
}
const publicPayment = (p: Row) => ({
  requestId: p.requestId,
  amount: p.amount,
  mode: p.mode,
  state: p.state,
  createdAt: p.createdAt,
  updatedAt: p.updatedAt,
  checkoutUrl: p.state === "PENDING" ? p.checkoutUrl : undefined,
  paymentId: p.paymentId,
  reason: p.reason,
});
async function load(driver: string, requestId: string) {
  if (!driver || !UUID.test(requestId))
    return fail("مرجع عملية الدفع غير صالح");
  const p = await gatewayIO.get(key(`PAYMENT#${driver}#${requestId}`));
  if (!p || p.driverId !== driver)
    return fail("عملية الدفع غير موجودة", "ZAINCASH_NOT_FOUND", 404);
  return p;
}
async function update(p: Row, changes: Row, extras: any[] = []) {
  const next: Row = {
    ...p,
    ...changes,
    revision: p.revision + 1,
    updatedAt: new Date(gatewayIO.now()).toISOString(),
  };
  const reviewStates = [
    "CREATION_UNCERTAIN",
    "REVIEW_REQUIRED",
    "REFUND_REVIEW_REQUIRED",
  ];
  const wasReview = reviewStates.includes(p.state),
    isReview = reviewStates.includes(next.state);
  const reviewOps: any[] = [];
  if (isReview && !wasReview)
    reviewOps.push(
      put({
        ...key("REVIEW", p.reference),
        driverId: p.driverId,
        requestId: p.requestId,
        amount: p.amount,
      }),
    );
  if (wasReview && !isReview)
    reviewOps.push({
      Delete: {
        TableName: TABLES.IDEMPOTENCY_KEYS,
        Key: key("REVIEW", p.reference),
      },
    });
  await gatewayIO.tx([put(next, p), ...extras, ...reviewOps]);
  return next;
}
export async function createGatewayPayment(driver: string, input: Row) {
  if (
    !driver ||
    !UUID.test(input.requestId || "") ||
    !Number.isSafeInteger(input.amount) ||
    !["UAT", "LIVE"].includes(input.mode)
  )
    fail("بيانات الدفع غير صالحة");
  const saved = await gatewayIO.get(
    key(`PAYMENT#${driver}#${input.requestId}`),
  );
  if (saved) {
    if (saved.amount !== input.amount || saved.mode !== input.mode)
      fail("مرجع الدفع مستخدم بمبلغ مختلف", "IDEMPOTENCY_CONFLICT");
    return publicPayment(saved);
  }
  const active = await gatewayIO.get(key(`ACTIVE#${driver}`));
  if (active)
    fail(
      "توجد عملية دفع معلّقة. افتح سجل الدفع وتحقق منها قبل دفع مبلغ آخر",
      "ZAINCASH_ACTIVE_PAYMENT",
    );
  const c = await gatewayIO.get(key("CONFIG"));
  if (
    !c?.enabled ||
    !c.verifiedAt ||
    (c.mode === "LIVE" &&
      !c.liveAcceptance &&
      !(c.pilotAuthorized && c.pilotDriverIds?.includes(driver)))
  )
    fail("الدفع المباشر غير متاح حاليًا", "METHOD_DISABLED");
  if (input.mode !== c.mode)
    fail(
      "تغيرت بيئة الدفع. لا تبدأ دفعة قبل تحديث الصفحة",
      "ZAINCASH_MODE_CHANGED",
    );
  if (input.amount < c.minimum || input.amount > c.maximum)
    fail("المبلغ خارج حدود الشحن");
  const w = await gatewayIO.read(TABLES.WALLETS, {
    walletId: `WALLET#DRIVER#${driver}`,
    sk: "META",
  });
  if (!w || w.status !== "ACTIVE" || w.deletionRequestId)
    fail("المحفظة غير متاحة للشحن", "ACCOUNT_CLOSING");
  const requestId = input.requestId,
    reference = randomUUID(),
    at = new Date(gatewayIO.now()).toISOString();
  const p: Row = {
    ...key(`PAYMENT#${driver}#${requestId}`),
    driverId: driver,
    requestId,
    reference,
    amount: input.amount,
    mode: c.mode,
    state: "CREATING",
    revision: 1,
    createdAt: at,
    updatedAt: at,
    config: c,
  };
  const due = {
    ...key("DUE", reference),
    driverId: driver,
    requestId,
    amount: input.amount,
    revision: 1,
    nextCheck: gatewayIO.now() + 60000,
  };
  try {
    await gatewayIO.tx([
      put({
        ...key(`ACTIVE#${driver}`),
        requestId,
        driverId: driver,
        amount: input.amount,
      }),
      put(p),
      put({
        ...key(`REFERENCE#${reference}`),
        driverId: driver,
        requestId,
        amount: input.amount,
      }),
      put({
        ...key(`HISTORY#${driver}`, at + "#" + requestId),
        requestId,
        driverId: driver,
        amount: input.amount,
      }),
      put({
        ...key("HISTORY", at + "#" + requestId),
        driverId: driver,
        requestId,
        amount: input.amount,
      }),
      put(due),
      ...(process.env.ACCOUNT_DELETION_TABLE
        ? [
            {
              ConditionCheck: {
                TableName: process.env.ACCOUNT_DELETION_TABLE,
                Key: { pk: `ACCOUNT_LIFECYCLE#DRIVER#${driver}`, sk: "META" },
                ConditionExpression: "attribute_not_exists(pk)",
              },
            },
          ]
        : []),
      {
        ConditionCheck: {
          TableName: TABLES.IDEMPOTENCY_KEYS,
          Key: key("CONFIG"),
          ConditionExpression: "revision = :r AND enabled = :yes",
          ExpressionAttributeValues: { ":r": c.revision, ":yes": true },
        },
      },
      {
        ConditionCheck: {
          TableName: TABLES.WALLETS,
          Key: { walletId: w.walletId, sk: "META" },
          ConditionExpression:
            "#v = :v AND #s = :active AND attribute_not_exists(deletionRequestId)",
          ExpressionAttributeNames: { "#v": "version", "#s": "status" },
          ExpressionAttributeValues: { ":v": w.version, ":active": "ACTIVE" },
        },
      },
    ]);
  } catch (e) {
    const replay = await gatewayIO.get(key(`PAYMENT#${driver}#${requestId}`));
    if (replay && replay.amount === input.amount && replay.mode === input.mode)
      return publicPayment(replay);
    if (await gatewayIO.get(key(`ACTIVE#${driver}`)))
      fail("توجد عملية دفع معلّقة. تابعها من السجل", "ZAINCASH_ACTIVE_PAYMENT");
    throw e;
  }
  try {
    const bearer = await token(c);
    const result = await gatewayIO.request(
      c.apiOrigin + "/api/v2/payment-gateway/transaction/init",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${bearer}`,
        },
        body: JSON.stringify({
          language: "ar",
          externalReferenceId: reference,
          orderId: reference,
          serviceType: "driver-wallet-funding",
          amount: { value: p.amount, currency: "IQD" },
          redirectUrls: {
            successUrl: process.env.ZAINCASH_RETURN_URL,
            failureUrl: process.env.ZAINCASH_RETURN_URL,
          },
        }),
      },
    );
    const paymentId = result.transactionDetails?.transactionId;
    const url = new URL(result.redirectUrl);
    if (
      !UUID.test(paymentId || "") ||
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.port ||
      !c.checkoutHosts.includes(url.hostname)
    )
      fail("استجابة البوابة غير صالحة", "ZAINCASH_RESPONSE", 502);
    const next = await update(
      p,
      { state: "PENDING", paymentId, checkoutUrl: url.href },
      [
        put({
          ...key(`PROVIDER#${p.mode}#${paymentId}`),
          driverId: driver,
          requestId,
          amount: p.amount,
        }),
      ],
    );
    return publicPayment(next);
  } catch {
    // Never repeat init after any uncertain provider response, even if app restarts.
    try {
      return publicPayment(
        await update(p, {
          state: "CREATION_UNCERTAIN",
          reason: "يلزم التحقق من البوابة قبل محاولة دفع أخرى",
        }),
      );
    } catch {
      return publicPayment(await load(driver, requestId));
    }
  }
}
async function releaseActive(p: Row) {
  const k = key(`ACTIVE#${p.driverId}`),
    current = await gatewayIO.get(k);
  if (!current)
    return {
      ConditionCheck: {
        TableName: TABLES.IDEMPOTENCY_KEYS,
        Key: k,
        ConditionExpression: "attribute_not_exists(idempotencyKey)",
      },
    };
  if (current.requestId !== p.requestId)
    return {
      ConditionCheck: {
        TableName: TABLES.IDEMPOTENCY_KEYS,
        Key: k,
        ConditionExpression: "requestId = :id",
        ExpressionAttributeValues: { ":id": current.requestId },
      },
    };
  return {
    Delete: {
      TableName: TABLES.IDEMPOTENCY_KEYS,
      Key: k,
      ConditionExpression: "requestId = :id",
      ExpressionAttributeValues: { ":id": p.requestId },
    },
  };
}
function removeDue(p: Row) {
  return {
    Delete: {
      TableName: TABLES.IDEMPOTENCY_KEYS,
      Key: key("DUE", p.reference),
    },
  };
}
function settledDue(p: Row, delay = 86400000) {
  return {
    Update: {
      TableName: TABLES.IDEMPOTENCY_KEYS,
      Key: key("DUE", p.reference),
      UpdateExpression:
        "SET nextCheck = :next, driverId = :driver, requestId = :request, amount = :amount ADD revision :one",
      ConditionExpression:
        "attribute_not_exists(idempotencyKey) OR (driverId = :driver AND requestId = :request)",
      ExpressionAttributeValues: {
        ":next": gatewayIO.now() + delay,
        ":one": 1,
        ":driver": p.driverId,
        ":request": p.requestId,
        ":amount": p.amount,
      },
    },
  };
}
export function matchGatewayInquiry(p: Row, result: Row, paymentId: string) {
  const d = result.transactionDetails;
  if (
    !d ||
    d.transactionId !== paymentId ||
    d.externalReferenceId !== p.reference ||
    d.amount?.currency !== "IQD" ||
    !["string", "number"].includes(typeof d.amount?.value) ||
    !Number.isSafeInteger(Number(d.amount.value)) ||
    Number(d.amount.value) !== p.amount
  )
    fail(
      "بيانات الدفع لا تطابق العملية. تحتاج مراجعة مالية",
      "ZAINCASH_MISMATCH",
    );
  return result.status;
}
async function settle(p: Row): Promise<Row> {
  const at = new Date(gatewayIO.now()).toISOString();
  if (p.mode === "UAT")
    return update(p, { state: "SUCCESS", settledAt: at }, [
      {
        Put: {
          TableName: TABLES.IDEMPOTENCY_KEYS,
          Item: {
            ...key("UAT_ACCEPTANCE"),
            requestId: p.requestId,
            confirmedAt: at,
            mode: "UAT",
          },
        },
      },
      put({
        ...key(`UAT_CREDIT#${p.reference}`),
        amount: p.amount,
        driverId: p.driverId,
        environment: "UAT",
      }),
      await releaseActive(p),
      removeDue(p),
      audit("ZAINCASH_UAT_SUCCESS", "ZAINCASH", {
        requestId: p.requestId,
        amount: p.amount,
      }),
    ]);
  const driverWalletId = `WALLET#DRIVER#${p.driverId}`,
    platformWalletId = getPlatformWalletId();
  const driver = await gatewayIO.read(TABLES.WALLETS, {
      walletId: driverWalletId,
      sk: "META",
    }),
    platform = await gatewayIO.read(TABLES.WALLETS, {
      walletId: platformWalletId,
      sk: "META",
    });
  if (
    !driver ||
    !platform ||
    driver.status !== "ACTIVE" ||
    driver.deletionRequestId
  )
    return update(p, {
      state: "REVIEW_REQUIRED",
      reason:
        "نجح الدفع لكن المحفظة غير متاحة. يلزم حل مالي؛ لم يضف الرصيد بعد.",
    });
  for (const w of [driver, platform])
    if (
      !Number.isSafeInteger(w.availableBalance) ||
      !Number.isSafeInteger(w.version) ||
      !Number.isSafeInteger(w.availableBalance + p.amount)
    )
      fail("رصيد المحفظة غير صالح للمطابقة", "ZAINCASH_BALANCE_REVIEW");
  const transactionId = `ZAINCASH#${p.reference}`;
  const ops: any[] = [];
  for (const [i, w] of [driver, platform].entries()) {
    ops.push({
      Update: {
        TableName: TABLES.WALLETS,
        Key: { walletId: w.walletId, sk: "META" },
        UpdateExpression:
          "SET availableBalance = availableBalance + :amount, #v = #v + :one, updatedAt = :at",
        ConditionExpression:
          "#v = :v" +
          (i === 0
            ? " AND #s = :active AND attribute_not_exists(deletionRequestId)"
            : ""),
        ExpressionAttributeNames: {
          "#v": "version",
          ...(i === 0 ? { "#s": "status" } : {}),
        },
        ExpressionAttributeValues: {
          ":v": w.version,
          ":amount": p.amount,
          ":one": 1,
          ":at": at,
          ...(i === 0 ? { ":active": "ACTIVE" } : {}),
        },
      },
    });
    ops.push({
      Put: {
        TableName: TABLES.LEDGER,
        Item: {
          walletId: w.walletId,
          sk: `ts#${at}#${transactionId}`,
          txnId: transactionId,
          transactionId,
          type: "TOPUP",
          amount: p.amount,
          balance: w.availableBalance + p.amount,
          relatedEntityId: p.requestId,
          relatedEntityType: "TOPUP",
          description:
            i === 0
              ? "شحن مباشر عبر زين كاش"
              : "تحصيل زين كاش لشحن محفظة السائق",
          metadata: {
            method: "ZAINCASH_GATEWAY",
            providerPaymentId: p.paymentId,
            driverId: p.driverId,
            configRevision: p.config.revision,
          },
          timestamp: at,
          createdAt: at,
        },
        ConditionExpression: "attribute_not_exists(walletId)",
      },
    });
  }
  ops.push(
    put({
      ...key(`SETTLED#${p.mode}#${p.paymentId}`),
      driverId: p.driverId,
      requestId: p.requestId,
      amount: p.amount,
    }),
    await releaseActive(p),
    settledDue(p),
    audit("ZAINCASH_WALLET_CREDIT", "ZAINCASH", {
      requestId: p.requestId,
      paymentId: p.paymentId,
      amount: p.amount,
      transactionId,
      lines: [
        { account: "ZAINCASH_RECEIVABLE", side: "DEBIT", amount: p.amount },
        {
          account: "DRIVER_WALLET_LIABILITY",
          side: "CREDIT",
          amount: p.amount,
        },
      ],
    }),
    walletNotification(
      { topupId: transactionId, driverId: p.driverId, amount: p.amount } as any,
      "APPROVED",
      at,
    ),
  );
  return update(
    p,
    { state: "SUCCESS", settledAt: at, transactionId, reason: null },
    ops,
  );
}
export async function checkGatewayPayment(
  driver: string,
  requestId: string,
  recoveredPaymentId?: string,
): Promise<Row> {
  let p = await load(driver, requestId);
  if (["REFUND_REVIEW_REQUIRED", "NOT_CREATED"].includes(p.state))
    return publicPayment(p);
  const paymentId = p.paymentId || recoveredPaymentId;
  if (!paymentId) return publicPayment(p);
  if (!UUID.test(paymentId)) fail("معرّف البوابة غير صالح");
  if (p.lastCheckedAt && gatewayIO.now() - p.lastCheckedAt < 15000)
    return publicPayment(p);
  try {
    p = await update(p, { lastCheckedAt: gatewayIO.now() });
  } catch {
    return publicPayment(await load(driver, requestId));
  }
  let authConfig = p.config;
  let bearer: string;
  try {
    bearer = await token(authConfig);
  } catch (error) {
    // Pending transactions survive a provider-side key revocation. Only a verified
    // replacement on the same provider origin/environment may inquire about them.
    const current = await gatewayIO.get(key("CONFIG"));
    if (
      !current?.verifiedAt ||
      current.mode !== p.mode ||
      current.apiOrigin !== p.config.apiOrigin ||
      current.secretVersion === p.config.secretVersion
    )
      throw error;
    authConfig = current;
    bearer = await token(authConfig);
  }
  const result = await gatewayIO.request(
    authConfig.apiOrigin +
      "/api/v2/payment-gateway/transaction/inquiry/" +
      encodeURIComponent(paymentId),
    { headers: { Authorization: `Bearer ${bearer}` } },
  );

  let status;
  if (result.status === "SUCCESS" && result.canceled === true)
    return publicPayment(
      await update(p, {
        state: "REVIEW_REQUIRED",
        reason: "استجابة متعارضة من البوابة. يلزم التحقق قبل إضافة الرصيد.",
      }),
    );
  try {
    status = matchGatewayInquiry(p, result, paymentId);
  } catch (e) {
    await update(p, {
      state: "REVIEW_REQUIRED",
      reason: "تعذر مطابقة معرّف الدفع أو المبلغ أو العملة",
    });
    throw e;
  }
  if (authConfig.secretVersion !== p.config.secretVersion)
    p = await update(
      p,
      { originalConfig: p.originalConfig || p.config, config: authConfig },
      [
        audit("ZAINCASH_VERIFIED_CREDENTIAL_ROTATION", "ZAINCASH", {
          driverId: p.driverId,
          requestId,
          fromRevision: p.config.revision,
          toRevision: authConfig.revision,
        }),
      ],
    );
  if (!p.paymentId)
    p = await update(p, { paymentId, state: "PENDING" }, [
      put({
        ...key(`PROVIDER#${p.mode}#${paymentId}`),
        driverId: driver,
        requestId,
        amount: p.amount,
      }),
    ]);
  if (["REFUNDED", "PARTIALLY_REFUNDED"].includes(status))
    return publicPayment(
      await update(
        p,
        {
          state: "REFUND_REVIEW_REQUIRED",
          reason:
            "أبلغت البوابة عن استرجاع. يلزم مراجعة الرصيد والمبلغ المسترجع قبل أي قيد جديد.",
        },
        [
          audit("ZAINCASH_REFUND_REVIEW", "ZAINCASH", {
            requestId,
            amount: p.amount,
            providerStatus: status,
          }),
        ],
      ),
    );
  if (p.state === "SUCCESS") {
    if (status !== "SUCCESS")
      return publicPayment(
        await update(
          p,
          {
            state: "REFUND_REVIEW_REQUIRED",
            reason:
              "تغيرت حالة دفعة سبق شحنها. يلزم مطابقة مالية؛ لا يُكرر القيد.",
          },
          [
            audit("ZAINCASH_SETTLED_STATUS_CHANGED", "ZAINCASH", {
              driverId: p.driverId,
              requestId,
              providerStatus: status,
            }),
          ],
        ),
      );
    return publicPayment(p);
  }
  if (["FAILED", "EXPIRED", "CANCELED"].includes(p.state)) {
    if (status === p.state) return publicPayment(p);
    p = await update(
      p,
      {
        state: "REVIEW_REQUIRED",
        reason:
          "ورد تحديث من الشركة لدفعة أُغلقت سابقًا. تُراجع النتيجة دون إنشاء دفع جديد.",
      },
      [settledDue(p, 60000)],
    );
  }
  if (status === "SUCCESS") {
    for (let i = 0; i < 3; i++) {
      try {
        return publicPayment(await settle(p));
      } catch (e: any) {
        if (e.name !== "TransactionCanceledException") throw e;
        p = await load(driver, requestId);
        if (
          [
            "SUCCESS",
            "FAILED",
            "EXPIRED",
            "CANCELED",
            "REFUND_REVIEW_REQUIRED",
            "NOT_CREATED",
          ].includes(p.state)
        )
          return publicPayment(p);
      }
    }
    return fail(
      "الدفع مؤكد؛ تسوية الرصيد قيد المتابعة. لا تدفع مجددًا",
      "ZAINCASH_SETTLEMENT_RETRY",
      503,
    );
  }
  if (["FAILED", "EXPIRED", "CANCELED"].includes(status))
    return publicPayment(
      await update(p, { state: status }, [
        await releaseActive(p),
        removeDue(p),
        audit("ZAINCASH_PAYMENT_TERMINAL", "ZAINCASH", {
          requestId,
          providerStatus: status,
        }),
      ]),
    );
  return publicPayment(p);
}
function decodeCursor(raw?: string): Row | undefined {
  if (!raw) return undefined;
  try {
    if (raw.length > 1500) throw Error();
    const k = JSON.parse(Buffer.from(raw, "base64url").toString());
    if (typeof k.idempotencyKey !== "string" || typeof k.sk !== "string")
      throw Error();
    return k;
  } catch {
    return fail("مؤشر الصفحة غير صالح");
  }
}
export async function gatewayHistory(
  driver: string | null,
  cursor?: string,
  reviewOnly = false,
) {
  const partition = driver
      ? `HISTORY#${driver}`
      : reviewOnly
        ? "REVIEW"
        : "HISTORY",
    k = decodeCursor(cursor);
  if (k && k.idempotencyKey !== `ZC#${partition}`)
    fail("مؤشر الصفحة لا يخص الحساب");
  const result = await gatewayIO.query(partition, k),
    payments = [];
  for (const pointer of result.Items || []) {
    const p = await load(driver || pointer.driverId, pointer.requestId);
    payments.push({
      ...publicPayment(p),
      ...(driver ? {} : { driverId: p.driverId }),
    });
  }
  return {
    payments,
    cursor: result.LastEvaluatedKey
      ? Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString(
          "base64url",
        )
      : null,
  };
}
export async function gatewayWebhook(body: Row) {
  const jwt = body.webhook_token;
  if (typeof jwt !== "string" || jwt.length > 8192)
    fail("إشعار الدفع غير صالح", "ZAINCASH_SIGNATURE", 401);
  let hint: Row;
  try {
    hint = JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString());
  } catch {
    return fail("إشعار الدفع غير صالح", "ZAINCASH_SIGNATURE", 401);
  }
  const reference = hint.merchantReferenceId || hint.orderId;
  if (typeof reference !== "string" || !UUID.test(reference))
    fail("مرجع الإشعار غير صالح", "ZAINCASH_SIGNATURE", 401);
  const pointer = await gatewayIO.get(key(`REFERENCE#${reference}`));
  if (!pointer) return { received: true };
  const p = await load(pointer.driverId, pointer.requestId);
  let claims: Row;
  let signatureConfig = p.config;
  try {
    claims = verifyZainToken(jwt, (await gatewayIO.secret(p.config)).apiKey);
  } catch (error) {
    const current = await gatewayIO.get(key("CONFIG"));
    if (
      !current?.verifiedAt ||
      current.mode !== p.mode ||
      current.apiOrigin !== p.config.apiOrigin ||
      current.secretVersion === p.config.secretVersion
    )
      throw error;
    claims = verifyZainToken(jwt, (await gatewayIO.secret(current)).apiKey);
    signatureConfig = current;
  }
  if (
    (claims.merchantReferenceId || claims.orderId) !== p.reference ||
    !UUID.test(claims.transactionId || "") ||
    (p.paymentId && p.paymentId !== claims.transactionId)
  )
    fail("الإشعار لا يخص العملية", "ZAINCASH_MISMATCH");
  if (p.state === "NOT_CREATED") {
    await update(
      p,
      {
        state: "REFUND_REVIEW_REQUIRED",
        reason:
          "وصل إشعار لاحق لعملية أُغلقت بعد تأكيد عدم الدفع؛ يلزم التحقق من الشركة.",
      },
      [
        audit("ZAINCASH_LATE_CALLBACK_REVIEW", "ZAINCASH", {
          requestId: p.requestId,
          paymentId: claims.transactionId,
        }),
      ],
    );
    return { received: true };
  }
  const eventId = claims.eventId;
  if (typeof eventId !== "string" || eventId.length < 1 || eventId.length > 200)
    fail("معرّف الإشعار غير صالح", "ZAINCASH_SIGNATURE", 401);
  const receiptKey = key(
    `WEBHOOK#${p.mode}#${createHash("sha256").update(eventId).digest("hex")}`,
  );
  const seen = await gatewayIO.get(receiptKey);
  if (seen) {
    if (
      seen.reference !== p.reference ||
      seen.paymentId !== claims.transactionId
    )
      fail("معرّف إشعار متعارض", "ZAINCASH_MISMATCH");
    return { received: true };
  }
  const checked = await checkGatewayPayment(
    p.driverId,
    p.requestId,
    claims.transactionId,
  );
  const verifiedPayment = await load(p.driverId, p.requestId);
  if (
    p.mode === "LIVE" &&
    checked.state === "SUCCESS" &&
    verifiedPayment.config.secretVersion === signatureConfig.secretVersion
  )
    await gatewayIO.tx([
      {
        Put: {
          TableName: TABLES.IDEMPOTENCY_KEYS,
          Item: {
            ...key(`LIVE_WEBHOOK_PROOF#${signatureConfig.secretVersion}`),
            requestId: p.requestId,
            confirmedAt: new Date(gatewayIO.now()).toISOString(),
          },
        },
      },
    ]);
  try {
    await gatewayIO.tx([
      put({
        ...receiptKey,
        eventId,
        reference: p.reference,
        paymentId: claims.transactionId,
        driverId: p.driverId,
        amount: p.amount,
        receivedAt: new Date(gatewayIO.now()).toISOString(),
      }),
    ]);
  } catch (e) {
    if (!(await gatewayIO.get(receiptKey))) throw e;
  }
  return { received: true };
}
export async function reconcileGatewayPayments() {
  const saved = await gatewayIO.get(key("WORKER_CURSOR"));
  const result = await gatewayIO.query("DUE", saved?.cursor);
  let checked = 0,
    review = 0;
  const tasks: Promise<void>[] = [];
  let resumeCursor: Row | undefined;
  for (const due of result.Items || []) {
    if (due.nextCheck > gatewayIO.now()) continue;
    const currentPayment = await load(due.driverId, due.requestId).catch(
      () => undefined,
    );
    const claim = {
      ...due,
      revision: due.revision + 1,
      nextCheck:
        gatewayIO.now() +
        (["SUCCESS", "REFUND_REVIEW_REQUIRED"].includes(currentPayment?.state)
          ? 86400000
          : 600000),
    };
    try {
      await gatewayIO.tx([put(claim, due)]);
    } catch {
      continue;
    }
    tasks.push(
      (async () => {
        try {
          const p = await load(due.driverId, due.requestId);
          if (p.state === "REFUND_REVIEW_REQUIRED") return;
          if (
            ["FAILED", "EXPIRED", "CANCELED", "NOT_CREATED"].includes(
              p.state,
            ) ||
            (p.state === "SUCCESS" && p.mode === "UAT")
          ) {
            await gatewayIO.tx([removeDue(p)]);
            return;
          }
          if (
            p.state !== "SUCCESS" &&
            ((!p.paymentId &&
              gatewayIO.now() - Date.parse(p.createdAt) > 600000) ||
              gatewayIO.now() - Date.parse(p.createdAt) > 86400000)
          ) {
            if (p.state !== "REVIEW_REQUIRED")
              await update(p, {
                state: "REVIEW_REQUIRED",
                reason:
                  "انتهت مهلة المتابعة الآلية. تحتاج مراجعة البوابة؛ لا تنشئ دفعة بديلة.",
              });
            review++;
          }
          if (p.paymentId) {
            await checkGatewayPayment(due.driverId, due.requestId);
            checked++;
          }
        } catch {
          console.warn("ZAINCASH_RECONCILIATION_RETRY", {
            requestId: due.requestId,
          });
        }
      })(),
    );
    if (tasks.length === 3) {
      resumeCursor = { idempotencyKey: due.idempotencyKey, sk: due.sk };
      break;
    }
  }
  await Promise.allSettled(tasks);
  const next = {
    ...key("WORKER_CURSOR"),
    revision: (saved?.revision || 0) + 1,
    cursor: resumeCursor || result.LastEvaluatedKey || null,
  };
  try {
    await gatewayIO.tx([put(next, saved)]);
  } catch {
    /* another worker progressed */
  }
  return { checked, review, hasMore: !!next.cursor };
}
export async function recoverGatewayPayment(
  actor: string,
  authTime: number,
  input: Row,
) {
  await staff(actor, authTime);
  if (
    !UUID.test(input.paymentId || "") ||
    typeof input.reason !== "string" ||
    input.reason.trim().length < 10
  )
    fail("أدخل معرّف العملية من بوابة الشركة وسبب المراجعة");
  await gatewayIO.tx([
    audit("ZAINCASH_RECOVERY_CHECK_REQUESTED", actor, {
      driverId: input.driverId,
      requestId: input.requestId,
      paymentId: input.paymentId,
      reason: input.reason.trim().slice(0, 500),
    }),
  ]);
  return checkGatewayPayment(input.driverId, input.requestId, input.paymentId);
}

/** Only a documented company investigation may release an init with no transaction id.
 * No refund or wallet credit is fabricated. A later valid callback still needs financial review.
 */
export async function resolveUncreatedGatewayPayment(
  actor: string,
  authTime: number,
  input: Row,
) {
  const employee = await staff(actor, authTime),
    p = await load(input.driverId, input.requestId);
  if (
    p.paymentId ||
    !["CREATION_UNCERTAIN", "REVIEW_REQUIRED"].includes(p.state) ||
    input.providerConfirmedNoPayment !== true ||
    typeof input.evidence !== "string" ||
    input.evidence.trim().length < 20 ||
    gatewayIO.now() - Date.parse(p.createdAt) < 600000
  )
    fail(
      "يلزم تأكيد الشركة عدم إنشاء أو تحصيل العملية، مع توثيق المرجع وبعد انتهاء مهلة الإنشاء",
    );
  return publicPayment(
    await update(
      p,
      {
        state: "NOT_CREATED",
        reason: "أكدت المراجعة عدم إنشاء أو تحصيل الدفع",
        resolvedBy: actor,
        resolutionEvidence: input.evidence.trim().slice(0, 1000),
      },
      [
        staffGuard(employee),
        await releaseActive(p),
        removeDue(p),
        audit("ZAINCASH_PROVIDER_NO_PAYMENT_CONFIRMED", actor, {
          driverId: p.driverId,
          requestId: p.requestId,
          reference: p.reference,
          evidence: input.evidence.trim().slice(0, 1000),
        }),
      ],
    ),
  );
}

export async function importGatewayUatCredentials(
  actor: string,
  authTime: number,
  input: Row,
) {
  await staff(actor, authTime);
  if (process.env.ENVIRONMENT !== "staging")
    fail("استيراد بيانات الاختبار متاح في بيئة staging فقط");
  const secret = JSON.parse(
    (
      await secretClient.send(
        new GetSecretValueCommand({
          SecretId: "wizz/staging/payments/zaincash/sandbox",
        }),
      )
    ).SecretString || "{}",
  );
  return saveGatewaySettings(actor, authTime, {
    revision: input.revision,
    mode: "UAT",
    apiOrigin: UAT,
    checkoutHosts: ["pg-api-uat.zaincash.iq", "pg-uat.zaincash.iq"],
    minimum: 25000,
    maximum: 500000,
    enabled: false,
    credentials: {
      clientId: secret.clientId,
      clientSecret: secret.clientSecret,
      apiKey: secret.apiKey || "",
    },
  });
}

export async function authorizeGatewayPilot(
  actor: string,
  authTime: number,
  input: Row,
) {
  const employee = await staff(actor, authTime),
    c = await gatewayIO.get(key("CONFIG"));
  if (
    !c ||
    c.revision !== input.revision ||
    c.mode !== "LIVE" ||
    !c.verifiedAt ||
    !c.pilotDriverIds?.length ||
    input.walletFundingApproved !== true ||
    typeof input.evidence !== "string" ||
    input.evidence.trim().length < 20 ||
    !(await gatewayIO.get(key("UAT_ACCEPTANCE")))
  )
    fail(
      "احفظ حسابات تجربة التشغيل، واختبر الاتصال، وأكمل دفع UAT، ثم وثّق موافقة الشركة على شحن المحافظ",
    );
  const next = {
    ...c,
    revision: c.revision + 1,
    pilotAuthorized: true,
    enabled: false,
    pilotEvidence: input.evidence.trim().slice(0, 1000),
  };
  await gatewayIO.tx([
    put(next, c),
    staffGuard(employee),
    audit("ZAINCASH_LIVE_PILOT_AUTHORIZED", actor, {
      driverIds: c.pilotDriverIds,
      evidence: next.pilotEvidence,
    }),
  ]);
  return gatewaySettings();
}
