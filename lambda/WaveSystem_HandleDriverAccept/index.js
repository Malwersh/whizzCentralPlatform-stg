const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const {
  DynamoDBDocumentClient,
  GetCommand,
  QueryCommand,
  UpdateCommand,
} = require('@aws-sdk/lib-dynamodb');
const { ApiGatewayManagementApiClient, PostToConnectionCommand } = require('@aws-sdk/client-apigatewaymanagementapi');

const dynamoDB = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});

function requireNonEmptyEnv(name) {
  const value = process.env[name];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value.trim();
}

function getStage() {
  return String(process.env.STAGE || '').trim().toLowerCase();
}

function getWebsocketManagementEndpoint() {
  const raw = (process.env.WEBSOCKET_MANAGEMENT_ENDPOINT || process.env.WEBSOCKET_API_ENDPOINT || '').trim();
  if (!raw) {
    throw new Error('Missing WebSocket endpoint: set WEBSOCKET_MANAGEMENT_ENDPOINT (https) or WEBSOCKET_API_ENDPOINT (wss/https)');
  }

  const endpoint = raw.startsWith('wss://') ? raw.replace('wss://', 'https://') : raw;
  const stage = getStage();

  if (endpoint.includes('/dev') && stage !== 'dev') {
    throw new Error(`رفض endpoint يحتوي على /dev في بيئة غير dev: ${endpoint}`);
  }

  return endpoint;
}

const DISPATCH_JOBS_TABLE = requireNonEmptyEnv('DISPATCH_JOBS_TABLE');
const WAVE_OFFERS_TABLE = requireNonEmptyEnv('WAVE_OFFERS_TABLE');
const DRIVER_LIVE_STATE_TABLE = requireNonEmptyEnv('DRIVER_LIVE_STATE_TABLE');
const ORDERS_TABLE = process.env.ORDERS_TABLE || 'WizzOrders';

/**
 * 🌊 Wave System - Handle Driver Accept
 * 
 * Lambda function لمعالجة قبول السائق لعرض Wave
 * 
 * المهام:
 * 1. التحقق من صلاحية العرض (pending, not expired)
 * 2. تحديث WizzDriverLiveState (status → busy)
 * 3. تحديث WizzOrders (status → assigned, add driverId)
 * 4. تحديث WizzDispatchJobs_dev (status → assigned)
 * 5. تحديث WaveOffers (الفائز → accepted, isWinner = true)
 * 6. إلغاء العروض الأخرى (order_assigned_to_other)
 * 7. إرسال إشعارات
 */

