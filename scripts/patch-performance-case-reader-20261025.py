def patch(source):
 def replace(old,new):
  nonlocal source
  assert source.count(old)==1,old[:90]
  source=source.replace(old,new)
 replace('activeResponsibilityFindingId: row.activeResponsibilityFindingId || null, caseAppeals:', 'activeResponsibilityFindingId: row.activeResponsibilityFindingId || null, driverPerformanceDecisions: row.driverPerformanceDecisions || [], caseAppeals:')
 a=source.index('if (method === "GET" && path === PATH + "/detail")',source.index('var require_order_exception_cases ='))
 b=source.index('if (method === "POST" && path === PATH + "/actions")',a)
 block=source[a:b]
 assert block.count('const events = [];')==1
 block=block.replace('const events = [];','const events = [], performanceAssignments = [];')
 needle='events.push(...(r7.Items || []).filter('
 assert block.count(needle)==1
 block=block.replace(needle,"for(const a of r7.Items||[])if(a.kind==='COD_ASSIGNMENT_RELEASE'&&a.orderId===c7.order.orderId&&typeof a.driverId==='string'&&typeof a.offerId==='string'&&Number.isSafeInteger(a.attempt))performanceAssignments.push({driverId:a.driverId,offerId:a.offerId,attempt:a.attempt,outcome:a.outcome,reportedReason:a.driverReportedReason||null});\n          "+needle)
 block=block.replace('"ORDER_EXCEPTION_FINDING"].includes(x7.kind)','"ORDER_EXCEPTION_FINDING", "DRIVER_PERFORMANCE_DECISION_EVENT"].includes(x7.kind)')
 needle='} while (cursor3);'
 assert block.count(needle)==1
 block=block.replace(needle,needle+"\n        if(c7.order.driverId&&c7.order.financialAcceptance?.offerId&&Number.isSafeInteger(c7.order.assignmentAttemptCounter)&&['cancelled','canceled','returned'].includes(c7.order.status)&&!performanceAssignments.some(a=>a.offerId===c7.order.financialAcceptance.offerId))performanceAssignments.push({driverId:c7.order.driverId,offerId:c7.order.financialAcceptance.offerId,attempt:c7.order.assignmentAttemptCounter,outcome:c7.order.status.toUpperCase(),reportedReason:null});\n        item.performanceAssignments=performanceAssignments;")
 block=block.replace('"noAutomaticCharge", "plan"].filter','"noAutomaticCharge", "plan", "driverId", "offerId", "attempt", "decisionId", "decision", "supersedesDecisionId"].filter')
 source=source[:a]+block+source[b:]
 return source
if __name__=='__main__':
 from pathlib import Path
 p=Path('/private/tmp/performance-hidden-20261025');(p/'patched-entry.js').write_text(patch((p/'actual-entry.js').read_text()))
