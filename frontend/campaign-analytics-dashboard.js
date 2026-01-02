// WizzCentral Campaign Analytics Dashboard
// Real-time analytics and reporting for campaign performance
// Author: WizzCentral Dev Team
// Version: 1.0

class CampaignAnalyticsDashboard {
    constructor() {
        this.analytics = new Map();
        this.liveMetrics = new Map();
        this.chartInstances = new Map();
        this.refreshInterval = null;
        this.conditionEngine = null;
        this.init();
    }

    init() {
        this.setupEventListeners();
        this.initializeCharts();
        this.startLiveUpdates();
    }

    // ============ ANALYTICS DATA COLLECTION ============

    async collectCampaignMetrics(campaignId, timeRange = '24h') {
        try {
            const metrics = {
                campaignId,
                timeRange,
                timestamp: new Date().toISOString(),
                
                // Core Performance Metrics
                totalRedemptions: await this.getTotalRedemptions(campaignId, timeRange),
                uniqueCustomers: await this.getUniqueCustomers(campaignId, timeRange),
                conversionRate: await this.getConversionRate(campaignId, timeRange),
                
                // Revenue Impact
                totalRevenue: await this.getCampaignRevenue(campaignId, timeRange),
                avgOrderValue: await this.getAverageOrderValue(campaignId, timeRange),
                revenueGrowth: await this.getRevenueGrowth(campaignId, timeRange),
                
                // Condition Performance
                conditionEffectiveness: await this.analyzeConditionEffectiveness(campaignId, timeRange),
                customerSegmentPerformance: await this.getSegmentPerformance(campaignId, timeRange),
                
                // Geographic Performance
                locationBreakdown: await this.getLocationBreakdown(campaignId, timeRange),
                restaurantPerformance: await this.getRestaurantPerformance(campaignId, timeRange),
                
                // Time-based Analysis
                hourlyDistribution: await this.getHourlyDistribution(campaignId, timeRange),
                peakUsageTimes: await this.getPeakUsageTimes(campaignId, timeRange),
                
                // Customer Behavior
                newVsReturning: await this.getNewVsReturningCustomers(campaignId, timeRange),
                customerLifetimeValue: await this.getCustomerLifetimeValue(campaignId, timeRange),
                
                // Condition-Specific Analytics
                conditionTriggerRates: await this.getConditionTriggerRates(campaignId, timeRange),
                conditionConversionRates: await this.getConditionConversionRates(campaignId, timeRange)
            };

            this.analytics.set(campaignId, metrics);
            return metrics;
        } catch (error) {
            console.error('Error collecting campaign metrics:', error);
            throw error;
        }
    }

    // ============ CONDITION ANALYTICS ============

    async analyzeConditionEffectiveness(campaignId, timeRange) {
        const conditions = await this.getCampaignConditions(campaignId);
        const effectiveness = {};

        for (const condition of conditions) {
            const triggerRate = await this.getConditionTriggerRate(condition.id, timeRange);
            const conversionRate = await this.getConditionConversionRate(condition.id, timeRange);
            const revenueImpact = await this.getConditionRevenueImpact(condition.id, timeRange);

            effectiveness[condition.id] = {
                name: condition.name,
                type: condition.type,
                triggerRate,
                conversionRate,
                revenueImpact,
                effectiveness: this.calculateEffectivenessScore(triggerRate, conversionRate, revenueImpact),
                recommendations: this.generateConditionRecommendations(condition, triggerRate, conversionRate)
            };
        }

        return effectiveness;
    }

    calculateEffectivenessScore(triggerRate, conversionRate, revenueImpact) {
        // Weighted scoring algorithm
        const triggerWeight = 0.3;
        const conversionWeight = 0.4;
        const revenueWeight = 0.3;

        return (triggerRate * triggerWeight + 
                conversionRate * conversionWeight + 
                revenueImpact * revenueWeight);
    }

    generateConditionRecommendations(condition, triggerRate, conversionRate) {
        const recommendations = [];

        if (triggerRate < 0.1) {
            recommendations.push({
                type: 'low_trigger',
                message: 'Condition triggers infrequently. Consider relaxing criteria.',
                priority: 'medium'
            });
        }

        if (conversionRate < 0.05) {
            recommendations.push({
                type: 'low_conversion',
                message: 'Low conversion rate. Review condition relevance and offer value.',
                priority: 'high'
            });
        }

        if (triggerRate > 0.8) {
            recommendations.push({
                type: 'over_triggering',
                message: 'Condition triggers very frequently. Consider tightening criteria to improve targeting.',
                priority: 'medium'
            });
        }

        return recommendations;
    }

    // ============ REAL-TIME CUSTOMER SEGMENTATION ANALYSIS ============