exports.handler = async (event) => {
  console.log('🌊 HandleDriverAccept Lambda triggered');
  console.log('📥 Event:', JSON.stringify(event, null, 2));
  
  try {
    // Parse request body
    const body = JSON.parse(event.body || '{}');
    const { offerId, driverId, orderId, holdId, holdStatus, holdAmount } = body;
    
    console.log('📋 Request parameters:');
    console.log(`   - offerId: ${offerId}`);
    console.log(`   - driverId: ${driverId}`);
    console.log(`   - orderId: ${orderId}`);
    console.log(`   - holdId: ${holdId || 'N/A'}`);
    console.log(`   - holdStatus: ${holdStatus || 'N/A'}`);
    console.log(`   - holdAmount: ${holdAmount || 'N/A'}`);
    
    // Validate required fields
    if (!offerId || !driverId) {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({
          success: false,
          message: 'Missing required fields: offerId, driverId'
        })
      };
    }
    
    // Extract orderId and waveNumber from offerId if not provided
    // Format: OFFER_{orderId}_{driverId}_W{waveNumber}
    let extractedOrderId = orderId;
    let waveNumber = 1;
    
    if (offerId.startsWith('OFFER_')) {
      const parts = offerId.split('_');
      if (parts.length >= 3) {
        extractedOrderId = extractedOrderId || parts[1];
        const wavepart = parts[parts.length - 1]; // W1, W2, etc
        if (wavepart.startsWith('W')) {
          waveNumber = parseInt(wavepart.substring(1));
        }
      }
    }
    
    if (!extractedOrderId) {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({
          success: false,
          message: 'Could not extract orderId from offerId'
        })
      };
    }
    
    console.log(`✅ Extracted orderId: ${extractedOrderId}, waveNumber: ${waveNumber}`);
    
    const now = new Date().toISOString();
    const timestamp = Date.now();
    
    // ============================================
    // Step 1: Get offer details first (to extract bonus info)
    // ============================================
    console.log('🔍 Step 1: Getting offer details...');
    
    // Build SK for WaveOffers
    // SK format: {driverId}#WAVE#{waveNumber}
    const offerSK = `${driverId}#WAVE#${waveNumber}`;
    
    let offerData = null;
    try {
      const offerResult = await dynamoDB.send(
        new GetCommand({
          TableName: WAVE_OFFERS_TABLE,
          Key: {
            orderId: extractedOrderId,
            SK: offerSK,
          },
        })
      );
      
      offerData = offerResult.Item;
      
      if (!offerData) {
        console.log('❌ Offer not found');
        return {
          statusCode: 404,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          },
          body: JSON.stringify({
            success: false,
            message: 'العرض غير موجود'
          })
        };
      }
      
      console.log('✅ Offer found:', {
        waveNumber: offerData.waveNumber,
        baseDeliveryFee: offerData.baseDeliveryFee,
        bonusAmount: offerData.bonusAmount,
        isEmergencyWave: offerData.isEmergencyWave
      });
    } catch (error) {
      console.error('❌ Error getting offer:', error);
      throw error;
    }
    
    // ============================================
    // Step 2: Verify and claim the offer (Race Condition Safe)
    // ============================================
    console.log('🔍 Step 2: Verifying and claiming offer...');
    
    try {
      await dynamoDB.send(
        new UpdateCommand({
          TableName: WAVE_OFFERS_TABLE,
          Key: {
            orderId: extractedOrderId,
            SK: offerSK,
          },
          UpdateExpression: `
          SET responseStatus = :accepted,
              isWinner = :true,
              responseAt = :now,
              updatedAt = :timestamp
        `,
          ConditionExpression: 'responseStatus = :pending AND expiresAt > :currentTime',
          ExpressionAttributeValues: {
            ':accepted': 'accepted',
            ':true': true,
            ':pending': 'pending',
            ':now': now,
            ':timestamp': timestamp,
            ':currentTime': now,
          },
        })
      );
      
      console.log('✅ Offer claimed successfully');
    } catch (error) {
      if (error.code === 'ConditionalCheckFailedException') {
        console.log('❌ Offer already taken or expired');
        return {
          statusCode: 409,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          },
          body: JSON.stringify({
            success: false,
            message: 'عذراً، تم قبول هذا الطلب من سائق آخر'
          })
        };
      }
      throw error;
    }
    
    // ============================================
    // Step 3: Update WizzDriverLiveState
    // ============================================
    console.log('🔍 Step 3: Updating WizzDriverLiveState...');
    
    try {
      await dynamoDB.send(
        new UpdateCommand({
          TableName: DRIVER_LIVE_STATE_TABLE,
          Key: { driverId },
          UpdateExpression: `
          SET #status = :status,
              isSearching = :isSearching,
              currentOrderId = :orderId,
              activeOrdersCount = if_not_exists(activeOrdersCount, :zero) + :one,
              lastUpdated = :now
        `,
          ExpressionAttributeNames: {
            '#status': 'status',
          },
          ExpressionAttributeValues: {
            ':status': 'busy',
            ':isSearching': false,
            ':orderId': extractedOrderId,
            ':zero': 0,
            ':one': 1,
            ':now': now,
          },
        })
      );
      
      console.log('✅ WizzDriverLiveState updated');
    } catch (error) {
      console.error('❌ Error updating WizzDriverLiveState:', error);
      throw error;
    }
    
    // ============================================
    // Step 4: Update WizzOrders (مع معلومات البونص)
    // ============================================
    console.log('🔍 Step 4: Updating WizzOrders with bonus info...');
    
    try {
      // حساب القيم من الـ offer
      const baseDeliveryFee = offerData.baseDeliveryFee || 0;
      const bonusAmount = offerData.bonusAmount || 0;
      const finalDeliveryFee = baseDeliveryFee + bonusAmount;
      const isEmergencyWave = offerData.isEmergencyWave || false;
      
      console.log('💰 Delivery fee breakdown:', {
        baseDeliveryFee: `${(baseDeliveryFee / 1000).toFixed(1)} IQD`,
        bonusAmount: `${(bonusAmount / 1000).toFixed(1)} IQD`,
        finalDeliveryFee: `${(finalDeliveryFee / 1000).toFixed(1)} IQD`,
        waveNumber: waveNumber,
        isEmergencyWave: isEmergencyWave
      });
      
      console.log('📊 Incrementing assignmentAttemptCounter (independent of wave number)');
      
      await dynamoDB.send(
        new UpdateCommand({
          TableName: ORDERS_TABLE,
          Key: {
            PK: `ORDER#${extractedOrderId}`,
            SK: 'META',
          },
          UpdateExpression: `
          SET orderStatus = :status,
              #status = :status,
              driverId = :driverId,
              assignedAt = :now,
              assignmentWaveNumber = :waveNumber,
              totalWavesSent = :waveNumber,
              updatedAt = :timestamp,
              updatedBy = :updatedBy,
              pricing.waveBonus = :bonusAmount,
              pricing.finalDeliveryFee = :finalDeliveryFee,
              pricing.isEmergencyWave = :isEmergencyWave,
              holdId = :holdId,
              holdStatus = :holdStatus,
              holdAmount = :holdAmount,
              pricingFrozen = :pricingFrozen
          ADD assignmentAttemptCounter :one
        `,
          ConditionExpression: 'orderStatus <> :assignedStatus',
          ExpressionAttributeNames: {
            '#status': 'status',
          },
          ExpressionAttributeValues: {
            ':status': 'assigned',
            ':assignedStatus': 'assigned',
            ':driverId': driverId,
            ':now': now,
            ':waveNumber': waveNumber,
            ':timestamp': timestamp,
            ':updatedBy': 'waveSystem',
            ':bonusAmount': bonusAmount,
            ':finalDeliveryFee': finalDeliveryFee,
            ':isEmergencyWave': isEmergencyWave,
            ':holdId': holdId || null,
            ':holdStatus': holdStatus || null,
            ':holdAmount': holdAmount || null,
            ':pricingFrozen': holdId ? true : false,
            ':one': 1,
          },
        })
      );
      
      console.log('✅ WizzOrders updated with bonus info');
    } catch (error) {
      console.error('❌ Error updating WizzOrders:', error);
      
      // Check if error is due to conditional check failure (race condition)
      if (error.code === 'ConditionalCheckFailedException') {
        console.error('⚠️ RACE CONDITION DETECTED: Order already assigned to another driver');
        console.error('   Order was likely accepted by another driver at the same time');
        
        // Return specific error for race condition
        return {
          statusCode: 409,
          body: JSON.stringify({
            success: false,
            message: 'تم قبول الطلب من سائق آخر',
            error: 'ORDER_ALREADY_ASSIGNED',
            details: 'هذا الطلب تم قبوله من سائق آخر في نفس اللحظة. يرجى البحث عن طلبات أخرى.'
          })
        };
      }
      
      throw error;
    }
    
    // ============================================
    // Step 5: Update WizzDispatchJobs_dev
    // ============================================
    console.log('🔍 Step 5: Updating WizzDispatchJobs_dev...');
    
    try {
      await dynamoDB.send(
        new UpdateCommand({
          TableName: DISPATCH_JOBS_TABLE,
          Key: {
            orderId: extractedOrderId,
            SK: 'METADATA',
          },
          UpdateExpression: `
          SET #status = :status,
              assignedDriverId = :driverId,
              assignedAt = :now,
              assignmentWaveNumber = :waveNumber,
              totalWavesSent = :waveNumber,
              updatedAt = :timestamp
        `,
          ExpressionAttributeNames: {
            '#status': 'status',
          },
          ExpressionAttributeValues: {
            ':status': 'assigned',
            ':driverId': driverId,
            ':now': now,
            ':waveNumber': waveNumber,
            ':timestamp': timestamp,
          },
        })
      );
      
      console.log('✅ WizzDispatchJobs_dev updated');
    } catch (error) {
      console.error('❌ Error updating WizzDispatchJobs_dev:', error);
      throw error;
    }
    
    // ============================================
    // Step 6: Cancel other pending offers + Notify drivers via WebSocket
    // ============================================
    console.log('🔍 Step 6: Cancelling other pending offers and notifying drivers...');
    
    try {
      // Query all offers for this order
      const otherOffers = await dynamoDB.send(
        new QueryCommand({
          TableName: WAVE_OFFERS_TABLE,
          KeyConditionExpression: 'orderId = :orderId',
          FilterExpression: 'responseStatus = :pending',
          ExpressionAttributeValues: {
            ':orderId': extractedOrderId,
            ':pending': 'pending',
          },
        })
      );
      
      console.log(`📋 Found ${otherOffers.Items.length} other pending offers to cancel`);
      
      // Initialize WebSocket client for PostToConnection
      // Note: Management API endpoint is different from WebSocket connection endpoint
      const websocketEndpoint = getWebsocketManagementEndpoint();
      console.log(`📡 Using WebSocket Management endpoint: ${websocketEndpoint}`);
      
      const apiGatewayClient = new ApiGatewayManagementApiClient({
        endpoint: websocketEndpoint,
        region: 'us-east-1'
      });
      
      // Cancel each pending offer + notify driver
      for (const offer of otherOffers.Items) {
        // Update offer status in DB
        await dynamoDB.send(
          new UpdateCommand({
            TableName: WAVE_OFFERS_TABLE,
            Key: {
              orderId: offer.orderId,
              SK: offer.SK,
            },
            UpdateExpression: `
            SET responseStatus = :canceled,
                responseAt = :now,
                updatedAt = :timestamp
          `,
            ExpressionAttributeValues: {
              ':canceled': 'order_assigned_to_other',
              ':now': now,
              ':timestamp': timestamp,
            },
          })
        );
        
        console.log(`✅ Cancelled offer for driver: ${offer.driverId}`);
        
        // Send WebSocket notification to remove offer from UI
        try {
          // Get active connectionId from WizzDriverLiveState
          const driverStateResult = await dynamoDB.send(
            new GetCommand({
              TableName: DRIVER_LIVE_STATE_TABLE,
              Key: {
                driverId: offer.driverId,
              },
            })
          );
          
          if (driverStateResult.Item && driverStateResult.Item.connectionId) {
            const connectionId = driverStateResult.Item.connectionId;
            const notificationMessage = {
              type: 'offer_taken',
              action: 'remove_offer',
              offerId: offer.offerId,
              orderId: extractedOrderId,
              message: 'تم قبول هذا الطلب من سائق آخر',
              timestamp: now
            };
            
            await apiGatewayClient.send(new PostToConnectionCommand({
              ConnectionId: connectionId,
              Data: JSON.stringify(notificationMessage)
            }));
            
            console.log(`📡 WebSocket notification sent to driver ${offer.driverId} (connection: ${connectionId})`);
          } else {
            console.log(`⚠️ No active connectionId found in WizzDriverLiveState for driver ${offer.driverId}`);
          }
        } catch (wsError) {
          console.error(`⚠️ Failed to send WebSocket notification to driver ${offer.driverId}:`, wsError);
          // Continue with next driver - notification failure is not critical
        }
      }
    } catch (error) {
      console.error('⚠️ Error cancelling other offers:', error);
      // Don't throw - this is not critical
    }
    
    // ============================================
    // Step 7: Get order details for response
    // ============================================
    console.log('🔍 Step 7: Fetching order details...');
    
    let orderDetails = null;
    try {
      const orderResult = await dynamoDB.send(
        new GetCommand({
          TableName: ORDERS_TABLE,
          Key: {
            PK: `ORDER#${extractedOrderId}`,
            SK: 'META',
          },
        })
      );
      
      orderDetails = orderResult.Item;
      console.log('✅ Order details fetched');
    } catch (error) {
      console.error('⚠️ Error fetching order details:', error);
      // Continue without details
    }
    
    // ============================================
    // Success Response
    // ============================================
    console.log('✅ Driver accept completed successfully');
    
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({
        success: true,
        message: 'تم قبول الطلب بنجاح',
        data: {
          orderId: extractedOrderId,
          driverId: driverId,
          assignedAt: now,
          orderNumber: orderDetails?.orderNumber,
          customerName: orderDetails?.customerName,
          storeName: orderDetails?.storeName,
          deliveryFee: orderDetails?.deliveryFee_legacy,
          total: orderDetails?.total,
          holdId: holdId || null,
          holdStatus: holdStatus || null,
          holdAmount: holdAmount || null
        }
      })
    };
    
  } catch (error) {
    console.error('❌ Error in HandleDriverAccept:', error);
    
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({
        success: false,
        message: 'حدث خطأ في معالجة قبول الطلب',
        error: error.message
      })
    };
  }
};
