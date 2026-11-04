'use strict';
// Internal release policy. Independent review remains the default outside Staging.
const direct=()=>process.env.PLATFORM_ENVIRONMENT==='staging'&&process.env.PLATFORM_WRITE_MODE==='DIRECT';
const operator=person=>direct()&&person?.status==='ACTIVE'&&(process.env.PLATFORM_DIRECT_OPERATOR_IDS||'').split(',').includes(person.employeeId);
module.exports={direct,operator};
