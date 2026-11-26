'use strict';

const { CognitoIdentityProviderClient } = require('@aws-sdk/client-cognito-identity-provider');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb');
const { authenticateFinancialIdentity } = require('../../../backend/wallet-service/src/financialIdentity');
const { createExceptionStaffAuthority } = require('../../../backend/wallet-service/src/exceptionStaffAuthority');
const { checkoutTables } = require('../../../backend/wallet-service/src/checkoutTables');
const { financialOrderTables } = require('../../../backend/wallet-service/src/walletBindings');
const { createFinanceRollout } = require('../../../backend/wallet-service/src/financeRollout');
const { createStagingCodReturn } = require('../../../backend/wallet-service/src/codReturn');
const { createExceptionCaseSlaWorker } = require('../../../backend/wallet-service/src/exceptionCaseSlaWorker');
const { createDeliveryAttempt } = require('../../../backend/wallet-service/src/deliveryAttempt');
const { createReturnOperations, createReturnRoadRouter } = require('../../../backend/wallet-service/src/returnOperations');
const { createReturnContinuation } = require('../../../backend/wallet-service/src/returnContinuation');
const { createReturnDisposition } = require('../../../backend/wallet-service/src/returnDisposition');
const { createExceptionCaseAdministration } = require('../../../backend/wallet-service/src/exceptionCaseAdministration');
const { verifyMerchantPayoutJournal } = require('../../../backend/wallet-service/src/merchantPayout');
const { quoteEntityIdValid } = require('../../../backend/wallet-service/src/deliveryQuoteRecord');
const { route: returnSettings } = require('../../../backend/staff-service/return-operations-settings');
const { route: attemptSettings } = require('../../../backend/staff-service/order-exception-settings');
const { write: writeStaffAudit } = require('../../../backend/staff-service/audit-trail');
const { allowed } = require('../../../backend/staff-service/catalog');
const { route: staffCases, PATH: staffPath } = require('../../../backend/staff-service/order-exception-cases');

