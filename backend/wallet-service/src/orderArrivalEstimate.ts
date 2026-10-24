/** Timing projection only: never changes customer prices or driver compensation. */
export function assignedArrivalEstimate(at: string, pickupSeconds: number, deliverySeconds: number, readyAt?: string | null) {
  const now=Date.parse(at),ready=readyAt==null?now:Date.parse(readyAt);
  if(!Number.isFinite(now)||!Number.isFinite(ready)||![pickupSeconds,deliverySeconds].every(v=>Number.isSafeInteger(v)&&v>0&&v<=86400))throw Error('INVALID_ARRIVAL_ESTIMATE');
  const earliest=Math.max(ready,now+pickupSeconds*1000)+deliverySeconds*1000;
  return {estimatedDeliveryTime:new Date(earliest).toISOString(),deliveryEstimate:{schemaVersion:1,basis:'PREPARATION_AND_ASSIGNED_DRIVER_ROUTE',updatedAt:at,
    earliestAt:new Date(earliest).toISOString(),latestAt:new Date(earliest+300000).toISOString(),pickupSeconds,deliverySeconds,driverWaitIncluded:true}};
}
