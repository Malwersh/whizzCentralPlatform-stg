// Campaign Condition Configuration UI
// Interactive interface for building sophisticated campaign conditions
// Author: WizzCentral Dev Team

class ConditionConfigUI {
    constructor(containerId, conditionEngine) {
        this.container = document.getElementById(containerId);
        this.conditionEngine = conditionEngine;
        this.selectedConditions = [];
        this.init();
    }

    init() {
        if (!this.container) {
            console.error('Condition config container not found');
            return;
        }
        this.render();
        this.bindEvents();
    }

    render() {
        this.container.innerHTML = `
            <div class="condition-builder">
                <div class="condition-builder-header">
                    <h3><i class="fas fa-cogs"></i> Campaign Conditions</h3>
                    <p class="help-text">Define sophisticated targeting rules for your campaign</p>
                </div>

                <div class="condition-categories">
                    ${this.renderCategoryTabs()}
                </div>

                <div class="condition-selector">
                    <div class="available-conditions">
                        <h4>Available Conditions</h4>
                        <div id="conditionsGrid" class="conditions-grid">
                            ${this.renderConditionsGrid('customer')}
                        </div>
                    </div>
                </div>

                <div class="selected-conditions">
                    <h4>Campaign Rules <span class="condition-count">(${this.selectedConditions.length})</span></h4>
                    <div id="selectedConditionsList" class="selected-conditions-list">
                        ${this.renderSelectedConditions()}
                    </div>
                    <button type="button" class="btn-secondary add-condition-btn" onclick="conditionUI.showConditionModal()">
                        <i class="fas fa-plus"></i> Add Condition
                    </button>
                </div>

                <div class="condition-logic">
                    <h4>Logic Operator</h4>
                    <div class="logic-selector">
                        <label>
                            <input type="radio" name="conditionLogic" value="AND" checked>
                            <span>AND - All conditions must be met</span>
                        </label>
                        <label>
                            <input type="radio" name="conditionLogic" value="OR">
                            <span>OR - Any condition can be met</span>
                        </label>
                    </div>
                </div>

                <div class="condition-preview">
                    <h4>Preview</h4>
                    <div class="preview-text">
                        ${this.generatePreviewText()}
                    </div>
                </div>
            </div>

            <!-- Condition Selection Modal -->
            <div id="conditionModal" class="modal condition-modal" style="display: none;">
                <div class="modal-content">
                    <div class="modal-header">
                        <h3>Add Condition</h3>
                        <button type="button" class="modal-close" onclick="conditionUI.hideConditionModal()">&times;</button>
                    </div>
                    <div class="modal-body" id="conditionModalBody">
                        <!-- Dynamic content -->
                    </div>
                </div>
            </div>
        `;
    }

    renderCategoryTabs() {
        const categories = ['customer', 'order', 'location', 'time', 'business', 'behavior'];
        return categories.map(category => `                    <button type="button" class="category-tab ${category === 'customer' ? 'active' : ''}" 
                    data-category="${category}" 
                    onclick="conditionUI.switchCategory('${category}')">
                <i class="fas fa-${this.getCategoryIcon(category)}"></i>
                ${category.charAt(0).toUpperCase() + category.slice(1)}
            </button>
        `).join('');
    }

    getCategoryIcon(category) {
        const icons = {
            customer: 'user',
            order: 'shopping-cart',
            location: 'map-marker-alt',
            time: 'clock',
            business: 'building',
            behavior: 'chart-line'
        };
        return icons[category] || 'cog';
    }

    renderConditionsGrid(category) {
        const conditions = this.conditionEngine.getConditionsByCategory(category);
        return conditions.map(condition => `
            <div class="condition-card" data-condition-id="${condition.id}">
                <div class="condition-header">
                    <h5>${condition.name}</h5>
                    <button type="button" class="add-btn" onclick="conditionUI.selectCondition('${condition.id}')">
                        <i class="fas fa-plus"></i>
                    </button>
                </div>
                <p class="condition-description">${condition.description}</p>
                ${this.renderParameterPreview(condition.parameters)}
            </div>
        `).join('');
    }

