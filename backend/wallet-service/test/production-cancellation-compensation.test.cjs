'use strict';

const {test} = require('node:test');
const assert = require('node:assert/strict');
const {randomUUID} = require('node:crypto');
const {GetCommand, TransactWriteCommand} = require('@aws-sdk/lib-dynamodb');
const fixture = require('./helpers/cancellation-compensation-249-fixture.cjs');
const {createFinanceRollout} = require('../dist/financeRollout');
const {financialDispatchTables} = require('../dist/walletBindings');
const {checkoutTables} = require('../dist/checkoutTables');
const {exactCheck} = require('../dist/driverFinancialTransaction');
const {quoteHash} = require('../dist/deliveryQuoteRecord');
const {createMerchantPayoutApi} = require('../dist/merchantPayoutApi');
const {createMerchantSettlementBatchService} = require('../dist/merchantSettlementBatch');
const {createMerchantSettlementScheduleReader} = require('../dist/merchantSettlementScheduleReader');
const {createMerchantSettlementPreviewReader} = require('../dist/merchantSettlementPreview');
const {createMerchantStatementApproval} = require('../dist/merchantStatementApproval');
const walletBindings = require('../../../infrastructure/production/wallet-receipt-runtime.json').environment;
const reviewRoot = '../../../infrastructure/production/';
const {identities} = require(reviewRoot + 'wallet-identity-bindings.json');

function loadReviewHandler() {
  if (process.env.REVIEW_BUNDLE) return require(process.env.REVIEW_BUNDLE).createHandler;
  const {outputFiles} = require('esbuild').buildSync({
    entryPoints: [require.resolve(reviewRoot + 'order-cancellation-review/index.cjs')],
    nodePaths: [require('node:path').resolve(__dirname, '../node_modules')],
    bundle: true, platform: 'node', format: 'cjs', keepNames: true, write: false,
  });
  const fixture = new (require('node:module'))(__filename, module);
  fixture._compile(outputFiles[0].text, __filename);
  return fixture.exports.createHandler;
}

