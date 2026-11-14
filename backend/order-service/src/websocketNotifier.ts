/**
 * WebSocket Notifier - Send real-time order updates
 */

import {
  ApiGatewayManagementApiClient,
  PostToConnectionCommand,
} from '@aws-sdk/client-apigatewaymanagementapi';
import { DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { docClient, QueryCommand } from './db';

const WEBSOCKET_CONNECTIONS_TABLE = process.env.WEBSOCKET_CONNECTIONS_TABLE || 'WizzUser_websocket_connections_staging';
const WEBSOCKET_ENDPOINT = process.env.WEBSOCKET_ENDPOINT || 'https://igcrhwc84c.execute-api.us-east-1.amazonaws.com/staging';

interface WebSocketConnection {
  connectionId: string;
  userId?: string;
  orderId?: string;
}

export class WebSocketNotifier {
  private apiGwClient: ApiGatewayManagementApiClient;

  constructor() {
    this.apiGwClient = new ApiGatewayManagementApiClient({
      endpoint: WEBSOCKET_ENDPOINT,
      region: 'us-east-1',
    });
  }

  /**
   * Send order cancellation notification to relevant connections
   */
  async notifyOrderCancellation(
    orderId: string,
    userId: string,
    businessId: string,
    newStatus: string,
    reason: string
  ): Promise<void> {
    console.log(`📡 Sending WebSocket notifications for order ${orderId}`);

    try {
      // Find all connections subscribed to this order
      const connections = await this.findRelevantConnections(orderId, userId, businessId);

      if (connections.length === 0) {
        console.log('ℹ️ No active WebSocket connections found for this order');
        return;
      }

      console.log(`📡 Found ${connections.length} active connections`);

      // Prepare the notification message in the format expected by Flutter app
      const message = {
        type: 'order_status_update',
        orderId: orderId,
        status: newStatus,
        cancelReason: reason,
        message: 'تم إلغاء الطلب',
        timestamp: new Date().toISOString(),
      };

      // Send to all connections
      const sendPromises = connections.map((conn) =>
        this.sendToConnection(conn.connectionId, message)
      );

      await Promise.allSettled(sendPromises);
      console.log('✅ WebSocket notifications sent successfully');
    } catch (error: any) {
      console.error('❌ Error sending WebSocket notifications:', error.message);
      // Don't throw - notification failure shouldn't fail the cancellation
    }
  }

  /**
   * Send driver unassignment notification to relevant connections
   */
  async notifyDriverUnassignment(
    orderId: string,
    userId: string,
    businessId: string,
    driverId: string,
    reason: string
  ): Promise<void> {
    console.log(`📡 Sending driver unassignment notifications for order ${orderId}`);

    try {
      const connections = await this.findRelevantConnections(orderId, userId, businessId);

      if (connections.length === 0) {
        console.log('ℹ️ No active WebSocket connections found');
        return;
      }

      console.log(`📡 Found ${connections.length} active connections`);

      // رسالة للزبون
      const customerMessage = {
        type: 'order_status_update',
        orderId,
        status: 'reassigning',
        message: 'يتم البحث عن سائق آخر...',
        messageAr: 'يتم البحث عن سائق آخر لتوصيل طلبك',
        timestamp: new Date().toISOString(),
      };

      // رسالة للمطعم
      const merchantMessage = {
        type: 'order_status_update',
        orderId,
        status: 'reassigning',
        message: 'يتم البحث عن سائق بديل',
        messageAr: 'تم فك ارتباط السائق، يتم البحث عن سائق بديل',
        reason,
        timestamp: new Date().toISOString(),
      };

      // رسالة للسائق (تم فك ارتباطه)
      const driverMessage = {
        type: 'order_unassigned',
        orderId,
        message: 'تم فك ارتباطك من الطلب',
        messageAr: 'تم فك ارتباطك من هذا الطلب بنجاح',
        reason,
        timestamp: new Date().toISOString(),
      };

      // إرسال الرسائل المناسبة لكل طرف
      const sendPromises = connections.map((conn) => {
        let message;
        
        // تحديد الرسالة المناسبة بناءً على نوع الاتصال
        if (conn.userId === driverId) {
          message = driverMessage;
        } else if (conn.userId === userId) {
          message = customerMessage;
        } else {
          message = merchantMessage;
        }
        
        return this.sendToConnection(conn.connectionId, message);
      });

      await Promise.allSettled(sendPromises);
      console.log('✅ Driver unassignment notifications sent successfully');
    } catch (error: any) {
      console.error('❌ Error sending unassignment notifications:', error.message);
    }
  }

  /**
   * Find WebSocket connections for this order
   */
  private async findRelevantConnections(
    orderId: string,
    userId: string,
    businessId: string
  ): Promise<WebSocketConnection[]> {
    const connections: WebSocketConnection[] = [];

    try {
      // 1. Find connections subscribed to this specific order
      const orderConnections = await this.findConnectionsByOrder(orderId);
      connections.push(...orderConnections);

      // 2. Find connections for the user (customer)
      const userConnections = await this.findConnectionsByUser(userId);
      connections.push(...userConnections);

      // 3. Find connections for the business (merchant) - using BUSINESS# prefix
      const businessConnections = await this.findConnectionsByBusiness(businessId);
      connections.push(...businessConnections);

      // Deduplicate by connectionId
      const uniqueConnections = Array.from(
        new Map(connections.map((c) => [c.connectionId, c])).values()
      );

      console.log(`📊 Connection breakdown:`);
      console.log(`   - Order subscriptions: ${orderConnections.length}`);
      console.log(`   - User connections: ${userConnections.length}`);
      console.log(`   - Business connections: ${businessConnections.length}`);
      console.log(`   - Total unique: ${uniqueConnections.length}`);

      return uniqueConnections;
    } catch (error: any) {
      console.error('❌ Error finding connections:', error.message);
      return [];
    }
  }

  /**
   * Find connections subscribed to a specific order
   */
  private async findConnectionsByOrder(orderId: string): Promise<WebSocketConnection[]> {
    try {
      const result = await docClient.send(
        new QueryCommand({
          TableName: WEBSOCKET_CONNECTIONS_TABLE,
          IndexName: 'GSI1',
          KeyConditionExpression: 'GSI1PK = :orderPK',
          FilterExpression: 'isActive = :active',
          ExpressionAttributeValues: {
            ':orderPK': `ORDER#${orderId}`,
            ':active': true,
          },
        })
      );

      return (
        result.Items?.map((item) => ({
          connectionId: item.connectionId,
          userId: item.userId,
          orderId: item.orderId,
        })) || []
      );
    } catch (error: any) {
      console.error(`Error finding order connections: ${error.message}`);
      return [];
    }
  }

  /**
   * Find active connections for a user
   */
  private async findConnectionsByUser(userId: string): Promise<WebSocketConnection[]> {
    try {
      const result = await docClient.send(
        new QueryCommand({
          TableName: WEBSOCKET_CONNECTIONS_TABLE,
          IndexName: 'GSI1',
          KeyConditionExpression: 'GSI1PK = :userPK',
          FilterExpression: 'isActive = :active',
          ExpressionAttributeValues: {
            ':userPK': `USER#${userId}`,
            ':active': true,
          },
        })
      );

      return (
        result.Items?.map((item) => ({
          connectionId: item.connectionId,
          userId: item.userId,
        })) || []
      );
    } catch (error: any) {
      console.error(`Error finding user connections: ${error.message}`);
      return [];
    }
  }

  /**
   * Find active connections for a business (merchant)
   */
  private async findConnectionsByBusiness(businessId: string): Promise<WebSocketConnection[]> {
    try {
      const result = await docClient.send(
        new QueryCommand({
          TableName: WEBSOCKET_CONNECTIONS_TABLE,
          IndexName: 'GSI1',
          KeyConditionExpression: 'GSI1PK = :businessPK',
          FilterExpression: 'isActive = :active',
          ExpressionAttributeValues: {
            ':businessPK': `BUSINESS#${businessId}`,
            ':active': true,
          },
        })
      );

      console.log(`🏪 Found ${result.Items?.length || 0} business connections for ${businessId}`);

      return (
        result.Items?.map((item) => ({
          connectionId: item.connectionId,
          userId: item.userId,
        })) || []
      );
    } catch (error: any) {
      console.error(`Error finding business connections: ${error.message}`);
      return [];
    }
  }

  /**
   * Send message to a specific connection
   */
  private async sendToConnection(connectionId: string, message: any): Promise<void> {
    try {
      await this.apiGwClient.send(
        new PostToConnectionCommand({
          ConnectionId: connectionId,
          Data: Buffer.from(JSON.stringify(message)),
        })
      );

      console.log(`✅ Message sent to connection: ${connectionId}`);
    } catch (error: any) {
      if (error.statusCode === 410 || error.name === 'GoneException') {
        // Connection is stale, remove it
        console.log(`🗑️ Removing stale connection: ${connectionId}`);
        await this.removeStaleConnection(connectionId);
      } else {
        console.error(`❌ Error sending to ${connectionId}:`, error.message);
      }
    }
  }

  /**
   * Remove stale connection from database
   */
  private async removeStaleConnection(connectionId: string): Promise<void> {
    try {
      // Mark connection as inactive instead of deleting
      await docClient.send(
        new DeleteCommand({
          TableName: WEBSOCKET_CONNECTIONS_TABLE,
          Key: {
            PK: `CONNECTION#${connectionId}`,
            SK: 'META',
          },
        })
      );

      console.log(`🗑️ Stale connection removed: ${connectionId}`);
    } catch (error: any) {
      console.error(`Error removing stale connection: ${error.message}`);
    }
  }
}
