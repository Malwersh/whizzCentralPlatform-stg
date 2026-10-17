const {isFinancialOrder,LEGACY_ONLY}=require('../legacy-order-policy');
/**
 * Driver Unassignment Service
 * 
 * فك ارتباط السائق من الطلب وإعادة إرساله لموجة جديدة
 * مختلف عن Cancellation: الطلب يبقى نشط للزبون والمطعم
 */

import { docClient, TABLES, GetCommand, UpdateCommand } from './db';
import { WalletServiceClient } from './walletServiceClient';
import { WebSocketNotifier } from './websocketNotifier';
import { OrderTimelineManager } from './orderTimelineManager';
import {
  UnassignDriverRequest,
  UnassignDriverResponse,
  Order,
  OrderNotFoundError,
  UnauthorizedError,
  OrderServiceError,
} from './types';
import { getCurrentTimestamp } from './utils';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';

const lambdaClient = new LambdaClient({ region: process.env.AWS_REGION || 'us-east-1' });
const CREATE_DISPATCH_JOB_LAMBDA = process.env.CREATE_DISPATCH_JOB_LAMBDA || 'WaveSystem_CreateDispatchJob';

export class DriverUnassignmentService {
  private walletClient: WalletServiceClient;
  private websocketNotifier: WebSocketNotifier;

  constructor(walletClient: WalletServiceClient) {
    this.walletClient = walletClient;
    this.websocketNotifier = new WebSocketNotifier();
  }

