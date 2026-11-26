'use strict';

const assert=require('node:assert/strict');
const {test}=require('node:test');
const {identities:{admin}}=require('../../infrastructure/production/wallet-identity-bindings.json');
const {createIdentity}=require('./identity');
const {createSocket}=require('./websocket');
const {createHandler:createAttachments}=require('./attachments');

const settings='wizz-production-PlatformStaff';
const owner='11111111-1111-4111-8111-111111111111';
const env={SUPPORT_WEBSOCKET_API_ID:'aaaaaaaaaa',WEBSOCKET_CONNECTIONS_TABLE:'connections',
    CHAT_SESSIONS_TABLE:'sessions',CHAT_MESSAGES_TABLE:'messages',SUPPORT_SETTINGS_TABLE:settings,
    WEBSOCKET_SUBSCRIPTIONS_TABLE:'tickets',SUPPORT_LIFECYCLE_TABLE:'lifecycle',SUPPORT_MESSAGE_RECEIPTS_TABLE:'receipts',
    SUPPORT_ALLOWED_ORIGIN:'https://production.example',SUPPORT_ATTACHMENTS_TABLE:'images',
    SUPPORT_ATTACHMENTS_BUCKET:'private',WALLET_NOTIFICATIONS_TABLE:'notices',SUPPORT_BUCKET_OWNER:'746727375268'};
const api='https://aaaaaaaaaa.execute-api.us-east-1.amazonaws.com/production';
function fixture(){
    const store=Object.fromEntries([...new Set(Object.values(env))].map(k=>[k,new Map()]));
    const sent=[];
    const keys={connections:['connectionId'],sessions:['sessionId'],messages:['sessionId','messageKey'],
        tickets:['subscriptionId'],receipts:['receiptId'],images:['attachmentId'],notices:['eventId']};
    const id=k=>Object.keys(k).sort().map(x=>k[x]).join('|');
    const put=(table,k,row)=>store[table].set(id(k),structuredClone(row));
    const read=(table,k)=>store[table].get(id(k));
    const at=Date.now(), seconds=Math.floor(at/1000);
    const failed=()=>Object.assign(Error('conditional'),{name:'ConditionalCheckFailedException'});
    const actor={employeeId:owner,roles:['support_supervisor'],status:'ACTIVE',scope:{allRegions:true},version:1,name:'اسم الموظف'};
    put(settings,{pk:'EMPLOYEE#'+owner,sk:'PROFILE'},actor);

    const db={async send(command){
        const {TableName,Key,Item,UpdateExpression,ExpressionAttributeValues:v}=command.input;
        switch(command.constructor.name){
            case 'GetCommand':return {Item:read(TableName,Key)};
            case 'PutCommand':
              put(TableName,Object.fromEntries(keys[TableName].map(k=>[k,Item[k]])),Item);return {};
            case 'ScanCommand':return {Items:[...store[TableName].values()]};
            case 'QueryCommand':return {Items:[...store[TableName].values()].filter(row=>row.sessionId===v[':sid'])};
            case 'UpdateCommand': {
                const row=read(TableName,Key);
                if(UpdateExpression.startsWith('SET #status'))row.status=v[':status'];
                if(UpdateExpression.startsWith('SET agentId')){row.agentId=v[':agentId'];row.status=v[':status'];}
                return {};
            }
            case 'DeleteCommand': {
                const row=read(TableName,Key);
                if (TableName==='tickets'&&(!row || row.ttl<=seconds))throw failed();
                store[TableName].delete(id(Key));
                return {Attributes:row};
            }
            case 'TransactWriteCommand': {
                const operations=command.input.TransactItems;
                for(const {ConditionCheck:check} of operations){
                    if(check?.TableName===env.SUPPORT_LIFECYCLE_TABLE && read(check.TableName,check.Key)) {
                        throw Object.assign(Error('conditional'),{name:'TransactionCanceledException'});
                    }
                }
                for(const {Put:p,Update:u} of operations){
                    if(p){
                        const k=Object.fromEntries(keys[p.TableName].map(k=>[k,p.Item[k]]));
                        put(p.TableName,k,p.Item);
                    }
                    if(u?.UpdateExpression.startsWith('SET #status')) read(u.TableName,u.Key).status=u.ExpressionAttributeValues[':status'];
                    if(u?.UpdateExpression.startsWith('SET sessionId=')) read(u.TableName,u.Key).sessionId=u.ExpressionAttributeValues[':session'];
                }
                return {};
            }
            default:throw Error(command.constructor.name);
        }
    }};
    const identity=createIdentity({db,env,now:()=>at,nonce:()=> 'x'.repeat(43),verifyApp:async(role,token)=>{
        if(!token.startsWith(role+'-'))throw Error('wrong pool');
        return {sub:token,exp:seconds+600};
    },verifyStaff:async token=>{
        if(token!=='staff-access')throw Error('wrong pool');
        return {sub:owner,username:owner,iss:'https://cognito-idp.us-east-1.amazonaws.com/'+admin.poolId,
            client_id:admin.clientId,exp:seconds+600,auth_time:seconds-10,token_use:'access'};
    },getStaff:async username=>({Username:username,Enabled:true,UserStatus:'CONFIRMED',
        UserAttributes:[{Name:'sub',Value:owner}],UserMFASettingList:['SOFTWARE_TOKEN_MFA']})});
    const handler=createSocket({db,env,...identity,merchantAccess:async()=>null,management:endpoint=>{
        assert.equal(endpoint,api);
        return {send:async command=>sent.push({connection:command.input.ConnectionId,...JSON.parse(command.input.Data)})};
    }});
    const call=(connection,route,body,extra={})=>handler({requestContext:{apiId:'aaaaaaaaaa',stage:'production',connectionId:connection,routeKey:route},...(body&&{body:JSON.stringify(body)}),...extra});
    return {identity,call,db,put,read,sent,store,actor};
}

