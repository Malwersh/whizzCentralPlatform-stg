'use strict';

const {createHash,randomBytes}=require('node:crypto');
const {GetCommand,PutCommand,DeleteCommand}=require('@aws-sdk/lib-dynamodb');
const {allowed}=require('../staff-service/catalog');
const {authenticateStaff}=require('../../infrastructure/production/admin-session/live-admin.cjs');
const {normalizeRole,principalFromClaims,isTrustedConnection}=require('./support-access');

const as = (status,code) => Object.assign(Error(code),{status,code});
const hash = token => createHash('sha256').update(token).digest('hex');
const key = token => ({subscriptionId:'TICKET#'+hash(token)});
const read=async (db,TableName,Key)=>(await db.send(new GetCommand({TableName,Key,ConsistentRead:true}))).Item;

function createIdentity({db,env,verifyStaff,getStaff,verifyApp,now=Date.now,nonce=()=>randomBytes(32).toString('base64url')}) {
    async function isCurrent(principal,permission) {
        if (!isTrustedConnection(principal)) return false;
        if (principal.userType==='agent') {
            const current=await read(db,env.SUPPORT_SETTINGS_TABLE,{pk:'EMPLOYEE#'+principal.authSubject,sk:'PROFILE'});
            return current?.employeeId===principal.authSubject && current.status==='ACTIVE' &&
                current.scope?.allRegions===true && !current.deletedAt && !current.deletionRequestId && current.isDeleted!==true &&
                Number.isSafeInteger(current.minimumAuthTime??0) && Number.isSafeInteger(principal.staffAuthTime) &&
                (current.minimumAuthTime??0)<=principal.staffAuthTime && allowed(current,permission);
        }
        return !await read(db,env.SUPPORT_LIFECYCLE_TABLE,{pk:'ACCOUNT_LIFECYCLE#'+principal.userType.toUpperCase()+'#'+principal.authSubject,sk:'META'});
    }

    async function verifyJwt(token,requested) {
        const role=normalizeRole(requested);
        if (!role || typeof token!=='string' || !token || token.length>8200) throw as(401,'UNAUTHORIZED');
        if (role!=='agent') return verifyApp(role,token);
        const {claims,actor}=await authenticateStaff({headers:{Authorization:'Bearer '+token}},
            {verifyStaff,getStaff},db,now,'support.read','SUPPORT_PERMISSION_REQUIRED');
        return {...claims,'cognito:groups':['support'],supportStaffAuthTime:claims.auth_time,
            supportStaffDisplayName:String(actor.name||actor.displayName||'فريق الدعم').slice(0,120)};
    }

    async function createTicket(event) {
        const headers=Object.entries(event.headers??{}).filter(([name])=>name.toLowerCase()==='authorization');
        const auth=headers.length===1 && typeof headers[0][1]==='string' ? /^Bearer (\S+)$/i.exec(headers[0][1])?.[1] : undefined;
        const principal=principalFromClaims(await verifyJwt(auth,'agent'),'agent');
        const seconds=Math.floor(now()/1000);
        const token=nonce();
        const ttl=Math.min(seconds+60,principal.authExpiresAt);
        if (ttl<=seconds || !await isCurrent(principal,'support.read')) throw as(401,'UNAUTHORIZED');
        await db.send(new PutCommand({TableName:env.WEBSOCKET_SUBSCRIPTIONS_TABLE,
            Item:{...key(token),principal,ttl},ConditionExpression:'attribute_not_exists(subscriptionId)'}));
        return {ticket:token,expiresAt:ttl};
    }

    async function consumeTicket(ticket) {
        if (typeof ticket!=='string'||!/^[\w-]{43}$/.test(ticket)) throw as(401,'UNAUTHORIZED');
        try {
            const result=await db.send(new DeleteCommand({TableName:env.WEBSOCKET_SUBSCRIPTIONS_TABLE,Key:key(ticket),
                ConditionExpression:'#ttl>:at',ExpressionAttributeNames:{'#ttl':'ttl'},
                ExpressionAttributeValues:{':at':Math.floor(now()/1000)},ReturnValues:'ALL_OLD'}));
            if (result.Attributes?.principal?.userType!=='agent') throw as(401,'UNAUTHORIZED');
            return result.Attributes.principal;
        } catch (error) {
            if (error.name==='ConditionalCheckFailedException') throw as(401,'UNAUTHORIZED');
            throw error;
        }
    }

    return {verifyJwt,isCurrent,createTicket,consumeTicket};
}

module.exports={createIdentity};
