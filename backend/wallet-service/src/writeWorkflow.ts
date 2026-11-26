// Internal Staging release policy; other environments retain independent review.
export const directWrite=()=>process.env.PLATFORM_ENVIRONMENT==='staging'&&process.env.PLATFORM_WRITE_MODE==='DIRECT';
export const directOperator=(id:string)=>directWrite()&&(process.env.PLATFORM_DIRECT_OPERATOR_IDS||'').split(',').includes(id);
