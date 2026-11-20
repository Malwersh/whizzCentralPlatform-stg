"use strict";
// Preserve the tested staging target; production must explicitly bind its own service.
function financialTarget(env = process.env) {
  const production = ["production", "prod"].includes(env.ENVIRONMENT);
  const target = env.FINANCIAL_WORKFLOW_FUNCTION_ARN;
  if (production) {
    if (!/^arn:aws:lambda:us-east-1:746727375268:function:wizz-production-[A-Za-z0-9_-]+$/.test(target || "")) {
      throw Object.assign(new Error("FINANCIAL_WORKFLOW_NOT_CONFIGURED"), {status: 503});
    }
    return target;
  }
  return target || "arn:aws:lambda:us-east-1:699561669180:function:staging-driver-financial-accept";
}
module.exports = {financialTarget};
