const fs=require('fs'),ts=require('../backend/wallet-service/node_modules/typescript');
const targetName=process.argv[4]||'stopSearching';
const live=process.argv[2],source=process.argv[3],s=fs.readFileSync(live,'utf8'),next=fs.readFileSync(source,'utf8');
function find(file,code){const a=ts.createSourceFile(file,code,99,true),found=[];function visit(n){if(ts.isFunctionDeclaration(n)&&n.name?.text===targetName)found.push({start:n.getStart(a),end:n.end,text:n.getText(a)});ts.forEachChild(n,visit);}visit(a);if(found.length!==1)throw Error('Stop function count');return found[0];}
const old=find(live,s),fresh=find(source,next);fs.writeFileSync(live,s.slice(0,old.start)+fresh.text+s.slice(old.end));
