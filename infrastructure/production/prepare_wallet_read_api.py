"""Expose authenticated wallet reads and approved, guarded topup review routes."""
import json
from pathlib import Path
ROOT = Path(__file__).resolve().parent
ROUTES = {'ApproveTopup':'/wallet/topup/{topupId}/approve', 'RejectTopup':'/wallet/topup/{topupId}/reject', 'SaveFundingConfig':'/wallet/funding/admin/config', 'AdminReceipt':'/wallet/funding/admin/receipt', 'TopupRequests':'/wallet/topup/requests', 'FundingConfig': '/wallet/funding/config', 'Transactions': '/wallet/me/transactions', 'AdminWallets':'/wallet/funding/admin/wallets', 'AdminTransactions':'/wallet/funding/admin/transactions', 'TransferSettings':'/wallet/funding/admin/transfer-settings'}
DEPLOYMENT = 'DeploymentTransferSettingsRead'
DRIVER_READS = {'DriverWallet': '/wallet/me', 'DriverNotifications': '/wallet/me/notifications'}
DRIVER_DEPLOYMENT = 'DeploymentDriverWalletAndNotifications'

def build(include_driver_reads=False):
    base = json.loads((ROOT / 'storage-auth.template.json').read_text())
    t = {k: v for k, v in base.items() if k not in ('Resources', 'Outputs')}
    t['Description'] = 'Production authenticated wallet API with scoped administrative topup review.'
    sub = lambda value: {'Fn::Sub': value}
    r = {'Api': {'Type': 'AWS::ApiGateway::RestApi', 'Properties': {'Name': 'wizz-production-wallet-read', 'EndpointConfiguration': {'Types': ['REGIONAL']}}},
         'Authorizer': {'Type': 'AWS::ApiGateway::Authorizer', 'Properties': {'Name': 'ProductionWalletIdentity', 'RestApiId': {'Ref': 'Api'}, 'Type': 'REQUEST', 'IdentitySource': 'method.request.header.Authorization', 'AuthorizerResultTtlInSeconds': 0, 'AuthorizerUri': sub('arn:${AWS::Partition}:apigateway:${AWS::Region}:lambda:path/2015-03-31/functions/arn:${AWS::Partition}:lambda:${AWS::Region}:${AWS::AccountId}:function:wizz-production-wallet-authorizer/invocations')}},
         'AuthorizePermission': {'Type': 'AWS::Lambda::Permission', 'Properties': {'Action': 'lambda:InvokeFunction', 'FunctionName': 'wizz-production-wallet-authorizer', 'Principal': 'apigateway.amazonaws.com', 'SourceAccount': {'Ref': 'AWS::AccountId'}, 'SourceArn': sub('arn:${AWS::Partition}:execute-api:${AWS::Region}:${AWS::AccountId}:${Api}/authorizers/${Authorizer}')}}}
    nodes = {}
    routes = {**ROUTES, **DRIVER_READS} if include_driver_reads else ROUTES
    for name, path in routes.items():
        method = 'PUT' if name == 'SaveFundingConfig' else ('POST' if name in ('AdminReceipt','ApproveTopup','RejectTopup') else 'GET')
        prefix = ''
        parent = {'Fn::GetAtt': ['Api', 'RootResourceId']}
        for part in path.strip('/').split('/'):
            prefix += '/' + part
            key = 'Resource' + ''.join(word.title() for segment in prefix.strip('/').split('/') for word in segment.strip('{}').split('-'))
            if prefix not in nodes:
                r[key] = {'Type': 'AWS::ApiGateway::Resource', 'Properties': {'RestApiId': {'Ref': 'Api'}, 'ParentId': parent, 'PathPart': part}}
                nodes[prefix] = key
            parent = {'Ref': nodes[prefix]}
        r[name] = {'Type': 'AWS::ApiGateway::Method', 'Properties': {'RestApiId': {'Ref': 'Api'}, 'ResourceId': parent, 'HttpMethod': method, 'AuthorizationType': 'CUSTOM', 'AuthorizerId': {'Ref': 'Authorizer'}, 'Integration': {'Type': 'AWS_PROXY', 'IntegrationHttpMethod': 'POST', 'Uri': sub('arn:${AWS::Partition}:apigateway:${AWS::Region}:lambda:path/2015-03-31/functions/arn:${AWS::Partition}:lambda:${AWS::Region}:${AWS::AccountId}:function:wizz-production-wallet-service/invocations')}}}
        headers = {'Access-Control-Allow-Origin': "'https://production.dy2cvcjvju3cf.amplifyapp.com'", 'Access-Control-Allow-Methods': "'"+method+",OPTIONS'", 'Access-Control-Allow-Headers': "'Authorization,Content-Type,Cache-Control,Pragma'"}
        r[name+'Options'] = {'Type':'AWS::ApiGateway::Method','Properties':{'RestApiId':{'Ref':'Api'},'ResourceId':parent,'HttpMethod':'OPTIONS','AuthorizationType':'NONE','Integration':{'Type':'MOCK','RequestTemplates':{'application/json':'{"statusCode":200}'},'IntegrationResponses':[{'StatusCode':'200','ResponseParameters':{'method.response.header.'+k:v for k,v in headers.items()}}]},'MethodResponses':[{'StatusCode':'200','ResponseParameters':{'method.response.header.'+k:True for k in headers}}]}}
        r[name + 'Permission'] = {'Type': 'AWS::Lambda::Permission', 'Properties': {'Action': 'lambda:InvokeFunction', 'FunctionName': 'wizz-production-wallet-service', 'Principal': 'apigateway.amazonaws.com', 'SourceAccount': {'Ref': 'AWS::AccountId'}, 'SourceArn': sub('arn:${AWS::Partition}:execute-api:${AWS::Region}:${AWS::AccountId}:${Api}/production/' + method + path.replace('{topupId}', '*'))}}
    for name, response_type in [('GatewayClientError', 'DEFAULT_4XX'), ('GatewayServerError', 'DEFAULT_5XX'), ('GatewayUnauthorized', 'UNAUTHORIZED'), ('GatewayDenied', 'ACCESS_DENIED')]:
        r[name] = {'Type': 'AWS::ApiGateway::GatewayResponse', 'Properties': {'RestApiId': {'Ref': 'Api'}, 'ResponseType': response_type, 'ResponseParameters': {'gatewayresponse.header.Access-Control-Allow-Origin': "'https://production.dy2cvcjvju3cf.amplifyapp.com'", 'gatewayresponse.header.Access-Control-Allow-Headers': "'Authorization,Content-Type,Cache-Control,Pragma'"}}}
    r[DEPLOYMENT] = {'Type': 'AWS::ApiGateway::Deployment', 'DependsOn': list(ROUTES)+[n+'Options' for n in ROUTES], 'Properties': {'RestApiId': {'Ref': 'Api'}}}
    if include_driver_reads:
        r[DRIVER_DEPLOYMENT] = {'Type':'AWS::ApiGateway::Deployment',
            'DependsOn':list(routes)+[n+'Options' for n in routes]+[n+'Permission' for n in DRIVER_READS],
            'Properties':{'RestApiId':{'Ref':'Api'}}}
    r['Stage'] = {'Type': 'AWS::ApiGateway::Stage', 'Properties': {'RestApiId': {'Ref': 'Api'}, 'DeploymentId': {'Ref': DRIVER_DEPLOYMENT if include_driver_reads else DEPLOYMENT}, 'StageName': 'production', 'MethodSettings': [{'ResourcePath': '/*', 'HttpMethod': '*', 'DataTraceEnabled': False, 'ThrottlingBurstLimit': 10, 'ThrottlingRateLimit': 5}]}}
    for resource in r.values():
        resource['Condition'] = 'IsProductionAccount'
    t['Resources'] = r
    t['Outputs'] = {'ApiUrl': {'Value': sub('https://${Api}.execute-api.${AWS::Region}.${AWS::URLSuffix}/production')}}
    return t

if __name__ == '__main__':
    (ROOT / 'wallet-read-api.template.json').write_text(json.dumps(build(include_driver_reads=True), indent=2) + '\n')