    async analyzeCustomerSegments(campaignId) {
        const segments = {
            newCustomers: await this.analyzeNewCustomerBehavior(campaignId),
            vipCustomers: await this.analyzeVIPCustomerBehavior(campaignId),
            locationBased: await this.analyzeLocationBasedSegments(campaignId),
            behaviorBased: await this.analyzeBehaviorBasedSegments(campaignId),
            timeBasedSegments: await this.analyzeTimeBasedSegments(campaignId)
        };

        return segments;
    }

    async analyzeNewCustomerBehavior(campaignId) {
        return {
            totalNewCustomers: await this.getNewCustomerCount(campaignId),
            avgFirstOrderValue: await this.getAvgFirstOrderValue(campaignId),
            retentionRate: await this.getNewCustomerRetentionRate(campaignId),
            mostPopularOffers: await this.getMostPopularOffersForNewCustomers(campaignId),
            conversionFunnel: await this.getNewCustomerConversionFunnel(campaignId)
        };
    }

    async analyzeVIPCustomerBehavior(campaignId) {
        return {
            totalVIPCustomers: await this.getVIPCustomerCount(campaignId),
            avgOrderValue: await this.getVIPAvgOrderValue(campaignId),
            revenueContribution: await this.getVIPRevenueContribution(campaignId),
            engagementRate: await this.getVIPEngagementRate(campaignId),
            preferredOfferTypes: await this.getVIPPreferredOffers(campaignId)
        };
    }

    // ============ PREDICTIVE ANALYTICS ============

    async generatePredictiveInsights(campaignId) {
        const insights = {
            projectedPerformance: await this.projectCampaignPerformance(campaignId),
            optimalTiming: await this.findOptimalTiming(campaignId),
            audienceExpansion: await this.identifyAudienceExpansionOpportunities(campaignId),
            budgetOptimization: await this.generateBudgetOptimizationRecommendations(campaignId),
            seasonalTrends: await this.analyzeSeasonalTrends(campaignId)
        };

        return insights;
    }

    async projectCampaignPerformance(campaignId) {
        const historicalData = await this.getHistoricalPerformance(campaignId);
        const currentTrends = await this.getCurrentTrends(campaignId);
        
        // Simple linear projection - can be enhanced with ML models
        const projectedRedemptions = this.extrapolateMetric(historicalData.redemptions, currentTrends.redemptionTrend);
        const projectedRevenue = this.extrapolateMetric(historicalData.revenue, currentTrends.revenueTrend);

        return {
            next7Days: {
                redemptions: projectedRedemptions.next7Days,
                revenue: projectedRevenue.next7Days,
                confidence: 0.75
            },
            next30Days: {
                redemptions: projectedRedemptions.next30Days,
                revenue: projectedRevenue.next30Days,
                confidence: 0.60
            }
        };
    }

    // ============ DASHBOARD RENDERING ============

