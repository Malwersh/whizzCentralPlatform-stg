#!/usr/bin/env node
/**
 * Update Order Status Script
 * Changes order status to 'ready_for_pickup' to trigger automatic driver assignment
 */

const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, UpdateCommand, GetCommand } = require("@aws-sdk/lib-dynamodb");

// Initialize DynamoDB client
const dynamoDBClient = new DynamoDBClient({ region: "us-east-1" });
const dynamoDB = DynamoDBDocumentClient.from(dynamoDBClient);

const ORDERS_TABLE = 'WizzOrders';
const ORDER_ID = 'be791742-9e81-4e30-ab16-3dea5a5fb2c0';

/**
 * Update order status to ready_for_pickup
 */
async function updateOrderStatus() {
    try {
        console.log('🔄 Updating order status...');
        console.log(`📦 Order ID: ${ORDER_ID}`);

        // First, get current order details
        const currentOrder = await dynamoDB.send(new GetCommand({
            TableName: ORDERS_TABLE,
            Key: {
                PK: `ORDER#${ORDER_ID}`,
                SK: 'META'
            }
        }));

        if (!currentOrder.Item) {
            console.error('❌ Order not found');
            return;
        }

        console.log(`📋 Current status: ${currentOrder.Item.status}`);

        // Update status to ready_for_pickup
        const result = await dynamoDB.send(new UpdateCommand({
            TableName: ORDERS_TABLE,
            Key: {
                PK: `ORDER#${ORDER_ID}`,
                SK: 'META'
            },
            UpdateExpression: `
                SET #status = :status, 
                    updatedAt = :updatedAt,
                    readyAt = :readyAt
            `,
            ExpressionAttributeNames: {
                '#status': 'status'
            },
            ExpressionAttributeValues: {
                ':status': 'ready_for_pickup',
                ':updatedAt': new Date().toISOString(),
                ':readyAt': new Date().toISOString()
            },
            ReturnValues: 'ALL_NEW'
        }));

        console.log('✅ Order status updated successfully!');
        console.log(`📋 New status: ${result.Attributes.status}`);
        console.log(`🕐 Ready at: ${result.Attributes.readyAt}`);

        console.log('\n🎯 This should trigger automatic driver assignment if:');
        console.log('  1. DynamoDB streams are enabled (✅ confirmed)');
        console.log('  2. Lambda function is deployed and configured');
        console.log('  3. Event source mapping is active');
        console.log('  4. Available drivers are online');

        return result.Attributes;

    } catch (error) {
        console.error('❌ Error updating order status:', error);
        return null;
    }
}

/**
 * Check if automatic assignment worked
 */
async function checkAssignmentStatus() {
    try {
        console.log('\n⏳ Waiting 10 seconds for automatic assignment...');
        await new Promise(resolve => setTimeout(resolve, 10000));

        const updatedOrder = await dynamoDB.send(new GetCommand({
            TableName: ORDERS_TABLE,
            Key: {
                PK: `ORDER#${ORDER_ID}`,
                SK: 'META'
            }
        }));

        if (updatedOrder.Item?.driverId) {
            console.log('🎉 SUCCESS! Automatic driver assignment worked!');
            console.log(`🚗 Assigned driver: ${updatedOrder.Item.driverId}`);
            console.log(`📅 Assigned at: ${updatedOrder.Item.assignedAt}`);
        } else {
            console.log('⚠️ No automatic assignment occurred');
            console.log('💡 You can run manual assignment with: node assign-driver-to-order.js');
        }

    } catch (error) {
        console.error('❌ Error checking assignment status:', error);
    }
}

/**
 * Main execution
 */
async function main() {
    console.log('🚀 Starting order status update for driver assignment...');
    
    const updatedOrder = await updateOrderStatus();
    if (updatedOrder) {
        await checkAssignmentStatus();
    }
}

// Run the script
main().catch(console.error);
