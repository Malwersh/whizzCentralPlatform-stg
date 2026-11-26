"""Narrow additions to the published support UI; never replace its other code."""
def patch(text):
 anchor='            let merchantSessions = new Map();';assert text.count(anchor)==1
 text=text.replace(anchor,anchor+"\n            let requestedComplaintSession341 = new URLSearchParams(location.search).get('sessionId');\n            const requestedComplaintOrder341 = new URLSearchParams(location.search).get('orderId');",1)
 anchor='            function updateSessionsList() {';assert text.count(anchor)==1
 text=text.replace(anchor,anchor+"\n                if (/^complaint_[a-f0-9]{48}$/.test(requestedComplaintSession341 || '') && merchantSessions.has(requestedComplaintSession341) && merchantSessions.get(requestedComplaintSession341).orderId === requestedComplaintOrder341) {\n                    const target = requestedComplaintSession341; requestedComplaintSession341 = null; selectSession(target);\n                }",1)
 return text