    renderDashboard(containerId) {
        const container = document.getElementById(containerId);
        if (!container) {
            console.error('Dashboard container not found');
            return;
        }

        container.innerHTML = `
            <div class="analytics-dashboard">
                <div class="dashboard-header">
                    <h2><i class="fas fa-chart-line"></i> Campaign Analytics Dashboard</h2>
                    <div class="dashboard-controls">
                        <select id="campaignSelect" class="form-control">
                            <option value="">Select Campaign</option>
                        </select>
                        <select id="timeRangeSelect" class="form-control">
                            <option value="1h">Last Hour</option>
                            <option value="24h" selected>Last 24 Hours</option>
                            <option value="7d">Last 7 Days</option>
                            <option value="30d">Last 30 Days</option>
                        </select>
                        <button id="refreshBtn" class="btn btn-primary">
                            <i class="fas fa-sync"></i> Refresh
                        </button>
                    </div>
                </div>

                <div class="metrics-grid">
                    <div class="metric-card primary">
                        <div class="metric-icon"><i class="fas fa-users"></i></div>
                        <div class="metric-content">
                            <h3 id="totalRedemptions">0</h3>
                            <p>Total Redemptions</p>
                            <span class="metric-change" id="redemptionsChange">+0%</span>
                        </div>
                    </div>

                    <div class="metric-card success">
                        <div class="metric-icon"><i class="fas fa-dollar-sign"></i></div>
                        <div class="metric-content">
                            <h3 id="totalRevenue">$0</h3>
                            <p>Revenue Generated</p>
                            <span class="metric-change" id="revenueChange">+0%</span>
                        </div>
                    </div>

                    <div class="metric-card info">
                        <div class="metric-icon"><i class="fas fa-percentage"></i></div>
                        <div class="metric-content">
                            <h3 id="conversionRate">0%</h3>
                            <p>Conversion Rate</p>
                            <span class="metric-change" id="conversionChange">+0%</span>
                        </div>
                    </div>

                    <div class="metric-card warning">
                        <div class="metric-icon"><i class="fas fa-shopping-cart"></i></div>
                        <div class="metric-content">
                            <h3 id="avgOrderValue">$0</h3>
                            <p>Avg Order Value</p>
                            <span class="metric-change" id="aovChange">+0%</span>
                        </div>
                    </div>
                </div>

                <div class="charts-section">
                    <div class="chart-container">
                        <h3>Performance Over Time</h3>
                        <canvas id="performanceChart"></canvas>
                    </div>

                    <div class="chart-container">
                        <h3>Condition Effectiveness</h3>
                        <canvas id="conditionChart"></canvas>
                    </div>

                    <div class="chart-container">
                        <h3>Customer Segments</h3>
                        <canvas id="segmentChart"></canvas>
                    </div>

                    <div class="chart-container">
                        <h3>Geographic Distribution</h3>
                        <canvas id="geoChart"></canvas>
                    </div>
                </div>

                <div class="insights-section">
                    <div class="insights-card">
                        <h3><i class="fas fa-lightbulb"></i> Key Insights</h3>
                        <div id="keyInsights" class="insights-list"></div>
                    </div>

                    <div class="recommendations-card">
                        <h3><i class="fas fa-rocket"></i> Recommendations</h3>
                        <div id="recommendations" class="recommendations-list"></div>
                    </div>
                </div>

                <div class="condition-performance-section">
                    <h3><i class="fas fa-cogs"></i> Condition Performance Analysis</h3>
                    <div id="conditionPerformanceTable" class="performance-table"></div>
                </div>

                <div class="predictive-section">
                    <h3><i class="fas fa-crystal-ball"></i> Predictive Analytics</h3>
                    <div id="predictiveInsights" class="predictive-cards"></div>
                </div>
            </div>
        `;

        this.bindEventListeners();
        this.loadInitialData();
    }

    // ============ CHART INITIALIZATION ============

    initializeCharts() {
        // Performance Over Time Chart
        this.chartInstances.set('performance', {
            type: 'line',
            options: {
                responsive: true,
                plugins: {
                    title: {
                        display: true,
                        text: 'Campaign Performance Trends'
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true
                    }
                }
            }
        });

        // Condition Effectiveness Chart
        this.chartInstances.set('condition', {
            type: 'radar',
            options: {
                responsive: true,
                plugins: {
                    title: {
                        display: true,
                        text: 'Condition Effectiveness Radar'
                    }
                }
            }
        });

        // Customer Segments Chart
        this.chartInstances.set('segment', {
            type: 'doughnut',
            options: {
                responsive: true,
                plugins: {
                    title: {
                        display: true,
                        text: 'Customer Segment Distribution'
                    }
                }
            }
        });
    }

    // ============ REAL-TIME UPDATES ============

    startLiveUpdates() {
        this.refreshInterval = setInterval(() => {
            this.updateLiveMetrics();
        }, 30000); // Update every 30 seconds
    }

    async updateLiveMetrics() {
        const selectedCampaign = document.getElementById('campaignSelect')?.value;
        const timeRange = document.getElementById('timeRangeSelect')?.value || '24h';

        if (selectedCampaign) {
            const metrics = await this.collectCampaignMetrics(selectedCampaign, timeRange);
            this.updateDashboardMetrics(metrics);
            this.updateCharts(metrics);
            this.updateInsights(metrics);
        }
    }

    updateDashboardMetrics(metrics) {
        const elements = {
            totalRedemptions: document.getElementById('totalRedemptions'),
            totalRevenue: document.getElementById('totalRevenue'),
            conversionRate: document.getElementById('conversionRate'),
            avgOrderValue: document.getElementById('avgOrderValue')
        };

        if (elements.totalRedemptions) elements.totalRedemptions.textContent = metrics.totalRedemptions.toLocaleString();
        if (elements.totalRevenue) elements.totalRevenue.textContent = `$${metrics.totalRevenue.toFixed(2)}`;
        if (elements.conversionRate) elements.conversionRate.textContent = `${(metrics.conversionRate * 100).toFixed(1)}%`;
        if (elements.avgOrderValue) elements.avgOrderValue.textContent = `$${metrics.avgOrderValue.toFixed(2)}`;
    }

    // ============ EVENT HANDLERS ============

