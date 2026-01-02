// Set emergency fix data in sessionStorage
const sampleCampaigns = [
    {
        name: "Summer Sale 2024",
        campaignId: "CAMP_001",
        discountType: "percentage",
        discountValue: 20,
        status: "active",
        usage: 45,
        usageLimit: 100,
        minimumOrderValue: 50,
        startDate: "2024-06-01T00:00:00Z"
    },
    {
        name: "Welcome Discount",
        campaignId: "CAMP_002", 
        discountType: "fixed",
        discountValue: 10,
        status: "active",
        usage: 12,
        usageLimit: 50,
        minimumOrderValue: 25,
        startDate: "2024-01-01T00:00:00Z"
    }
];

const sampleDiscounts = [
    {
        title: "Restaurant Special",
        discountId: "DISC_001",
        type: "percentage",
        value: 15,
        status: "active",
        usage_count: 23,
        usage_limit: 100,
        valid_to: "2024-12-31T23:59:59Z"
    },
    {
        title: "Coffee Shop Deal",
        discountId: "DISC_002",
        type: "fixed",
        value: 5,
        status: "active", 
        usage_count: 8,
        usage_limit: 200,
        valid_to: "2024-12-31T23:59:59Z"
    },
    {
        title: "Retail Discount",
        discountId: "DISC_003",
        type: "percentage",
        value: 25,
        status: "active",
        usage_count: 56,
        usage_limit: 150,
        valid_to: "2024-12-31T23:59:59Z"
    },
    {
        title: "Service Provider Deal",
        discountId: "DISC_004",
        type: "fixed",
        value: 15,
        status: "active",
        usage_count: 34,
        usage_limit: 75,
        valid_to: "2024-12-31T23:59:59Z"
    },
    {
        title: "Grocery Store Special",
        discountId: "DISC_005",
        type: "percentage",
        value: 12,
        status: "active",
        usage_count: 67,
        usage_limit: 200,
        valid_to: "2024-12-31T23:59:59Z"
    }
];

// Store in sessionStorage
sessionStorage.setItem('emergencyFixActive', 'true');
sessionStorage.setItem('sampleCampaigns', JSON.stringify(sampleCampaigns));
sessionStorage.setItem('sampleDiscounts', JSON.stringify(sampleDiscounts));
sessionStorage.setItem('fixAppliedAt', new Date().toISOString());

console.log('✅ Emergency fix data has been set in sessionStorage');
console.log('📊 Data prepared:', {
    campaigns: sampleCampaigns.length,
    discounts: sampleDiscounts.length
});
