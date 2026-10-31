'use strict';
const fs=require('node:fs'),path=require('node:path'),esbuild=require('../backend/wallet-service/node_modules/esbuild');
const root=path.resolve(__dirname,'..'),out='/private/tmp/sharing78';fs.mkdirSync(out,{recursive:true});
for(const [name,source]of [['commercial-notices','backend/staff-service/commercial-notices.js'],['commercial-sharing-push','backend/src/utils/commercial-sharing-push.js']]){
 const result=esbuild.buildSync({entryPoints:[path.join(root,source)],bundle:true,platform:'node',target:'node18',keepNames:true,external:['@aws-sdk/lib-dynamodb'],write:false,nodePaths:[path.join(root,'node_modules'),path.join(root,'backend/node_modules')]});fs.writeFileSync(path.join(out,name+'.js'),result.outputFiles[0].contents);
}