    bindEventListeners() {
        const campaignSelect = document.getElementById('campaignSelect');
        const timeRangeSelect = document.getElementById('timeRangeSelect');
        const refreshBtn = document.getElementById('refreshBtn');

        if (campaignSelect) {
            campaignSelect.addEventListener('change', () => this.onCampaignChanged());
        }

        if (timeRangeSelect) {
            timeRangeSelect.addEventListener('change', () => this.onTimeRangeChanged());
        }

        if (refreshBtn) {
            refreshBtn.addEventListener('click', () => this.refreshDashboard());
        }
    }

    async onCampaignChanged() {
        const selectedCampaign = document.getElementById('campaignSelect').value;
        if (selectedCampaign) {
            await this.loadCampaignData(selectedCampaign);
        }
    }

    async onTimeRangeChanged() {
        await this.refreshDashboard();
    }

    async refreshDashboard() {
        const refreshBtn = document.getElementById('refreshBtn');
        if (refreshBtn) {
            refreshBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Refreshing...';
            refreshBtn.disabled = true;
        }

        try {
            await this.updateLiveMetrics();
        } finally {
            if (refreshBtn) {
                refreshBtn.innerHTML = '<i class="fas fa-sync"></i> Refresh';
                refreshBtn.disabled = false;
            }
        }
    }

    // ============ DATA FETCHING METHODS (TO BE INTEGRATED WITH BACKEND) ============

    async getTotalRedemptions(campaignId, timeRange) {
        // Mock implementation - replace with actual API call
        return Math.floor(Math.random() * 1000) + 500;
    }

    async getUniqueCustomers(campaignId, timeRange) {
        return Math.floor(Math.random() * 200) + 100;
    }

    async getConversionRate(campaignId, timeRange) {
        return (Math.random() * 0.1) + 0.05; // 5-15%
    }

    async getCampaignRevenue(campaignId, timeRange) {
        return (Math.random() * 10000) + 5000;
    }

    async getAverageOrderValue(campaignId, timeRange) {
        return (Math.random() * 50) + 25;
    }

    // ============ UTILITY METHODS ============

    generateInsights(metrics) {
        const insights = [];

        if (metrics.conversionRate > 0.1) {
            insights.push({
                type: 'success',
                title: 'High Conversion Rate',
                description: `Your campaign is performing exceptionally well with a ${(metrics.conversionRate * 100).toFixed(1)}% conversion rate.`
            });
        }

        if (metrics.totalRedemptions > 1000) {
            insights.push({
                type: 'info',
                title: 'High Engagement',
                description: 'Your campaign is generating significant customer engagement with over 1,000 redemptions.'
            });
        }

        return insights;
    }

    formatCurrency(amount) {
        return new Intl.NumberFormat('en-US', {
            style: 'currency',
            currency: 'USD'
        }).format(amount);
    }

    formatPercentage(value) {
        return `${(value * 100).toFixed(1)}%`;
    }

    // ============ CLEANUP ============

    destroy() {
        if (this.refreshInterval) {
            clearInterval(this.refreshInterval);
        }

        this.chartInstances.forEach(chart => {
            if (chart.destroy) chart.destroy();
        });

        this.chartInstances.clear();
        this.analytics.clear();
        this.liveMetrics.clear();
    }
}

// Enhanced Real-time Analytics Dashboard with Live Backend Integration
// Connects to production APIs for real-time data

class EnhancedCampaignAnalyticsDashboard extends CampaignAnalyticsDashboard {
    constructor() {
        super();
        this.apiEndpoint = this.getApiEndpoint();
        this.authToken = this.getAuthToken();
        this.websocketConnection = null;
        this.realTimeEnabled = true;
        this.refreshIntervals = new Map();
        
        // Performance optimization settings
        this.cacheTimeout = 30000; // 30 seconds
        this.batchSize = 50;
        this.maxConcurrentRequests = 10;
        
        this.initializeRealTimeConnections();
    }
    
    getApiEndpoint() {
        // Get API endpoint from environment or configuration
        return window.WIZZCENTRAL_CONFIG?.API_ENDPOINT || 
               localStorage.getItem('apiEndpoint') || 
               'https://api.wizzcentral.com/v1';
    }
    
    getAuthToken() {
        // Get authentication token
        return localStorage.getItem('authToken') || sessionStorage.getItem('authToken');
    }
    
    async initializeRealTimeConnections() {
        try {
            // Initialize WebSocket for real-time updates
            await this.initializeWebSocket();
            
            // Start real-time data streams
            this.startRealTimeMetrics();
            
            // Initialize performance monitoring
            this.initializePerformanceMonitoring();
            
            log_success("Real-time analytics dashboard initialized successfully");
        } catch (error) {
            log_error("Failed to initialize real-time connections:", error);
            this.fallbackToPolling();
        }
    }
    
