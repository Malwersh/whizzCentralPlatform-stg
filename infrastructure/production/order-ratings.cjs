'use strict';

const {DynamoDBClient}=require('@aws-sdk/client-dynamodb');
const {DynamoDBDocumentClient}=require('@aws-sdk/lib-dynamodb');
const {CognitoJwtVerifier}=require('aws-jwt-verify');
const {createHandler}=require('../../backend/src/handlers/order-ratings');
const {identities:{customer}}=require('./wallet-identity-bindings.json');

const route='/orders/{orderId}/rating';
const env={
  ORDERS_TABLE:'wizz-production-Orders',
  CUSTOMERS_TABLE:'wizz-production-Customers',
  MERCHANTS_TABLE:'wizz-production-Merchants',
  DRIVERS_TABLE:'wizz-production-Drivers',
  RATINGS_TABLE:'wizz-production-OrderRatings',
};
const response=(statusCode,code)=>({statusCode,headers:{'Content-Type':'application/json','Cache-Control':'no-store'},
  body:JSON.stringify({success:false,code})});

function createProductionHandler({db,verify,apiId,now}) {
  const ratings=createHandler({db,verify,env,now,lifecycleTable:'wizz-production-AccountDeletion'});
  return async event=>{
    if(event?.requestContext?.apiId!==apiId||event?.requestContext?.stage!=='production'||event?.resource!==route)
      return response(404,'NOT_FOUND');
    const headers=Object.entries(event.headers??{}).filter(([name])=>name.toLowerCase()==='authorization');
    if(headers.length!==1||typeof headers[0][1]!=='string'||headers[0][1].length>8200||
      !/^Bearer \S+$/i.test(headers[0][1]))return response(401,'UNAUTHORIZED');
    return ratings(event);
  };
}

const db=DynamoDBDocumentClient.from(new DynamoDBClient({region:'us-east-1',maxAttempts:2}),{
  marshallOptions:{removeUndefinedValues:true},
});
const jwt=CognitoJwtVerifier.create({userPoolId:customer.poolId,clientId:customer.clientId,tokenUse:'access'});
const apiId=process.env.ORDER_RATINGS_API_ID;
const production=createProductionHandler({db,apiId,verify:token=>jwt.verify(token)});
module.exports={createProductionHandler,handler(event) {
  if(process.env.STAGE!=='production'||process.env.AWS_REGION!=='us-east-1'||!(/^[a-z0-9]{10}$/.test(apiId??'')))
    return response(503,'RATINGS_UNAVAILABLE');
  return production(event);
}};