    renderParameterPreview(parameters) {
        if (!parameters || Object.keys(parameters).length === 0) {
            return '<div class="parameter-preview">No parameters required</div>';
        }
        
        const paramCount = Object.keys(parameters).length;
        return `<div class="parameter-preview">${paramCount} parameter${paramCount > 1 ? 's' : ''} available</div>`;
    }

    renderSelectedConditions() {
        if (this.selectedConditions.length === 0) {
            return '<div class="no-conditions">No conditions added yet. Add conditions to define campaign targeting.</div>';
        }

        return this.selectedConditions.map((condition, index) => `
            <div class="selected-condition" data-index="${index}">
                <div class="condition-summary">
                    <div class="condition-info">
                        <h5>${condition.name}</h5>
                        <p>${condition.description}</p>
                        ${this.renderParameterSummary(condition.parameters)}
                    </div>
                    <div class="condition-actions">
                        <button type="button" class="btn-edit" onclick="conditionUI.editCondition(${index})">
                            <i class="fas fa-edit"></i>
                        </button>
                        <button type="button" class="btn-remove" onclick="conditionUI.removeCondition(${index})">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                </div>
                ${index < this.selectedConditions.length - 1 ? '<div class="logic-connector">AND</div>' : ''}
            </div>
        `).join('');
    }

    renderParameterSummary(parameters) {
        if (!parameters || Object.keys(parameters).length === 0) {
            return '';
        }

        const summaryItems = Object.entries(parameters).map(([key, value]) => {
            if (Array.isArray(value)) {
                return `${key}: ${value.length} item${value.length !== 1 ? 's' : ''}`;
            }
            return `${key}: ${value}`;
        }).slice(0, 2); // Show only first 2 parameters

        return `<div class="parameter-summary">${summaryItems.join(', ')}</div>`;
    }

    switchCategory(category, event) {
        console.log('[ConditionConfigUI] switchCategory called:', category);
        
        // Prevent any form submission or event bubbling
        if (event) {
            event.preventDefault();
            event.stopPropagation();
        }
        
        // Update active tab
        document.querySelectorAll('.category-tab').forEach(tab => tab.classList.remove('active'));
        document.querySelector(`[data-category="${category}"]`).classList.add('active');

        // Update conditions grid
        document.getElementById('conditionsGrid').innerHTML = this.renderConditionsGrid(category);
    }

    selectCondition(conditionId, event) {
        console.log('[ConditionConfigUI] selectCondition called:', conditionId);
        
        // Prevent any form submission or event bubbling
        if (event) {
            event.preventDefault();
            event.stopPropagation();
        }
        
        const conditionDef = this.conditionEngine.getAvailableConditions().find(c => c.id === conditionId);
        if (!conditionDef) {
            console.warn('[ConditionConfigUI] Condition not found:', conditionId);
            return;
        }

        this.showConditionParameterModal(conditionDef);
    }

    showConditionParameterModal(conditionDef) {
        const modal = document.getElementById('conditionModal');
        const modalBody = document.getElementById('conditionModalBody');

        modalBody.innerHTML = `
            <div class="condition-config">
                <div class="condition-info">
                    <h4>${conditionDef.name}</h4>
                    <p>${conditionDef.description}</p>
                </div>

                <form id="conditionParametersForm">
                    ${this.renderParameterForm(conditionDef.parameters)}
                    
                    <div class="form-actions">
                        <button type="button" class="btn-secondary" onclick="conditionUI.hideConditionModal()">
                            Cancel
                        </button>
                        <button type="submit" class="btn-primary">
                            Add Condition
                        </button>
                    </div>
                </form>
            </div>
        `;

        // Bind form submission
        document.getElementById('conditionParametersForm').addEventListener('submit', (e) => {
            e.preventDefault();
            this.addConditionWithParameters(conditionDef);
        });

        modal.style.display = 'flex';
    }