const driverRoot = '/driver/orders/{orderId}';
const merchantPath = '/auth/order-returns';
const driverActions = new Map([
  ['GET '+driverRoot+'/delivery-attempt','readAttempt'],
  ['POST '+driverRoot+'/delivery-attempt','startAttempt'],
  ['POST '+driverRoot+'/delivery-attempt/contact','contactAttempt'],
  ['POST '+driverRoot+'/request-return','requestReturn'],
  ['POST '+driverRoot+'/arrive-return','arriveReturn'],
  ['POST '+driverRoot+'/report-return-obstacle','reportObstacle'],
  ['POST '+driverRoot+'/return-case','continuation'],
]);
const staffMethods = new Set([
  'GET '+staffPath, 'GET '+staffPath+'/detail', 'GET '+staffPath+'/custodians', 'POST '+staffPath+'/actions',
]);
const settingsActions = new Map([
  ['GET /staff/settings/return-operations',returnSettings],
  ['POST /staff/settings/return-operations/request',returnSettings],
  ['GET /staff/settings/order-exceptions',attemptSettings],
  ['POST /staff/settings/order-exceptions/request',attemptSettings],
]);
const readActions = new Set(['READ_RETURN_CONTINUATION','RECORD_RETURN_HANDOVER','OPEN_CASE_APPEAL']);
const ownerActions = new Set(['READ_RETURN_CONTINUATION','RECEIVE_RETURN_REMAINDER','OPEN_CASE_APPEAL']);
const errorCode = /^(?:(?:INVALID_)?(?:COD_RETURN|RETURN_|EXCEPTION_|DELIVERY_ATTEMPT|ARRIVAL_|CASH_|CASE_APPEAL|ORDER_EXCEPTION)|CONTACT_ATTEMPT_TOO_SOON|NO_RESPONSE_REQUIREMENTS_NOT_MET|INDEPENDENT_EVIDENCE_REQUIRED|CORRECTION_CASE_WORK_REMAINS)[A-Z0-9_]*$/;
const headers = {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'};
const response = (statusCode, value) => ({statusCode,headers,body:JSON.stringify(value)});
const fail = (code, status) => {throw Object.assign(Error(code),{status});};

function token(event) {
  const names = Object.entries(event.headers ?? {}).filter(([name]) => name.toLowerCase()==='authorization');
  const multi = Object.entries(event.multiValueHeaders ?? {}).filter(([name]) => name.toLowerCase()==='authorization');
  const value = names[0]?.[1];
  if (names.length!==1 || multi.length>1 || typeof value!=='string' || value.length>16000 ||
      multi.length && (!Array.isArray(multi[0][1]) || multi[0][1].length!==1 || multi[0][1][0]!==value)) return null;
  return /^Bearer ([\w-]+\.[\w-]+\.[\w-]+)$/i.exec(value)?.[1] ?? null;
}

function payload(event) {
  const query = event.queryStringParameters ?? {};
  if (Object.values(event.multiValueQueryStringParameters ?? {}).some(values => !Array.isArray(values) || values.length!==1)) {
    fail('INVALID_EXCEPTION_SELECTOR',400);
  }
  if (event.httpMethod==='GET') return query;
  if (Object.keys(query).length || event.isBase64Encoded || typeof event.body!=='string' ||
      Buffer.byteLength(event.body)>32000) fail('INVALID_EXCEPTION_SELECTOR',400);
  let data;
  try { data=JSON.parse(event.body); } catch { fail('INVALID_EXCEPTION_SELECTOR',400); }
  if (!data || Array.isArray(data) || typeof data!=='object') fail('INVALID_EXCEPTION_SELECTOR',400);
  return data;
}

function selectors(input) {
  if (!quoteEntityIdValid(input.orderId) || !quoteEntityIdValid(input.offerId) ||
      !Number.isSafeInteger(input.attempt) || input.attempt<1 || input.attempt>1000) fail('INVALID_COD_RETURN',400);
}

function createHandler({db,cognito,makeRouter=createReturnRoadRouter}) {
  return async event => {
    if (event?.source==='aws.events') {
      const expected='arn:aws:events:us-east-1:746727375268:rule/wizz-production-order-returns-sla';
      if (process.env.ENVIRONMENT!=='production' || process.env.AWS_REGION!=='us-east-1' ||
        event.account!=='746727375268' || event.region!=='us-east-1' ||
        event['detail-type']!=='Scheduled Event' || !event.resources?.includes(expected)) {
        throw Error('INVALID_RETURN_SLA_TRIGGER');
      }
      return createExceptionCaseSlaWorker({db,returnsOnly:true})();
    }
    const route = event?.httpMethod+' '+event?.resource;
    const api = event?.requestContext?.apiId;
    const driverAction = api===process.env.RETURN_DRIVER_API_ID && driverActions.get(route);
    const merchant = api===process.env.RETURN_MERCHANT_API_ID &&
      event?.resource===merchantPath && ['GET','POST'].includes(event.httpMethod);
    const staff = api===process.env.RETURN_STAFF_API_ID && staffMethods.has(route);
    const settings = api===process.env.RETURN_STAFF_API_ID && settingsActions.get(route);
    if (process.env.ENVIRONMENT!=='production' || process.env.AWS_REGION!=='us-east-1' ||
        event?.requestContext?.stage!=='production' || !api || !(driverAction || merchant || staff || settings)) {
      return response(404,{error:'NOT_FOUND'});
    }
    const bearer = token(event);
    if (!bearer) return response(401,{success:false,code:'UNAUTHORIZED',error:'UNAUTHORIZED'});
    try {
      const input=payload(event);
      if (settings) {
        if (event.httpMethod==='POST' && Object.keys(input).sort().join(',')!=='baseVersion,reason,values') {
          fail('INVALID_EXCEPTION_SETTINGS',400);
        }
        const actor=await authenticateFinancialIdentity(cognito,bearer,'STAFF');
        const {employee,guard}=await createExceptionStaffAuthority({db,cognito,accessToken:bearer}).settings(actor);
        const table=financialOrderTables().staff;
        return response(200,await settings({
          db,table,allowed,directWrite:true,enrolled:true,recent:()=>{},guard:()=>guard,
          audit:(id,action,before,after,reference)=>writeStaffAudit(table,employee,id,action,before,after,reference),
        },employee,event.httpMethod,event.resource,input));
      }
      if (staff) {
        const resolveAuthority = createExceptionStaffAuthority({db,cognito,accessToken:bearer});
        const actor = await resolveAuthority.authenticate();
        const {employee} = await resolveAuthority.read(actor);
        const tables = {...financialOrderTables(),platform:checkoutTables().platform};
        return response(200,await staffCases({
          db,tables,allowed,returnOnly:true,enrolled:true,recent:()=>{},query:input,verifyMerchantPayoutJournal,
          executeReturnAction: async action => {
            if (!quoteEntityIdValid(action.orderId)) fail('INVALID_EXCEPTION_SELECTOR',400);
            const rollout=createFinanceRollout({db,returns:true});
            await rollout.order(action.orderId,'DRAIN');
            return createExceptionCaseAdministration({
              db:rollout.db,authority:resolveAuthority,enableFullCash:true,enableDeliveryFunding:true,productionReturns:true,
            })(action);
          },
        },employee,event.httpMethod,event.resource,input));
      }
      const orderId = merchant ? input.orderId : event.pathParameters?.orderId;
      if (!quoteEntityIdValid(orderId) || !merchant && Object.hasOwn(input,'orderId')) fail('INVALID_COD_RETURN',400);
      const role=merchant?'MERCHANT_OWNER':'DRIVER';
      const rollout=createFinanceRollout({db,returns:true});
      const authenticate=async()=> {
        const actor=await authenticateFinancialIdentity(cognito,bearer,role);
        await rollout.order(orderId,'DRAIN');
        if (!merchant) rollout.subject(orderId,actor.subjectId);
        return actor;
      };
      const options={db:rollout.db,enableFullCash:true,enableDeliveryFunding:true,authenticate};

      if (merchant) {
        if (Object.hasOwn(input,'branchId') || !quoteEntityIdValid(input.businessId)) fail('INVALID_COD_RETURN',400);
        const {businessId,custodyAction,automaticReturnAcceptance,...fields}=input;
        const data={...fields,branchId:businessId,attempt:event.httpMethod==='GET'?Number(fields.attempt):fields.attempt};
        selectors(data);
        if (custodyAction!==undefined) {
          if (event.httpMethod!=='POST' || !ownerActions.has(custodyAction) || Object.hasOwn(fields,'action') ||
              fields.caseKey!==undefined && fields.caseKey!=='RETURN#'+fields.attempt) fail('INVALID_RETURN_CONTINUATION',400);
          const {offerId,attempt,caseKey,...rest}=data;
          return response(200,await createReturnContinuation(options).execute({
            ...rest,caseKey:'RETURN#'+attempt,action:custodyAction,
          },role));
        }
        const returns=createStagingCodReturn(options);
        if (event.httpMethod==='GET') {
          if (automaticReturnAcceptance!==undefined) fail('INVALID_COD_RETURN',400);
          const receipt=await returns.readReturn(data);
          if (receipt.resolution?.caseId) {
            receipt.continuation=await createReturnContinuation(options).read({
              action:'READ_RETURN_CONTINUATION',orderId,branchId:businessId,caseKey:'RETURN#'+data.attempt,
            },role);
          }
          return response(200,receipt);
        }
        if (automaticReturnAcceptance!==undefined) return response(200,await createReturnOperations(options).setAcceptance({
          ...data,enabled:automaticReturnAcceptance,
        }));
        if (fields.branchCanReceive!==undefined) return response(200,await createReturnDisposition(options).recordReadiness(data));
        return response(200,await returns.confirmReceipt(data));
      }

      const data = {...input,orderId};
      if (driverAction==='continuation') {
        if (!readActions.has(data.action)) fail('INVALID_RETURN_CONTINUATION',400);
        return response(200,await createReturnContinuation(options).execute(data,role));
      }
      if (event.httpMethod==='GET') data.attempt=Number(data.attempt);
      selectors(data);
      if (driverAction==='reportObstacle') return response(200,await createReturnOperations(options).reportObstacle(data));
      const methods = {
        readAttempt:()=>createDeliveryAttempt(options).read(data),
        startAttempt:()=>createDeliveryAttempt(options).start(data),
        contactAttempt:()=>createDeliveryAttempt(options).contact(data),
        requestReturn:()=>createStagingCodReturn({...options,returnRouter:makeRouter()}).requestReturn(data),
        arriveReturn:()=>createStagingCodReturn(options).arriveReturn(data),
      };
      return response(200,await methods[driverAction]());
    } catch (cause) {
      const candidate = cause?.code ?? cause?.message;
      let code = 'COD_RETURN_UNAVAILABLE';
      let status = 503;
      if (['UNAUTHORIZED','NotAuthorizedException','UserNotFoundException'].includes(candidate) ||
          ['NotAuthorizedException','UserNotFoundException'].includes(cause?.name)) {
        code='UNAUTHORIZED'; status=401;
      } else if (['FORBIDDEN','PERMISSION_REQUIRED','EXCEPTION_PERMISSION_REQUIRED','EXCEPTION_EMPLOYEE_UNAVAILABLE',
          'FINANCE_ROLLOUT_OUT_OF_SCOPE','EXCEPTION_APPROVAL_LIMIT'].includes(candidate)) {
        code=candidate; status=403;
      } else if (['INVALID_CURSOR','ORDER_NUMBER_AMBIGUOUS','CUSTODIANS_INCOMPLETE','REASON_REQUIRED','VERSION_OR_STATE_CONFLICT','SETTINGS_NOT_INITIALIZED'].includes(candidate) ||
          typeof candidate==='string' && errorCode.test(candidate)) {
        code=candidate;
        status=cause.status ?? (candidate.startsWith('INVALID_')?400:409);
      } else {
        console.error('Production return unavailable',cause?.name);
      }
      return response(status,{success:false,code,error:code});
    }
  };
}

const config={region:'us-east-1',maxAttempts:2};
const db=DynamoDBDocumentClient.from(new DynamoDBClient(config),{marshallOptions:{removeUndefinedValues:true}});
exports.handler = createHandler({db,cognito:new CognitoIdentityProviderClient(config)});
exports.createHandler = createHandler;
