'use strict';

const {createHash} = require('node:crypto');
const {GetCommand} = require('@aws-sdk/lib-dynamodb');
const tables = Object.freeze({
  orders:'wizz-production-Orders', registry:'wizz-production-PushDeviceTokens',
  merchants:'wizz-production-Merchants', platform:'wizz-production-MerchantPlatform',
  deletion:'wizz-production-AccountDeletion', staff:'wizz-production-PlatformStaff',
  delivery:'wizz-production-WalletNotifications',
});
const read = async (db, TableName, Key) => (await db.send(new GetCommand({TableName,Key,ConsistentRead:true}))).Item;
const digest = value => createHash('sha256').update(value).digest('hex');
const bindingKey = (branch,device) => ({pk:'BRANCH#'+branch,sk:'DEVICE_PUSH#'+device});
const tokenKey = device => ({token:'BRANCH_DEVICE#'+device});
const reverseKey = hash => ({token:'BRANCH_PUSH_TOKEN#'+hash});
const id = value => typeof value==='string' && /^[\w.:-]{1,150}$/.test(value);
module.exports = {tables,read,digest,bindingKey,tokenKey,reverseKey,id};
