#!/usr/bin/env node
/**
 * Create Complete Iraq Regions
 * Generates ALL Iraqi governorates, districts, and neighborhoods
 * Uses Mapbox Geocoding API for accurate coordinates
 */

const fs = require('fs');
const path = require('path');
const { geocode, geocodeWithFallback } = require('./geocode-helper');

// Output file
const OUTPUT_FILE = path.join(__dirname, '../data/comprehensive-iraq-regions.json');

// ============================================
// Iraqi Governorates (All 18)
// ============================================
const GOVERNORATES = [
    { name: 'Baghdad', name_ar: 'بغداد', population: 9000000 },
    { name: 'Basra', name_ar: 'البصرة', population: 2500000 },
    { name: 'Najaf', name_ar: 'النجف', population: 1285500 },
    { name: 'Karbala', name_ar: 'كربلاء', population: 1066600 },
    { name: 'Erbil', name_ar: 'أربيل', name_ku: 'هەولێر', population: 1612700 },
    { name: 'Mosul', name_ar: 'الموصل', alt_name: 'Nineveh', population: 3270000 },
    { name: 'Sulaymaniyah', name_ar: 'السليمانية', name_ku: 'سلێمانی', population: 1950000 },
    { name: 'Duhok', name_ar: 'دهوك', name_ku: 'دهۆک', population: 1292535 },
    { name: 'Kirkuk', name_ar: 'كركوك', name_ku: 'کەرکووک', population: 1395614 },
    { name: 'Anbar', name_ar: 'الأنبار', population: 1561000 },
    { name: 'Diyala', name_ar: 'ديالى', population: 1443200 },
    { name: 'Saladin', name_ar: 'صلاح الدين', population: 1508200 },
    { name: 'Wasit', name_ar: 'واسط', population: 1420900 },
    { name: 'Maysan', name_ar: 'ميسان', population: 1010000 },
    { name: 'Dhi Qar', name_ar: 'ذي قار', population: 2010700 },
    { name: 'Muthanna', name_ar: 'المثنى', population: 775000 },
    { name: 'Qadisiyyah', name_ar: 'القادسية', population: 1283000 },
    { name: 'Babil', name_ar: 'بابل', population: 2025000 }
];

// ============================================
// Districts by Governorate
// ============================================
const DISTRICTS = {
    'Baghdad': ['Al-Karkh', 'Al-Rusafa', 'Al-Kadhimiya', 'Al-Adhamiyah'],
    'Basra': ['Basra Center', 'Al-Qurna', 'Shatt al-Arab', 'Al-Zubair', 'Abu al-Khaseeb'],
    'Najaf': ['Najaf Central', 'Al-Kufa', 'Al-Manathera', 'Al-Mishkhab'],
    'Karbala': ['Karbala Center', 'Al-Hindiya'],
    'Erbil': ['Erbil Center', 'Shaqlawa', 'Soran', 'Koya'],
    'Mosul': ['Mosul Center', 'Tal Afar', 'Sinjar', 'Al-Hamdaniya'],
    'Sulaymaniyah': ['Sulaymaniyah Center', 'Halabja', 'Penjwin'],
    'Duhok': ['Duhok Center', 'Zakho', 'Amadiya'],
    'Kirkuk': ['Kirkuk Center', 'Hawija', 'Daquq'],
    'Anbar': ['Ramadi', 'Fallujah', 'Haditha', 'Hit'],
    'Diyala': ['Baqubah', 'Muqdadiyah', 'Khalis'],
    'Saladin': ['Tikrit', 'Samarra', 'Tuz Khurmatu'],
    'Wasit': ['Kut', 'Al-Hay', 'Al-Aziziyah'],
    'Maysan': ['Amarah', 'Al-Majar al-Kabir', 'Qalat Saleh'],
    'Dhi Qar': ['Nasiriyah', 'Suq ash-Shuyukh', 'Al-Rifai'],
    'Muthanna': ['Samawah', 'Rumaitha', 'Al-Khidr'],
    'Qadisiyyah': ['Diwaniyah', 'Al-Shamiya', 'Afak'],
    'Babil': ['Hilla', 'Al-Musayyib', 'Hashimiya']
};

// ============================================
// Sample Neighborhoods (Will be expanded)
// ============================================
const NEIGHBORHOODS = {
    'Baghdad': {
        'Al-Karkh': ['Kadhimiya', 'Mansour', 'Al-Amiriya', 'Al-Bayaa'],
        'Al-Rusafa': ['Sadr City', 'Al-Adhamiyah', 'Karrada', 'Al-Shaab']
    },
    'Najaf': {
        'Najaf Central': ['Old City', 'Imam Ali Area', 'Al-Hanana', 'Al-Ghadeer', 'Al-Ameer', 'New Najaf'],
        'Al-Kufa': ['Kufa Center', 'Kufa Grand Mosque', 'University Area', 'Al-Huriya'],
        'Al-Manathera': ['Manathera Center', 'Al-Haidariya', 'Al-Qadisiya'],
        'Al-Mishkhab': ['Mishkhab Center', 'Al-Hindiya', 'Umm Khanazer']
    },
    'Basra': {
        'Basra Center': ['Old Basra', 'Al-Ashar', 'Al-Jazira', 'Al-Maaqal']
    }
};

