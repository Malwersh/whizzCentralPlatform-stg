'use strict';
const path = require('node:path'), fs = require('node:fs');
const esbuild = require('../backend/wallet-service/node_modules/esbuild');
(async () => {
 const output = path.resolve(__dirname, '../../wizzuser-stg/backend/src/functions/delivery-quotes/runtime.js');
 const result = await esbuild.build({ entryPoints: [path.resolve(__dirname, '../backend/wallet-service/src/deliveryQuoteRuntime.ts')],
  bundle: true, platform: 'node', target: 'node20', format: 'cjs', write: false });
 const bytes = result.outputFiles[0].contents;
 if (process.argv.includes('--check')) { if (!fs.existsSync(output) || !Buffer.from(bytes).equals(fs.readFileSync(output))) throw Error('QUOTE_RUNTIME_OUT_OF_SYNC'); }
 else fs.writeFileSync(output, bytes);
})().catch(e => { console.error(e.message); process.exitCode = 1; });
