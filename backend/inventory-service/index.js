'use strict';
const {DynamoDBClient}=require('@aws-sdk/client-dynamodb');
const {DynamoDBDocumentClient}=require('@aws-sdk/lib-dynamodb');
const {unmarshall}=require('@aws-sdk/util-dynamodb');
const {reconcileOrderInventory,inventoryTerminalStatus}=require('../wallet-service/dist/productInventory');
const db=DynamoDBDocumentClient.from(new DynamoDBClient({}));
exports.handler=async event=>{
 const batchItemFailures=[];
 for(const record of event.Records||[]){
  if(!['INSERT','MODIFY'].includes(record.eventName)||!record.dynamodb?.NewImage)continue;
  const order=unmarshall(record.dynamodb.NewImage);
  if(order.SK!=='META'||!order.inventoryReservation||order.inventoryReservation.schemaVersion!==1||order.inventoryReservation.branchId!==order.storeId||order.inventoryReservation.orderId!==order.orderId)continue;
  if(!inventoryTerminalStatus(order.status))continue;
  try{await reconcileOrderInventory(db,order.storeId,order.orderId);}
  catch(error){console.error('INVENTORY_RECONCILIATION_RETRY',{orderId:order.orderId,code:error.code||error.name});batchItemFailures.push({itemIdentifier:record.dynamodb.SequenceNumber});}
 }
 return {batchItemFailures};
};
