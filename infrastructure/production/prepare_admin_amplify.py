"""Production-only Amplify hosting for the tested isolated administration bundle."""
import json
from pathlib import Path
from prepare_admin_hosting import build as legacy_security
ROOT=Path(__file__).resolve().parent

def build():
 old=legacy_security();t={k:v for k,v in old.items() if k not in ['Resources','Outputs']}
 t['Description']='Independent production Amplify administration hosting; reviewed manual bundles only.'
 sec=old['Resources']['SecurityHeaders']['Properties']['ResponseHeadersPolicyConfig']['SecurityHeadersConfig']
 sec['ContentSecurityPolicy']['ContentSecurityPolicy']=sec['ContentSecurityPolicy']['ContentSecurityPolicy'].replace("img-src 'self' data:;","img-src 'self' data: https://tile.openstreetmap.org https://wizz-production-home-slides-746727375268.s3.us-east-1.amazonaws.com https://wizz-production-funding-receipts-746727375268-us-east-1.s3.us-east-1.amazonaws.com; worker-src 'self'; media-src 'self' data:;")
 sec['ContentSecurityPolicy']['ContentSecurityPolicy']=sec['ContentSecurityPolicy']['ContentSecurityPolicy'].replace("connect-src 'self' https://cognito-idp.us-east-1.amazonaws.com;","connect-src 'self' https://cognito-idp.us-east-1.amazonaws.com https://44rmfvjxp8.execute-api.us-east-1.amazonaws.com wss://x7o502lmzk.execute-api.us-east-1.amazonaws.com/production;")
 headers={'customHeaders':[{'pattern':'**','headers':[{'key':'Content-Security-Policy','value':sec['ContentSecurityPolicy']['ContentSecurityPolicy']},{'key':'X-Content-Type-Options','value':'nosniff'},{'key':'X-Frame-Options','value':'DENY'},{'key':'Referrer-Policy','value':'no-referrer'},{'key':'Strict-Transport-Security','value':'max-age=31536000'},{'key':'Cache-Control','value':'no-store, max-age=0'}]}]}
 rules=[{'Source':p,'Target':'https://y6vmu5snh3.execute-api.us-east-1.amazonaws.com/production'+p,'Status':'200'} for p in ['/staff/me','/staff/enrollment/finish']]+[{'Source':'/staff/drivers','Target':'https://q8do9c7wba.execute-api.us-east-1.amazonaws.com/production/staff/drivers','Status':'200'},{'Source':'/staff/drivers/<driverId>/vehicles','Target':'https://q8do9c7wba.execute-api.us-east-1.amazonaws.com/production/staff/drivers/<driverId>/vehicles','Status':'200'},{'Source':'/staff/drivers/<driverId>/documents/view','Target':'https://q8do9c7wba.execute-api.us-east-1.amazonaws.com/production/staff/drivers/<driverId>/documents/view','Status':'200'},{'Source':'/','Target':'/index.html','Status':'200'}]
 rules[0:0]=[{'Source':p,'Target':'https://dkih4prjga.execute-api.us-east-1.amazonaws.com/production'+p,'Status':'200'} for p in ['/staff/regions/manage','/staff/regions/manage/history/<regionId>','/staff/regions/manage/jobs/<jobId>']+['/staff/regions/manage/'+action for action in ['validate','validate-plan','draft','discard','cancel','publish']]]
 rules[0:0]=[{'Source':p,'Target':'https://2mmmcqr0m7.execute-api.us-east-1.amazonaws.com/production'+p,'Status':'200'} for p in ['/staff/settings/legal-documents/<audience>','/staff/settings/legal-documents/<audience>/<action>','/staff/settings/legal-documents/<audience>/version/<revision>']]
 rules[0:0]=[{'Source':p,'Target':'https://3qcrtaq3b1.execute-api.us-east-1.amazonaws.com/production'+p,'Status':'200'} for p in ['/staff/merchants/onboarding','/staff/merchants/onboarding/<action>']]
 rules[0:0]=[{'Source':'/staff/drivers/<driverId>/quality','Target':'https://q8do9c7wba.execute-api.us-east-1.amazonaws.com/production/staff/drivers/<driverId>/quality','Status':'200'}]
 rules[0:0]=[{'Source':'/staff/drivers/<driverId>/account-deletion','Target':'https://q8do9c7wba.execute-api.us-east-1.amazonaws.com/production/staff/drivers/<driverId>/account-deletion','Status':'200'}]
 rules[0:0]=[{'Source':'/staff/drivers/<driverId>/performance','Target':'https://q8do9c7wba.execute-api.us-east-1.amazonaws.com/production/staff/drivers/<driverId>/performance','Status':'200'}]
 home=['/staff/home-layout/slides','/staff/home-layout','/staff/home-layout/options','/staff/home-layout/draft','/staff/home-layout/publish','/staff/home-layout/rollback','/staff/home-layout/promotion-header/publish','/staff/home-layout/classifications']
 home += [base + suffix for base in ('/staff/settings/driver-map', '/staff/settings/delivery-operations') for suffix in ('', '/changes', '/request', '/approve', '/reject')]
 home += ['/staff/settings/notification-sounds' + suffix for suffix in ('', '/changes', '/upload', '/request', '/approve', '/reject')]
 home += ['/staff/home-layout/interfaces' + suffix for suffix in ('', '/catalog', '/draft', '/publish', '/rollback')]
 rules[0:0]=[{'Source':path,'Status':'200','Target':'https://96kw5cw8e8.execute-api.us-east-1.amazonaws.com/production'+path} for path in home]
 merchant_routes=['/staff/merchants/directory','/staff/merchants/branch','/staff/merchants/applications','/staff/merchants/applications/review','/staff/merchants/application-asset']
 rules[0:0]=[{'Source':path,'Status':'200','Target':'https://vxd59g8n0e.execute-api.us-east-1.amazonaws.com/production'+path} for path in merchant_routes]
 rules[0:0]=[{'Source':'/staff/merchants/agreements','Status':'200','Target':'https://te5d6a852m.execute-api.us-east-1.amazonaws.com/production/staff/merchants/agreements'}]
 rules[0:0]=[{'Source':'/staff/order-cancellation','Status':'200','Target':'https://wsnrap4pl5.execute-api.us-east-1.amazonaws.com/production/staff/order-cancellation'}]
 rules[0:0]=[{'Source':path,'Status':'200','Target':'https://qa7qftdttc.execute-api.us-east-1.amazonaws.com/production'+path} for path in ['/staff/settlement-schedules','/staff/settlement-schedules/branches']]
 rules[0:0]=[{'Source':path,'Status':'200','Target':'https://irr5v59ww1.execute-api.us-east-1.amazonaws.com/production'+path}
             for path in ['/staff/merchants/staff-policy','/staff/merchants/staff-policy/history','/staff/merchants/staff-policy/save']]
 rules[0:0]=[{'Source':'/staff/pickup-issues','Status':'200','Target':'https://6d55f5nc5h.execute-api.us-east-1.amazonaws.com/production/staff/pickup-issues'}]
 t['Resources']={'AdminApp':{'Type':'AWS::Amplify::App','Condition':'IsProductionAccount','Properties':{'Name':'wizz-centralplatform-production','Description':'Production administration bootstrap; no imported content or credentials.','Platform':'WEB','EnableBranchAutoDeletion':False,'CustomHeaders':json.dumps(headers),'CustomRules':rules,'Tags':[{'Key':'Environment','Value':'production'},{'Key':'Purpose','Value':'admin-bootstrap'}]}},'ProductionBranch':{'Type':'AWS::Amplify::Branch','Condition':'IsProductionAccount','Properties':{'AppId':{'Fn::GetAtt':['AdminApp','AppId']},'BranchName':'production','Stage':'PRODUCTION','EnableAutoBuild':False,'EnablePullRequestPreview':False,'EnablePerformanceMode':False}}}
 t['Outputs']={'AppId':{'Value':{'Fn::GetAtt':['AdminApp','AppId']}},'WebsiteUrl':{'Value':{'Fn::Sub':'https://production.${AdminApp.DefaultDomain}'}}};return t
if __name__=='__main__':(ROOT/'admin-amplify.template.json').write_text(json.dumps(build(),indent=2)+'\n')
