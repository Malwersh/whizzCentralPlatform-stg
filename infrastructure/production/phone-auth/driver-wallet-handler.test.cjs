'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
test('disabled production creator fails before SDK or database initialization',async()=>{process.env.ENVIRONMENT='production';process.env.WALLET_CREATION_ENABLED='false';await assert.rejects(require('./driver-wallet-handler.cjs').handler({}),/ProductionWalletCreationDisabled/);});
