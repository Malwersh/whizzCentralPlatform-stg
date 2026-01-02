#!/usr/bin/env node
/**
 * Mapbox Geocoding Helper
 * Geocodes Iraqi locations using Mapbox API
 */

require('dotenv').config({ path: '.env.mapbox' });
const fetch = require('node-fetch');

const MAPBOX_TOKEN = process.env.MAPBOX_ACCESS_TOKEN;

if (!MAPBOX_TOKEN) {
    console.error('❌ MAPBOX_ACCESS_TOKEN not found in .env.mapbox');
    console.error('Create .env.mapbox file with: MAPBOX_ACCESS_TOKEN=pk.ey...');
    process.exit(1);
}

/**
 * Geocode a location using Mapbox Geocoding API
 * @param {string} locationName - Name of location (English or Arabic)
 * @param {string} country - Country code (default: 'IQ' for Iraq)
 * @returns {Promise<Object>} - { lat, lng, place_name, confidence }
 */
async function geocode(locationName, country = 'IQ') {
    const encodedLocation = encodeURIComponent(locationName);
    const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodedLocation}.json?country=${country}&access_token=${MAPBOX_TOKEN}&limit=1`;
    
    console.log(`🔍 Geocoding: ${locationName}`);
    
    try {
        const response = await fetch(url);
        
        if (!response.ok) {
            throw new Error(`Mapbox API error: ${response.status} ${response.statusText}`);
        }
        
        const data = await response.json();
        
        if (!data.features || data.features.length === 0) {
            console.warn(`⚠️  No results for: ${locationName}`);
            return null;
        }
        
        const feature = data.features[0];
        const [lng, lat] = feature.center;
        
        const result = {
            lat: parseFloat(lat.toFixed(6)),
            lng: parseFloat(lng.toFixed(6)),
            place_name: feature.place_name,
            confidence: feature.relevance || 1.0,
            bbox: feature.bbox
        };
        
        console.log(`✅ Found: ${result.place_name} (${result.lat}, ${result.lng})`);
        
        // Rate limit: 600 requests/minute for free tier
        // Add 100ms delay to be safe
        await new Promise(resolve => setTimeout(resolve, 100));
        
        return result;
        
    } catch (error) {
        console.error(`❌ Geocoding failed for ${locationName}:`, error.message);
        return null;
    }
}

/**
 * Batch geocode multiple locations
 * @param {Array<string>} locations - Array of location names
 * @param {string} country - Country code
 * @returns {Promise<Array<Object>>} - Array of geocoded results
 */
async function geocodeBatch(locations, country = 'IQ') {
    console.log(`📍 Batch geocoding ${locations.length} locations...`);
    
    const results = [];
    
    for (const location of locations) {
        const result = await geocode(location, country);
        if (result) {
            results.push({
                query: location,
                ...result
            });
        }
    }
    
    console.log(`✅ Successfully geocoded ${results.length}/${locations.length} locations`);
    
    return results;
}

/**
 * Geocode with fallback - tries multiple location formats
 * @param {string} name - Location name
 * @param {string} governorate - Governorate name for context
 * @param {string} country - Country code
 * @returns {Promise<Object>} - Geocoded result
 */
async function geocodeWithFallback(name, governorate, country = 'IQ') {
    // Try 1: Full location with governorate context
    let result = await geocode(`${name}, ${governorate}, Iraq`, country);
    
    // Try 2: Just location and country
    if (!result) {
        result = await geocode(`${name}, Iraq`, country);
    }
    
    // Try 3: Just location name
    if (!result) {
        result = await geocode(name, country);
    }
    
    return result;
}

module.exports = {
    geocode,
    geocodeBatch,
    geocodeWithFallback
};

// CLI Usage
if (require.main === module) {
    const args = process.argv.slice(2);
    
    if (args.length === 0) {
        console.log('Usage: node geocode-helper.js "Location Name"');
        console.log('Example: node geocode-helper.js "Baghdad"');
        process.exit(1);
    }
    
    const location = args[0];
    
    geocode(location).then(result => {
        if (result) {
            console.log('\n📍 Result:');
            console.log(JSON.stringify(result, null, 2));
        } else {
            console.log('\n❌ No result found');
            process.exit(1);
        }
    });
}
