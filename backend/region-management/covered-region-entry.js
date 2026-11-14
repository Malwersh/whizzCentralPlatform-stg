'use strict';
const {createDynamoRegionCoverage}=require('../wallet-service/src/regionCoverage.ts');
exports.createRegionResolver=function({db,sdk,tables}){
 const bridge={send(command){const type=command?.constructor?.name?.replace(/\d+$/,'');if(!['GetCommand','QueryCommand'].includes(type)||!sdk[type])throw Error('REGION_READER_COMMAND_INVALID');return db.send(new sdk[type](command.input));}};
 return createDynamoRegionCoverage({db:bridge,tables});
};