    renderParameterForm(parameters) {
        if (!parameters || Object.keys(parameters).length === 0) {
            return '<p class="no-parameters">This condition requires no additional parameters.</p>';
        }

        return Object.entries(parameters).map(([paramName, paramDef]) => {
            return `
                <div class="form-group">
                    <label for="param_${paramName}">
                        ${paramName.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}
                        ${paramDef.required ? '*' : ''}
                    </label>
                    ${this.renderParameterInput(paramName, paramDef)}
                    ${paramDef.description ? `<small class="help-text">${paramDef.description}</small>` : ''}
                </div>
            `;
        }).join('');
    }

    renderParameterInput(paramName, paramDef) {
        const inputId = `param_${paramName}`;
        const defaultValue = paramDef.default || '';

        switch (paramDef.type) {
            case 'number':
                return `
                    <input type="number" 
                           id="${inputId}" 
                           name="${paramName}" 
                           value="${defaultValue}"
                           min="${paramDef.min || ''}"
                           max="${paramDef.max || ''}"
                           ${paramDef.required ? 'required' : ''}>
                `;
            
            case 'array':
                if (paramName === 'restaurantIds') {
                    return this.renderRestaurantSelector(inputId, paramName);
                } else if (paramName === 'areas') {
                    return this.renderAreaSelector(inputId, paramName);
                } else if (paramName === 'occasions') {
                    return this.renderOccasionSelector(inputId, paramName);
                } else if (paramName === 'days') {
                    return this.renderDaySelector(inputId, paramName);
                } else if (paramName === 'categories') {
                    return this.renderCategorySelector(inputId, paramName);
                } else if (paramName === 'methods') {
                    return this.renderPaymentMethodSelector(inputId, paramName);
                }
                return `
                    <textarea id="${inputId}" 
                              name="${paramName}" 
                              placeholder="Enter comma-separated values"
                              ${paramDef.required ? 'required' : ''}></textarea>
                `;
            
            default:
                return `
                    <input type="text" 
                           id="${inputId}" 
                           name="${paramName}" 
                           value="${defaultValue}"
                           ${paramDef.required ? 'required' : ''}>
                `;
        }
    }

    async renderRestaurantSelector(inputId, paramName) {
        try {
            // Try to get real restaurant data
            if (window.dataService) {
                await window.dataService.initialize();
                const businesses = await window.dataService.getBusinesses();
                
                // Filter for restaurants and food businesses
                const restaurants = businesses.filter(b => {
                    const businessType = (b.businessType || '').toLowerCase();
                    const category = (b.category || '').toLowerCase();
                    
                    return businessType.includes('restaurant') || 
                           businessType.includes('cafe') || 
                           businessType.includes('food') ||
                           category.includes('restaurant') ||
                           category.includes('cafe') ||
                           category.includes('food') ||
                           businessType === 'restaurant' ||
                           category === 'restaurant';
                });
                
                if (restaurants.length > 0) {
                    const options = restaurants.map(restaurant => {
                        const id = restaurant.businessId || restaurant.id;
                        const name = restaurant.businessName || restaurant.name || 'Unknown Business';
                        const type = restaurant.businessType || restaurant.category || '';
                        const displayName = name + (type ? ' (' + type + ')' : '');
                        return '<option value="' + id + '">' + displayName + '</option>';
                    }).join('');
                    
                    return `
                        <select id="${inputId}" name="${paramName}" multiple size="5">
                            ${options}
                        </select>
                        <small class="help-text">Hold Ctrl/Cmd to select multiple restaurants</small>
                    `;
                }
            }
        } catch (error) {
            console.warn('Could not load real restaurant data, using fallback:', error);
        }
        
        // Fallback to mock data if real data is not available
        return `
            <select id="${inputId}" name="${paramName}" multiple size="5">
                <option value="rest_001">Pizza Palace</option>
                <option value="rest_002">Burger House</option>
                <option value="rest_003">Sushi Master</option>
                <option value="rest_004">Italian Corner</option>
                <option value="rest_005">Taco Bell</option>
            </select>
            <small class="help-text">Hold Ctrl/Cmd to select multiple restaurants</small>
        `;
    }

