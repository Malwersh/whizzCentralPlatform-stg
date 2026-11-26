"""Private funding evidence storage. No public access or funding activation."""
import json
from pathlib import Path
from prepare_driver_documents import build as document_storage
ROOT = Path(__file__).resolve().parent
NAME = 'wizz-production-funding-receipts-746727375268-us-east-1'
def build():
    template = document_storage()
    template['Description'] = 'Private production funding receipt evidence; retained, encrypted, TLS only.'
    template['Resources']['Documents']['Properties']['BucketName'] = NAME
    return template

def service_policy():
    # Attach only to the production wallet role when its API stack is deployed.
    # Receipt URLs grant individual object access; the role cannot list/delete objects.
    return {'Version': '2012-10-17', 'Statement': [{
        'Effect': 'Allow', 'Action': ['s3:PutObject', 's3:GetObject'],
        'Resource': f'arn:aws:s3:::{NAME}/receipts/*',
        'Condition': {'StringEquals': {'s3:ResourceAccount': '746727375268'}}
    }]}
if __name__ == '__main__':
    (ROOT/'funding-receipts.template.json').write_text(json.dumps(build(), indent=2)+'\n')
    (ROOT/'funding-receipts-service-policy.json').write_text(json.dumps(service_policy(), indent=2)+'\n')
