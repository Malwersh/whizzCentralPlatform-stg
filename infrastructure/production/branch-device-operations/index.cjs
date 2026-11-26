'use strict';

const {DynamoDBClient} = require('@aws-sdk/client-dynamodb');
const {DynamoDBDocumentClient} = require('@aws-sdk/lib-dynamodb');
const {createDeviceAuthority} = require('../../../backend/wallet-service/src/productionBranchDeviceAuthority');
const {merchantRequestContext} = require('../../../../whizzMerchants-stg/backend/functions/shared/merchant-lifecycle');
const {authorizedHandler} = require('../../../../whizzMerchants-stg/backend/functions/products/product_management_handler');
const {createApi} = require('./api.cjs');

const db = DynamoDBDocumentClient.from(new DynamoDBClient({maxAttempts:2}), {marshallOptions:{removeUndefinedValues:true}});
exports.handler = createApi({db, authorize:createDeviceAuthority(db),
  catalogRead:(actor,event) => merchantRequestContext.run(actor,() => authorizedHandler(event))});
