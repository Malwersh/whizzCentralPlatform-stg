const fs=require('fs'),ts=require('../backend/wallet-service/node_modules/typescript');
const file=process.argv[2],s=fs.readFileSync(file,'utf8'),a=ts.createSourceFile(file,s,99,true),edits=[];let routed=0,handler=0;
function visit(n){if(ts.isFunctionDeclaration(n)&&n.body&&n.name){const body=n.body.getText(a);
 if(body.includes('DRIVER_UNAVAILABLE')&&body.includes('drivers.read')&&body.includes('ctx.driversTable')){
  const get=body.match(/new (GetCommand\d*)\(/)?.[1],tx=body.match(/new (TransactWriteCommand\d*)\(/)?.[1];if(!get||!tx)throw Error('Staff SDK constructors unavailable');
  const insertion=`\n if(/^\\/staff\\/drivers\\/[^/]+\\/vehicles$/.test(path))return require('../../driver-vehicles.js').route({...ctx,db:{send(command){const sdk={GetCommand:${get},TransactWriteCommand:${tx}},type=command?.constructor?.name?.replace(/\\d+$/,'');if(!sdk[type])throw Error('VEHICLE_STAFF_COMMAND_INVALID');return ctx.db.send(command instanceof sdk[type]?command:new sdk[type](command.input));}}},actor,method,path,input);\n if(method==='GET'&&path==='/staff/drivers'){const core=require('../../driver-vehicles-core-308.js');return {items:(await all(ctx.db,ctx.driversTable)).filter(d=>inScope(actor,d)).map(d=>{if(!actor.roles.includes('bootstrap_admin'))return {...visible(d),vehicleReviewSummary:core.reviewSummary(d)};const {vehicleRegistry,vehicleOperational,...rest}=d;return {...rest,vehicleReviewSummary:core.reviewSummary(d)};})};}\n`;
  edits.push([n.body.getStart(a)+1,n.body.getStart(a)+1,insertion]);routed++;
 }
 if(n.name.text==='handler'&&body.includes('driverRoutes.route')){
  const needle='if (method === "POST" && path === "/staff/drivers/edit")';const index=s.indexOf(needle,n.body.getStart(a));if(index<0||index>n.body.end)throw Error('Staff POST anchor not found');
  const insertion=`if(method==='POST'&&/^\\/staff\\/drivers\\/[^/]+\\/vehicles$/.test(path))return response(200,await driverRoutes.route({db,driversTable:process.env.DRIVERS_TABLE,guard,audit,id:randomUUID},actor,method,path,input));\n    `;
  edits.push([index,index,insertion]);handler++;
 }
}ts.forEachChild(n,visit);}visit(a);if(routed!==1||handler!==1)throw Error('Staff route count mismatch');let out=s;for(const[x,y,z]of edits.sort((a,b)=>b[0]-a[0]))out=out.slice(0,x)+z+out.slice(y);fs.writeFileSync(file,out);
