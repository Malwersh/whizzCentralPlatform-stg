// Regions API Server
// Express server for Mapbox Geocoding Playground

const express = require('express');
const path = require('path');
const fs = require('fs').promises;
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// DynamoDB Service (optional)
let dynamoDBService = null;
const USE_DYNAMODB = process.env.USE_DYNAMODB === 'true';

if (USE_DYNAMODB) {
    try {
        const RegionsDynamoDBService = require('./dynamodb-service');
        dynamoDBService = new RegionsDynamoDBService();
        console.log('✅ DynamoDB integration enabled');
    } catch (error) {
        console.log('⚠️  DynamoDB not available, using file storage only');
    }
}

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '..')));

// Data file path
const DATA_FILE = path.join(__dirname, '../data/regions.json');

// Initialize data file if it doesn't exist
async function initializeDataFile() {
    try {
        await fs.access(DATA_FILE);
    } catch {
        await fs.writeFile(DATA_FILE, JSON.stringify([], null, 2));
        console.log('📁 Created data/regions.json');
    }
}

// Save to DynamoDB if enabled
async function saveToDynamoDB(region) {
    if (dynamoDBService) {
        try {
            await dynamoDBService.saveRegion(region);
            return true;
        } catch (error) {
            console.error('❌ Error saving to DynamoDB:', error.message);
            return false;
        }
    }
    return false;
}

// Delete from DynamoDB if enabled
async function deleteFromDynamoDB(regionId) {
    if (dynamoDBService) {
        try {
            await dynamoDBService.deleteRegion(regionId);
            return true;
        } catch (error) {
            console.error('❌ Error deleting from DynamoDB:', error.message);
            return false;
        }
    }
    return false;
}

