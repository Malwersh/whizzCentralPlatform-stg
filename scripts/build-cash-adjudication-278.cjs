const fs=require('node:fs'),esbuild=require('../backend/wallet-service/node_modules/esbuild');
const p='/private/tmp/cash-adjudication-278';fs.mkdirSync(p,{recursive:true});
const runtime=esbuild.buildSync({entryPoints:['backend/wallet-service/src/customerCashRuntime266.ts'],bundle:true,platform:'node',target:'node22',write:false,logLevel:'warning'}).outputFiles[0].contents;
fs.writeFileSync(p+'/customer-cash-runtime-266.js',runtime);fs.writeFileSync('backend/shared/customer-cash-runtime-266.js',runtime);
console.log('Built isolated adjudication runtime; no unrelated financial handlers rebuilt.');