    renderAreaSelector(inputId, paramName) {
        return `
            <select id="${inputId}" name="${paramName}" multiple size="4">
                <option value="downtown">Downtown</option>
                <option value="al_malaz">Al-Malaz</option>
                <option value="riyadh_center">Riyadh Center</option>
                <option value="king_fahd">King Fahd District</option>
                <option value="olaya">Olaya</option>
                <option value="diplomatic_quarter">Diplomatic Quarter</option>
            </select>
            <small class="help-text">Select delivery areas to target</small>
        `;
    }

    renderOccasionSelector(inputId, paramName) {
        return `
            <select id="${inputId}" name="${paramName}" multiple size="4">
                <option value="weekend">Weekend</option>
                <option value="ramadan">Ramadan</option>
                <option value="eid">Eid</option>
                <option value="new_year">New Year</option>
                <option value="valentine">Valentine's Day</option>
                <option value="christmas">Christmas</option>
                <option value="national_day">National Day</option>
            </select>
            <small class="help-text">Select special occasions</small>
        `;
    }

    renderDaySelector(inputId, paramName) {
        return `
            <select id="${inputId}" name="${paramName}" multiple size="4">
                <option value="0">Sunday</option>
                <option value="1">Monday</option>
                <option value="2">Tuesday</option>
                <option value="3">Wednesday</option>
                <option value="4">Thursday</option>
                <option value="5">Friday</option>
                <option value="6">Saturday</option>
            </select>
            <small class="help-text">Select allowed days of the week</small>
        `;
    }

    renderCategorySelector(inputId, paramName) {
        return `
            <select id="${inputId}" name="${paramName}" multiple size="4">
                <option value="fast_food">Fast Food</option>
                <option value="pizza">Pizza</option>
                <option value="middle_eastern">Middle Eastern</option>
                <option value="asian">Asian</option>
                <option value="italian">Italian</option>
                <option value="desserts">Desserts</option>
                <option value="healthy">Healthy</option>
            </select>
            <small class="help-text">Select restaurant categories</small>
        `;
    }

    renderPaymentMethodSelector(inputId, paramName) {
        return `
            <select id="${inputId}" name="${paramName}" multiple size="3">
                <option value="credit_card">Credit Card</option>
                <option value="cash_on_delivery">Cash on Delivery</option>
                <option value="digital_wallet">Digital Wallet</option>
                <option value="apple_pay">Apple Pay</option>
                <option value="stc_pay">STC Pay</option>
            </select>
            <small class="help-text">Select allowed payment methods</small>
        `;
    }

    addConditionWithParameters(conditionDef) {
        const form = document.getElementById('conditionParametersForm');
        const formData = new FormData(form);
        const parameters = {};

        // Process form data
        Object.entries(conditionDef.parameters || {}).forEach(([paramName, paramDef]) => {
            const value = formData.get(paramName);
            
            if (paramDef.type === 'number') {
                parameters[paramName] = value ? Number(value) : paramDef.default;
            } else if (paramDef.type === 'array') {
                const selectedOptions = form.querySelector(`[name="${paramName}"]`);
                if (selectedOptions && selectedOptions.multiple) {
                    parameters[paramName] = Array.from(selectedOptions.selectedOptions).map(opt => opt.value);
                } else if (value) {
                    parameters[paramName] = value.split(',').map(v => v.trim()).filter(v => v);
                } else {
                    parameters[paramName] = [];
                }
            } else {
                parameters[paramName] = value || paramDef.default;
            }
        });

        // Validate parameters
        const errors = this.conditionEngine.validateConditionParameters(conditionDef.id, parameters);
        if (errors.length > 0) {
            alert('Validation errors:\n' + errors.join('\n'));
            return;
        }

        // Add condition
        this.selectedConditions.push({
            id: conditionDef.id,
            name: conditionDef.name,
            description: conditionDef.description,
            parameters: parameters
        });

        this.hideConditionModal();
        this.updateUI();
    }