  /**
   * فك ارتباط السائق من الطلب
   * 
   * الخطوات:
   * 1. التحقق من الطلب والسائق
   * 2. التحقق من أن السائق لم يستلم الطلب بعد
   * 3. Release Hold للسائق
   * 4. حفظ السائق في driverHistory
   * 5. تحديث الطلب إلى حالة "reassigning"
   * 6. إرسال WebSocket notifications
   * 7. إنشاء موجة جديدة (TODO: integration مع Wave System)
   */
  async unassignDriver(request: UnassignDriverRequest): Promise<UnassignDriverResponse> {
    const { orderId, driverId, reason, requestedBy } = request;

    console.log('🔄 Processing driver unassignment:');
    console.log(`   Order ID: ${orderId}`);
    console.log(`   Driver ID: ${driverId}`);
    console.log(`   Reason: ${reason}`);
    console.log(`   Requested By: ${requestedBy}`);

    // Step 1: Get order
    const order = await this.getOrder(orderId);
    if (isFinancialOrder(order)) throw new OrderServiceError('Financial order requires its return/cancellation workflow', 409, 'FINANCIAL_CANCELLATION_REQUIRED');

    // Step 2: Validate unassignment
    this.validateUnassignment(order, driverId, requestedBy);

    // Step 3: Check if driver can unassign at current status
    const eligibility = OrderTimelineManager.determineReassignmentEligibility(order.status);
    if (!eligibility.canUnassign) {
      throw new OrderServiceError(
        eligibility.reason || 'لا يمكن فك الارتباط في الحالة الحالية',
        400,
        'UNASSIGN_NOT_ALLOWED'
      );
    }

    let holdReleased = false;
    // Step 5: Update driverHistory
    const updatedDriverHistory = OrderTimelineManager.updateDriverHistoryOnUnassign(
      order.driverHistory,
      driverId,
      order.status, // آخر حالة وصل إليها السائق
      reason,
      holdReleased
    );

    // Step 6: Add timeline event
    const updatedTimeline = OrderTimelineManager.addEvent(
      order.orderTimeline,
      'driver_unassigned',
      driverId,
      'driver',
      'reassigning',
      { reason, holdReleased, previousStatus: order.status }
    );

    // Step 7: Add driver to excluded list (prevent reassignment to same driver)
    const updatedExcludedDrivers = OrderTimelineManager.addExcludedDriver(
      order.excludedDrivers,
      driverId,
      'unassigned',
      null  // Permanent exclusion
    );
    console.log(`🚫 Driver ${driverId} added to excluded list`);

    // Step 8: Update order to "reassigning" status
    const newStatus = 'reassigning';
    await this.updateOrderForReassignment(orderId, {
      status: newStatus,
      driverHistory: updatedDriverHistory,
      orderTimeline: updatedTimeline,
      excludedDrivers: updatedExcludedDrivers,
      holdStatus: holdReleased ? 'RELEASED' : order.holdStatus,
      walletFinancialStatus: order.holdId && !holdReleased ? 'PENDING_RELEASE' : (holdReleased?'RELEASED':'NONE'),
      walletPendingHoldId: order.holdId && !holdReleased ? order.holdId : '',
      originalStatus: order.status,
      originalDriverId: order.driverId,
    });
    // Step 4: Release Hold (if exists)
    if (order.holdId && order.holdStatus === 'ACTIVE') {
      console.log(`💰 Releasing Hold: ${order.holdId}`);
      try {
        await this.walletClient.releaseHold(order.holdId, `Driver unassigned: ${reason}`);
        holdReleased = true;
        console.log('✅ Hold released successfully');
      } catch (error: any) {
        console.error('❌ Failed to release Hold:', error.message);
        // Continue - notification will inform about hold issue
      }
    }



    console.log(`✅ Driver ${driverId} unassigned from order ${orderId}`);
    console.log(`   New Status: ${newStatus}`);
    console.log(`   Hold Released: ${holdReleased}`);
    console.log(`   🚫 Driver excluded from future reassignment`);

    // Step 9: Send WebSocket notifications
    try {
      const userId = order.userId || order.customerId || '';
      const businessId = order.storeId || order.businessId || '';

      await this.websocketNotifier.notifyDriverUnassignment(
        orderId,
        userId,
        businessId,
        driverId,
        reason
      );
      console.log('✅ WebSocket notifications sent successfully');
    } catch (wsError: any) {
      console.error('⚠️ Failed to send WebSocket notifications:', wsError.message);
    }

    // Step 10: ✅ استدعاء CreateDispatchJob Lambda مباشرة (أسرع من DynamoDB Stream)
    // DynamoDB Stream يظل موجوداً كـ backup في حال فشل الاستدعاء المباشر
    console.log('✅ Order status changed to "reassigning"');
    console.log('🚀 Invoking CreateDispatchJob Lambda directly for immediate response...');
    
    try {
      const excludedDriverIds = updatedExcludedDrivers.map(ed => ed.driverId);
      const invokeResult = await this.invokeCreateDispatchJob(orderId, excludedDriverIds, reason);
      console.log('✅ CreateDispatchJob invoked successfully:', invokeResult);
      console.log('   → New wave will be created immediately with excluded drivers');
    } catch (lambdaError: any) {
      console.error('⚠️ Failed to invoke CreateDispatchJob directly:', lambdaError.message);
      console.log('   → DynamoDB Stream will trigger CreateDispatchJob as backup');
      // لا نرمي خطأ - DynamoDB Stream ستتولى الأمر
    }

    return {
      success: true,
      orderId,
      oldDriverId: driverId,
      newStatus: 'reassigning',
      holdReleased,
      message: 'تم فك ارتباط السائق بنجاح. يتم البحث عن سائق بديل فوراً.',
    };
  }

  /**
   * استدعاء CreateDispatchJob Lambda مباشرة
   */
  private async invokeCreateDispatchJob(
    orderId: string,
    excludedDriverIds: string[],
    reason: string
  ): Promise<any> {
    console.log(`📞 Invoking ${CREATE_DISPATCH_JOB_LAMBDA} for order ${orderId}`);
    console.log(`   Excluded drivers: ${excludedDriverIds.join(', ')}`);

    const payload = {
      orderId,
      reason: `driver_unassigned: ${reason}`,
      excludedDrivers: excludedDriverIds,
    };

    const command = new InvokeCommand({
      FunctionName: CREATE_DISPATCH_JOB_LAMBDA,
      InvocationType: 'Event', // Asynchronous - لا ننتظر النتيجة
      Payload: Buffer.from(JSON.stringify(payload)),
    });

    const response = await lambdaClient.send(command);
    
    return {
      statusCode: response.StatusCode,
      requestId: response.$metadata.requestId,
    };
  }

  /**
   * Get order from WizzOrders
   */
  private async getOrder(orderId: string): Promise<Order> {
    console.log(`📋 Fetching order: ${orderId}`);

    const result = await docClient.send(
      new GetCommand({
        TableName: TABLES.ORDERS,
        Key: {
          PK: `ORDER#${orderId}`,
          SK: 'META',
        },
      })
    );

    if (!result.Item) {
      throw new OrderNotFoundError(orderId);
    }

    return result.Item as Order;
  }

