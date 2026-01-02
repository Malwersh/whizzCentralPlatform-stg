// Lightweight Data Service wrapper around AWSUtils with safe fallbacks.
// Provides a consistent API used by dashboard and promotions pages without forcing redirects.

(function () {
    console.log('Loading data-service.js...');

    const TABLES = {
        businesses: 'WhizzMerchants_Businesses',
        discounts: 'WhizzMerchants_Discounts',
        platformDiscounts: 'WizzCentral_Platform_Discounts', // Platform-wide discounts managed by central platform
        campaigns: 'WizzCentral_Campaigns', // Special campaigns (first order, new customer, etc.)
        drivers: 'WhizzDrivers_dev',
        orders: 'WizzUser_transactions_dev', // Using transactions as proxy for orders
        customers: 'WizzUser_users_dev',
        supportTickets: 'wizzcentral-backend-support-tickets-dev' // Using the proper support tickets table
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
        // Return cached client if available
        if (_cachedClient) {
            return _cachedClient;
        }

        // Prevent multiple concurrent initializations
        if (_initPromise) {
            return await _initPromise;
        }

        _initPromise = (async () => {
            try {
                console.log('INFO: Initializing DynamoDB client...');
                
                if (!window.AWSUtils) {
                    throw new Error('AWSUtils not loaded - check script loading order');
                }
                
                // Initialize AWS with retry logic
                let initAttempts = 0;
                const maxAttempts = 3;
                
                while (initAttempts < maxAttempts) {
                    try {
                        await AWSUtils.initialize();
                        break;
                    } catch (initError) {
                        initAttempts++;
                        console.warn(`AWS init attempt ${initAttempts}/${maxAttempts} failed:`, initError.message);
                        if (initAttempts >= maxAttempts) throw initError;
                        await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1s between retries
                    }
                }
                
                const client = await AWSUtils.getDynamoDBClient();
                if (!client) {
                    throw new Error('DynamoDB client unavailable - check AWS credentials and permissions');
                }
                
                console.log('SUCCESS: DynamoDB client initialized');
                _cachedClient = client;
                return client;
            } catch (e) {
                console.error('ERROR: Failed to initialize DynamoDB client:', e?.message || e);
                _initPromise = null; // Reset promise on error
                return null;
            }
        })();

        return await _initPromise;
    }

    // Debug: list DynamoDB tables using low-level client
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
        if (!client) {
            return { Items: [], Count: 0 };
        }
        const req = {
            TableName: tableName,
            ...params,
        };
        try {
            const res = await client.scan(req).promise();
            return res || { Items: [], Count: 0 };
        } catch (e) {
            console.error('data-service scan error:', e);
            return { Items: [], Count: 0 };
        }
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

        if (items.length === 0) {
            // Fallback demo data
            const now = Date.now();
            items = [1, 2, 3, 4, 5].map(i => ({
                name: `Demo Business ${i}`,
                joinDate: new Date(now - i * 86400000).toISOString()
            }));
        }

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
    async function getPlatformDiscounts(forceFresh = false) {
        // Try the dedicated platform table first
        const primary = await scan(TABLES.platformDiscounts, { Limit: 100 });
        const primaryItems = Array.isArray(primary.Items) ? primary.Items : [];
        if (primaryItems.length > 0) return primaryItems;
        // Fallback: use merchant discounts table where discountSource == 'platform'
        const fallback = await scan(TABLES.discounts, {
            Limit: 100,
            FilterExpression: 'discountSource = :src',
            ExpressionAttributeValues: { ':src': 'platform' }
        });
        return Array.isArray(fallback.Items) ? fallback.Items : [];
    }

    // REMOVED: createPlatformDiscount function - use createCampaign instead for unified functionality

    async function updatePlatformDiscount(discountId, updates) {
        // Try to find in primary platform table first
        let tableForUpdate = TABLES.platformDiscounts;
        let res = await scan(tableForUpdate, {
            FilterExpression: 'discountId = :id OR id = :id',
            ExpressionAttributeValues: { ':id': discountId }
        });
        let current = (res.Items || [])[0];

        // If not found, fallback to discounts table
        if (!current) {
            tableForUpdate = TABLES.discounts;
            res = await scan(tableForUpdate, {
                FilterExpression: 'discountId = :id OR id = :id',
                ExpressionAttributeValues: { ':id': discountId }
            });
            current = (res.Items || [])[0];
        }

        if (!current) throw new Error('Platform discount not found');

        // Normalize type
        if (updates?.type) {
            updates.type = (updates.type === 'fixed_amount') ? 'fixed' : updates.type;
        }

        const updated = {
            ...current,
            ...(updates || {}),
            updatedAt: new Date().toISOString(),
            discountSource: 'platform'
        };
        if (!updated.discountId && updated.id) updated.discountId = updated.id;
        if (!updated.id && updated.discountId) updated.id = updated.discountId;
        // Keep common mirrors in sync when present
        if (updated.title && !updated.name) updated.name = updated.title;
        if (updated.name && !updated.title) updated.title = updated.name;
        if (updated.minOrderAmount != null && updated.minOrderValue == null) updated.minOrderValue = Number(updated.minOrderAmount);
        if (updated.minOrderValue != null && updated.minOrderAmount == null) updated.minOrderAmount = Number(updated.minOrderValue);
        if (updated.usageLimit != null && updated.limit == null) updated.limit = Number(updated.usageLimit);
        if (updated.limit != null && updated.usageLimit == null) updated.usageLimit = Number(updated.limit);
        if (updated.currentUsage != null && updated.usage == null) updated.usage = Number(updated.currentUsage);
        if (updated.usage != null && updated.currentUsage == null) updated.currentUsage = Number(updated.usage);

        try {
            await putDocumentItem(tableForUpdate, updated);
            return { success: true };
        } catch (e) {
            throw new Error(`Update platform discount failed: ${e?.message || e}`);
        }
    }

    async function deletePlatformDiscount(discountId) {
        // Attempt delete on primary table first
        try {
            await deleteDocumentItem(TABLES.platformDiscounts, { discountId });
            return { success: true };
        } catch (e) {
            // Try alternative key in primary table
            try {
                await deleteDocumentItem(TABLES.platformDiscounts, { id: discountId });
                return { success: true };
            } catch (e1) {
                if (_shouldFallbackPlatformTable(e) || _shouldFallbackPlatformTable(e1)) {
                    // Fallback table attempts: both key shapes
                    try {
                        await deleteDocumentItem(TABLES.discounts, { discountId });
                        return { success: true };
                    } catch (e2) {
                        try {
                            await deleteDocumentItem(TABLES.discounts, { id: discountId });
                            return { success: true };
                        } catch (e3) {
                            throw new Error(`Delete platform discount failed (fallback): ${e3?.message || e3}`);
                        }
                    }
                }
                throw new Error(`Delete platform discount failed: ${e1?.message || e1}`);
            }
        }
    }

    // Merchant Discounts CRUD (limited)
    async function updateMerchantDiscount(discountId, updates) {
        // Fetch current discount via scan (simple PK table assumption)
        const res = await scan(TABLES.discounts, {
            FilterExpression: 'discountId = :id OR id = :id',
            ExpressionAttributeValues: { ':id': discountId }
        });
        const current = (res.Items || [])[0];
        if (!current) throw new Error('Merchant discount not found');
        const updated = {
            ...current,
            ...(updates || {}),
            updatedAt: new Date().toISOString()
        };
        try {
            await putDocumentItem(TABLES.discounts, updated);
            return { success: true };
        } catch (e) {
            throw new Error(`Update merchant discount failed: ${e?.message || e}`);
        }
    }

    async function deleteMerchantDiscount(discountId) {
        try {
            await deleteDocumentItem(TABLES.discounts, { discountId });
            return { success: true };
        } catch (e) {
            try {
                await deleteDocumentItem(TABLES.discounts, { id: discountId });
                return { success: true };
            } catch (e2) {
                throw new Error(`Delete merchant discount failed: ${e2?.message || e2}`);
            }
        }
    }

    // Added: Fetch drivers from DynamoDB (WhizzDrivers_dev)
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
    async function getCampaigns() {
        console.log('INFO: Getting all campaigns from unified platform discounts table...');
        try {
            const client = await getClientSafe();
            if (!client) {
                console.warn('No DynamoDB client available for campaigns');
                return [];
            }

            // Scan the unified platform discounts table and filter for campaigns
            const params = {
                TableName: TABLES.platformDiscounts,
                FilterExpression: 'discountSource = :source',
                ExpressionAttributeValues: {
                    ':source': 'campaign'
                }
            };

            const result = await client.scan(params).promise();
            console.log(`✅ Retrieved ${result.Items?.length || 0} campaigns from unified table`);
            
            return (result.Items || []).map(item => ({
                id: item.campaignId || item.discountId,
                campaignId: item.campaignId || item.discountId,
                title: item.title || item.name,
                code: item.code || '',
                type: item.campaignType || item.type || '',
                discountType: item.discountType || 'percentage',
                discountValue: item.discountValue || item.value || 0,
                target: item.target || '',
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
            
            // Verify this is actually a campaign
            if (item && item.discountSource === 'campaign') {
                return item;
            }
            
            return null;
        } catch (error) {
            console.error(`Error getting campaign ${campaignId}:`, error);
            return null;
        }
    }

    async function createCampaign(campaignData) {
        console.log('INFO: Creating new campaign/discount in unified platform discounts table...');
        const startTime = Date.now();
        
        try {
            const client = await getClientSafe();
            if (!client) {
                console.warn('No DynamoDB client available for campaign creation');
                return { success: false, error: 'No DynamoDB client available' };
            }

            const campaignId = campaignData.discountId || campaignData.campaignId || `campaign_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            const timestamp = new Date().toISOString();
            
            // Normalize discount type
            const normalizedType = (campaignData.type === 'fixed_amount' || campaignData.discountType === 'fixed_amount') ? 'fixed' : 
                                   (campaignData.discountType || campaignData.type || 'percentage');
            
            // Create unified campaign/discount object that works for both use cases
            const campaign = {
                // Primary identifiers
                discountId: campaignId, // Use discountId as primary key for unified table
                campaignId, // Keep original campaignId for backwards compatibility
                id: campaignId, // compatibility for tables keyed by 'id'
                
                // Basic info (unified field naming)
                title: campaignData.title || campaignData.name || '',
                name: campaignData.title || campaignData.name || '', // Also set name field for consistency
                description: campaignData.description || '',
                code: campaignData.code || '',
                
                // Discount details
                type: normalizedType, // Main type field
                discountType: normalizedType, // Also store as discountType for compatibility
                campaignType: campaignData.campaignType || campaignData.type || '', // Store original campaign type separately
                value: parseFloat(campaignData.value || campaignData.discountValue) || 0,
                discountValue: parseFloat(campaignData.value || campaignData.discountValue) || 0, // Keep both for compatibility
                
                // Source and targeting
                discountSource: campaignData.discountSource || 'campaign', // Mark as campaign-originated by default
                target: campaignData.target || '',
                targetRestaurants: campaignData.targetRestaurants || [],
                targetSegments: campaignData.targetSegments || [],
                occasions: campaignData.occasions || [],
                customerSegments: Array.isArray(campaignData.customerSegments) && campaignData.customerSegments.length ? 
                                  campaignData.customerSegments : ['all'],
                
                // Status and activation
                status: campaignData.status || 'active',
                isActive: campaignData.isActive !== false && campaignData.autoActivate !== false,
                autoActivate: campaignData.autoActivate !== false,
                
                // Usage tracking (unified field naming)
                usage: 0,
                currentUsage: 0, // For compatibility with discount structure
                usageLimit: parseInt(campaignData.usageLimit || campaignData.limit) || 0,
                limit: parseInt(campaignData.usageLimit || campaignData.limit) || 0, // Keep both for compatibility
                
                // Order requirements (unified field naming)
                minOrderValue: parseFloat(campaignData.minOrderValue || campaignData.minOrderAmount) || 0,
                minOrderAmount: parseFloat(campaignData.minOrderValue || campaignData.minOrderAmount) || 0, // Keep both for compatibility
                
                // Date ranges (unified field naming)
                startDate: campaignData.startDate || '',
                endDate: campaignData.endDate || '',
                validFrom: campaignData.validFrom || campaignData.startDate || '',
                validTo: campaignData.validTo || campaignData.endDate || '',
                
                // Campaign-specific features
                singleUse: campaignData.singleUse || false,
                stackable: campaignData.stackable || false,
                applicableToAll: campaignData.applicableToAll !== false,
                
                // Timestamps and metadata
                createdAt: campaignData.createdAt || timestamp,
                updatedAt: timestamp,
                createdBy: campaignData.createdBy || 'central-platform'
            };

            const params = {
                TableName: TABLES.platformDiscounts, // Use unified platform discounts table
                Item: campaign
            };

            await client.put(params).promise();
            const duration = Date.now() - startTime;
            console.log(`✅ Campaign/discount created successfully in unified table: ${campaignId} (${duration}ms)`);
            return { success: true, discountId: campaignId, campaignId };
            
        } catch (error) {
            // Fallback to merchant discounts table if platform table is missing or blocked
            if (_shouldFallbackPlatformTable(error)) {
                console.warn('WARN: Primary platform discounts table unavailable. Falling back to merchant discounts table.');
                try {
                    const campaignId = campaignData.discountId || campaignData.campaignId || `campaign_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
                    const timestamp = new Date().toISOString();
                    const normalizedType = (campaignData.type === 'fixed_amount' || campaignData.discountType === 'fixed_amount') ? 'fixed' : 
                                           (campaignData.discountType || campaignData.type || 'percentage');
                    
                    const fallbackCampaign = {
                        discountId: campaignId,
                        campaignId,
                        id: campaignId,
                        title: campaignData.title || campaignData.name || '',
                        name: campaignData.title || campaignData.name || '',
                        description: campaignData.description || '',
                        code: campaignData.code || '',
                        type: normalizedType,
                        value: parseFloat(campaignData.value || campaignData.discountValue) || 0,
                        discountSource: campaignData.discountSource || 'campaign',
                        isActive: campaignData.isActive !== false,
                        usage: 0,
                        limit: parseInt(campaignData.usageLimit || campaignData.limit) || 0,
                        minOrderValue: parseFloat(campaignData.minOrderValue || campaignData.minOrderAmount) || 0,
                        startDate: campaignData.startDate || '',
                        endDate: campaignData.endDate || '',
                        createdAt: timestamp,
                        updatedAt: timestamp
                    };
                    
                    await putDocumentItem(TABLES.discounts, fallbackCampaign);
                    const duration = Date.now() - startTime;
                    console.log(`✅ Campaign/discount created successfully in fallback table: ${campaignId} (${duration}ms)`);
                    return { success: true, discountId: campaignId, campaignId };
                } catch (fallbackError) {
                    const duration = Date.now() - startTime;
                    console.error(`ERROR: Campaign creation fallback failed after ${duration}ms:`, fallbackError?.message || fallbackError);
                    return { success: false, error: `Create campaign failed (fallback): ${fallbackError?.message || fallbackError}` };
                }
            }
            const duration = Date.now() - startTime;
            console.error(`ERROR: Campaign creation failed after ${duration}ms:`, error?.message || error);
            return { success: false, error: `Create campaign failed: ${error?.message || error}` };
        }
    }

    async function updateCampaign(campaignId, updateData) {
        console.log(`INFO: Updating campaign ${campaignId} in unified platform discounts table...`);
        try {
            const client = await getClientSafe();
            if (!client) {
                console.warn('No DynamoDB client available for campaign update');
                return null;
            }

            const timestamp = new Date().toISOString();
            updateData.updatedAt = timestamp;

            // Build update expression dynamically
            const updateExpression = [];
            const expressionAttributeNames = {};
            const expressionAttributeValues = {};

            Object.keys(updateData).forEach(key => {
                updateExpression.push(`#${key} = :${key}`);
                expressionAttributeNames[`#${key}`] = key;
                expressionAttributeValues[`:${key}`] = updateData[key];
            });

            const params = {
                TableName: TABLES.platformDiscounts,
                Key: { discountId: campaignId }, // Use discountId as primary key
                UpdateExpression: `SET ${updateExpression.join(', ')}`,
                ExpressionAttributeNames: expressionAttributeNames,
                ExpressionAttributeValues: expressionAttributeValues,
                ReturnValues: 'ALL_NEW'
            };

            const result = await client.update(params).promise();
            console.log(`✅ Campaign updated successfully: ${campaignId}`);
            return result.Attributes;
        } catch (error) {
            console.error(`Error updating campaign ${campaignId}:`, error);
            throw error;
        }
    }

    async function deleteCampaign(campaignId) {
        console.log(`INFO: Deleting campaign ${campaignId} from unified platform discounts table...`);
        try {
            const client = await getClientSafe();
            if (!client) {
                console.warn('No DynamoDB client available for campaign deletion');
                return false;
            }

            const params = {
                TableName: TABLES.platformDiscounts,
                Key: { discountId: campaignId } // Use discountId as primary key
            };

            await client.delete(params).promise();
            console.log(`✅ Campaign deleted successfully: ${campaignId}`);
            return true;
        } catch (error) {
            console.error(`Error deleting campaign ${campaignId}:`, error);
            throw error;
        }
    }

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