    editCondition(index, event) {
        console.log('[ConditionConfigUI] editCondition called:', index);
        
        // Prevent any form submission or event bubbling
        if (event) {
            event.preventDefault();
            event.stopPropagation();
        }
        
        const condition = this.selectedConditions[index];
        if (!condition) return;

        const conditionDef = this.conditionEngine.getAvailableConditions().find(c => c.id === condition.id);
        if (!conditionDef) return;

        // Store edit index for later
        this.editingIndex = index;
        this.showConditionParameterModal(conditionDef);

        // Pre-fill form with existing parameters
        setTimeout(() => {
            const form = document.getElementById('conditionParametersForm');
            Object.entries(condition.parameters || {}).forEach(([paramName, value]) => {
                const input = form.querySelector(`[name="${paramName}"]`);
                if (input) {
                    if (input.type === 'number') {
                        input.value = value;
                    } else if (input.multiple && Array.isArray(value)) {
                        Array.from(input.options).forEach(option => {
                            option.selected = value.includes(option.value);
                        });
                    } else {
                        input.value = Array.isArray(value) ? value.join(', ') : value;
                    }
                }
            });

            // Update submit button text
            const submitBtn = form.querySelector('button[type="submit"]');
            if (submitBtn) {
                submitBtn.textContent = 'Update Condition';
            }
        }, 100);
    }

    removeCondition(index, event) {
        console.log('[ConditionConfigUI] removeCondition called:', index);
        
        // Prevent any form submission or event bubbling
        if (event) {
            event.preventDefault();
            event.stopPropagation();
        }
        
        if (confirm('Are you sure you want to remove this condition?')) {
            this.selectedConditions.splice(index, 1);
            this.updateUI();
        }
    }

    showConditionModal(event) {
        console.log('[ConditionConfigUI] showConditionModal called');
        
        // Prevent any form submission or event bubbling
        if (event) {
            event.preventDefault();
            event.stopPropagation();
        }
        
        // Show category-based selection
        const modal = document.getElementById('conditionModal');
        const modalBody = document.getElementById('conditionModalBody');

        modalBody.innerHTML = `
            <div class="condition-selection">
                <h4>Select a Condition Type</h4>
                <div class="condition-categories-full">
                    ${this.renderFullCategoryList()}
                </div>
            </div>
        `;

        modal.style.display = 'flex';
    }

    renderFullCategoryList() {
        const categories = ['customer', 'order', 'location', 'time', 'business', 'behavior'];
        
        return categories.map(category => {
            const conditions = this.conditionEngine.getConditionsByCategory(category);
            return `
                <div class="category-section">
                    <h5><i class="fas fa-${this.getCategoryIcon(category)}"></i> ${category.charAt(0).toUpperCase() + category.slice(1)}</h5>
                    <div class="conditions-list">
                        ${conditions.map(condition => `
                            <div class="condition-option" onclick="conditionUI.selectCondition('${condition.id}')">
                                <strong>${condition.name}</strong>
                                <p>${condition.description}</p>
                            </div>
                        `).join('')}
                    </div>
                </div>
            `;
        }).join('');
    }

    hideConditionModal(event) {
        console.log('[ConditionConfigUI] hideConditionModal called');
        
        // Prevent any form submission or event bubbling
        if (event) {
            event.preventDefault();
            event.stopPropagation();
        }
        
        document.getElementById('conditionModal').style.display = 'none';
        this.editingIndex = null;
    }

    updateUI() {
        // Update selected conditions list
        document.getElementById('selectedConditionsList').innerHTML = this.renderSelectedConditions();
        
        // Update condition count
        document.querySelector('.condition-count').textContent = `(${this.selectedConditions.length})`;
        
        // Update preview
        document.querySelector('.preview-text').innerHTML = this.generatePreviewText();
    }