    async initializeWebSocket() {
        try {
            const wsUrl = this.apiEndpoint.replace('https://', 'wss://').replace('http://', 'ws://') + '/websocket';
            this.websocketConnection = new WebSocket(wsUrl);
            
            this.websocketConnection.onopen = () => {
                log_info("WebSocket connection established");
                this.sendWebSocketAuth();
            };
            
            this.websocketConnection.onmessage = (event) => {
                this.handleWebSocketMessage(JSON.parse(event.data));
            };
            
            this.websocketConnection.onclose = () => {
                log_warning("WebSocket connection closed, attempting to reconnect...");
                setTimeout(() => this.initializeWebSocket(), 5000);
            };
            
            this.websocketConnection.onerror = (error) => {
                log_error("WebSocket error:", error);
            };
        } catch (error) {
            log_error("Failed to initialize WebSocket:", error);
            throw error;
        }
    }
    
    sendWebSocketAuth() {
        if (this.websocketConnection && this.websocketConnection.readyState === WebSocket.OPEN) {
            this.websocketConnection.send(JSON.stringify({
                type: 'auth',
                token: this.authToken
            }));
        }
    }
    
    handleWebSocketMessage(message) {
        try {
            switch (message.type) {
                case 'campaign_metrics_update':
                    this.updateCampaignMetrics(message.data);
                    break;
                case 'condition_evaluation':
                    this.updateConditionMetrics(message.data);
                    break;
                case 'real_time_analytics':
                    this.updateRealTimeAnalytics(message.data);
                    break;
                case 'alert':
                    this.handleRealTimeAlert(message.data);
                    break;
                default:
                    log_info("Unknown WebSocket message type:", message.type);
            }
        } catch (error) {
            log_error("Error handling WebSocket message:", error);
        }
    }
    
    // ============ ENHANCED DATA COLLECTION ============
    
    async collectCampaignMetrics(campaignId, timeRange = '24h') {
        try {
            // Check cache first
            const cacheKey = `campaign_metrics_${campaignId}_${timeRange}`;
            const cachedData = this.getCachedData(cacheKey);
            
            if (cachedData) {
                return cachedData;
            }
            
            // Fetch from API
            const response = await this.makeAPIRequest(`/analytics/${campaignId}`, {
                timeRange: timeRange,
                detailed: true,
                includeSegmentation: true
            });
            
            if (!response.ok) {
                throw new Error(`API request failed: ${response.status}`);
            }
            
            const metrics = await response.json();
            
            // Process and enhance metrics
            const enhancedMetrics = await this.enhanceMetricsData(metrics, campaignId);
            
            // Cache the data
            this.setCachedData(cacheKey, enhancedMetrics, this.cacheTimeout);
            
            // Update analytics storage
            this.analytics.set(campaignId, enhancedMetrics);
            
            return enhancedMetrics;
            
        } catch (error) {
            log_error(`Error collecting campaign metrics for ${campaignId}:`, error);
            return this.getFallbackMetrics(campaignId);
        }
    }
    
    async enhanceMetricsData(baseMetrics, campaignId) {
        try {
            const enhanced = {
                ...baseMetrics,
                
                // Real-time calculations
                realTimeMetrics: await this.calculateRealTimeMetrics(campaignId),
                
                // Predictive analytics
                predictiveInsights: await this.generatePredictiveInsights(campaignId, baseMetrics),
                
                // Comparison data
                comparisonData: await this.getComparisonData(campaignId, baseMetrics),
                
                // Performance indicators
                performanceIndicators: this.calculatePerformanceIndicators(baseMetrics),
                
                // Geographic distribution
                geographicDistribution: await this.getGeographicDistribution(campaignId),
                
                // Customer segmentation
                customerSegmentation: await this.getDetailedCustomerSegmentation(campaignId),
                
                // Optimization recommendations
                optimizationRecommendations: this.generateOptimizationRecommendations(baseMetrics)
            };
            
            return enhanced;
        } catch (error) {
            log_error("Error enhancing metrics data:", error);
            return baseMetrics;
        }
    }
    
    async calculateRealTimeMetrics(campaignId) {
        try {
            const response = await this.makeAPIRequest(`/analytics/${campaignId}/realtime`);
            
            if (response.ok) {
                const data = await response.json();
                return {
                    activeEvaluations: data.activeEvaluations || 0,
                    currentConversionRate: data.currentConversionRate || 0,
                    recentMatches: data.recentMatches || [],
                    performanceTrend: data.performanceTrend || 'stable',
                    lastUpdated: new Date().toISOString()
                };
            }
            
            return this.getMockRealTimeMetrics();
        } catch (error) {
            log_error("Error calculating real-time metrics:", error);
            return this.getMockRealTimeMetrics();
        }
    }
    
