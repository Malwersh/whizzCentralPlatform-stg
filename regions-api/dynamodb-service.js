// DynamoDB Service for Regions Management V2
// Handles all DynamoDB operations for regions

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand, GetCommand, DeleteCommand, ScanCommand, BatchWriteCommand } = require('@aws-sdk/lib-dynamodb');

class RegionsDynamoDBService {
    constructor() {
        // Initialize DynamoDB client
        const client = new DynamoDBClient({
            region: process.env.AWS_REGION || 'us-east-1'
        });
        
        this.docClient = DynamoDBDocumentClient.from(client);
        this.tableName = process.env.DYNAMODB_TABLE || 'WizzOrders-Regions-ghayth-dev';
    }

    /**
     * Save a region to DynamoDB
     */
    async saveRegion(region) {
        try {
            const item = {
                region_id: region.id,
                name: region.name,
                name_ar: region.nameAr || region.name,
                level: this.mapTypeToLevel(region.type),
                parent_id: region.parentId || 'root',
                governorate_id: region.governorateId || region.id,
                coordinates: {
                    lat: region.coordinates.lat,
                    lng: region.coordinates.lng,
                    radius: region.delivery?.radius || 10000
                },
                geocoding: region.geocoding,
                delivery_config: region.delivery,
                is_active: region.status === 'active',
                created_at: region.createdAt || new Date().toISOString(),
                updated_at: region.updatedAt || new Date().toISOString(),
                source: 'mapbox-playground'
            };

            const command = new PutCommand({
                TableName: this.tableName,
                Item: item
            });

            await this.docClient.send(command);
            console.log(`✅ Saved region to DynamoDB: ${region.name}`);
            return { success: true, item };
        } catch (error) {
            console.error('❌ Error saving to DynamoDB:', error);
            throw error;
        }
    }

    /**
     * Get a region by ID
     */
    async getRegion(regionId) {
        try {
            const command = new GetCommand({
                TableName: this.tableName,
                Key: { region_id: regionId }
            });

            const response = await this.docClient.send(command);
            return response.Item;
        } catch (error) {
            console.error('❌ Error getting region:', error);
            throw error;
        }
    }

    /**
     * Delete a region
     */
    async deleteRegion(regionId) {
        try {
            const command = new DeleteCommand({
                TableName: this.tableName,
                Key: { region_id: regionId }
            });

            await this.docClient.send(command);
            console.log(`🗑️  Deleted region from DynamoDB: ${regionId}`);
            return { success: true };
        } catch (error) {
            console.error('❌ Error deleting region:', error);
            throw error;
        }
    }

    /**
     * Get all regions
     */
    async getAllRegions() {
        try {
            const command = new ScanCommand({
                TableName: this.tableName
            });

            const response = await this.docClient.send(command);
            return response.Items || [];
        } catch (error) {
            console.error('❌ Error scanning regions:', error);
            throw error;
        }
    }

    /**
     * Batch import regions
     */
    async batchImportRegions(regions) {
        try {
            const batchSize = 25; // DynamoDB limit
            const batches = [];

            for (let i = 0; i < regions.length; i += batchSize) {
                batches.push(regions.slice(i, i + batchSize));
            }

            let successCount = 0;
            let errorCount = 0;

            for (const batch of batches) {
                const writeRequests = batch.map(region => ({
                    PutRequest: {
                        Item: {
                            region_id: region.id,
                            name: region.name,
                            name_ar: region.nameAr || region.name,
                            level: this.mapTypeToLevel(region.type),
                            parent_id: region.parentId || 'root',
                            governorate_id: region.governorateId || region.id,
                            coordinates: region.coordinates,
                            geocoding: region.geocoding,
                            delivery_config: region.delivery,
                            is_active: region.status === 'active',
                            created_at: region.createdAt || new Date().toISOString(),
                            updated_at: new Date().toISOString(),
                            source: 'mapbox-playground-bulk'
                        }
                    }
                }));

                const command = new BatchWriteCommand({
                    RequestItems: {
                        [this.tableName]: writeRequests
                    }
                });

                try {
                    await this.docClient.send(command);
                    successCount += batch.length;
                    console.log(`✅ Batch imported ${batch.length} regions`);
                } catch (error) {
                    errorCount += batch.length;
                    console.error(`❌ Error in batch:`, error);
                }
            }

            return {
                success: true,
                imported: successCount,
                failed: errorCount,
                total: regions.length
            };
        } catch (error) {
            console.error('❌ Error batch importing:', error);
            throw error;
        }
    }

    /**
     * Map playground type to DynamoDB level
     */
    mapTypeToLevel(type) {
        const mapping = {
            'country': 'country',
            'region': 'governorate',
            'place': 'governorate',
            'district': 'district',
            'locality': 'district',
            'neighborhood': 'neighborhood'
        };
        return mapping[type] || 'district';
    }

    /**
     * Check if DynamoDB is accessible
     */
    async healthCheck() {
        try {
            const command = new ScanCommand({
                TableName: this.tableName,
                Limit: 1
            });

            await this.docClient.send(command);
            return { 
                status: 'healthy', 
                table: this.tableName,
                connected: true 
            };
        } catch (error) {
            return { 
                status: 'unhealthy', 
                table: this.tableName,
                connected: false,
                error: error.message 
            };
        }
    }
}

module.exports = RegionsDynamoDBService;
