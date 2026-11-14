const fs=require('fs'),path=require('path'),esbuild=require('../backend/wallet-service/node_modules/esbuild');
const root=path.resolve(__dirname,'..'),out=path.join(root,'backend/.tmp/regions-312');fs.mkdirSync(out,{recursive:true});
for(const entry of ['api','worker'])esbuild.buildSync({entryPoints:[path.join(root,`backend/region-management/${entry}-entry.js`)],outfile:path.join(out,`region-management-${entry}-312.js`),platform:'node',target:'node22',bundle:true,keepNames:true,logLevel:'silent'});
esbuild.buildSync({entryPoints:[path.join(root,'backend/region-management/browser-entry.js')],outfile:path.join(root,'frontend/region-geometry-runtime-312.js'),platform:'browser',target:'es2020',bundle:true,format:'iife',globalName:'RegionGeometry312',minify:true,logLevel:'silent'});
esbuild.buildSync({entryPoints:[path.join(root,'backend/region-management/covered-region-entry.js')],outfile:path.join(out,'region-coverage-runtime-312.js'),platform:'node',target:'node22',bundle:true,keepNames:true,logLevel:'silent'});
fs.copyFileSync(path.join(out,'region-coverage-runtime-312.js'),path.join(root,'../wizzuser-stg/backend/src/utils/region-coverage-runtime-312.js'));
console.log('Built region API, durable worker and shared browser validation');
