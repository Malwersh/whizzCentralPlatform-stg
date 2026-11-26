'use strict';

const {test} = require('node:test');
const assert = require('node:assert/strict');
const {createApi} = require('./api.cjs');

const prefix = 'wizz-production-';
const env = {ENVIRONMENT:'production', MERCHANT_STAFF_PERMISSION_MODE:'CENTRAL', PRODUCTS_TABLE:prefix+'Products',
  MERCHANT_PLATFORM_TABLE:prefix+'MerchantPlatform', BUSINESSES_TABLE:prefix+'Merchants',
  CATEGORIES_TABLE:prefix+'MenuCategories', DISCOVERY_TABLE:prefix+'PlatformStaff'};
const branch = 'branch1';
const requestId = '11111111-1111-4111-8111-111111111111';
const branchKey = {businessId:branch};
const days = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
const week = Object.fromEntries(days.map((day,index) => [day,{isOpen:index===1,openTime:'09:00',closeTime:'17:00'}]));
const defaultPermission = ['menu.read','menu.create','menu.edit','menu.delete','menu.price.write','menu.availability.write','hours.read','hours.write'];

function fixture({permissions=defaultPermission, revokeOnCommit=false, branchOverride={}}={}) {
  const rows = new Map(), transactions = [], checked = [];
  const key = value => JSON.stringify(value);
  const put = (table,k,row) => rows.set(table+'|'+key(k),row);
  const get = (table,k) => rows.get(table+'|'+key(k));
  const product = {productId:'product1',businessId:branch,categoryId:'cat1',name:'قديم',price:2500,isAvailable:true};
  put('Merchants',branchKey,{...branchKey,ownerId:'owner',cognitoUserId:'owner',status:'approved',...branchOverride});
  put('Products',{productId:'product1'},product);
  put('Products',{productId:'unrelated'}, {...product,productId:'unrelated',businessId:'foreign'});
  put('MenuCategories',{categoryId:'cat1'},{categoryId:'cat1',businessId:branch,isActive:true});
  const pk = 'BRANCH#'+branch;
  const needKeys={Merchants:['businessId'],WorkingHours:['businessId','weekday'],MerchantPlatform:['pk','sk'],Products:['productId']};
  const db = {async send(command) {
    const input=command.input;
    if (input.TransactItems) {
      transactions.push(input.TransactItems);
      const identities=input.TransactItems.map(op => {
        const row=Object.values(op)[0], table=row.TableName.replace(prefix,'');
        assert.ok(row.TableName.startsWith(prefix),row.TableName);
        return row.TableName+':'+key(row.Key??Object.fromEntries(needKeys[table].map(k=>[k,row.Item[k]])));
      });
      assert.equal(new Set(identities).size,identities.length,'duplicate DynamoDB item');
      for (const item of input.TransactItems) {
        if (item.Put) {
          const {TableName,Item}=item.Put,table=TableName.replace(prefix,'');
          put(table,Object.fromEntries(needKeys[table].map(k=>[k,Item[k]])),Item);
        }
        if (item.Update) {
          const {TableName,Key,UpdateExpression,ExpressionAttributeNames={},ExpressionAttributeValues={}}=item.Update;
          const table=TableName.replace(prefix,'');
          const row={...(get(table,Key)??Key)};
          if (table==='MerchantPlatform' && Key.sk==='MENU_DRAFT#META') row.version=(row.version??0)+1;
          else for (const assign of UpdateExpression.slice(4).split(/,\s*/)) {
            const [name,value]=assign.split('=').map(x=>x.trim());
            row[ExpressionAttributeNames[name]??name]=ExpressionAttributeValues[value];
          }
          put(table,Key,row);
        }
        if (item.Delete) rows.delete(item.Delete.TableName.replace(prefix,'')+'|'+key(item.Delete.Key));
      }
      return {};
    }
    assert.ok(input.TableName.startsWith(prefix));
    if (input.FilterExpression) return {Items:[...rows.entries()].filter(([k,v])=>k.startsWith('Products|')&&v.businessId===branch).map(x=>x[1])};
    return {Item:get(input.TableName.replace(prefix,''),input.Key)};
  }};
  const authorize = async (event, businessId, required) => {
    checked.push(required);
    if (event.headers?.Authorization !== 'paired' || event.headers?.['X-Staff-Session'] !== 'staff' || revokeOnCommit&&checked.length>1) {
      throw Object.assign(Error('SESSION_REVOKED'),{status:401});
    }
    if (businessId!==branch || required.some(permission => !permissions.includes(permission))) {
      throw Object.assign(Error('PERMISSION_REQUIRED'),{status:403});
    }
    return {actor:{ownerId:'owner',subjectId:'employee',guards:[{ConditionCheck:{TableName:prefix+'Merchants',Key:branchKey,
      ConditionExpression:'ownerId=:owner',ExpressionAttributeValues:{':owner':'owner'}}}]},
      actorName:'موظف الفرع',roleName:'مدير',deviceId:'device1',sessionId:'session1',
      scopeHash:'guard1',membershipVersion:2,policyVersion:3,permissions};
  };
  const handler=createApi({db,authorize,env,catalogRead:async(actor,event)=>({
    statusCode:200,body:JSON.stringify({branch:actor.businessId,path:event.path})
  })});
  const invoke = async (path,method='GET',body,options={}) => {
    const response=await handler({requestContext:{stage:'production'},path:'/branch-device'+path,httpMethod:method,
      headers:{Authorization:'paired','X-Staff-Session':'staff'},queryStringParameters:method==='GET'&&!path.includes('/working-hours')?{businessId:branch}:undefined,
      ...(body?{body:JSON.stringify({businessId:branch,...body})}:{}),...options});
    return {status:response.statusCode,body:JSON.parse(response.body)};
  };
  return {invoke,transactions,checked,get,put,pk};
}