// Read regions from file
async function readRegions() {
    try {
        const data = await fs.readFile(DATA_FILE, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        console.error('Error reading regions:', error);
        return [];
    }
}

// Write regions to file
async function writeRegions(regions) {
    try {
        await fs.writeFile(DATA_FILE, JSON.stringify(regions, null, 2));
        return true;
    } catch (error) {
        console.error('Error writing regions:', error);
        return false;
    }
}

// Save to DynamoDB if enabled
async function saveToDynamoDB(region) {
    if (dynamoDBService) {
        try {
            await dynamoDBService.saveRegion(region);
            return true;
        } catch (error) {
            console.error('Error saving to DynamoDB:', error);
            return false;
        }
    }
    return false;
}

// Routes

// Home page - redirect to playground
app.get('/', (req, res) => {
    res.redirect('/mapbox-playground/index.html');
});

// Get all regions
app.get('/api/regions', async (req, res) => {
    try {
        const regions = await readRegions();
        
        // Generate summary
        const summary = {
            totalRegions: regions.length,
            byType: regions.reduce((acc, r) => {
                acc[r.type] = (acc[r.type] || 0) + 1;
                return acc;
            }, {}),
            activeRegions: regions.filter(r => r.status === 'active').length,
            lastUpdated: new Date().toISOString()
        };

        res.json({
            success: true,
            data: regions,
            summary: summary
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Get single region
app.get('/api/regions/:id', async (req, res) => {
    try {
        const regions = await readRegions();
        const region = regions.find(r => r.id === req.params.id);
        
        if (!region) {
            return res.status(404).json({
                success: false,
                error: 'Region not found'
            });
        }

        res.json({
            success: true,
            data: region
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Create new region
app.post('/api/regions', async (req, res) => {
    try {
        const regions = await readRegions();
        const newRegion = {
            id: `region_${Date.now()}`,
            ...req.body,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };

        // Save to local file (always)
        regions.push(newRegion);
        await writeRegions(regions);

        // Save to DynamoDB (if enabled)
        const dynamoSaved = await saveToDynamoDB(newRegion);

        res.status(201).json({
            success: true,
            data: newRegion,
            message: 'Region created successfully',
            savedTo: {
                file: true,
                dynamodb: dynamoSaved
            }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Update region
app.put('/api/regions/:id', async (req, res) => {
    try {
        const regions = await readRegions();
        const index = regions.findIndex(r => r.id === req.params.id);
        
        if (index === -1) {
            return res.status(404).json({
                success: false,
                error: 'Region not found'
            });
        }

        regions[index] = {
            ...regions[index],
            ...req.body,
            updatedAt: new Date().toISOString()
        };

        // Save to local file
        await writeRegions(regions);

        // Update in DynamoDB (if enabled)
        const dynamoSaved = await saveToDynamoDB(regions[index]);

        res.json({
            success: true,
            data: regions[index],
            message: 'Region updated successfully',
            savedTo: {
                file: true,
                dynamodb: dynamoSaved
            }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Delete region
app.delete('/api/regions/:id', async (req, res) => {
    try {
        const regions = await readRegions();
        const filteredRegions = regions.filter(r => r.id !== req.params.id);
        
        if (regions.length === filteredRegions.length) {
            return res.status(404).json({
                success: false,
                error: 'Region not found'
            });
        }

        // Delete from local file
        await writeRegions(filteredRegions);

        // Delete from DynamoDB (if enabled)
        const dynamoDeleted = await deleteFromDynamoDB(req.params.id);

        res.json({
            success: true,
            message: 'Region deleted successfully',
            deletedFrom: {
                file: true,
                dynamodb: dynamoDeleted
            }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Bulk import regions
app.post('/api/regions/bulk', async (req, res) => {
    try {
        const { regions: newRegions } = req.body;
        
        if (!Array.isArray(newRegions)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid data format. Expected array of regions.'
            });
        }

        const regions = await readRegions();
        const timestamp = new Date().toISOString();
        
        const importedRegions = newRegions.map(r => ({
            id: r.id || `region_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            ...r,
            createdAt: r.createdAt || timestamp,
            updatedAt: timestamp
        }));

        // Save to local file
        regions.push(...importedRegions);
        await writeRegions(regions);

        // Batch save to DynamoDB if enabled
        let dynamoResult = null;
        if (dynamoDBService) {
            try {
                dynamoResult = await dynamoDBService.batchImportRegions(importedRegions);
            } catch (error) {
                console.error('Error batch importing to DynamoDB:', error);
            }
        }

        res.json({
            success: true,
            data: {
                imported: importedRegions.length,
                total: regions.length
            },
            savedTo: {
                file: true,
                dynamodb: dynamoResult
            },
            message: `Successfully imported ${importedRegions.length} regions`
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Export all regions
app.get('/api/export', async (req, res) => {
    try {
        const regions = await readRegions();
        const filename = `whizz-regions-${new Date().toISOString().split('T')[0]}.json`;
        
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send(JSON.stringify(regions, null, 2));
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Health check with DynamoDB status
app.get('/health', async (req, res) => {
    const health = {
        status: 'healthy',
        timestamp: new Date().toISOString(),
        version: '2.0.0',
        storage: {
            file: true,
            dynamodb: USE_DYNAMODB
        }
    };

    if (dynamoDBService) {
        health.dynamodb = await dynamoDBService.healthCheck();
    }

    res.json(health);
});

// Start server
async function startServer() {
    await initializeDataFile();
    
    app.listen(PORT, async () => {
        console.log('');
        console.log('🚀 WhizzCentral Regions API Server V2');
        console.log('=====================================');
        console.log(`📍 Server running on: http://localhost:${PORT}`);
        console.log(`🗺️  Playground: http://localhost:${PORT}/mapbox-playground/index.html`);
        console.log(`📊 API: http://localhost:${PORT}/api/regions`);
        console.log(`💚 Health: http://localhost:${PORT}/health`);
        console.log('=====================================');
        console.log('');
        console.log('💾 Storage Configuration:');
        console.log(`   • Local File: ✅ Enabled (data/regions.json)`);
        if (USE_DYNAMODB && dynamoDBService) {
            const dbHealth = await dynamoDBService.healthCheck();
            if (dbHealth.connected) {
                console.log(`   • DynamoDB: ✅ Connected (${dbHealth.table})`);
                console.log(`   • AWS Region: ${process.env.AWS_REGION || 'us-east-1'}`);
            } else {
                console.log(`   • DynamoDB: ❌ Connection Failed`);
                console.log(`   • Error: ${dbHealth.error}`);
            }
        } else {
            console.log(`   • DynamoDB: ⚠️  Disabled (use USE_DYNAMODB=true to enable)`);
        }
        console.log('');
        console.log('🎯 Quick Start:');
        console.log('   1. Open http://localhost:3000 in your browser');
        console.log('   2. Search for locations (e.g., "Najaf, Iraq")');
        console.log('   3. Save regions with one click');
        console.log('   4. Export to JSON when done');
        console.log('');
        console.log('📚 Documentation:');
        console.log('   • USAGE_GUIDE.md - How to use the playground');
        console.log('   • STORAGE_GUIDE.md - Where data is saved');
        console.log('   • QUICK_START.md - Getting started');
        console.log('');
    });
}

// ============================================
// TEMPORARY: Support Chat Image Upload Endpoint
// ============================================

// Temporary image upload endpoint for support chat testing
app.get('/support/upload-image', async (req, res) => {
    try {
        const { sessionId, merchantId, fileName } = req.query;

        if (!sessionId || !merchantId || !fileName) {
            return res.status(400).json({
                error: 'Missing required parameters: sessionId, merchantId, fileName'
            });
        }

        // For testing, return a mock presigned URL and image URL
        // In production, this would generate real S3 presigned URLs
        const mockPresignedUrl = `http://localhost:3000/support/upload/${sessionId}/${merchantId}/${fileName}`;
        const mockImageUrl = `http://localhost:3000/support/images/${sessionId}/${merchantId}/${fileName}`;

        console.log(`📤 Mock presigned URL generated for: ${fileName}`);

        res.json({
            success: true,
            presignedUrl: mockPresignedUrl,
            imageUrl: mockImageUrl,
            expiresIn: 300
        });

    } catch (error) {
        console.error('❌ Error generating mock presigned URL:', error);
        res.status(500).json({
            error: 'Failed to generate presigned URL',
            message: error.message
        });
    }
});

// Mock image upload endpoint
app.put('/support/upload/:sessionId/:merchantId/:fileName', async (req, res) => {
    try {
        const { sessionId, merchantId, fileName } = req.params;
        
        console.log(`📤 Mock image upload received: ${fileName} for session ${sessionId}`);
        console.log(`📊 Content-Type: ${req.headers['content-type']}`);
        console.log(`📏 Content-Length: ${req.headers['content-length']} bytes`);

        // Simulate successful upload
        res.status(200).send('');

    } catch (error) {
        console.error('❌ Mock upload error:', error);
        res.status(500).json({
            error: 'Upload failed',
            message: error.message
        });
    }
});

// Mock image serving endpoint
app.get('/support/images/:sessionId/:merchantId/:fileName', (req, res) => {
    const { sessionId, merchantId, fileName } = req.params;
    console.log(`🖼️ Mock image request: ${fileName} for session ${sessionId}`);
    
    // Return a placeholder image or success message
    res.json({
        message: 'Mock image uploaded successfully',
        sessionId,
        merchantId,
        fileName,
        uploadedAt: new Date().toISOString()
    });
});

startServer().catch(console.error);

module.exports = app;
