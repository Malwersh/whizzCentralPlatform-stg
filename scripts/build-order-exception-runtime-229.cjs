'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto'),esbuild=require('../backend/wallet-service/node_modules/esbuild'),ts=require('../backend/wallet-service/node_modules/typescript');
const root=path.resolve(__dirname,'..'),check=process.argv.includes('--check');
function output(file,bytes){if(check){if(!fs.existsSync(file)||!fs.readFileSync(file).equals(Buffer.from(bytes)))throw Error('RUNTIME_DRIFT:'+file);}else fs.writeFileSync(file,bytes);}
const bytes=esbuild.buildSync({entryPoints:[root+'/backend/wallet-service/src/orderExceptionRuntime229.ts'],bundle:true,platform:'node',target:'node22',write:false,logLevel:'warning'}).outputFiles[0].contents;
output(root+'/backend/shared/order-exception-runtime-229.js',bytes);
const source=fs.readFileSync(root+'/backend/wallet-service/src/orderExceptionPolicy.ts','utf8');
const policy='// Generated from canonical orderExceptionPolicy.ts SHA256 '+crypto.createHash('sha256').update(source).digest('hex')+'\n'+ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
output(path.resolve(root,'../wizzuser-stg/backend/src/functions/create-order/quote-runtime/orderExceptionPolicy.js'),policy);
