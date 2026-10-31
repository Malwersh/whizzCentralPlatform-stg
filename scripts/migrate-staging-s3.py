"""Audit by default; --apply copies referenced assets and conditionally updates Staging.
Never modifies or deletes source objects. Credentials are obtained via AWS CLI SSO.
"""
import argparse, hashlib, json, os, subprocess
from urllib.parse import urlparse, unquote
import boto3

def session(profile, account):
    c=json.loads(subprocess.check_output(['aws','configure','export-credentials','--profile',profile,'--format','process']))
    s=boto3.Session(aws_access_key_id=c['AccessKeyId'],aws_secret_access_key=c['SecretAccessKey'],aws_session_token=c['SessionToken'],region_name='us-east-1')
    assert s.client('sts').get_caller_identity()['Account']==account
    return s

def strings(value):
    if isinstance(value,dict):
        for v in value.values(): yield from strings(v)
    elif isinstance(value,list):
        for v in value: yield from strings(v)
    elif isinstance(value,str): yield value

def replace(value, mapping):
    if isinstance(value,dict): return {k:replace(v,mapping) for k,v in value.items()}
    if isinstance(value,list): return [replace(v,mapping) for v in value]
    return mapping.get(value,value) if isinstance(value,str) else value

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--apply',action='store_true');args=parser.parse_args()
    stg=session('Wizz_stg_UserApp','699561669180');old=session('Wizz_dev_UserApp','031857856164')
    db=stg.client('dynamodb'); target=stg.client('s3'); source=old.client('s3')
    owned={b['Name'] for b in target.list_buckets()['Buckets']}
    destinations={'order-receiver-business-photos-dev-1755170214':'wizz-merchants-staging-businessphotosbucket-up3j1qega8m5'}
    records=[];mapping={};unknown=set();counts={}
    for page in db.get_paginator('list_tables').paginate():
        for table in page['TableNames']:
            keys=[x['AttributeName'] for x in db.describe_table(TableName=table)['Table']['KeySchema']]
            for scan in db.get_paginator('scan').paginate(TableName=table,ConsistentRead=True):
                for item in scan.get('Items',[]):
                    urls=[]
                    for url in strings(item):
                        p=urlparse(url)
                        if p.scheme not in ('http','https') or '.s3' not in p.netloc: continue
                        bucket=p.netloc.split('.s3')[0]
                        if bucket in owned:continue
                        if bucket not in destinations:unknown.add(bucket);continue
                        if p.query or p.fragment:raise RuntimeError('Signed source URL requires separate migration')
                        urls.append(url);mapping[url]='https://'+destinations[bucket]+'.s3.amazonaws.com/'+p.path.lstrip('/')
                    if urls:
                        records.append((table,keys,item));counts[table]=counts.get(table,0)+1
    print(json.dumps({'affectedRecords':counts,'uniqueURLs':len(mapping),'unknownSourceBuckets':sorted(unknown),'apply':args.apply}),flush=True)
    if unknown:raise RuntimeError('Unknown buckets require verified ownership and destination mapping')
    if not args.apply:return
    # Copy and independently verify every asset before changing any database URL.
    for url,new in mapping.items():
        p=urlparse(url);bucket=p.netloc.split('.s3')[0];key=unquote(p.path.lstrip('/'));dest=destinations[bucket]
        head=source.head_object(Bucket=bucket,Key=key,ExpectedBucketOwner='031857856164')
        data=source.get_object(Bucket=bucket,Key=key,ExpectedBucketOwner='031857856164',IfMatch=head['ETag'])['Body'].read()
        digest=hashlib.sha256(data).hexdigest()
        try:
            current=target.get_object(Bucket=dest,Key=key,ExpectedBucketOwner='699561669180')['Body'].read()
            if hashlib.sha256(current).hexdigest()!=digest:raise RuntimeError('Destination collision; refusing overwrite')
        except target.exceptions.NoSuchKey:
            target.put_object(Bucket=dest,Key=key,Body=data,ContentType=head.get('ContentType','application/octet-stream'),Metadata={'migration-sha256':digest},ExpectedBucketOwner='699561669180',IfNoneMatch='*')
        check=target.get_object(Bucket=dest,Key=key,ExpectedBucketOwner='699561669180')['Body'].read()
        assert hashlib.sha256(check).hexdigest()==digest
    updated=0
    for table,keys,item in records:
        changed=replace(item,mapping);fields=[k for k in item if item[k]!=changed[k]]
        names={};values={};sets=[];conditions=[]
        for i,k in enumerate(fields):
            names['#f'+str(i)]=k;values[':old'+str(i)]=item[k];values[':new'+str(i)]=changed[k]
            sets.append('#f%d=:new%d'%(i,i));conditions.append('#f%d=:old%d'%(i,i))
        db.update_item(TableName=table,Key={k:item[k] for k in keys},UpdateExpression='SET '+', '.join(sets),ConditionExpression=' AND '.join(conditions),ExpressionAttributeNames=names,ExpressionAttributeValues=values)
        updated+=1
    print(json.dumps({'verifiedCopiedURLs':len(mapping),'updatedStagingRecords':updated,'sourceObjectsUnchanged':True}))
if __name__=='__main__':main()
