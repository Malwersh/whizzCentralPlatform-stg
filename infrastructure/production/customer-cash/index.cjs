'use strict';

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb');
const { CognitoIdentityProviderClient } = require('@aws-sdk/client-cognito-identity-provider');
const { createExceptionCaseSlaWorker } = require('../../../backend/wallet-service/src/exceptionCaseSlaWorker');
const { createCustomerCashRuntime } = require('../../../backend/wallet-service/src/customerCashRuntime266');
const { createExceptionStaffAuthority } = require('../../../backend/wallet-service/src/exceptionStaffAuthority');
const { financialOrderTables } = require('../../../backend/wallet-service/src/walletBindings');
const { checkoutTables } = require('../../../backend/wallet-service/src/checkoutTables');
const { allowed } = require('../../../backend/staff-service/catalog');
const { route: staffCases, PATH } = require('../../../backend/staff-service/order-exception-cases');
const { quoteEntityIdValid } = require('../../../backend/wallet-service/src/deliveryQuoteRecord');

const driverPath='/driver/orders/{orderId}/cash-review';
const customerPath='/order/cash-review';
const staffPath='/staff/cash-reviews';
const caseKey='CUSTOMER_CASH_REVIEW';
const attributes={
  'Content-Type':'application/json; charset=utf-8',
  'Cache-Control':'no-store',
};
const customerCors={
  'Access-Control-Allow-Origin':'*',
  'Access-Control-Allow-Methods':'POST,OPTIONS',
  'Access-Control-Allow-Headers':'Authorization,Content-Type',
};
const driverActions=new Set(['READ_CUSTOMER_CASH_CASE','REPORT_CASH_PAYMENT','EXECUTE_CUSTOMER_REFUND']);
const customerActions=new Set(['READ_CUSTOMER_CASH_CASE','REPORT_CASH_PAYMENT','ACKNOWLEDGE_CUSTOMER_REFUND']);
const businessCode=/^(?:CASH_|REFUND_|PAYOUT_CASH_|INVALID_CASH_|INVALID_CUSTOMER_REFUND|EXCEPTION_|FULL_CASH_)[A-Z0-9_]+$/;
const reply=(statusCode,body,cors={})=>({statusCode,headers:{...attributes,...cors},body:body==null?'':JSON.stringify(body)});
const fail=(message,status)=>{throw Object.assign(Error(message),{status});};

function originalToken(event) {
  const values=Object.entries(event.headers??{}).filter(([name])=>name.toLowerCase()==='authorization');
  const multi=Object.entries(event.multiValueHeaders??{}).filter(([name])=>name.toLowerCase()==='authorization');
  const header=values[0]?.[1];
  if (values.length!==1 || multi.length>1 || typeof header!=='string' || header.length>16000 ||
      multi.length&&(!Array.isArray(multi[0][1])||multi[0][1].length!==1||multi[0][1][0]!==header)) return null;
  return /^Bearer ([\w-]+\.[\w-]+\.[\w-]+)$/i.exec(header)?.[1]??null;
}

function input(event) {
  const query=event.queryStringParameters??{};
  if (Object.values(event.multiValueQueryStringParameters??{}).some(values=>!Array.isArray(values)||values.length!==1)) fail('INVALID_CASH_REVIEW',400);
  if (event.httpMethod==='GET') return query;
  if (Object.keys(query).length || event.isBase64Encoded===true || typeof event.body!=='string' ||
      Buffer.byteLength(event.body)>32000) fail('INVALID_CASH_REVIEW',400);
  let body;
  try { body=JSON.parse(event.body); } catch { fail('INVALID_CASH_REVIEW',400); }
  if (!body || Array.isArray(body) || typeof body!=='object') fail('INVALID_CASH_REVIEW',400);
  return body;
}

