// Lightweight Data Service wrapper around AWSUtils with safe fallbacks.
// Provides a consistent API used by dashboard and promotions pages without forcing redirects.

(function () {
    console.log('Loading data-service.js...');

    const TABLES = {
        businesses: 'WhizzMerchants_Businesses',
        discounts: 'WhizzMerchants_Discounts',
        platformDiscounts: 'WizzCentral_Platform_Discounts', // Platform-wide discounts managed by central platform
        campaigns: 'WizzCentral_Campaigns', // Special campaigns (first order, new customer, etc.)
        drivers: 'WhizzDrivers_staging',
        orders: 'WizzOrders', // Using transactions as proxy for orders
        customers: 'WizzUser_users_staging',
        supportTickets: 'wizzcentral-backend-support-tickets-staging' // Using the proper support tickets table
    };

    // Helper to detect errors that suggest missing table or lacking permissions
    function _shouldFallbackPlatformTable(err) {
        const msg = (err && (err.message || err.code || String(err))) || '';
        const s = msg.toLowerCase();
        return (
            s.includes('resourcenotfound') ||
            s.includes('requested resource not found') ||
            s.includes('cannot do operations on a non-existent table') ||
            s.includes('accessdenied') ||
            s.includes('not authorized') ||
            s.includes('missing authentication')
        );
    }

    let _cachedClient = null;
    let _initPromise = null;

    async function getClientSafe() {
        if (!window.AWSUtils) throw new Error('AWS utilities unavailable.');
        return window.AWSUtils.getDynamoDBClient();
    }

    async function listTables() {
        const client = await getClientSafe();
        if (!client) return [];
        try {
            const ddb = new AWS.DynamoDB();
            const res = await ddb.listTables({}).promise();
            return res?.TableNames || [];
        } catch (e) {
            console.warn('listTables failed:', e?.message || e);
            return [];
        }
    }

    async function scan(tableName, params = {}) {
        const client = await getClientSafe();
        const items = [];
        let key, count = 0;
        do {
            const page = await client.scan({ TableName: tableName, ...params,
                ...(key ? { ExclusiveStartKey: key } : {}) }).promise();
            items.push(...(page.Items || []));
            count += page.Count || 0;
            key = page.LastEvaluatedKey;
        } while (key);
        return { Items: items, Count: count };
    }

    async function putDocumentItem(tableName, item) {
        console.log('DEBUG: putDocumentItem table:', tableName);
        console.log('DEBUG: putDocumentItem item keys:', Object.keys(item).join(', '));
        
        // Enhanced client retrieval with retry logic
        let client = await getClientSafe();
        
        // If client is unavailable, try to reinitialize once
        if (!client) {
            console.warn('WARN: DynamoDB client unavailable, attempting reinitialization...');
            _cachedClient = null;
            _initPromise = null;
            
            try {
                // Force re-initialization
                if (window.AWSUtils) {
                    window.AWSUtils.isInitialized = false;
                    window.AWSUtils.dynamodbClient = null;
                    await window.AWSUtils.initialize();
                }
                client = await getClientSafe();
            } catch (reinitError) {
                console.error('ERROR: Failed to reinitialize AWS client:', reinitError.message);
            }
        }
        
        if (!client) {
            const msg = 'DynamoDB client unavailable, cannot save item. Check AWS credentials and initialization.';
            console.error('ERROR:', msg);
            console.error('TROUBLESHOOTING: 1) Run enhanced DynamoDB fix script, 2) Verify AWS credentials, 3) Check IAM permissions');
            console.error('FIX SCRIPT: await fetch("/enhanced-dynamodb-fix.js").then(r => r.text()).then(eval)');
            throw new Error(msg);
        }
        
        try {
            const startTime = Date.now();
            await client.put({ TableName: tableName, Item: item }).promise();
            const duration = Date.now() - startTime;
            console.log(`SUCCESS: DocumentClient.put succeeded in ${duration}ms`);
            return true;
        } catch (e) {
            // Surface AWS error details upstream with enhanced messaging
            const awsMsg = e?.message || e?.code || String(e);
            console.error('ERROR: DocumentClient.put failed:', awsMsg, e);
            console.error('TABLE:', tableName, 'ITEM_KEYS:', Object.keys(item));
            
            // Provide specific guidance based on error type
            if (awsMsg.includes('AccessDenied') || awsMsg.includes('not authorized')) {
                console.error('💡 SOLUTION: This appears to be an IAM permissions issue');
                console.error('   Check that the authenticated role has DynamoDB write permissions');
            } else if (awsMsg.includes('ResourceNotFoundException')) {
                console.error('💡 SOLUTION: Table does not exist:', tableName);
                console.error('   Verify the table name or create the table in DynamoDB');
            }
            
            throw new Error(`DynamoDB put failed: ${awsMsg}`);
        }
    }

    // New: delete helper using DocumentClient.delete
    async function deleteDocumentItem(tableName, key) {
        const client = await getClientSafe();
        if (!client) {
            const msg = 'DynamoDB client unavailable, cannot delete item';
            console.error('ERROR:', msg);
            throw new Error(msg);
        }
        try {
            const startTime = Date.now();
            await client.delete({ TableName: tableName, Key: key }).promise();
            const duration = Date.now() - startTime;
            console.log(`SUCCESS: DocumentClient.delete succeeded in ${duration}ms`);
            return true;
        } catch (e) {
            const awsMsg = e?.message || e?.code || String(e);
            console.error('ERROR: DocumentClient.delete failed:', awsMsg, e);
            throw new Error(awsMsg);
        }
    }

    // Replace old putItem to call DocumentClient.put for backward compatibility
    async function putItem(tableName, item) {
        return putDocumentItem(tableName, item);
    }

    async function getRecentBusinesses(limit = 5) {
        // Try DynamoDB; if unavailable, return demo data instead of failing
        const res = await scan(TABLES.businesses, { Limit: 50 });
        let items = Array.isArray(res.Items) ? res.Items : [];

        // Normalize and sort by joinDate desc when available
        items = items.map(b => ({
            name: b.name || b.businessName || 'Business',
            joinDate: b.joinDate || b.createdAt || b.updatedAt || null,
        }));

        items.sort((a, b) => new Date(b.joinDate || 0) - new Date(a.joinDate || 0));

        return items.slice(0, limit);
    }

    async function getMerchantDiscounts(forceFresh = false) {
        const res = await scan(TABLES.discounts, { Limit: 100 });
        const items = Array.isArray(res.Items) ? res.Items : [];
        return items;
    }

    async function getBusinesses(forceFresh = false) {
        const res = await scan(TABLES.businesses, { Limit: 100 });
        const items = Array.isArray(res.Items) ? res.Items : [];
        return items;
    }

    // Platform Discount Functions
    async function getPlatformDiscounts() {
        const result = await scan(TABLES.platformDiscounts, {Limit:100});
        return Array.isArray(result.Items) ? result.Items : [];
    }


    // All campaign writes use the existing staff service. Browser DynamoDB reads remain unchanged.
    const campaignPending=new Map();
    const campaignStable=v=>Array.isArray(v)?v.map(campaignStable):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,campaignStable(v[k])])):v;
    function campaignAccount(){const token=window.Auth.getToken('accessToken');try{const v=JSON.parse(atob(token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/')));if(typeof v.sub!=='string')throw Error();return v.sub;}catch{throw Error('يرجى تسجيل الدخول مجددًا.');}}
    async function campaignApi(body,source,id){
        await window.Auth.ensureSession();const token=window.Auth.getToken('accessToken'),controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20000);
        try{const response=await fetch(window.WIZZCENTRAL_CONFIG.STAFF_API_BASE_URL+'/staff/promotions'+(body?'':'?source='+encodeURIComponent(source)+'&discountId='+encodeURIComponent(id)),{method:body?'POST':'GET',signal:controller.signal,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});const data=await response.json();if(window.Auth.getToken('accessToken')!==token)throw Error('تغيرت جلسة الدخول. أعد تحميل الصفحة.');if(!response.ok){const messages={VERSION_OR_STATE_CONFLICT:'تغير الخصم أو استخدامه. حدّث القائمة ثم أعد المحاولة.',PERMISSION_REQUIRED:'ليست لديك صلاحية تعديل هذه العروض.',REGION_SCOPE_REQUIRED:'العرض خارج نطاق المناطق المسموح لك بها.',REQUEST_ID_CONFLICT:'تعارضت محاولة الحفظ. أعد تحميل القائمة.',CAMPAIGN_FIELDS_INVALID:'تحقق من حقول العرض.',CAMPAIGN_PERIOD_INVALID:'تحقق من بداية العرض ونهايته.',CAMPAIGN_REGION_UNAVAILABLE:'منطقة العرض غير متاحة.',CAMPAIGN_RETENTION_HOLD:'هذا العرض محجوز للاحتفاظ.'};const error=Error(messages[data.error]||'تعذر حفظ العرض. تحقق من القيم والصلاحيات.');error.status=response.status;throw error;}return data;}finally{clearTimeout(timer);}
    }
    const campaignRead=(source,id)=>campaignApi(null,source,id);
    async function campaignMutation(source,id,action,values,requestId){
        await window.Auth.ensureSession();const account=campaignAccount(),signature=JSON.stringify(campaignStable({account,source,id,action,values:values||null}));let body=campaignPending.get(signature);
        if(!body){const previous=action==='CREATE'?null:await campaignRead(source,id);if(account!==campaignAccount())throw Error('تغيرت جلسة الدخول.');body={source,discountId:id,action,requestId:requestId||crypto.randomUUID(),...(previous?{baseRevision:previous.revision}:{}),...(values?{values}:{})};campaignPending.set(signature,body);}
        try{const result=await campaignApi(body);campaignPending.delete(signature);return result;}catch(e){if(e.status===409)campaignPending.delete(signature);throw e;}
    }

    // REMOVED: createPlatformDiscount function - use createCampaign instead for unified functionality

    async function updatePlatformDiscount(id,values) { return campaignMutation('PLATFORM',id,'UPDATE',values); }

    async function deletePlatformDiscount(id) { return campaignMutation('PLATFORM',id,'DELETE'); }

    // Merchant Discounts CRUD (limited)
    async function updateMerchantDiscount(id,values) { return campaignMutation('MERCHANT',id,'UPDATE',values); }

    async function deleteMerchantDiscount(id) { return campaignMutation('MERCHANT',id,'DELETE'); }

    // Added: Fetch drivers from DynamoDB (WhizzDrivers_staging)
    async function getDrivers(limit = 100) {
        const res = await scan(TABLES.drivers, { Limit: limit });
        const items = Array.isArray(res.Items) ? res.Items : [];
        return items;
    }

    async function getOrders(limit = 100) {
        const res = await scan(TABLES.orders, { Limit: limit });
        const items = Array.isArray(res.Items) ? res.Items : [];
        return items;
    }

    async function getCustomers(limit = 100) {
        const res = await scan(TABLES.customers, { Limit: limit });
        const items = Array.isArray(res.Items) ? res.Items : [];
        return items;
    }

    async function getSupportTickets(limit = 100) {
        const res = await scan(TABLES.supportTickets, { Limit: limit });
        const items = Array.isArray(res.Items) ? res.Items : [];
        return items;
    }

    async function createSupportTicket(ticketData) {
        // Generate a unique ticket ID
        const ticketId = 'TKT-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
        
        const item = {
            ticketId: { S: ticketId },
            customerEmail: { S: ticketData.customerEmail || '' },
            customerName: { S: ticketData.customerName || 'Unknown Customer' },
            subject: { S: ticketData.subject || '' },
            description: { S: ticketData.description || '' },
            category: { S: ticketData.category || 'general' },
            priority: { S: ticketData.priority || 'medium' },
            status: { S: ticketData.status || 'open' },
            assignedTo: { S: ticketData.assignedTo || 'Unassigned' },
            createdAt: { S: new Date().toISOString() },
            updatedAt: { S: new Date().toISOString() }
        };

        const success = await putItem(TABLES.supportTickets, item);
        if (success) {
            console.log('✅ Support ticket created successfully:', ticketId);
            return {
                id: ticketId,
                ticketId: ticketId,
                customerEmail: ticketData.customerEmail,
                customerName: ticketData.customerName,
                subject: ticketData.subject,
                description: ticketData.description,
                category: ticketData.category,
                priority: ticketData.priority,
                status: ticketData.status || 'open',
                assignedTo: ticketData.assignedTo || 'Unassigned',
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            };
        } else {
            console.error('❌ Failed to create support ticket');
            return null;
        }
    }

    // Campaign Management Functions
    async function getCampaigns({ strict = false } = {}) {
        console.log('INFO: Getting all campaigns from unified platform discounts table...');
        try {
            const client = await getClientSafe();
            if (!client) {
                if (strict) throw new Error('Please sign in again to load campaigns.');
                console.warn('No DynamoDB client available for campaigns');
                return [];
            }

            // The table is authoritative for platform ownership. Legacy records may
            // have a missing or obsolete discountSource tag but remain redeemable.
            const result = await scan(TABLES.platformDiscounts);
            console.log(`✅ Retrieved ${result.Items?.length || 0} campaigns from unified table`);
            
            return (result.Items || []).filter(item => !item.isDeleted && item.deletedAt == null && item.deletionRequestId == null).map(item => ({
                id: item.discountId,
                discountId: item.discountId,
                campaignId: item.campaignId || item.discountId,
                title: item.title || item.name,
                version: item.version ?? null,
                fundingPolicyId: item.fundingPolicyId ?? null,
                fundingPolicyVersion: item.fundingPolicyVersion ?? null,
                code: item.code || '',
                type: item.campaignType || item.type || '',
                discountType: item.discountType || 'percentage',
                discountValue: item.discountValue || item.value || 0,
                target: item.target || '',
                targetRegionIds: item.targetRegionIds || [],
                targetLocation: item.targetLocation || '',
                customerSegments: item.customerSegments || ['all'],
                campaignType: item.campaignType || '',
                targetRestaurants: item.targetRestaurants || [],
                targetSegments: item.targetSegments || [],
                occasions: item.occasions || [],
                status: item.status || 'draft',
                isActive: item.isActive || false,
                usage: item.usage || item.currentUsage || 0,
                usageLimit: item.usageLimit || item.limit || 0,
                minOrderValue: item.minOrderValue || item.minOrderAmount || 0,
                startDate: item.startDate || '',
                endDate: item.endDate || '',
                validFrom: item.validFrom || '',
                validTo: item.validTo || '',
                description: item.description || '',
                autoActivate: item.autoActivate || false,
                singleUse: item.singleUse || false,
                stackable: item.stackable || false,
                createdAt: item.createdAt || new Date().toISOString(),
                updatedAt: item.updatedAt || new Date().toISOString()
            }));
        } catch (error) {
            console.error('Error getting campaigns:', error);
            if (strict) throw error;
            if (_shouldFallbackPlatformTable(error)) {
                console.warn('Using fallback data for campaigns');
                return [];
            }
            throw error;
        }
    }

    async function getCampaignById(campaignId) {
        console.log(`INFO: Getting campaign ${campaignId} from unified platform discounts table...`);
        try {
            const client = await getClientSafe();
            if (!client) {
                console.warn('No DynamoDB client available for campaign lookup');
                return null;
            }

            // Use discountId as the primary key since campaigns are stored with discountId
            const params = {
                TableName: TABLES.platformDiscounts,
                Key: { discountId: campaignId }
            };

            const result = await client.get(params).promise();
            const item = result.Item;
            
            // Use the same ownership and deletion rules as the campaign list.
            if (item && !item.isDeleted && item.deletedAt == null && item.deletionRequestId == null) {
                return item;
            }
            
            return null;
        } catch (error) {
            console.error(`Error getting campaign ${campaignId}:`, error);
            return null;
        }
    }

    async function campaignRequest(request) {
        let timer;
        try {
            return await Promise.race([
                request.promise(),
                new Promise((_, reject) => { timer = setTimeout(() => {
                    reject(new Error('The save could not be confirmed. Retry without changing the form to check the same campaign.'));
                    request.abort();
                }, 20000); })
            ]);
        } finally { clearTimeout(timer); }
    }

    async function createCampaign(data) { const {requestId,discountId,campaignId,id,createdAt,createdBy,...values}=data; const key=discountId||campaignId||id||('campaign_'+crypto.randomUUID());return campaignMutation('PLATFORM',key,'CREATE',values,requestId); }

    async function updateCampaign(id,values) { return campaignMutation('PLATFORM',id,'UPDATE',values); }

    async function deleteCampaign(id) { await campaignMutation('PLATFORM',id,'DELETE');return true; }

    window.dataService = {
        initialize: async () => {
            // Do not redirect here; rely on AWSUtils behavior
            await getClientSafe();
            return true;
        },
        scan,
        getRecentBusinesses,
        getMerchantDiscounts,
        getBusinesses,
        // Back-compat alias
        getAllBusinesses: getBusinesses,
        getPlatformDiscounts,
        // UNIFIED: Use createCampaign for all campaign/discount creation
        createCampaign,
        // Legacy alias for backward compatibility - redirects to createCampaign
        createPlatformDiscount: createCampaign,
        updatePlatformDiscount,
        deletePlatformDiscount,
        updateMerchantDiscount,
        deleteMerchantDiscount,
        getDrivers,
        getOrders,
        getCustomers,
        getSupportTickets,
        createSupportTicket,
        // Campaign management functions
        getCampaigns,
        updateCampaign,
        deleteCampaign,
        getCampaignById,
        listTables,
        // Debug helper passthrough
        getDynamoDBClient: async () => {
            try { return await AWSUtils.getDynamoDBClient(); } catch (_) { return null; }
        },
    };

    console.log('data-service.js ready');
})();
