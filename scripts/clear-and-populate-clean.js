#!/usr/bin/env node
/**
 * Clear DynamoDB table and populate with clean, consistent data
 */
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, ScanCommand, BatchWriteCommand, PutCommand } = require('@aws-sdk/lib-dynamodb');

const ddbClient = new DynamoDBClient({
    region: process.env.AWS_REGION || 'us-east-1'
});
const dynamoDB = DynamoDBDocumentClient.from(ddbClient);
const REGIONS_TABLE = 'WizzCentral_Regions';

// Clean data structure
const cleanRegions = [
    // Iraq (Country)
    {
        regionId: 'iraq',
        name: 'Iraq',
        name_ar: 'العراق',
        level: 'country',
        parent_id: null,
        is_active: true,
        coordinates: { lat: 33.2232, lng: 43.6793, radius: 1000000 },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    },
    
    // Key Governorates
    {
        regionId: 'baghdad',
        name: 'Baghdad',
        name_ar: 'بغداد',
        level: 'governorate',
        parent_id: 'iraq',
        is_active: true,
        coordinates: { lat: 33.3152, lng: 44.3661, radius: 50000 },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    },
    {
        regionId: 'basra',
        name: 'Basra',
        name_ar: 'البصرة',
        level: 'governorate',
        parent_id: 'iraq',
        is_active: true,
        coordinates: { lat: 30.5085, lng: 47.7804, radius: 45000 },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    },
    {
        regionId: 'najaf',
        name: 'Najaf',
        name_ar: 'النجف',
        level: 'governorate',
        parent_id: 'iraq',
        is_active: true,
        coordinates: { lat: 31.9996, lng: 44.3267, radius: 30000 },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    },
    {
        regionId: 'karbala',
        name: 'Karbala',
        name_ar: 'كربلاء',
        level: 'governorate',
        parent_id: 'iraq',
        is_active: true,
        coordinates: { lat: 32.6169, lng: 44.0252, radius: 25000 },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    },
    {
        regionId: 'erbil',
        name: 'Erbil',
        name_ar: 'أربيل',
        level: 'governorate',
        parent_id: 'iraq',
        is_active: false,
        coordinates: { lat: 36.1911, lng: 44.0093, radius: 35000 },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    },
    {
        regionId: 'kirkuk',
        name: 'Kirkuk',
        name_ar: 'كركوك',
        level: 'governorate',
        parent_id: 'iraq',
        is_active: false,
        coordinates: { lat: 35.4681, lng: 44.3922, radius: 35000 },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    },
    {
        regionId: 'nineveh',
        name: 'Nineveh',
        name_ar: 'نينوى',
        level: 'governorate',
        parent_id: 'iraq',
        is_active: false,
        coordinates: { lat: 36.3407, lng: 43.1186, radius: 60000 },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    },
    
    // Sample Districts
    {
        regionId: 'al_karkh',
        name: 'Al-Karkh',
        name_ar: 'الكرخ',
        level: 'district',
        parent_id: 'baghdad',
        is_active: true,
        coordinates: { lat: 33.3007, lng: 44.3225, radius: 15000 },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    },
    {
        regionId: 'al_rusafa',
        name: 'Al-Rusafa',
        name_ar: 'الرصافة',
        level: 'district',
        parent_id: 'baghdad',
        is_active: true,
        coordinates: { lat: 33.3406, lng: 44.4009, radius: 15000 },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    }
];

async function clearTable() {
    console.log('🗑️  Clearing existing DynamoDB data...');
    
    const scanResult = await dynamoDB.send(new ScanCommand({
        TableName: REGIONS_TABLE
    }));
    
    if (scanResult.Items && scanResult.Items.length > 0) {
        console.log(`📊 Found ${scanResult.Items.length} items to delete`);
        
        // Delete in batches of 25
        const batches = [];
        for (let i = 0; i < scanResult.Items.length; i += 25) {
            batches.push(scanResult.Items.slice(i, i + 25));
        }
        
        for (const batch of batches) {
            const deleteRequests = batch.map(item => ({
                DeleteRequest: {
                    Key: { regionId: item.regionId }
                }
            }));
            
            await dynamoDB.send(new BatchWriteCommand({
                RequestItems: {
                    [REGIONS_TABLE]: deleteRequests
                }
            }));
            
            console.log(`   ✅ Deleted ${deleteRequests.length} items`);
        }
    }
    
    console.log('✅ Table cleared');
}

async function populateCleanData() {
    console.log('📝 Populating clean data...');
    
    for (const region of cleanRegions) {
        await dynamoDB.send(new PutCommand({
            TableName: REGIONS_TABLE,
            Item: region
        }));
        
        console.log(`   ✅ Added: ${region.name} (${region.level})`);
    }
    
    console.log(`✅ Added ${cleanRegions.length} regions`);
}

async function main() {
    try {
        console.log('�� DynamoDB Clean Population');
        console.log('============================');
        
        await clearTable();
        console.log('');
        await populateCleanData();
        
        console.log('');
        console.log('🎉 SUCCESS! Clean data structure applied');
        console.log('');
        console.log('✅ Structure:');
        console.log('   - regionId: Simple IDs (baghdad, basra, etc.)');
        console.log('   - level: String values (country, governorate, district)');
        console.log('   - is_active: Boolean values');
        console.log('   - Consistent field names');
        console.log('');
        console.log('🔄 Next: Restart server and test toggle');
        
    } catch (error) {
        console.error('❌ Error:', error);
        process.exit(1);
    }
}

main();
