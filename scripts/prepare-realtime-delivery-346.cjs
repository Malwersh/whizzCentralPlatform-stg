'use strict';
// Preserve the live runtime; replace only the financial delivery factory.
const fs=require('node:fs'),path=require('node:path'),esbuild=require('../backend/wallet-service/node_modules/esbuild'),ts=require('../backend/wallet-service/node_modules/typescript');
const base='/private/tmp/realtime-346',root=path.resolve(__dirname,'..');
esbuild.buildSync({entryPoints:[path.join(root,'backend/wallet-service/src/financialOfferDelivery.ts')],outfile:path.join(base,'financial-delivery-runtime-346.js'),bundle:true,platform:'node',target:'node20',keepNames:true,logLevel:'silent'});
const file=process.argv[2];if(!file)process.exit(0);
const source=fs.readFileSync(file,'utf8'),ast=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS),edits=[];
function visit(n){if(ts.isFunctionDeclaration(n)&&n.name&&/^createStagingFinancialOfferDelivery\d*$/.test(n.name.text)&&n.body){
 const sdk=n.body.getText(ast).match(/new ([$\w]+)\.TransactWriteCommand\(/)?.[1];if(!sdk)throw Error('delivery SDK namespace unavailable');
 const replacement=`{const original=options.db,sdk=${sdk};return require('./financial-delivery-runtime-346.js').createStagingFinancialOfferDelivery({...options,db:{send(command){const kind=command.constructor.name.replace(/\\d+$/,'');if(!['GetCommand','TransactWriteCommand'].includes(kind))throw Error('DELIVERY_COMMAND_INVALID');return original.send(new sdk[kind](command.input));}}});}`;
 edits.push([n.body.getStart(ast),n.body.end,replacement]);return;}ts.forEachChild(n,visit);}visit(ast);
if(edits.length!==1)throw Error('expected one financial delivery factory');let output=source;for(const [a,b,r]of edits.sort((a,b)=>b[0]-a[0]))output=output.slice(0,a)+r+output.slice(b);fs.writeFileSync(file+'.patched',output);console.log('Patched one financial delivery factory');
