"""Reuse the reviewed closed Gateway/Cognito check with a Part55 evidence destination.
The existing helper suppresses account messages and removes its temporary client/user.
It never opens gates, invokes pricing providers or creates an application order.
"""
from pathlib import Path
import sys
root=Path(__file__).resolve().parents[1]
source=(root/'scripts/test-quote-closed-auth-staging.py').read_text()
old="Path('/private/tmp/cod29-auth-result.json')"
if source.count(old)!=1:raise ValueError('REVIEWED_AUTH_TEST_OUTPUT_ANCHOR_CHANGED')
source=source.replace(old,"Path('/private/tmp/finance55/gateway-closed-auth.json')")
sys.argv=[str(root/'scripts/test-quote-closed-auth-staging.py'),'--execute-synthetic-auth']
exec(compile(source,str(root/'scripts/test-quote-closed-auth-staging.py'),'exec'))
