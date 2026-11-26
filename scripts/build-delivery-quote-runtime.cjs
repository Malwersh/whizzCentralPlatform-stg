'use strict';
const path = require('node:path'), fs = require('node:fs');
const esbuild = require('../backend/wallet-service/node_modules/esbuild');
(async () => {
 const directory = process.env.DELIVERY_QUOTE_OUTPUT_DIR
  ? path.resolve(process.env.DELIVERY_QUOTE_OUTPUT_DIR)
  : path.resolve(__dirname, '../../wizzuser-stg/backend/src/functions/delivery-quotes');
 if (!process.argv.includes('--check')) fs.mkdirSync(directory, { recursive: true });
 for (const [source, filename] of [['deliveryQuoteRuntime', 'runtime.js'], ['storefrontPointRuntime317', 'point-preview-runtime-317.js']]) {
  const output = path.join(directory, filename);
  const result = await esbuild.build({ entryPoints: [path.resolve(__dirname, '../backend/wallet-service/src', source+'.ts')],
   bundle: true, platform: 'node', target: 'node20', format: 'cjs', write: false });
  const bytes = result.outputFiles[0].contents;
  if (process.argv.includes('--check')) {
   if (!fs.existsSync(output) || !Buffer.from(bytes).equals(fs.readFileSync(output))) throw Error('QUOTE_RUNTIME_OUT_OF_SYNC: '+filename);
  } else fs.writeFileSync(output, bytes);
 }
})().catch(e => { console.error(e.message); process.exitCode = 1; });