test('a scoped employee can list catalog and categories but cannot inspect a foreign product', async () => {
  const f=fixture({permissions:['menu.read']});
  assert.deepEqual((await f.invoke('/products')).body,{branch,path:'/products'});
  assert.equal((await f.invoke('/categories')).status,200);
  assert.equal((await f.invoke('/products/product1')).body.product.id,'product1');
  assert.equal((await f.invoke('/products/unrelated')).status,404);
  assert.equal((await f.invoke('/products','GET',null,{headers:{Authorization:'paired'}})).status,401);
  assert.equal((await f.invoke('/products/product1','PUT',{price:3000,requestId})).status,403);
  assert.equal(f.transactions.length,0);
});

test('a price change uses staging menu publication with a single merged branch guard', async () => {
  const f=fixture({permissions:['menu.read','menu.price.write']});
  const result=await f.invoke('/products/product1','PUT',{price:4500,requestId});
  assert.equal(result.status,200,JSON.stringify(result));
  assert.equal(result.body.publication?.status,'published',JSON.stringify(result));
  assert.equal(f.get('Products',{productId:'product1'}).price,4500);
  const pointer=f.get('MerchantPlatform',{pk:f.pk,sk:'MENU_VERSION#ACTIVE'});
  assert.equal(f.get('MerchantPlatform',{pk:f.pk,sk:'MENU_VERSION#'+pointer.publishedVersion+'#PRODUCT#product1'}).product.price,4500);
  const guard=f.transactions.at(-1).find(op=>op.Update?.TableName===prefix+'Merchants').Update;
  assert.match(guard.ConditionExpression, /ownerId=/);
  assert.equal((await f.invoke('/products/product1','PUT',{name:'مرفوض',price:5000,requestId})).status,403);
  const prior=f.transactions.length;
  assert.equal((await f.invoke('/products/product1','PUT',{imageUrl:'https://example.com/image.png',requestId})).status,400);
  assert.equal(f.transactions.length,prior);
});

test('staff create and delete publish the same branch menu and record the actor', async () => {
  const f=fixture();
  const creation=await f.invoke('/products','POST',{categoryId:'cat1',name:'جديد',price:3500,requestId});
  assert.equal(creation.status,201,JSON.stringify(creation));
  assert.equal(creation.body.publication?.status,'published');
  const productId=creation.body.product.productId;
  const deletion=await f.invoke('/products/'+productId,'DELETE',{});
  assert.equal(deletion.status,200,JSON.stringify(deletion));
  assert.equal(deletion.body.publication?.status,'published');
  const audit=f.transactions.flat().filter(op=>op.Put?.Item.actorId==='employee').map(op=>op.Put.Item.action);
  assert.ok(audit.includes('MENU_PRODUCT_CREATED')&&audit.includes('MENU_PRODUCT_DELETED'));
});

test('the working-hours update fences the displayed week and both production representations', async () => {
  const f=fixture({permissions:['hours.read','hours.write']});
  const path='/businesses/'+branch+'/working-hours';
  const initial=await f.invoke(path);
  assert.equal(initial.body.workingHours.monday.isClosed,true);
  assert.equal((await f.invoke(path,'PUT',{workingHours:week,hoursVersion:'stale'})).body.code,'WORKING_HOURS_CHANGED');
  const saved=await f.invoke(path,'PUT',{workingHours:week,hoursVersion:initial.body.hoursVersion});
  assert.equal(saved.status,200,JSON.stringify(saved));
  const [tx]=f.transactions;
  assert.equal(tx.filter(op=>op.Put?.TableName===prefix+'WorkingHours').length,7);
  assert.equal(f.get('WorkingHours',{businessId:branch,weekday:'Monday'}).opening,'09:00');
  assert.deepEqual(f.get('Merchants',branchKey).openingHours[1].periods,[{open:'09:00',close:'17:00'}]);
  const audit=tx.find(op=>op.Put?.Item.action==='BRANCH_HOURS_CHANGED').Put.Item;
  assert.equal(audit.actorId,'employee');
  assert.equal(audit.after.days.find(day=>day.weekday==='Monday').opening,'09:00');
  assert.equal((await f.invoke(path,'PUT',{workingHours:week,hoursVersion:initial.body.hoursVersion})).status,409);
  assert.equal((await f.invoke('/businesses/foreign/working-hours')).status,403);
});

test('lost PIN authority cannot change either hours or product state', async () => {
  const product=fixture({revokeOnCommit:true});
  assert.equal((await product.invoke('/products/product1','PUT',{price:4500,requestId})).status,401);
  assert.equal(product.transactions.length,0);
  const known=fixture();
  const path='/businesses/'+branch+'/working-hours';
  const {body:{hoursVersion}}=await known.invoke(path);
  const hours=fixture({revokeOnCommit:true});
  assert.equal((await hours.invoke(path,'PUT',{workingHours:week,hoursVersion})).status,401);
  assert.equal(hours.transactions.length,0);
});
