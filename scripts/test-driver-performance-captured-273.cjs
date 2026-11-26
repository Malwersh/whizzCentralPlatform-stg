// Test-only SDK bridge: input and conditions are preserved exactly; never deployed.
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const {GetCommand,TransactWriteCommand}=require(root+'/backend/wallet-service/node_modules/@aws-sdk/lib-dynamodb');
const bridge=db=>({send:c=>db.send(c.input.TransactItems?new TransactWriteCommand(c.input):c.input.TableName&&c.input.Key?new GetCommand(c.input):(()=>{throw Error('UNKNOWN_CAPTURED_COMMAND')})())});
const captured=require(process.env.PERFORMANCE_CAPTURE273_ENGINE);
const create=captured.createStagingDriverOfferAcceptance||captured.__testAcceptance;
if(typeof create!=='function')throw Error('CAPTURED_ACCEPTANCE_EXPORT_MISSING');
require(root+'/backend/wallet-service/dist/driverOfferAcceptance').createStagingDriverOfferAcceptance=options=>create({...options,db:bridge(options.db)});
