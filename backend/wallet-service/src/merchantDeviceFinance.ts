import { createHash, randomUUID } from "crypto";
import {
  CognitoIdentityProviderClient,
  AdminGetUserCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import { docClient, TABLES, GetCommand, TransactWriteCommand } from "./db";
import { runtimeDb } from "./merchantDeviceWallet";
import { MobileAccount } from "./transferIdentity";
import { getTransferSettings, baghdadDay } from "./transferSettings";
import {
  requestTransfer,
  cancelMobileTransfer,
  TransferActor,
} from "./transferService";
import {
  transferRecipient,
  transferStatus,
  transferHistory,
} from "./transferClient";
import {
  sendTransferCodeToVerifiedPhone,
  verifyTransferCode,
} from "./transferVerification";
import { fundingError } from "./fundingService";
import { buildSuccessResponse, buildErrorResponse } from "./utils";
import { WalletError } from "./types";
const devices = require("../merchant-runtime/functions/auth/branch_devices");
const fail = (code: string, status = 403): never => {
  throw fundingError(
    "تعذر إكمال العملية المالية من جلسة الموظف الحالية",
    code,
    status,
  );
};
const base = "/wallet/branch-device/transfers/";
const methods: Record<string, string> = {
  context: "GET",
  recipient: "GET",
  history: "GET",
  status: "GET",
  "otp/send": "POST",
  "otp/verify": "POST",
  request: "POST",
  cancel: "POST",
};
const keys: Record<string, string[]> = {
  context: [],
  recipient: ["phone", "type"],
  history: ["cursor"],
  status: ["requestId"],
  "otp/send": ["requestId", "recipientWalletId", "amount", "reason"],
  "otp/verify": [
    "requestId",
    "recipientWalletId",
    "amount",
    "reason",
    "challengeId",
    "code",
  ],
  request: [
    "requestId",
    "recipientWalletId",
    "amount",
    "reason",
    "verificationId",
  ],
  cancel: ["requestId", "recipientWalletId", "amount", "reason"],
};
export async function deviceFinance(event: any) {
  if (process.env.ENVIRONMENT !== "staging") fail("NOT_FOUND", 404);
  const action =
    typeof event.path === "string" && event.path.startsWith(base)
      ? event.path.slice(base.length)
      : "";
  if (!methods[action] || event.httpMethod !== methods[action])
    fail("NOT_FOUND", 404);
  let input: any = event.queryStringParameters || {};
  if (event.httpMethod === "POST") {
    try {
      input = JSON.parse(event.body || "{}");
    } catch {
      fail("INVALID_TRANSFER", 400);
    }
  }
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    Object.keys(input).some((k) => !keys[action].includes(k))
  )
    fail("INVALID_TRANSFER", 400);
  const token = /^Bearer (\S+)$/.exec(
    event.headers?.Authorization || event.headers?.authorization || "",
  )?.[1];
  if (!token) fail("DEVICE_REVOKED", 401);
  const access = await devices.reception(runtimeDb, token),
    { b, d } = access,
    staff = await devices.employeeAccess(runtimeDb, event, access);
  if (!staff.authorization?.permissions.includes("finance.transfer"))
    fail("PERMISSION_REQUIRED");
  const guards = [...devices.guards(b), devices.check(d), ...staff.common];
  const prove = () => devices.tx(runtimeDb, guards);
  await prove();
  const walletId = "WALLET#MERCHANT#" + b.businessId;
  const audit = (operation: any, actionName: string) => {
    const time = new Date().toISOString();
    return {
      Put: {
        TableName: "staging-MerchantPlatform",
        Item: {
          pk: "BRANCH#" + b.businessId,
          sk: "STAFF_AUDIT#OPERATIONS#" + time + "#" + randomUUID(),
          ownerId: b.ownerId,
          businessId: b.businessId,
          actorId: staff.s.subjectId,
          actorName: staff.m.displayName || "",
          roleName: staff.m.grant?.roleNameAr || staff.m.role,
          deviceId: d.deviceId,
          sessionId: staff.s.sessionId,
          permissionVersion: staff.m.version,
          policyVersion: staff.authorization.policy.version,
          createdAt: time,
          action: actionName,
          entityId: operation.transferId || b.businessId,
          result: "SUCCEEDED",
          amount: operation.amount ?? null,
          currency: "IQD",
          transferStatus: operation.status || null,
        },
        ConditionExpression: "attribute_not_exists(pk)",
      },
    };
  };
  const account: MobileAccount = {
    principalId: staff.s.subjectId,
    ownerId: b.businessId,
    type: "MERCHANT",
    walletId,
    business: b,
    isOwner: false,
    deviceGuards: guards,
    deviceAudit: audit,
  };
  const actor: TransferActor = {
    id: staff.s.subjectId,
    type: "MERCHANT",
    authTime: 0,
    account,
  };
  if (["otp/send", "otp/verify", "request"].includes(action)) {
    const live = await new CognitoIdentityProviderClient({}).send(
      new AdminGetUserCommand({
        UserPoolId: process.env.MERCHANT_USER_POOL_ID,
        Username: staff.s.subjectId,
      }),
    );
    const attrs = Object.fromEntries(
      (live.UserAttributes || []).map((a) => [a.Name!, a.Value!]),
    );
    if (
      !live.Enabled ||
      live.UserStatus !== "CONFIRMED" ||
      attrs.sub !== staff.s.subjectId ||
      attrs.phone_number_verified !== "true" ||
      !/^\+9647\d{9}$/.test(attrs.phone_number || "")
    )
      fail("PHONE_VERIFICATION_REQUIRED");
    account.verificationScope = createHash("sha256")
      .update(
        JSON.stringify([
          b.businessId,
          d.deviceId,
          d.version,
          staff.s.sessionId,
          staff.m.version,
          staff.s.pinVersion,
          attrs.phone_number,
        ]),
      )
      .digest("hex");
    if (action === "otp/send")
      return sendTransferCodeToVerifiedPhone(
        account,
        attrs.phone_number,
        input,
      );
    if (action === "otp/verify") {
      const result = await verifyTransferCode(account, input);
      await prove();
      return result;
    }
  }
  if (action === "request") {
    const result = await requestTransfer(actor, input);
    await prove();
    return {
      transferId: result.transferId,
      status: result.status,
      amount: result.amount,
      currency: "IQD",
    };
  }
  if (action === "cancel") {
    const result = await cancelMobileTransfer(actor, input);
    await prove();
    return {
      transferId: result.transferId,
      status: result.status,
      amount: result.amount,
    };
  }
  let result: any;
  if (action === "context") {
    const settings = await getTransferSettings();
    const wallet = (
      await docClient.send(
        new GetCommand({
          TableName: TABLES.WALLETS,
          Key: { walletId, sk: "META" },
          ConsistentRead: true,
        }),
      )
    ).Item;
    if (
      !wallet ||
      wallet.ownerType !== "MERCHANT" ||
      wallet.ownerId !== b.businessId ||
      wallet.deletionRequestId ||
      wallet.currency !== "IQD" ||
      !Number.isSafeInteger(wallet.availableBalance) ||
      wallet.availableBalance < 0 ||
      !Number.isSafeInteger(wallet.lockedBalance) ||
      wallet.lockedBalance < 0
    )
      return fail("WALLET_UNAVAILABLE", 409);
    const daily = (
      await docClient.send(
        new GetCommand({
          TableName: TABLES.IDEMPOTENCY_KEYS,
          Key: {
            idempotencyKey: `TRANSFER_DAILY#${walletId}#${baghdadDay()}`,
            sk: "META",
          },
          ConsistentRead: true,
        }),
      )
    ).Item;
    if (daily && (!Number.isSafeInteger(daily.total) || daily.total < 0))
      fail("DAILY_LIMIT_UNAVAILABLE", 503);
    result = {
      walletId,
      available: wallet.availableBalance,
      locked: wallet.lockedBalance,
      canTransfer: settings.enabled && wallet.status === "ACTIVE",
      minAmount: settings.minAmount,
      maxAmount: settings.maxAmount,
      dailyLimit: settings.merchantDaily,
      dailyUsed: daily?.total || 0,
      dailyRemaining: Math.max(0, settings.merchantDaily - (daily?.total || 0)),
      day: baghdadDay(),
      timezone: "Asia/Baghdad",
    };
  } else if (action === "recipient") {
    if (
      typeof input.phone !== "string" ||
      input.phone.length > 40 ||
      (input.type !== undefined && !["DRIVER", "CUSTOMER"].includes(input.type))
    )
      fail("INVALID_RECIPIENT", 400);
    result = await transferRecipient(
      account,
      input.phone,
      input.type || "DRIVER",
    );
  } else if (action === "history") {
    const page = await transferHistory(account, input.cursor);
    result = {
      nextCursor: page.nextCursor,
      transactions: page.transactions.map((r: any) =>
        Object.fromEntries(
          [
            "transactionId",
            "type",
            "category",
            "amount",
            "balanceBefore",
            "balanceAfter",
            "createdAt",
            "relatedEntityId",
          ]
            .filter((k) => r[k] !== undefined)
            .map((k) => [k, r[k]]),
        ),
      ),
    };
  } else result = await transferStatus(account, input.requestId);
  await docClient.send(
    new TransactWriteCommand({
      TransactItems: [
        ...guards,
        audit({}, "MERCHANT_STAFF_TRANSFER_" + action.toUpperCase() + "_READ"),
      ],
    }),
  );
  return result;
}
export async function handler(event: any) {
  if (event.type === "TOKEN") {
    if (process.env.ENVIRONMENT !== "staging") throw Error("Unauthorized");
    return devices.authorizer(runtimeDb, event);
  }
  try {
    return buildSuccessResponse(await deviceFinance(event));
  } catch (error: any) {
    if (Number.isInteger(error.status) && error.status >= 400 && error.status < 500 && /^[A-Z_]+$/.test(error.message || '')) {
      return buildErrorResponse(error.status, error.message, 'تغيرت صلاحية العملية أو حالتها. حدّث جلسة الموظف وتحقق من النتيجة.');
    }
    if (error instanceof WalletError)
      return buildErrorResponse(error.statusCode, error.code, error.message);
    return buildErrorResponse(
      503,
      "FINANCIAL_OPERATION_UNAVAILABLE",
      "تعذر تأكيد العملية. تحقق من حالتها قبل المحاولة مجددًا.",
    );
  }
}