  /**
   * Validate unassignment request
   */
  private validateUnassignment(
    order: Order,
    driverId: string,
    requestedBy: string
  ): void {
    console.log('🔍 Validating unassignment...');
    console.log(`   Order Status: ${order.status}`);
    console.log(`   Order Driver: ${order.driverId}`);

    // Check if order is already in a final state
    const finalStatuses = [
      'delivered',
      'canceled_by_user',
      'canceled_by_store',
      'canceled_by_driver',
      'canceled_by_system',
      'rejected',
    ];

    if (finalStatuses.includes(order.status)) {
      throw new OrderServiceError(
        `لا يمكن فك ارتباط السائق من طلب في حالة ${order.status}`,
        400,
        'INVALID_STATUS'
      );
    }

    // Check if order is assigned to this driver
    if (order.driverId !== driverId) {
      throw new UnauthorizedError('الطلب غير مخصص لهذا السائق');
    }

    // Verify requestedBy matches driverId (security check)
    if (requestedBy !== driverId) {
      throw new UnauthorizedError('غير مصرح لك بفك ارتباط هذا الطلب');
    }

    console.log('✅ Unassignment validation passed');
  }

  /**
   * Update order for reassignment
   */
  private async updateOrderForReassignment(
    orderId: string,
    updates: {
      status: string;
      excludedDrivers: any[];
      driverHistory: any[];
      orderTimeline: any[];
      holdStatus?: string;
      walletFinancialStatus: string;
      walletPendingHoldId: string;
      originalStatus: string;
      originalDriverId?: string;
    }
  ): Promise<void> {
    console.log(`💾 Updating order ${orderId} for reassignment...`);

    let updateExpression =
      'SET #status = :status, driverHistory = :driverHistory, orderTimeline = :orderTimeline, excludedDrivers = :excludedDrivers, pricingFrozen = :pricingFrozen, updatedAt = :updatedAt';

    const expressionAttributeNames: Record<string, string> = {
      '#status': 'status',
    };

    const expressionAttributeValues: Record<string, any> = {
      ':status': updates.status,
      ':originalStatus': updates.originalStatus,
      ':driverHistory': updates.driverHistory,
      ':orderTimeline': updates.orderTimeline,
      ':excludedDrivers': updates.excludedDrivers,
      ':pricingFrozen': false,  // ✅ إلغاء تجميد الأسعار لإعادة التعيين
      ':updatedAt': getCurrentTimestamp(),
    };

    updateExpression += ', walletFinancialStatus = :financial, walletPendingHoldId = :pendingHold';
    expressionAttributeValues[':financial'] = updates.walletFinancialStatus;
    expressionAttributeValues[':pendingHold'] = updates.walletPendingHoldId;

    if(updates.originalDriverId)expressionAttributeValues[':originalDriverId']=updates.originalDriverId;
    if (updates.holdStatus) {
      updateExpression += ', #holdStatus = :holdStatus';
      expressionAttributeNames['#holdStatus'] = 'holdStatus';
      expressionAttributeValues[':holdStatus'] = updates.holdStatus;
    }

    // ✅ حذف جميع الحقول المتعلقة بالـ Hold والسائق والـ DispatchJob القديم
    updateExpression += ' REMOVE driverId, holdId, holdAmount, deliveryJobId';

    await docClient.send(
      new UpdateCommand({
        TableName: TABLES.ORDERS,
        Key: {
          PK: `ORDER#${orderId}`,
          SK: 'META',
        },
        UpdateExpression: updateExpression,
        ExpressionAttributeNames: expressionAttributeNames,
        ExpressionAttributeValues: expressionAttributeValues,
        ConditionExpression: LEGACY_ONLY+' AND attribute_exists(PK) AND #status = :originalStatus AND '+(updates.originalDriverId?'driverId = :originalDriverId':'attribute_not_exists(driverId)'),
      })
    );

    console.log('✅ Order updated for reassignment');
    console.log('   - Removed: driverId, holdId, holdAmount');
    console.log('   - Updated: holdStatus = RELEASED, pricingFrozen = false');
  }
}
