'use strict';
exports.handler=async event=>{
 if(process.env.ENVIRONMENT!=='production'||process.env.WALLET_CREATION_ENABLED!=='true')throw Error('ProductionWalletCreationDisabled');
 const {DynamoDBClient}=require('@aws-sdk/client-dynamodb');
 const {DynamoDBDocumentClient,GetCommand,TransactWriteCommand}=require('@aws-sdk/lib-dynamodb');
 const {createDriverWallet}=require('./driver-wallet-creation.cjs');
 return createDriverWallet({event,db:DynamoDBDocumentClient.from(new DynamoDBClient({})),GetCommand,TransactWriteCommand});
};
