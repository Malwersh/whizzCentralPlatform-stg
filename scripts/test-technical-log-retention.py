#!/usr/bin/env python3
import pathlib,re,textwrap,types,sys,unittest
source=pathlib.Path('backend/account-deletion/template.yaml').read_text();code=textwrap.dedent(re.search(r'      InlineCode: \|\n(.*?)      Policies:',source,re.S).group(1))
class Tests(unittest.TestCase):
 def setUp(self):
  self.writes=[]
  groups=[{'logGroupName':'/aws/lambda/example-staging'},{'logGroupName':'/aws/apigateway/staging','retentionInDays':30},{'logGroupName':'cloudtrail-financial-audit','retentionInDays':2557}]
  pager=types.SimpleNamespace(paginate=lambda:[{'logGroups':groups}]);client=types.SimpleNamespace(get_paginator=lambda _:pager,put_retention_policy=lambda **kw:self.writes.append(kw));self.original=sys.modules.get('boto3');sys.modules['boto3']=types.SimpleNamespace(client=lambda *a,**kw:client);self.ns={};exec(compile(code,'inline-retention','exec'),self.ns);self.ctx=types.SimpleNamespace(invoked_function_arn='arn:aws:lambda:us-east-1:699561669180:function:test')
 def tearDown(self):
  if self.original is None:sys.modules.pop('boto3',None)
  else:sys.modules['boto3']=self.original
 def test_default_is_preview(self):
  self.assertTrue(self.ns['handler']({},self.ctx)['dryRun']);self.assertFalse(self.writes)
 def test_only_technical_logs_change_and_existing_policy_is_skipped(self):
  result=self.ns['handler']({'dryRun':False},self.ctx);self.assertEqual(result['inspected'],2);self.assertEqual(self.writes,[{'logGroupName':'/aws/lambda/example-staging','retentionInDays':30}])
 def test_old_account_is_never_modified(self):
  self.ctx.invoked_function_arn=self.ctx.invoked_function_arn.replace('699561669180','031857856164')
  with self.assertRaisesRegex(RuntimeError,'ENVIRONMENT_NOT_ALLOWED'):self.ns['handler']({'dryRun':False},self.ctx)
  self.assertFalse(self.writes)
if __name__=='__main__':unittest.main()
