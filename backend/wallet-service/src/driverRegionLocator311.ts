import {createDynamoRegionCoverage} from './regionCoverage';
// Reuse the exact polygon/H3 resolver used for covered orders. The supplied SDK
// constructors belong to the host bundle, avoiding mixed-SDK command instances.
export function createDriverRegionLocator311(options:any){
 const {db,GetCommand,QueryCommand,tables}=options;
 const bridge={async send(command:any){const name=command.constructor.name.replace(/\d+$/,'');const Command:any=({GetCommand,QueryCommand}as any)[name];if(!Command)throw Error('DRIVER_REGION_COMMAND_INVALID');return db.send(new Command(command.input));}};
 return createDynamoRegionCoverage({db:bridge as any,tables});
}