    async generatePredictiveInsights(campaignId, baseMetrics) {
        try {
            const response = await this.makeAPIRequest(`/analytics/${campaignId}/predictions`, {
                method: 'POST',
                body: JSON.stringify({
                    historicalData: baseMetrics,
                    timeHorizon: '7d',
                    confidenceLevel: 0.95
                })
            });
            
            if (response.ok) {
                return await response.json();
            }
            
            // Fallback to local prediction calculations
            return this.calculateLocalPredictions(baseMetrics);
        } catch (error) {
            log_error("Error generating predictive insights:", error);
            return this.calculateLocalPredictions(baseMetrics);
        }
    }
    
    calculateLocalPredictions(baseMetrics) {
        // Simple local prediction logic
        const conversionRate = baseMetrics.conversionRate || 0;
        const totalEvaluations = baseMetrics.totalEvaluations || 0;
        
        return {
            projectedConversions: Math.round(totalEvaluations * 0.1 * (conversionRate / 100)),
            trendDirection: conversionRate > 5 ? 'increasing' : 'stable',
            confidenceScore: 0.75,
            recommendedActions: this.getRecommendedActions(baseMetrics)
        };
    }
    
    async getComparisonData(campaignId, currentMetrics) {
        try {
            const response = await this.makeAPIRequest(`/analytics/${campaignId}/comparison`, {
                comparisonPeriod: 'previous_week',
                metrics: ['conversionRate', 'totalRevenue', 'uniqueCustomers']
            });
            
            if (response.ok) {
                return await response.json();
            }
            
            return this.getMockComparisonData(currentMetrics);
        } catch (error) {
            log_error("Error getting comparison data:", error);
            return this.getMockComparisonData(currentMetrics);
        }
    }
    
    async getDetailedCustomerSegmentation(campaignId) {
        try {
            const response = await this.makeAPIRequest(`/analytics/${campaignId}/segmentation`);
            
            if (response.ok) {
                const data = await response.json();
                return {
                    byLoyaltyTier: data.byLoyaltyTier || {},
                    byGeography: data.byGeography || {},
                    byOrderValue: data.byOrderValue || {},
                    byEngagement: data.byEngagement || {},
                    customSegments: data.customSegments || []
                };
            }
            
            return this.getMockSegmentationData();
        } catch (error) {
            log_error("Error getting customer segmentation:", error);
            return this.getMockSegmentationData();
        }
    }
    
    async getGeographicDistribution(campaignId) {
        try {
            const response = await this.makeAPIRequest(`/analytics/${campaignId}/geographic`);
            
            if (response.ok) {
                return await response.json();
            }
            
            return this.getMockGeographicData();
        } catch (error) {
            log_error("Error getting geographic distribution:", error);
            return this.getMockGeographicData();
        }
    }
    
    // ============ ENHANCED API INTEGRATION ============
    
