"""Private document storage only; upload access is granted by later API stack."""
import json
from pathlib import Path
ROOT=Path(__file__).resolve().parent
NAME='wizz-production-driver-documents-746727375268-us-east-1'
def build():
 base=json.loads((ROOT/'foundation.template.json').read_text());t={k:v for k,v in base.items() if k not in ['Resources','Outputs']};t['Description']='Private production driver documents; no public access or copied data.'
 t['Resources']={'Documents':{'Type':'AWS::S3::Bucket','Condition':'IsProductionAccount','DeletionPolicy':'Retain','UpdateReplacePolicy':'Retain','Properties':{'BucketName':NAME,'VersioningConfiguration':{'Status':'Enabled'},'BucketEncryption':{'ServerSideEncryptionConfiguration':[{'ServerSideEncryptionByDefault':{'SSEAlgorithm':'AES256'}}]},'PublicAccessBlockConfiguration':{'BlockPublicAcls':True,'IgnorePublicAcls':True,'BlockPublicPolicy':True,'RestrictPublicBuckets':True},'OwnershipControls':{'Rules':[{'ObjectOwnership':'BucketOwnerEnforced'}]}}},'TlsOnly':{'Type':'AWS::S3::BucketPolicy','Condition':'IsProductionAccount','Properties':{'Bucket':{'Ref':'Documents'},'PolicyDocument':{'Version':'2012-10-17','Statement':[{'Effect':'Deny','Principal':'*','Action':'s3:*','Resource':[{'Fn::GetAtt':['Documents','Arn']},{'Fn::Sub':'${Documents.Arn}/*'}],'Condition':{'Bool':{'aws:SecureTransport':'false'}}}]}}}}
 t['Outputs']={'BucketName':{'Value':{'Ref':'Documents'}}};return t
if __name__=='__main__':(ROOT/'driver-documents.template.json').write_text(json.dumps(build(),indent=2)+'\n')
