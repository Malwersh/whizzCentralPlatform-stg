const fs=require('node:fs'),esbuild=require('../backend/wallet-service/node_modules/esbuild');
const runtime=esbuild.buildSync({entryPoints:['backend/wallet-service/src/customerCashRuntime266.ts'],bundle:true,platform:'node',target:'node22',write:false,logLevel:'warning'}).outputFiles[0].contents;
fs.writeFileSync('backend/shared/customer-cash-runtime-266.js',runtime);
const client=esbuild.buildSync({entryPoints:['backend/staff-service/order-exception-case-client.js'],bundle:true,platform:'node',target:'node20',write:false,alias:{'@aws-sdk/client-lambda':require.resolve('../backend/order-service/node_modules/@aws-sdk/client-lambda')},logLevel:'warning'}).outputFiles[0].contents;
fs.writeFileSync('/private/tmp/customer-cash-266/staff-client.js',client);
console.log('Built isolated customer cash runtime and scoped staff proxy; no original settlement handlers rebuilt.');