function createHandler({db,cognito,now}) {
  return async event=>{
    if(event?.source==='aws.events') {
      const schedule='arn:aws:events:us-east-1:746727375268:rule/wizz-production-customer-cash-review-sla';
      if(process.env.ENVIRONMENT!=='production'||process.env.AWS_REGION!=='us-east-1'||
         event.account!=='746727375268'||event.region!=='us-east-1'||
         event['detail-type']!=='Scheduled Event'||!event.resources?.includes(schedule)) throw Error('INVALID_CASH_SLA_TRIGGER');
      return createExceptionCaseSlaWorker({db,now,cashOnly:true})();
    }
    const api=event?.requestContext?.apiId, resource=event?.resource, method=event?.httpMethod;
    const driver=api===process.env.CASH_DRIVER_API_ID&&resource===driverPath&&method==='POST';
    const customer=api===process.env.CASH_CUSTOMER_API_ID&&resource===customerPath&&['POST','OPTIONS'].includes(method);
    const staff=api===process.env.CASH_STAFF_API_ID&&
      (method==='GET'&&[staffPath,staffPath+'/detail'].includes(resource)||method==='POST'&&resource===staffPath+'/actions');
    if (process.env.ENVIRONMENT!=='production' || process.env.AWS_REGION!=='us-east-1' ||
        !api || event.requestContext?.stage!=='production' || ![driver,customer,staff].some(Boolean))
      return reply(404,{code:'NOT_FOUND'});
    const cors=customer?customerCors:{};
    if (method==='OPTIONS') return reply(204,null,cors);
    const accessToken=originalToken(event);
    if (!accessToken) return reply(401,{code:'UNAUTHORIZED'},cors);
    try {
      const body=input(event);
      const runtime=action=>createCustomerCashRuntime({db,cognito,accessToken,action,now});
      if (driver || customer) {
        if (!(driver?driverActions:customerActions).has(body.action)) fail('INVALID_CASH_REVIEW',400);
        const orderId=driver?event.pathParameters?.orderId:body.orderId;
        if (!quoteEntityIdValid(orderId) || driver&&Object.hasOwn(body,'orderId')) fail('INVALID_CASH_REVIEW',400);
        if (customer&&body.workflow!=='CUSTOMER_CASH_REVIEW') fail('INVALID_CASH_REVIEW',400);
        const {workflow,...data}=body;
        if (driver&&workflow!==undefined) fail('INVALID_CASH_REVIEW',400);
        return reply(200,await runtime(driver?'driver_cash_case':'customer_cash_case').execute({...data,orderId}),cors);
      }
      const authority=createExceptionStaffAuthority({db,cognito,accessToken,now});
      const actor=await authority.authenticate();
      const {employee}=await authority.readCash(actor);
      const tables={...financialOrderTables(),platform:checkoutTables().platform};
      return reply(200,await staffCases({
        db,tables,allowed,cashOnly:true,enrolled:true,recent:()=>{},query:body,
        executeCashAction:({caseKey:_,...operation})=>runtime('staff_cash_case').execute(operation),
      },employee,method,PATH+resource.slice(staffPath.length),body));
    } catch(error) {
      const code=error?.code??error?.message;
      if (['UNAUTHORIZED','NotAuthorizedException','UserNotFoundException'].includes(code)||
          ['NotAuthorizedException','UserNotFoundException'].includes(error?.name))
        return reply(401,{code:'UNAUTHORIZED'},cors);
      if (['PERMISSION_REQUIRED','EXCEPTION_PERMISSION_REQUIRED','EXCEPTION_EMPLOYEE_UNAVAILABLE','EXCEPTION_APPROVAL_LIMIT','CASH_REVIEW_FORBIDDEN','FINANCE_ROLLOUT_OUT_OF_SCOPE'].includes(code))
        return reply(403,{code},cors);
      if (typeof code==='string'&&(businessCode.test(code)||['INVALID_CURSOR','ORDER_NUMBER_AMBIGUOUS'].includes(code)))
        return reply(error?.status??(code.startsWith('INVALID_')?400:409),{code},cors);
      if (['TransactionCanceledException','ConditionalCheckFailedException'].includes(error?.name))
        return reply(409,{code:'CASH_REVIEW_CONFLICT'},cors);
      console.error('Production cash review unavailable',error?.name);
      return reply(503,{code:'CASH_REVIEW_UNAVAILABLE'},cors);
    }
  };
}
const config={region:'us-east-1',maxAttempts:2};
const db=DynamoDBDocumentClient.from(new DynamoDBClient(config),{marshallOptions:{removeUndefinedValues:true}});
exports.handler=createHandler({db,cognito:new CognitoIdentityProviderClient(config)});
exports.createHandler=createHandler;