test('browser support ticket is one-use and existing staff authorization is required',async()=>{
    const f=fixture();
    const staff={headers:{Authorization:'Bearer staff-access'}};
    const ticket=await f.identity.createTicket(staff);
    assert.equal((await f.call('a','$connect',null,{queryStringParameters:{userType:'agent',ticket:ticket.ticket}})).statusCode,200);
    assert.equal((await f.call('b','$connect',null,{queryStringParameters:{userType:'agent',ticket:ticket.ticket}})).statusCode,401);
    f.put(settings,{pk:'EMPLOYEE#'+owner,sk:'PROFILE'},{...f.actor,status:'SUSPENDED'});
    assert.equal((await f.call('a','$default',{action:'sync_sessions'})).statusCode,403);
    await assert.rejects(f.identity.createTicket(staff),/SUPPORT_PERMISSION_REQUIRED/);
});

test('customer receives private history and consistent receipts, while a different app user is refused',async()=>{
    const f=fixture();
    const socket=(id,role,token)=>f.call(id,'$connect',null,{headers:{Authorization:'Bearer '+token},queryStringParameters:{userType:role}});
    assert.equal((await socket('a','customer','customer-alpha')).statusCode,200);
    assert.equal((await socket('b','customer','customer-beta')).statusCode,200);
    assert.equal((await socket('foreign','merchant','customer-alpha')).statusCode,401);
    assert.equal((await f.call('token-query','$connect',null,{queryStringParameters:{userType:'customer',token:'customer-alpha'}})).statusCode,401);
    const sessionId='session1';
    await f.call('a','$default',{action:'chat_customer_connect',sessionId,customerId:'customer-alpha'});
    assert.equal(f.sent.at(-1).type,'chat_session_created');
    const text={action:'chat_message',sessionId,message:'رسالة خاصة',clientMessageId:'message-key'};
    await f.call('a','$default',text);
    const receipt=f.sent.findLast(row=>row.type==='message_ack');
    await f.call('a','$default',text);
    assert.equal(f.sent.at(-1).messageId,receipt.messageId);
    assert.equal(f.store.messages.size,1);
    assert.equal((await f.call('b','$default',{action:'get_session_messages',sessionId})).statusCode,403);
    assert.equal((await f.call('a','$default',{action:'get_session_messages',sessionId,requestId:'r1'})).statusCode,200);
    assert.equal(f.sent.at(-1).requestId,'r1');
    assert.match(f.sent.at(-1).messages[0].text,/رسالة خاصة/);
    f.put('lifecycle',{pk:'ACCOUNT_LIFECYCLE#CUSTOMER#customer-alpha',sk:'META'},{pk:'deleted'});
    assert.equal((await f.call('a','$default',text)).statusCode,403);
});

test('private attachments reject foreign and revoked participants before touching object storage',async()=>{
    const f=fixture();
    f.put('sessions',{sessionId:'session1'},{sessionId:'session1',userType:'customer',userId:'customer-alpha'});
    let s3Calls=0;
    const handler=createAttachments({db:f.db,s3:{async send(){s3Calls++;}},env,verify:f.identity.verifyJwt,
        authorizeMerchant:async()=>false,authorizePrincipal:async(p,right)=>{
            if(!await f.identity.isCurrent(p,right))throw Object.assign(Error('FORBIDDEN'),{status:403,code:'FORBIDDEN'});
        }});
    const call=token=>handler({httpMethod:'GET',headers:{Authorization:'Bearer '+token,'X-Support-User-Type':'customer'},queryStringParameters:{sessionId:'session1',attachmentId:'some-file'}});
    assert.equal((await call('customer-other')).statusCode,403);
    f.put('lifecycle',{pk:'ACCOUNT_LIFECYCLE#CUSTOMER#customer-alpha',sk:'META'},{lock:true});
    assert.equal((await call('customer-alpha')).statusCode,403);
    assert.equal(s3Calls,0);
});

