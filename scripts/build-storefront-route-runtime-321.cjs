'use strict';
const path=require('node:path'),esbuild=require('../backend/wallet-service/node_modules/esbuild');
const output=process.argv[2];if(!output||!path.isAbsolute(output))throw Error('Supply absolute output path');
esbuild.buildSync({stdin:{contents:"export {createStagingStorefrontRoute} from './storefrontRoute'; export {createStagingDeliveryQuoteRateLimiter} from './deliveryQuoteRateLimit';",resolveDir:path.resolve(__dirname,'../backend/wallet-service/src'),loader:'ts'},bundle:true,platform:'node',target:'node20',keepNames:true,outfile:output});
