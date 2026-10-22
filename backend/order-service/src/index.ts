import {authorizeOrder} from './orderAuth';
/**
 * Order Service - Main Lambda Handler
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { CognitoService } from './cognitoService';
import { WalletServiceClient } from './walletServiceClient';
import { OrderCancellationService } from './orderCancellationService';
import { DriverUnassignmentService } from './driverUnassignmentService';
import { OrderServiceError } from './types';
import { buildSuccessResponse, buildErrorResponse, parseBody, validateRequired } from './utils';

// Initialize services (reused across warm Lambda invocations)
const cognitoService = new CognitoService();
const walletClient = new WalletServiceClient(cognitoService);
const cancellationService = new OrderCancellationService(walletClient);
const unassignmentService = new DriverUnassignmentService(walletClient);

/**
 * Main Lambda Handler
 */
export async function handler(
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> {
  console.log('📨 Order Service Request:', {
    path: event.path,
    method: event.httpMethod,
    requestId: event.requestContext?.requestId || 'N/A',
  });

  try {
    const { path, httpMethod } = event;

    // Health check
    if (path === '/health' && httpMethod === 'GET') {
      return buildSuccessResponse({
        status: 'healthy',
        service: 'order-service',
        timestamp: new Date().toISOString(),
      });
    }

    // CORS preflight
    if (httpMethod === 'OPTIONS') {
      return buildSuccessResponse({ message: 'OK' }, 200);
    }

    // Existing POST resource multiplexes an explicit workflow before cancellation.
    // This branch never invokes cancellation, notifications or the legacy writer.
    if(httpMethod==='POST'&&path==='/order/cancel'){
      const input=parseBody(event.body);
      if(input.workflow==='CUSTOMER_CASH_REVIEW'){
        try{return buildSuccessResponse(await require('../customer-cash-case-client').invokeCustomerCashCase(event,input),200);}
        catch(e:any){return buildErrorResponse(e.status||503,e.status?e.message:'CASH_REVIEW_UNAVAILABLE','تعذر تأكيد مراجعة النقد؛ حدّث الحالة قبل إعادة المحاولة');}
      }
    }
    if(httpMethod==='POST'&&['/order/cancel','/order/unassign'].includes(path)){
      try{event={...event,body:JSON.stringify(await authorizeOrder(event,parseBody(event.body)))};}catch(e:any){return buildErrorResponse(e.status||500,e.status?e.message:'AUTHENTICATION_UNAVAILABLE','تعذر التحقق من صلاحية تنفيذ العملية');}
    }

    if(path==='/order/cancel'&&httpMethod==='POST'){
      const input=parseBody(event.body);
      const {docClient,GetCommand,TABLES}=require('./db');
      const {Item:order}=await docClient.send(new GetCommand({TableName:TABLES.ORDERS,Key:{PK:'ORDER#'+input.orderId,SK:'META'},ConsistentRead:true}));
      if(order?.exceptionPolicy){
        if(input.canceledBy!=='customer')return buildErrorResponse(409,'FINANCIAL_CANCELLATION_REQUIRED','استخدم مسار الإلغاء المالي المخصص');
        try{return buildSuccessResponse(await require('../financial-cancellation-client').invokeCustomerCancellation(event,input),200);}
        catch(e:any){return buildErrorResponse(e.status||503,e.message,'تعذر تأكيد الإلغاء؛ حدّث حالة الطلب قبل إعادة المحاولة');}
      }
    }

    // POST /order/cancel
    if (path === '/order/cancel' && httpMethod === 'POST') {
      return await handleCancelOrder(event);
    }

    // POST /order/unassign - Driver unassignment (order stays active)
    if (path === '/order/unassign' && httpMethod === 'POST') {
      return await handleUnassignDriver(event);
    }

    // Route not found
    return buildErrorResponse(404, 'NOT_FOUND', 'Route not found');
  } catch (error: any) {
    console.error('❌ Handler Error:', error);

    if (error instanceof OrderServiceError) {
      return buildErrorResponse(error.statusCode, error.code, error.message);
    }

    return buildErrorResponse(
      500,
      'INTERNAL_ERROR',
      error.message || 'An unexpected error occurred'
    );
  }
}

/**
 * Handle POST /order/cancel
 * 
 * Request Body:
 * {
 *   "orderId": "xxx",
 *   "canceledBy": "driver" | "customer" | "restaurant" | "system",
 *   "reason": "Customer changed mind",
 *   "requestedBy": "userId or driverId or storeId"
 * }
 */
async function handleCancelOrder(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const body = parseBody(event.body);

  // Validate required fields
  try {
    validateRequired(body, ['orderId', 'canceledBy', 'reason', 'requestedBy']);
  } catch (error: any) {
    return buildErrorResponse(400, 'INVALID_REQUEST', error.message);
  }

  // Validate canceledBy value
  const validCancelledBy = ['driver', 'customer', 'restaurant', 'system'];
  if (!validCancelledBy.includes(body.canceledBy)) {
    return buildErrorResponse(
      400,
      'INVALID_REQUEST',
      `canceledBy must be one of: ${validCancelledBy.join(', ')}`
    );
  }

  // Process cancellation
  const result = await cancellationService.cancelOrder({
    orderId: body.orderId,
    canceledBy: body.canceledBy,
    reason: body.reason,
    requestedBy: body.requestedBy,
  });

  return buildSuccessResponse(result, 200);
}

/**
 * Handle POST /order/unassign
 * 
 * Request Body:
 * {
 *   "orderId": "xxx",
 *   "driverId": "driver123",
 *   "reason": "عذراً، لا أستطيع إكمال التوصيل",
 *   "requestedBy": "driver123"
 * }
 */
async function handleUnassignDriver(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const body = parseBody(event.body);

  // Validate required fields
  try {
    validateRequired(body, ['orderId', 'driverId', 'reason', 'requestedBy']);
  } catch (error: any) {
    return buildErrorResponse(400, 'INVALID_REQUEST', error.message);
  }

  // Process unassignment
  const result = await unassignmentService.unassignDriver({
    orderId: body.orderId,
    driverId: body.driverId,
    reason: body.reason,
    requestedBy: body.requestedBy,
  });

  return buildSuccessResponse(result, 200);
}
