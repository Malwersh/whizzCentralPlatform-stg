const fs=require('fs'),ts=require('../backend/wallet-service/node_modules/typescript');
const file=process.argv[2],s=fs.readFileSync(file,'utf8');if(s.includes('region-management-api-312.js'))throw Error('Route already present');
const sdk=s.match(/var\s*\{[^}]*DynamoDBDocumentClient[^}]*GetCommand[^}]*\}\s*=\s*([A-Za-z0-9_]+)\(\);/);if(!sdk)throw Error('Host SDK not identified');
const a=ts.createSourceFile(file,s,99,true);let edit,count=0;function visit(n){if(ts.isFunctionDeclaration(n)&&n.name?.text==='handler'){
 const text=n.getText(a),needle='const requirePermission =';let anchor=s.indexOf(needle,n.getStart(a));if(anchor<0||anchor>n.end)throw Error('Handler permission anchor');
 // Insert after the first GET /staff/me statement, inside the authenticated scope.
 const marker='if (method === "GET" && path === "/staff/me") return response(200, { employee: actor, permissions: effective(actor), directWrite: direct() });';
 anchor=s.indexOf(marker,anchor);if(anchor<0||anchor>n.end)throw Error('Handler staff/me anchor');anchor+=marker.length;
 const code=`\n    if(path==='/staff/regions/manage'||path.startsWith('/staff/regions/manage/')){let regionInput={};if(method==='POST'){try{regionInput=JSON.parse(event.body||'{}');if(!regionInput||typeof regionInput!=='object'||Array.isArray(regionInput))throw Error();}catch{throw fail('INVALID_BODY',400);}}try{return response(200,await require('../../region-management-api-312.js').route({db,table,sdk:${sdk[1]}(),allowed,guard,audit,recent,claims},actor,method,path,regionInput));}catch(error){return response(error.status||503,{error:error.code||'REGION_MANAGEMENT_UNAVAILABLE',...(error.details?{details:error.details}:{})});}}\n`;
 edit=[anchor,code];count++;}ts.forEachChild(n,visit);}visit(a);if(count!==1)throw Error('Handler count');fs.writeFileSync(file,s.slice(0,edit[0])+edit[1]+s.slice(edit[0]));console.log('Patched authenticated region route with the actual host SDK factory',sdk[1]);