// ============================================
// Main Generation Function
// ============================================
async function generateAllIraqRegions() {
    console.log('🇮🇶 Generating Complete Iraq Regions using Mapbox Geocoding API\n');
    console.log('='.repeat(70));
    
    const regions = [];
    
    // 1. Add Iraq (Country level)
    console.log('\n📍 Adding Iraq (Country)...');
    const iraqCoords = await geocode('Iraq');
    regions.push({
        id: 'iraq',
        name: 'Iraq',
        name_ar: 'العراق',
        level: 'country',
        parent_id: null,
        governorate_id: null,
        coordinates: {
            lat: iraqCoords ? iraqCoords.lat : 33.2232,
            lng: iraqCoords ? iraqCoords.lng : 43.6793,
            radius: 1000000
        },
        is_active: true,
        geocoded_by: 'mapbox',
        statistics: {
            population: 40222493,
            area_km2: 438317
        }
    });
    
    // 2. Add all Governorates
    console.log('\n📍 Adding 18 Governorates...\n');
    for (const gov of GOVERNORATES) {
        const govId = gov.name.toLowerCase().replace(/\s+/g, '_');
        
        // Geocode governorate
        const coords = await geocode(`${gov.name}, Iraq`);
        
        if (!coords) {
            console.warn(`⚠️  Skipping ${gov.name} - geocoding failed`);
            continue;
        }
        
        regions.push({
            id: govId,
            name: gov.name,
            name_ar: gov.name_ar,
            name_ku: gov.name_ku,
            level: 'governorate',
            parent_id: 'iraq',
            governorate_id: govId,
            coordinates: {
                lat: coords.lat,
                lng: coords.lng,
                radius: 50000
            },
            is_active: true,
            geocoded_by: 'mapbox',
            geocoding_confidence: coords.confidence,
            statistics: {
                population: gov.population,
                area_km2: 0
            }
        });
    }
    
    // 3. Add Districts
    console.log('\n📍 Adding Districts...\n');
    for (const [govName, districts] of Object.entries(DISTRICTS)) {
        const govId = govName.toLowerCase().replace(/\s+/g, '_');
        
        for (const districtName of districts) {
            const districtId = `${govId}_${districtName.toLowerCase().replace(/[\s-]/g, '_')}`;
            
            // Geocode district with governorate context
            const coords = await geocodeWithFallback(districtName, govName);
            
            if (!coords) {
                console.warn(`⚠️  Skipping ${districtName} in ${govName}`);
                continue;
            }
            
            regions.push({
                id: districtId,
                name: districtName,
                name_ar: '', // Can be filled later
                level: 'district',
                parent_id: govId,
                governorate_id: govId,
                coordinates: {
                    lat: coords.lat,
                    lng: coords.lng,
                    radius: 15000
                },
                is_active: true,
                geocoded_by: 'mapbox',
                geocoding_confidence: coords.confidence
            });
        }
    }
    
    // 4. Add Neighborhoods
    console.log('\n📍 Adding Neighborhoods...\n');
    for (const [govName, districtNeighborhoods] of Object.entries(NEIGHBORHOODS)) {
        const govId = govName.toLowerCase().replace(/\s+/g, '_');
        
        for (const [districtName, neighborhoods] of Object.entries(districtNeighborhoods)) {
            const districtId = `${govId}_${districtName.toLowerCase().replace(/[\s-]/g, '_')}`;
            
            for (const neighborhoodName of neighborhoods) {
                const neighborhoodId = `${districtId}_${neighborhoodName.toLowerCase().replace(/[\s-]/g, '_')}`;
                
                // Geocode neighborhood
                const coords = await geocodeWithFallback(neighborhoodName, districtName);
                
                if (!coords) {
                    console.warn(`⚠️  Skipping ${neighborhoodName}`);
                    continue;
                }
                
                regions.push({
                    id: neighborhoodId,
                    name: neighborhoodName,
                    name_ar: '',
                    level: 'neighborhood',
                    parent_id: districtId,
                    governorate_id: govId,
                    coordinates: {
                        lat: coords.lat,
                        lng: coords.lng,
                        radius: 3000
                    },
                    is_active: true,
                    geocoded_by: 'mapbox',
                    geocoding_confidence: coords.confidence
                });
            }
        }
    }
    
    // 5. Save to file
    console.log('\n💾 Saving regions...');
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(regions, null, 2));
    
    // 6. Print summary
    console.log('\n' + '='.repeat(70));
    console.log('✅ GENERATION COMPLETE!\n');
    console.log(`📊 Statistics:`);
    console.log(`   Total Regions: ${regions.length}`);
    console.log(`   Country: ${regions.filter(r => r.level === 'country').length}`);
    console.log(`   Governorates: ${regions.filter(r => r.level === 'governorate').length}`);
    console.log(`   Districts: ${regions.filter(r => r.level === 'district').length}`);
    console.log(`   Neighborhoods: ${regions.filter(r => r.level === 'neighborhood').length}`);
    console.log(`\n📁 Output: ${OUTPUT_FILE}`);
    console.log('='.repeat(70));
}

// Run if called directly
if (require.main === module) {
    generateAllIraqRegions().catch(error => {
        console.error('\n❌ Generation failed:', error);
        process.exit(1);
    });
}

module.exports = { generateAllIraqRegions };