    async makeAPIRequest(endpoint, options = {}) {
        try {
            const url = `${this.apiEndpoint}${endpoint}`;
            const requestOptions = {
                method: options.method || 'GET',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.authToken}`,
                    ...options.headers
                },
                ...options
            };
            
            // Add query parameters for GET requests
            if (requestOptions.method === 'GET' && options.query) {
                const params = new URLSearchParams(options.query);
                url += `?${params.toString()}`;
            }
            
            const response = await fetch(url, requestOptions);
            return response;
        } catch (error) {
            log_error("API request failed:", error);
            throw error;
        }
    }
    
    // ============ ENHANCED CHART RENDERING ============
    
    async renderEnhancedCharts() {
        try {
            // Render all chart types with enhanced data
            await Promise.all([
                this.renderRealTimeMetricsChart(),
                this.renderPredictiveAnalyticsChart(),
                this.renderCustomerSegmentationChart(),
                this.renderGeographicHeatmap(),
                this.renderPerformanceComparisonChart(),
                this.renderConditionEffectivenessChart()
            ]);
            
            log_success("All enhanced charts rendered successfully");
        } catch (error) {
            log_error("Error rendering enhanced charts:", error);
        }
    }
    
    async renderRealTimeMetricsChart() {
        const container = document.getElementById('realtime-metrics-chart');
        if (!container) return;
        
        // Get real-time data
        const realTimeData = await this.getRealTimeMetricsData();
        
        const config = {
            type: 'line',
            data: {
                labels: realTimeData.timestamps,
                datasets: [{
                    label: 'Live Conversions',
                    data: realTimeData.conversions,
                    borderColor: '#10B981',
                    backgroundColor: 'rgba(16, 185, 129, 0.1)',
                    tension: 0.4,
                    pointRadius: 3,
                    pointHoverRadius: 6
                }, {
                    label: 'Active Evaluations',
                    data: realTimeData.evaluations,
                    borderColor: '#3B82F6',
                    backgroundColor: 'rgba(59, 130, 246, 0.1)',
                    tension: 0.4,
                    pointRadius: 3,
                    pointHoverRadius: 6
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                animation: {
                    duration: 750,
                    easing: 'easeInOutQuart'
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        grid: {
                            color: 'rgba(156, 163, 175, 0.1)'
                        }
                    },
                    x: {
                        grid: {
                            color: 'rgba(156, 163, 175, 0.1)'
                        }
                    }
                },
                plugins: {
                    legend: {
                        position: 'top'
                    },
                    tooltip: {
                        mode: 'index',
                        intersect: false
                    }
                }
            }
        };
        
        if (this.chartInstances.has('realtime-metrics')) {
            this.chartInstances.get('realtime-metrics').destroy();
        }
        
        const chart = new Chart(container, config);
        this.chartInstances.set('realtime-metrics', chart);
    }
    
    async renderPredictiveAnalyticsChart() {
        const container = document.getElementById('predictive-analytics-chart');
        if (!container) return;
        
        const predictiveData = await this.getPredictiveAnalyticsData();
        
        const config = {
            type: 'line',
            data: {
                labels: predictiveData.futureDates,
                datasets: [{
                    label: 'Historical Performance',
                    data: predictiveData.historical,
                    borderColor: '#6B7280',
                    backgroundColor: 'rgba(107, 114, 128, 0.1)',
                    borderDash: [0]
                }, {
                    label: 'Predicted Performance',
                    data: predictiveData.predicted,
                    borderColor: '#F59E0B',
                    backgroundColor: 'rgba(245, 158, 11, 0.1)',
                    borderDash: [5, 5]
                }, {
                    label: 'Confidence Interval',
                    data: predictiveData.confidenceUpper,
                    borderColor: 'rgba(245, 158, 11, 0.3)',
                    backgroundColor: 'rgba(245, 158, 11, 0.05)',
                    fill: '+1'
                }, {
                    label: 'Confidence Interval Lower',
                    data: predictiveData.confidenceLower,
                    borderColor: 'rgba(245, 158, 11, 0.3)',
                    backgroundColor: 'rgba(245, 158, 11, 0.05)',
                    fill: false
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        display: true,
                        position: 'top'
                    },
                    title: {
                        display: true,
                        text: 'Performance Prediction with Confidence Intervals'
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true
                    }
                }
            }
        };
        
        if (this.chartInstances.has('predictive-analytics')) {
            this.chartInstances.get('predictive-analytics').destroy();
        }
        
        const chart = new Chart(container, config);
        this.chartInstances.set('predictive-analytics', chart);
    }
    
    // ============ REAL-TIME UPDATES ============
    
    startRealTimeMetrics() {
        if (!this.realTimeEnabled) return;
        
        // Update metrics every 5 seconds
        this.refreshIntervals.set('metrics', setInterval(() => {
            this.updateAllMetrics();
        }, 5000));
        
        // Update charts every 10 seconds
        this.refreshIntervals.set('charts', setInterval(() => {
            this.updateRealTimeCharts();
        }, 10000));
        
        // Update dashboard summary every 15 seconds
        this.refreshIntervals.set('summary', setInterval(() => {
            this.updateDashboardSummary();
        }, 15000));
    }
    
    async updateAllMetrics() {
        try {
            const activeCampaigns = this.getActiveCampaignIds();
            
            // Update metrics for all active campaigns
            const updatePromises = activeCampaigns.map(campaignId => 
                this.collectCampaignMetrics(campaignId, '1h')
            );
            
            await Promise.all(updatePromises);
            
            // Trigger UI updates
            this.triggerMetricsUpdate();
        } catch (error) {
            log_error("Error updating all metrics:", error);
        }
    }
    
    updateCampaignMetrics(data) {
        try {
            const { campaignId, metrics } = data;
            
            // Update stored metrics
            this.analytics.set(campaignId, metrics);
            
            // Update UI elements
            this.updateCampaignCard(campaignId, metrics);
            this.updateMetricCards(metrics);
            
            // Update relevant charts
            this.updateCampaignCharts(campaignId);
        } catch (error) {
            log_error("Error updating campaign metrics:", error);
        }
    }
    
    updateConditionMetrics(data) {
        try {
            const { conditionId, evaluationResult, timestamp } = data;
            
            // Update condition performance tracking
            this.updateConditionPerformance(conditionId, evaluationResult);
            
            // Update condition effectiveness chart
            this.updateConditionEffectivenessChart();
            
            // Show real-time notification if significant
            if (this.isSignificantEvent(evaluationResult)) {
                this.showRealTimeNotification(data);
            }
        } catch (error) {
            log_error("Error updating condition metrics:", error);
        }
    }
    
    // ============ PERFORMANCE MONITORING ============
    
    initializePerformanceMonitoring() {
        this.performanceMetrics = {
            apiResponseTimes: [],
            chartRenderTimes: [],
            updateFrequency: 0,
            errorRate: 0
        };
        
        // Monitor API performance
        this.monitorAPIPerformance();
        
        // Monitor chart rendering performance
        this.monitorChartPerformance();
        
        // Monitor overall dashboard performance
        this.monitorDashboardPerformance();
    }
    
    monitorAPIPerformance() {
        const originalMakeRequest = this.makeAPIRequest.bind(this);
        
        this.makeAPIRequest = async function(endpoint, options = {}) {
            const startTime = performance.now();
            
            try {
                const response = await originalMakeRequest(endpoint, options);
                const endTime = performance.now();
                
                this.performanceMetrics.apiResponseTimes.push(endTime - startTime);
                
                // Keep only last 100 measurements
                if (this.performanceMetrics.apiResponseTimes.length > 100) {
                    this.performanceMetrics.apiResponseTimes.shift();
                }
                
                return response;
            } catch (error) {
                this.performanceMetrics.errorRate++;
                throw error;
            }
        }.bind(this);
    }
    
    // ============ UTILITY FUNCTIONS ============
    
    getCachedData(key) {
        const cached = localStorage.getItem(`dashboard_cache_${key}`);
        if (cached) {
            const { data, timestamp } = JSON.parse(cached);
            if (Date.now() - timestamp < this.cacheTimeout) {
                return data;
            }
        }
        return null;
    }
    
    setCachedData(key, data, timeout) {
        try {
            const cacheItem = {
                data: data,
                timestamp: Date.now()
            };
            localStorage.setItem(`dashboard_cache_${key}`, JSON.stringify(cacheItem));
        } catch (error) {
            log_warning("Failed to cache data:", error);
        }
    }
    
    getActiveCampaignIds() {
        // Get list of active campaign IDs from the current context
        return Array.from(this.analytics.keys()).slice(0, 10);
    }
    
    fallbackToPolling() {
        log_info("Falling back to polling mode for data updates");
        this.realTimeEnabled = false;
        
        // Start polling every 30 seconds
        setInterval(() => {
            this.updateAllMetrics();
        }, 30000);
    }
    
    // Mock data functions for fallback scenarios
    getMockRealTimeMetrics() {
        return {
            activeEvaluations: Math.floor(Math.random() * 100),
            currentConversionRate: Math.random() * 15,
            recentMatches: [],
            performanceTrend: 'stable',
            lastUpdated: new Date().toISOString()
        };
    }
    
    getMockComparisonData(currentMetrics) {
        return {
            previousPeriod: {
                conversionRate: (currentMetrics.conversionRate || 0) * 0.9,
                totalRevenue: (currentMetrics.totalRevenue || 0) * 0.85,
                uniqueCustomers: (currentMetrics.uniqueCustomers || 0) * 0.95
            },
            changePercentage: {
                conversionRate: 10.5,
                totalRevenue: 15.2,
                uniqueCustomers: 5.3
            }
        };
    }
    
    getMockSegmentationData() {
        return {
            byLoyaltyTier: {
                'bronze': 45,
                'silver': 35,
                'gold': 15,
                'platinum': 5
            },
            byGeography: {
                'urban': 60,
                'suburban': 30,
                'rural': 10
            },
            byOrderValue: {
                'low': 40,
                'medium': 35,
                'high': 25
            }
        };
    }
    
    getMockGeographicData() {
        return {
            regions: [
                { name: 'North America', percentage: 45, count: 1250 },
                { name: 'Europe', percentage: 30, count: 850 },
                { name: 'Asia Pacific', percentage: 20, count: 600 },
                { name: 'Other', percentage: 5, count: 150 }
            ]
        };
    }
    
    destroy() {
        // Clean up real-time connections and intervals
        if (this.websocketConnection) {
            this.websocketConnection.close();
        }
        
        for (const [key, interval] of this.refreshIntervals) {
            clearInterval(interval);
        }
        
        super.destroy();
    }
}

// Export for use
window.CampaignAnalyticsDashboard = CampaignAnalyticsDashboard;

// Auto-initialize if container exists
document.addEventListener('DOMContentLoaded', () => {
    const dashboardContainer = document.getElementById('campaignAnalyticsDashboard');
    if (dashboardContainer) {
        const dashboard = new EnhancedCampaignAnalyticsDashboard();
        dashboard.renderDashboard('campaignAnalyticsDashboard');
        window.campaignDashboard = dashboard;
    }
});