    generatePreviewText() {
        if (this.selectedConditions.length === 0) {
            return '<em>No conditions defined - campaign will be available to all customers</em>';
        }

        const logic = document.querySelector('input[name="conditionLogic"]:checked')?.value || 'AND';
        const connector = logic === 'AND' ? ' <strong>AND</strong> ' : ' <strong>OR</strong> ';

        const conditionTexts = this.selectedConditions.map(condition => {
            let text = condition.name;
            if (condition.parameters && Object.keys(condition.parameters).length > 0) {
                const paramText = Object.entries(condition.parameters).map(([key, value]) => {
                    if (Array.isArray(value) && value.length > 0) {
                        return `${key}: ${value.join(', ')}`;
                    } else if (value !== undefined && value !== null && value !== '') {
                        return `${key}: ${value}`;
                    }
                    return null;
                }).filter(Boolean).join(', ');
                
                if (paramText) {
                    text += ` (${paramText})`;
                }
            }
            return text;
        });

        return 'Campaign will be available to customers who meet: ' + conditionTexts.join(connector);
    }

    bindEvents() {
        console.log('[ConditionConfigUI] bindEvents called');
        
        // Logic selector change
        document.addEventListener('change', (e) => {
            if (e.target.name === 'conditionLogic') {
                this.updateUI();
            }
        });

        // Category tab hover effects
        document.addEventListener('mouseover', (e) => {
            if (e.target.matches('.campaign-type-card')) {
                e.target.style.transform = 'translateY(-2px)';
            }
        });

        document.addEventListener('mouseout', (e) => {
            if (e.target.matches('.campaign-type-card')) {
                e.target.style.transform = 'translateY(0)';
            }
        });
        
        // Add comprehensive click protection for condition UI elements
        document.addEventListener('click', (e) => {
            // Check if the click is within a condition UI container
            const isInConditionUI = e.target.closest('.condition-builder') || 
                                  e.target.closest('.condition-modal') ||
                                  e.target.closest('#campaignConditions');
                                  
            if (isInConditionUI) {
                // Check if it's a button or clickable element without explicit type
                const isButton = e.target.tagName === 'BUTTON';
                const isClickableDiv = e.target.matches('.condition-option') || 
                                     e.target.closest('.condition-option');
                
                if (isButton || isClickableDiv) {
                    console.log('[ConditionConfigUI] Preventing potential form submission from:', e.target);
                    
                    // Only prevent if it's a button without explicit type="submit"
                    if (isButton && !e.target.type) {
                        e.target.type = 'button'; // Set type to prevent submission
                    }
                    
                    // Always prevent propagation for condition UI interactions
                    e.stopPropagation();
                    
                    // Mark that we've recently interacted with condition UI
                    this.container.setAttribute('data-recent-interaction', 'true');
                    setTimeout(() => {
                        this.container.removeAttribute('data-recent-interaction');
                    }, 1000);
                }
            }
        }, true); // Use capture phase to catch events early
    }

    // Public methods for integration
    getConditions() {
        const logic = document.querySelector('input[name="conditionLogic"]:checked')?.value || 'AND';
        return {
            logic: logic,
            conditions: this.selectedConditions.map(condition => ({
                conditionId: condition.id,
                params: condition.parameters || {},
                operator: logic
            }))
        };
    }

    setConditions(conditionData) {
        if (!conditionData || !conditionData.conditions) return;

        this.selectedConditions = conditionData.conditions.map(rule => {
            const conditionDef = this.conditionEngine.getAvailableConditions().find(c => c.id === rule.conditionId);
            return {
                id: rule.conditionId,
                name: conditionDef?.name || rule.conditionId,
                description: conditionDef?.description || '',
                parameters: rule.params || {}
            };
        });

        // Set logic
        if (conditionData.logic) {
            const logicInput = document.querySelector(`input[name="conditionLogic"][value="${conditionData.logic}"]`);
            if (logicInput) logicInput.checked = true;
        }

        this.updateUI();
    }

    clearConditions() {
        this.selectedConditions = [];
        this.updateUI();
    }
}

// Make available globally
if (typeof window !== 'undefined') {
    window.ConditionConfigUI = ConditionConfigUI;
}
