const fs=require('fs'),ts=require('../backend/wallet-service/node_modules/typescript'),assert=require('assert');
const base=process.argv[2],out=process.argv[3];let s=fs.readFileSync(base,'utf8');
const compiled=fs.readFileSync('backend/wallet-service/dist/driverOfferOrderReader.js','utf8');
const ast=ts.createSourceFile('reader.js',compiled,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
const helper=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='driverOfferDisplay').getText(ast);
const target=ts.createSourceFile('runtime.js',s,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
const old=target.statements.filter(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='driverOfferDisplay');assert.equal(old.length,1);
const fields=[];function visit(n){if(ts.isVariableDeclaration(n)&&/^fields\d*$/.test(n.name.getText(target))&&n.initializer&&ts.isArrayLiteralExpression(n.initializer)&&n.initializer.getText(target).includes('"financialSnapshot"')&&n.initializer.getText(target).includes('"estimatedReadyAt"'))fields.push(n.initializer);ts.forEachChild(n,visit);}visit(target);assert.equal(fields.length,1);
const edits=[{a:old[0].getStart(target),b:old[0].end,text:helper},{a:fields[0].end-1,b:fields[0].end-1,text:', "customerName", "deliveryAddress"'}];for(const e of edits.sort((a,b)=>b.a-a.a))s=s.slice(0,e.a)+e.text+s.slice(e.b);fs.writeFileSync(out,s);
