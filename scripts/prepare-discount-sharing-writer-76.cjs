const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),assert=require('node:assert/strict'),ts=require(process.cwd()+'/backend/wallet-service/node_modules/typescript');
const original=fs.readFileSync('scripts/overlay-financial-readers-63.cjs','utf8');
const functions=original.slice(original.indexOf('function moduleRange'),original.indexOf('const inv='));
const read=cp.execFileSync('python3',['-c','import zipfile,sys;sys.stdout.buffer.write(zipfile.ZipFile(sys.argv[1]).read(sys.argv[2]))','/private/tmp/sharing76/writer.base.zip','functions/create-order/commercial-runtime.js'],{encoding:'utf8',maxBuffer:20000000});
const change=new Function('ts','assert',functions+';return wrapper;')(ts,assert);
const result=change(read,'quote-runtime/orderCommercialSource.js',fs.readFileSync('backend/wallet-service/dist/orderCommercialSource.js','utf8'));
fs.writeFileSync('/private/tmp/sharing76/commercial-runtime.js',result);
