/**
 * Order Cancellation Service - Core business logic
 */

import { docClient, TABLES, GetCommand, UpdateCommand } from './db';
import { WalletServiceClient } from './walletServiceClient';
import { WebSocketNotifier } from './websocketNotifier';
import { OrderTimelineManager } from './orderTimelineManager';
import {
  CancelOrderRequest,
  CancelOrderResponse,
  Order,
  OrderNotFoundError,
  UnauthorizedError,
  InvalidStatusError,
} from './types';
import { getCurrentTimestamp } from './utils';

export class OrderCancellationService {
  private walletClient: WalletServiceClient;
  private websocketNotifier: WebSocketNotifier;

  constructor(walletClient: WalletServiceClient) {
    this.walletClient = walletClient;
    this.websocketNotifier = new WebSocketNotifier();
  }

  /**
   * Cancel an order with Hold release
   * This is the main entry point for all cancellation requests
   */
  async cancelOrder(request: CancelOrderRequest): Promise<CancelOrderResponse> {
    const { orderId, canceledBy, reason, requestedBy } = request;

    console.log('🔄 Processing order cancellation:');
    console.log(`   Order ID: ${orderId}`);
    console.log(`   Canceled By: ${canceledBy}`);
    console.log(`   Reason: ${reason}`);
    console.log(`   Requested By: ${requestedBy}`);

    // Step 1: Get order from WizzOrders
    const order = await this.getOrder(orderId);

    // Step 2: Validate cancellation rules
    this.validateCancellation(order, canceledBy, requestedBy);

    let holdReleased = false;
    // Step 4: Update WizzOrders with Timeline event
    const newStatus = `canceled_by_${canceledBy}`;
    
    // إنشاء حدث Timeline للإلغاء
    const actorType = this.getActorType(canceledBy);
    const updatedTimeline = OrderTimelineManager.addEvent(
      order.orderTimeline,
      'order_cancelled',
      requestedBy,
      actorType,
      newStatus,
      { reason, holdReleased }
    );

    await this.updateOrderStatus(orderId, {
      status: newStatus,
      canceledAt: getCurrentTimestamp(),
      canceledBy,
      cancelReason: reason,
      holdStatus: holdReleased ? 'RELEASED' : order.holdStatus,
      walletFinancialStatus: order.holdId && !holdReleased ? 'PENDING_RELEASE' : (holdReleased?'RELEASED':'NONE'),
      walletPendingHoldId: order.holdId && !holdReleased ? order.holdId : '',
      originalStatus: order.status,
      originalDriverId: order.driverId,
      orderTimeline: updatedTimeline,
    });
    // Step 3: Release Hold (if exists and ACTIVE)
    if (order.holdId && order.holdStatus === 'ACTIVE') {
      console.log(`💰 Order has active Hold: ${order.holdId}`);
      try {
        await this.walletClient.releaseHold(order.holdId, reason);
        holdReleased = true;
        console.log('✅ Hold released successfully');
      } catch (error: any) {
        console.error('❌ Failed to release Hold:', error.message);
        // Continue with cancellation even if Hold release fails
        // (Hold might be already released or expired)
      }
    } else {
      console.log('ℹ️ No active Hold to release');
    }



    console.log(`✅ Order ${orderId} cancelled successfully`);
    console.log(`   New Status: ${newStatus}`);
    console.log(`   Hold Released: ${holdReleased}`);

    // Step 5: Send WebSocket notification to all stakeholders
    try {
      const userId = order.userId || order.customerId || '';
      const businessId = order.storeId || order.businessId || '';
      
      await this.websocketNotifier.notifyOrderCancellation(
        orderId,
        userId,
        businessId,
        newStatus,
        reason
      );
      console.log('✅ WebSocket notifications sent successfully');
    } catch (wsError: any) {
      console.error('⚠️ Failed to send WebSocket notifications:', wsError.message);
      // Continue - notification failure shouldn't break cancellation
    }

    return {
      success: true,
      orderId,
      newStatus,
      holdReleased,
      message: `Order cancelled successfully by ${canceledBy}`,
    };
  }