test('staff reply saves one customer inbox notice and a retry does not send a second reply',async()=>{
    const f=fixture();
    const staff=await f.identity.createTicket({headers:{Authorization:'Bearer staff-access'}});
    assert.equal((await f.call('staff','$connect',null,{queryStringParameters:{userType:'agent',ticket:staff.ticket}})).statusCode,200);
    assert.equal((await f.call('customer','$connect',null,{headers:{Authorization:'Bearer customer-alpha'},
        queryStringParameters:{userType:'customer'}})).statusCode,200);
    const sessionId='reply-test';
    await f.call('customer','$default',{type:'chat_customer_connect',sessionId});
    await f.call('staff','$default',{type:'join_channel',sessionId});
    const frame={type:'chat_message',sessionId,messageText:'رد من الدعم',clientMessageId:'idempotent-reply'};
    await f.call('staff','$default',frame);
    await f.call('staff','$default',frame);
    assert.equal(f.store.messages.size,1);
    assert.equal(f.store.notices.size,1);
    const [notice]=f.store.notices.values();
    assert.equal(notice.type,'support_reply');
    assert.equal(notice.driverId,'customer-alpha');
    assert.equal(notice.sessionId,sessionId);
    const received=f.sent.filter(x=>x.connection==='customer'&&x.type==='chat_message');
    assert.equal(received.length,1);
    assert.equal(received[0].message.text,'رد من الدعم');
    const acks=f.sent.filter(x=>x.connection==='staff'&&x.type==='message_ack');
    assert.equal(acks.length,2);
    assert.equal(acks[0].messageId,acks[1].messageId);
    await f.call('staff','$default',{type:'chat_session_close',sessionId});
    assert.equal(f.read('sessions',{sessionId}).status,'closed');
});

test('a customer deletion lock acquired after staff reads the conversation blocks the reply transaction',async()=>{
    const f=fixture();
    const ticket=await f.identity.createTicket({headers:{Authorization:'Bearer staff-access'}});
    await f.call('staff','$connect',null,{queryStringParameters:{userType:'agent',ticket:ticket.ticket}});
    await f.call('customer','$connect',null,{headers:{Authorization:'Bearer customer-alpha'},queryStringParameters:{userType:'customer'}});
    const sessionId='closing-customer';
    await f.call('customer','$default',{type:'chat_customer_connect',sessionId});
    const send=f.db.send.bind(f.db);
    let reachedCommit=false;
    f.db.send=async command=>{
        if(command.input.TransactItems?.some(op=>op.Put?.TableName==='messages')){
            reachedCommit=true;
            f.put('lifecycle',{pk:'ACCOUNT_LIFECYCLE#CUSTOMER#customer-alpha',sk:'META'},{state:'CLOSING'});
        }
        return send(command);
    };
    await f.call('staff','$default',{type:'chat_message',sessionId,messageText:'رد متزامن',clientMessageId:'late'});
    assert.equal(reachedCommit,true);
    assert.equal(f.store.messages.size,0);
    assert.equal(f.store.receipts.size,0);
    assert.equal(f.store.notices.size,0);
});

test('a customer deletion lock acquired during upload authorization prevents the object write',async()=>{
    const f=fixture();
    const sessionId='upload-race';
    f.put('sessions',{sessionId},{sessionId,userType:'customer',userId:'customer-alpha',customerId:'customer-alpha',status:'active'});
    let reserved=false;
    const send=f.db.send.bind(f.db);
    f.db.send=async command=>{
        if(command.input.TransactItems?.some(op=>op.Put?.TableName==='images')){
            reserved=true;
            f.put('lifecycle',{pk:'ACCOUNT_LIFECYCLE#CUSTOMER#customer-alpha',sk:'META'},{state:'CLOSING'});
        }
        return send(command);
    };
    let objectWrites=0;
    const upload=createAttachments({db:f.db,s3:{async send(){objectWrites++;}},env,verify:f.identity.verifyJwt,
        authorizePrincipal:async()=>{},authorizeMerchant:async()=>false});
    const response=await upload({httpMethod:'POST',headers:{Authorization:'Bearer customer-alpha','X-Support-User-Type':'customer'},
        body:JSON.stringify({sessionId,uploadId:'12345678-0000-4000-8000-000000000091',contentType:'image/png',
            dataBase64:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACklEQVR4nGNgAAAAAgABSK+kcQAAAABJRU5ErkJggg=='})});
    assert.equal(reserved,true);
    assert.equal(response.statusCode,409);
    assert.equal(f.store.images.size,0);
    assert.equal(objectWrites,0);
});
