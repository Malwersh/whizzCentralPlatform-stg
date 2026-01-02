const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand } = require('@aws-sdk/lib-dynamodb');

const ddbClient = new DynamoDBClient({ region: 'us-east-1' });
const dynamoDB = DynamoDBDocumentClient.from(ddbClient);

async function addRegion(region) {
    await dynamoDB.send(new PutCommand({
        TableName: 'WizzCentral_Regions',
        Item: region
    }));
    console.log(`✅ Added: ${region.name} (level ${region.level})`);
}

async function populate() {
    console.log('📝 Adding regions with numeric levels...');
    
    // Level 0 = Country
    await addRegion({
        regionId: 'iraq',
        name: 'Iraq',
        name_ar: 'العراق',
        level: 0,
        parent_id: null,
        is_active: true,
        coordinates: { lat: 33.2232, lng: 43.6793, radius: 1000000 },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    });
    
    // Level 1 = Governorate
    await addRegion({
        regionId: 'baghdad',
        name: 'Baghdad',
        name_ar: 'بغداد',
        level: 1,
        parent_id: 'iraq',
        is_active: true,
        coordinates: { lat: 33.3152, lng: 44.3661, radius: 50000 },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    });
    
    await addRegion({
        regionId: 'basra',
        name: 'Basra',
        name_ar: 'البصرة',
        level: 1,
        parent_id: 'iraq',
        is_active: false,
        coordinates: { lat: 30.5085, lng: 47.7804, radius: 45000 },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    });
    
    await addRegion({
        regionId: 'najaf',
        name: 'Najaf',
        name_ar: 'النجف',
        level: 1,
        parent_id: 'iraq',
        is_active: true,
        coordinates: { lat: 31.9996, lng: 44.3267, radius: 30000 },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    });
    
    await addRegion({
        regionId: 'karbala',
        name: 'Karbala',
        name_ar: 'كربلاء',
        level: 1,
        parent_id: 'iraq',
        is_active: true,
        coordinates: { lat: 32.6169, lng: 44.0252, radius: 25000 },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    });
    
    // Level 2 = District
    await addRegion({
        regionId: 'al_karkh',
        name: 'Al-Karkh',
        name_ar: 'الكرخ',
        level: 2,
        parent_id: 'baghdad',
        is_active: true,
        coordinates: { lat: 33.3007, lng: 44.3225, radius: 15000 },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    });
    
    await addRegion({
        regionId: 'al_rusafa',
        name: 'Al-Rusafa',
        name_ar: 'الرصافة',
        level: 2,
        parent_id: 'baghdad',
        is_active: true,
        coordinates: { lat: 33.3406, lng: 44.4009, radius: 15000 },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    });
    
    console.log('🎉 Clean regions added successfully!');
    console.log('');
    console.log('📊 Level Mapping:');
    console.log('   0 = Country');
    console.log('   1 = Governorate');
    console.log('   2 = District');
    console.log('   3 = Neighborhood');
}

populate().catch(console.error);