test('production compensation posts only to production tables and closes after a matching payout', async () => {
  const x = await fixture();
  const stage = financialDispatchTables();
  const stagePlatform = checkoutTables().platform;
  const orderId = 'order1';
  const orderKey = {PK: 'ORDER#' + orderId, SK: 'META'};
  const order = x.f.get(stage.orders, orderKey);
  const employeeKey = {pk: 'EMPLOYEE#staff1', sk: 'PROFILE'};
  const config = {schemaVersion: 1, accountId: '746727375268', region: 'us-east-1', scopes: []};
  const mode = 'GENERAL_PRODUCTION_FULL_CASH_V1';
  order.financeRollout = {schemaVersion: 2, scopeId: mode, version: 1,
    digest: quoteHash({release: mode, version: 1,
      orders: [{orderId, branchId: order.storeId, customerSubjectId: order.userSub}]})};
  const env = {
    ...walletBindings, ENVIRONMENT: 'production', AWS_REGION: 'us-east-1',
    FINANCE_ROLLOUT_CONFIG: JSON.stringify(config), FINANCE_ROLLOUT_SHA256: quoteHash(config),
    FINANCE_GENERAL_RELEASE_MODE: 'REQUIRED', FINANCIAL_SETTLEMENT_MODEL: 'FULL_CASH_AT_DELIVERY_V1',
    PLATFORM_SESSION_POLICY: 'VALID_SESSION',
    MERCHANTS_TABLE: 'wizz-production-Merchants', DRIVERS_TABLE: 'wizz-production-Drivers',
    DISPATCH_JOBS_TABLE: 'wizz-production-DispatchJobs', DRIVER_LIVE_STATE_TABLE: 'wizz-production-DriverLiveState',
    WAVE_OFFERS_TABLE: 'wizz-production-WaveOffers', DELIVERY_QUOTES_TABLE: 'wizz-production-DeliveryQuotes',
    OFFER_JOURNEY_TABLE: 'wizz-production-OfferJourney',
  };
  const previous = {};
  for (const [key, value] of Object.entries(env)) {
    previous[key] = process.env[key];
    process.env[key] = value;
  }
  try {
    const tables = financialDispatchTables();
    const platform = checkoutTables().platform;
    const equivalents = new Map([
      ...Object.entries(tables).map(([key, name]) => [name, stage[key]]), [platform, stagePlatform],
    ]);
    const commands = [];
    // The in-memory fixture already implements DynamoDB conditional transactions.
    // Translate storage only after checking the command's production binding.
    const db = {send(command) {
      const input = structuredClone(command.input);
      commands.push(command.input);
      const mapTable = operation => {
        assert.ok(equivalents.has(operation.TableName), operation.TableName);
        operation.TableName = equivalents.get(operation.TableName);
      };
      if (input.TransactItems) {
        for (const item of input.TransactItems) mapTable(Object.values(item)[0]);
      } else mapTable(input);
      const Command = input.TransactItems ? TransactWriteCommand : GetCommand;
      return x.f.db.send(new Command(input));
    }};
    const employee = x.f.get(stage.staff, employeeKey);
    const identity = {Username: employee.employeeId, UserAttributes: [{Name:'sub', Value:employee.employeeId}]};
    const cognito = {async send({input}) {
      if (input.AccessToken) return identity;
      assert.equal(input.UserPoolId, identities.admin.poolId);
      return {...identity, Enabled:true, UserStatus:'CONFIRMED', UserMFASettingList:['SOFTWARE_TOKEN_MFA']};
    }};
    const handle = loadReviewHandler()({db, cognito, now: () => x.f.time});
    const claims = {sub: employee.employeeId, client_id: identities.admin.clientId,
      token_use:'access', iss:'https://cognito-idp.us-east-1.amazonaws.com/' + identities.admin.poolId,
      auth_time: Math.floor(Date.now() / 1000) - 901};
    const auth = 'Bearer header.' + Buffer.from(JSON.stringify(claims)).toString('base64url') + '.signature';
    const service = async input => {
      const read = input.action === 'READ';
      const response = await handle({
        resource: '/staff/order-cancellation', requestContext: {stage:'production'},
        httpMethod: read ? 'GET' : 'POST', headers: {Authorization: auth},
        queryStringParameters: {view:'compensation', ...(read ? {orderId: input.orderId, caseKey: input.caseKey} : {})},
        ...(read ? {} : {body: JSON.stringify(input)}),
      });
      const data = JSON.parse(response.body);
      if (response.statusCode !== 200) throw Error(data.error);
      return data;
    };
    const rollout = createFinanceRollout({db, cancellationCompensation: true});
    await rollout.order(orderId, 'DRAIN');
    const view = await service({action: 'READ', caseKey: 'CUSTOMER_CANCELLATION', orderId});
    assert.equal(view.item.driverFareCapIqd, 2750);
    assert.equal(view.item.branchId, 'branch1');
    assert.ok(!commands.some(input => input.TransactItems));
    const limit = employee.approvalLimit;
    employee.approvalLimit = 0;
    await assert.rejects(service({...x.common('APPROVE'), assessment: {
      requester: 'CUSTOMER', channel: 'SUPPORT', reference: 'مراجعة قضية في بيانات الاختبار',
      foodState: 'UNUSABLE', foodLossIqd: 7000, foodLossReference: 'خسارة المطعم موثقة',
      driverEffortReference: 'وصول السائق موثق',
    }, driverFareIqd: 1000, merchantCompensationIqd: 7000, merchantFundingIqd: 0,
    agreementReference: 'مرجع الاتفاقية المختبرة'}), /EXCEPTION_APPROVAL_LIMIT/);
    employee.approvalLimit = limit;
    await service({...x.common('APPROVE'), assessment: {
      requester: 'CUSTOMER', channel: 'SUPPORT', reference: 'مراجعة قضية في بيانات الاختبار',
      foodState: 'UNUSABLE', foodLossIqd: 7000, foodLossReference: 'خسارة المطعم موثقة',
      driverEffortReference: 'وصول السائق موثق',
    }, driverFareIqd: 1000, merchantCompensationIqd: 7000, merchantFundingIqd: 0,
    agreementReference: 'مرجع الاتفاقية المختبرة'});
    assert.equal(commands.some(input => input.TransactItems?.some(i => i.Update?.TableName === tables.wallets)), false);
    const execution = {...x.common('EXECUTE'),
      decisionId: x.row().cancellationCompensationDecision.decisionId, confirmExecution: true};
    const result = await service(execution);
    assert.equal(result.driverWalletCreditIqd, 1000);
    assert.equal(result.merchantPayableIqd, 7000);
    assert.equal((await service(execution)).replayed, true);
    const transactions = commands.filter(input => input.TransactItems).map(input => input.TransactItems);
    assert.equal(transactions.length, 2);
    const accrued = transactions[1].find(item => item.Put?.Item?.kind === 'MERCHANT_ACCRUAL_INDEX_ENTRY');
    assert.equal(accrued.Put.TableName, platform);
    assert.equal(accrued.Put.Item.financialSchemaVersion, 5);
    assert.equal(x.f.get(stage.wallets, {walletId: 'WALLET#MERCHANT#branch1', sk: 'META'}).lockedBalance, 7000);

    const branchId = 'branch1';
    const scheduleBody = {
      schemaVersion: 1, kind: 'MERCHANT_SETTLEMENT_SCHEDULE', branchId, ownerId: 'owner1',
      enabled: true, status: 'APPROVED', schedule: {
        schemaVersion: 1, version: 1, frequency: 'WEEKLY', timezone: 'Asia/Baghdad', anchorLocalDate: '2026-10-01',
      },
      agreement: order.commercialPricing.agreement, effectiveFrom: '2026-09-30T21:00:00.000Z', effectiveTo: null,
      acceptedAt: '2026-09-29T12:00:00.000Z', approvedAt: '2026-09-29T13:00:00.000Z',
      acceptedBy: 'owner1', approvedBy: 'staff1',
    };
    x.f.put(stagePlatform, {pk: 'BRANCH#' + branchId, sk: 'SETTLEMENT_SCHEDULE#CURRENT',
      ...scheduleBody, digest: quoteHash(scheduleBody)});
    const readSchedule = createMerchantSettlementScheduleReader(db);
    const authorizeBranch = async branch => ({branchId: branch, actorId: 'staff1',
      guards: [exactCheck(tables.staff, employeeKey, employee)]});
    const batchService = createMerchantSettlementBatchService({
      db, readSchedule, authorizeBranch, now: () => x.f.time + 8 * 86400000,
    });
    const previewService = createMerchantSettlementPreviewReader({
      db, authorizeBranch, readSchedule: async (branch, at) => (await readSchedule(branch, at))?.schedule,
    });
    const at = new Date(x.f.time).toISOString();
    const selection = {branchId, orderIds: [orderId], at};
    const preview = await previewService.preview(selection);
    const batch = await batchService.create({...selection, requestId: randomUUID(), previewId: preview.previewId});
    assert.equal(batch.lines[0].accrual.kind, 'MERCHANT_EXCEPTION_ACCRUAL');
    assert.equal(batch.lines[0].accrual.amounts.goodsGross.minorAmount, 0);
    assert.equal(batch.header.summary.amounts.merchantNet.minorAmount, 7000000);
    const approveStatement = createMerchantStatementApproval({
      db, authorize: authorizeBranch, readBatch: batchService.read, now: () => x.f.time + 8 * 86400000,
    });
    const {batchId, batchDigest} = batch.header;
    const approved = await approveStatement({branchId, batchId, batchDigest});
    assert.equal(approved.approval.status, 'APPROVED_NOT_PAID');
    assert.equal(x.f.get(stage.wallets, {walletId: 'WALLET#MERCHANT#branch1', sk: 'META'}).lockedBalance, 7000);

    const close = {...x.common('CLOSE'), confirmClosure: true};
    await assert.rejects(service(close), /CANCEL_COMPENSATION_PAYOUT_PENDING/);
    const cashboxId = 'CASH-DESK-01';
    x.f.put(stagePlatform, {
      pk: 'MERCHANT_CASHBOXES#GLOBAL', sk: 'BOX#' + cashboxId,
      kind: 'MERCHANT_CASHBOX', code: cashboxId, name: 'صندوق الاختبار', custodian: 'أمين الصندوق',
      location: 'بغداد', status: 'ACTIVE', version: 1,
    });
    const custodian = '11111111-1111-4111-8111-111111111111';
    require('./helpers/cashbox-accounting-251-seed.cjs').seed(x.f, cashboxId, custodian);
    x.f.time += 8 * 86400000;
    const balanceKey = {pk: 'MERCHANT_CASHBOX#' + cashboxId, sk: 'BALANCE'};
    const initialCash = x.f.get(stagePlatform, balanceKey).balanceIqd;
    const authTime = Math.floor(x.f.time / 1000) - 3600;
    const ownerApi = createMerchantPayoutApi({
      db, now: () => x.f.time, owner: {subjectId: 'owner1', authTime, revalidate: async () => {}},
    });
    const staffApi = createMerchantPayoutApi({
      db, now: () => x.f.time, staff: {employeeId: custodian, authTime, mfaEnrolled: true},
    });
    let {payout} = await ownerApi.act({
      action: 'REQUEST_PAYOUT', branchId, batchId, batchDigest, method: 'CASH', requestId: randomUUID(),
    });
    const act = async (api, action, extra = {}) => {
      const result = await api.act({
        action, branchId, payoutId: payout.payoutId, version: payout.version, requestId: randomUUID(), ...extra,
      });
      payout = result.payout;
    };
    await assert.rejects(act(ownerApi, 'APPROVE_PAYOUT'), /PAYOUT_PERMISSION_REQUIRED/);
    await act(staffApi, 'APPROVE_PAYOUT');
    await act(staffApi, 'BEGIN_PAYOUT');
    await act(staffApi, 'RECORD_PAYOUT_EXECUTION', {cashboxId, actualAmount: 7000, destinationConfirmed: true});
    assert.equal(x.f.get(stagePlatform, balanceKey).balanceIqd, initialCash - 7000);
    assert.equal(x.f.get(stage.wallets, {walletId: 'WALLET#MERCHANT#branch1', sk: 'META'}).lockedBalance, 7000);
    await assert.rejects(service(close), /CANCEL_COMPENSATION_PAYOUT_PENDING/);
    await act(ownerApi, 'ACK_PAYOUT_RECEIPT', {accepted: true, receivedAmount: 7000});
    await act(staffApi, 'RECONCILE_PAYOUT');
    assert.equal(payout.status, 'PAID');
    assert.equal(x.f.get(stage.wallets, {walletId: 'WALLET#MERCHANT#branch1', sk: 'META'}).lockedBalance, 0);
    const journalKey = {pk: 'MERCHANT_PAYOUT_PAID#' + payout.payoutId, sk: 'META'};
    const journal = x.f.get(stagePlatform, journalKey);
    x.f.put(stagePlatform, {...journal, digest: 'wrong'});
    await assert.rejects(service(close), /PAYOUT_PAID_PROOF_INVALID/);
    x.f.put(stagePlatform, journal);
    assert.equal((await service(close)).status, 'RESOLVED');
    assert.equal(x.row().settlementStatus, 'RESOLVED');
    await assert.rejects(rollout.db.send(new GetCommand({TableName: platform,
      Key: {pk: 'BRANCH#foreign', sk: 'OTHER'}})), /FINANCE_ROLLOUT/);
    await assert.rejects(rollout.db.send(new TransactWriteCommand({TransactItems: [
      {Put: {TableName: platform, Item: journal}},
    ]})), /FINANCE_ROLLOUT/);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