  /**
   * Get order from WizzOrders table
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
   * Validate cancellation rules
   */
  private validateCancellation(
    order: Order,
    canceledBy: string,
    requestedBy: string
  ): void {
    console.log('🔍 Validating cancellation...');
    console.log(`   Order Status: ${order.status}`);
    console.log(`   Canceled By: ${canceledBy}`);

    // Define allowed statuses for each canceller
    const allowedStatuses: Record<string, string[]> = {
      driver: ['accepted', 'heading_to_store', 'arrived_at_store'],
      customer: ['pending', 'confirmed'],
      restaurant: ['pending', 'confirmed', 'preparing', 'in_kitchen', 'ready'],
      system: [], // System can cancel any status (handled separately)
    };

    // Statuses that prevent cancellation
    const blockedStatuses = [
      'picked_up',
      'heading_to_customer',
      'arrived_at_customer',
      'delivered',
      'canceled_by_user',
      'canceled_by_store',
      'canceled_by_driver',
      'canceled_by_system',
      'rejected',
    ];

    // Check if already cancelled or delivered
    if (blockedStatuses.includes(order.status)) {
      throw new InvalidStatusError(order.status, canceledBy);
    }

    // System can cancel any non-final status
    if (canceledBy === 'system') {
      console.log('✅ System cancellation - allowed');
      return;
    }

    // Check if status is allowed for this canceller
    const allowed = allowedStatuses[canceledBy] || [];
    if (!allowed.includes(order.status)) {
      throw new InvalidStatusError(order.status, canceledBy);
    }

    // Additional authorization checks
    if (canceledBy === 'driver' && order.driverId !== requestedBy) {
      throw new UnauthorizedError('Order not assigned to this driver');
    }

    if (canceledBy === 'customer') {
      const customerId = order.customerId || order.userId || (order as any).guestToken;
      if (customerId !== requestedBy) {
        throw new UnauthorizedError('Order does not belong to this customer');
      }
    }

    if (canceledBy === 'restaurant') {
      const storeId = order.storeId || order.businessId;
      if (storeId !== requestedBy) {
        throw new UnauthorizedError('Order does not belong to this restaurant');
      }
    }

    console.log('✅ Cancellation validation passed');
  }

  /**
   * Update order status in WizzOrders
   */
  private async updateOrderStatus(
    orderId: string,
    updates: {
      status: string;
      canceledAt: string;
      canceledBy: string;
      cancelReason: string;
      holdStatus?: string;
      walletFinancialStatus: string;
      walletPendingHoldId: string;
      originalStatus: string;
      originalDriverId?: string;
      orderTimeline?: any[];
    }
  ): Promise<void> {
    console.log(`💾 Updating order ${orderId} in database...`);

    let updateExpression = 'SET #status = :status, canceledAt = :canceledAt, canceledBy = :canceledBy, cancelReason = :cancelReason, updatedAt = :updatedAt';
    const expressionAttributeValues: Record<string, any> = {
      ':status': updates.status,
      ':originalStatus': updates.originalStatus,
      ':canceledAt': updates.canceledAt,
      ':canceledBy': updates.canceledBy,
      ':cancelReason': updates.cancelReason,
      ':updatedAt': getCurrentTimestamp(),
    };

    updateExpression += ', walletFinancialStatus = :financial, walletPendingHoldId = :pendingHold';
    expressionAttributeValues[':financial'] = updates.walletFinancialStatus;
    expressionAttributeValues[':pendingHold'] = updates.walletPendingHoldId;

    if(updates.originalDriverId)expressionAttributeValues[':originalDriverId']=updates.originalDriverId;
    if (updates.holdStatus) {
      updateExpression += ', holdStatus = :holdStatus';
      expressionAttributeValues[':holdStatus'] = updates.holdStatus;
    }

    if (updates.orderTimeline) {
      updateExpression += ', orderTimeline = :orderTimeline';
      expressionAttributeValues[':orderTimeline'] = updates.orderTimeline;
    }

    await docClient.send(
      new UpdateCommand({
        TableName: TABLES.ORDERS,
        Key: {
          PK: `ORDER#${orderId}`,
          SK: 'META',
        },
        UpdateExpression: updateExpression,
        ExpressionAttributeNames: {
          '#status': 'status',
        },
        ExpressionAttributeValues: expressionAttributeValues,
        // ConditionExpression to prevent race conditions
        ConditionExpression: 'attribute_exists(PK) AND #status = :originalStatus AND '+(updates.originalDriverId?'driverId = :originalDriverId':'attribute_not_exists(driverId)'),
      })
    );

    console.log('✅ Order updated successfully');
  }

  /**
   * Helper: تحديد نوع المستخدم من canceledBy
   */
  private getActorType(canceledBy: string): 'customer' | 'driver' | 'restaurant' | 'system' {
    if (canceledBy === 'customer') return 'customer';
    if (canceledBy === 'driver') return 'driver';
    if (canceledBy === 'restaurant') return 'restaurant';
    return 'system';
  }
}
