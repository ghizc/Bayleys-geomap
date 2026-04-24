// modals.js

import { state } from './store.js';
import { MAPBOX_TOKEN } from './config.js';
import { supabase, uploadMultipleFiles } from './api.js';
import { log, filterAdminView, showDetail } from './ui.js';

// --- HELPER: Find closest location using Haversine (Crow-flies distance) ---
function getClosestLocation(lat, lng, locations) {
    if (!locations || locations.length === 0) return null;
    let closest = null;
    let minDistance = Infinity;
    locations.forEach(loc => {
        const R = 6371; 
        const dLat = (loc.lat - lat) * Math.PI / 180;
        const dLng = (loc.lng - lng) * Math.PI / 180;
        const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
                  Math.cos(lat * Math.PI / 180) * Math.cos(loc.lat * Math.PI / 180) *
                  Math.sin(dLng/2) * Math.sin(dLng/2);
        const distance = R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)));
        if (distance < minDistance) {
            minDistance = distance;
            closest = loc;
        }
    });
    return closest;
}

// HELPER: Calculate Lifetime Revenue & VIP Discount Tier
window.getClientVipTier = (clientId) => {
    if (!state.allReportsData || !clientId) return { revenue: 0, discount: 0, tier: 'Standard' };

    const completedReports = state.allReportsData.filter(r => {
        if (String(r.client_id) !== String(clientId)) return false;
        if (!r.status) return false;
        const s = r.status.toLowerCase().trim();
        return s.includes('complete') || s.includes('invoice');
    });

    const totalRevenue = completedReports.reduce((sum, r) => {
        if (!r.budget) return sum;
        const cleanBudget = parseFloat(String(r.budget).replace(/[^0-9.]/g, ''));
        return sum + (isNaN(cleanBudget) ? 0 : cleanBudget);
    }, 0);

    let discount = 0;
    let tier = 'Standard';

    if (state.discountsData && state.discountsData.length > 0) {
        const activeTier = state.discountsData.find(t => totalRevenue >= Number(t.min_revenue));
        if (activeTier) {
            discount = Number(activeTier.discount_percentage);
            tier = `${activeTier.name} (${discount * 100}% Off)`;
        }
    }

    return { revenue: totalRevenue, discount, tier };
};

// --- REQUEST REPORT MODAL ---
window.addPremiseRow = () => {
    const container = document.getElementById('reqPremisesContainer');
    const rowCount = container.children.length;
    const uniqueId = Date.now().toString(36) + Math.random().toString(36).substr(2); 

    let savedPremisesOptions = '';
    const clientId = state.currentUser?.clientSpoof?.id || state.currentUser?.id;
    
    if (state.allReportsData && state.allReportsData.length > 0) {
        const clientReports = state.allReportsData.filter(r => r.client_id === clientId && r.name);
        const uniqueReports = [];
        const seenNames = new Set();
        for (const r of clientReports) {
            if (!seenNames.has(r.name)) {
                seenNames.add(r.name);
                uniqueReports.push(r);
            }
        }
        const sorted = uniqueReports.sort((a,b) => a.name.localeCompare(b.name));
        savedPremisesOptions = sorted.map(r => {
            const premise = state.premisesData.find(p => p.id === r.premise_id) || {};
            const address = premise.address || '';
            const floor = premise.floor_area || '';
            const sector = premise.sector || '';
            return `<option value="${r.id}" data-name="${r.name}" data-address="${address}" data-floor="${floor}" data-sector="${sector}">${r.name}</option>`;
        }).join('');
    }

    const row = document.createElement('div');
    row.className = 'premise-req-row';
    row.style.cssText = 'background: white; padding: 24px; border: 1px solid #cbd5e1; border-radius: 12px; position: relative; margin-bottom: 24px; box-shadow: 0 4px 10px rgba(0, 0, 0, 0.03);';

    row.innerHTML = `
        ${rowCount > 0 ? `<button type="button" class="icon-btn" style="position: absolute; top: -10px; right: -10px; border: 1px solid #fca5a5; background: white; color: #ef4444; width: 30px; height: 30px; border-radius: 50%; box-shadow: 0 2px 6px rgba(0,0,0,0.1); z-index: 10; transition: 0.2s;" onmouseover="this.style.background='#fef2f2'" onmouseout="this.style.background='white'" onclick="this.closest('.premise-req-row').remove()" title="Remove Request">✕</button>` : ''}
        
        <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 16px;">
            <div style="background: #00264b; color: white; width: 24px; height: 24px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 700;">1</div>
            <div style="font-size: 13px; font-weight: 700; color: #0f172a; text-transform: uppercase; letter-spacing: 0.5px;">Location Details</div>
            <div style="flex: 1; height: 1px; background: #e2e8f0; margin-left: 8px;"></div>
        </div>

        ${savedPremisesOptions ? `
        <div style="margin-bottom: 16px;">
            <label class="form-label" style="font-size: 11px; color: #10b981; font-weight: 700;">✨ Autofill Saved Location</label>
            <select class="form-input req-saved-select" onchange="window.autofillReqPremise(this)" style="height: 44px; box-sizing: border-box; cursor:pointer; border: 2px solid #10b981; background: #f0fdf4;">
                <option value="" selected>Select a saved location to autofill...</option>
                ${savedPremisesOptions}
            </select>
        </div>` : ''}
        
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 24px;">
            <div class="form-group" style="margin: 0; grid-column: span 2;">
                <label class="form-label" style="font-size: 11px;">Premise / Location Name</label>
                <input type="text" class="form-input req-name-input" required placeholder="e.g. Four Square Hokitika" style="height: 44px; box-sizing: border-box;">
                <input type="hidden" class="req-hidden-sector">
            </div>
            <div class="form-group" style="margin: 0; grid-column: span 2;">
                <label class="form-label" style="font-size: 11px;">Street Address & City</label>
                <input type="text" class="form-input req-address-input" required placeholder="123 Example St, Auckland CBD" onblur="window.calculateRowEstimate(this.closest('.premise-req-row'))" style="height: 44px; box-sizing: border-box;">
            </div>
            <div class="form-group" style="margin: 0;">
                <label class="form-label" style="font-size: 11px;">Region</label>
                <input type="text" class="form-input req-region-input" required placeholder="e.g. Auckland" onblur="window.calculateRowEstimate(this.closest('.premise-req-row'))" style="height: 44px; box-sizing: border-box;">
            </div>
            <div class="form-group" style="margin: 0;">
                <label class="form-label" style="font-size: 11px;">Country</label>
                <select class="form-input req-country-select" required style="height: 44px; box-sizing: border-box; cursor:pointer;" onchange="window.calculateRowEstimate(this.closest('.premise-req-row'))">
                    <option value="New Zealand" selected>New Zealand</option>
                    <option value="Australia">Australia</option>
                </select>
            </div>
        </div>

        <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 16px;">
            <div style="background: #00264b; color: white; width: 24px; height: 24px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 700;">2</div>
            <div style="font-size: 13px; font-weight: 700; color: #0f172a; text-transform: uppercase; letter-spacing: 0.5px;">Scope & Complexity</div>
            <div style="flex: 1; height: 1px; background: #e2e8f0; margin-left: 8px;"></div>
        </div>

        <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 20px; margin-bottom: 24px; display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px;">
            
            <div class="form-group" style="margin: 0; grid-column: span 2;">
                <label class="form-label" style="font-size: 11px;">Report Type</label>
                <select class="form-input req-type-select" required style="height: 44px; box-sizing: border-box; cursor:pointer; background: white;" onchange="window.calculateRowEstimate(this.closest('.premise-req-row'))">
                    <option value="" disabled selected>Select...</option>
                    <option value="BCA">BCA (Building Condition Assessment)</option>
                    <option value="COO">COO (Change of Operator/Owner)</option>
                    <option value="PCR">PCR (Premises Condition Report)</option>
                    <option value="RMP">RMP (Roof Maintenance Plan)</option>
                    <option value="Capex">CapEx (Capital Expenditure)</option>
                    <option value="RCA">RCA (Reinstatement Cost Assessment)</option>
                    <option value="MGA">MGA (Make Good Assessment)</option>
                    <option value="FMP">FMP (Forward Maintenance Plan)</option>
                    <option value="TDD">TDD (Technical Due Diligence)</option>
                </select>
            </div>
            <div class="form-group" style="margin: 0;">
                <label class="form-label" style="font-size: 11px; color: #0284c7;">Site Area (sqm)</label>
                <input type="number" class="form-input req-site-area-input" required placeholder="e.g. 1500" oninput="window.calculateRowEstimate(this.closest('.premise-req-row'))" style="height: 44px; box-sizing: border-box; border-color: #bae6fd; background: #f0f9ff;">
            </div>
            <div class="form-group" style="margin: 0;">
                <label class="form-label" style="font-size: 11px; color: #0284c7;">Floor Area (sqm)</label>
                <input type="number" class="form-input req-floor-area-input" required placeholder="e.g. 500" oninput="window.calculateRowEstimate(this.closest('.premise-req-row'))" style="height: 44px; box-sizing: border-box; border-color: #bae6fd; background: #f0f9ff;">
            </div>

            <div class="form-group" style="margin: 0; grid-column: span 2;">
                <label class="form-label" style="font-size: 11px;">Delivery Deadline</label>
                <input type="date" class="form-input req-deadline-input" required style="height: 44px; box-sizing: border-box; background: white;" onchange="window.calculateRowEstimate(this.closest('.premise-req-row'))">
            </div>
            <div class="form-group" style="margin: 0; grid-column: span 2;">
                <label class="form-label" style="font-size: 11px;">Order # (Opt)</label>
                <input type="text" class="form-input req-co-input" style="height: 44px; box-sizing: border-box; background: white;" placeholder="e.g. PO-9921">
            </div>

            <div style="grid-column: span 4; height: 1px; background: #e2e8f0; margin: 4px 0;"></div>

            <div class="form-group" style="margin: 0; grid-column: span 2;">
                <label class="form-label" style="font-size: 11px; color: #64748b;">Building Sector</label>
                <select class="form-input req-bldg-type-select" style="height: 44px; box-sizing: border-box; cursor:pointer; background: white;" onchange="window.calculateRowEstimate(this.closest('.premise-req-row'))">
                    <option value="type_industrial">Industrial/Warehouse</option>
                    <option value="type_office">Office/Commercial</option>
                    <option value="type_retail">Retail</option>
                    <option value="type_special">Special Purpose</option>
                </select>
            </div>
            <div class="form-group" style="margin: 0; grid-column: span 2;">
                <label class="form-label" style="font-size: 11px; color: #64748b;">Complexity Config</label>
                <select class="form-input req-complexity-select" style="height: 44px; box-sizing: border-box; cursor:pointer; background: white;" onchange="window.calculateRowEstimate(this.closest('.premise-req-row'))">
                    <option value="simple">Simple (Cat 1)</option>
                    <option value="standard" selected>Standard (Cat 2)</option>
                    <option value="complex">Complex (Cat 3)</option>
                </select>
            </div>
            
            <div style="grid-column: span 4; margin-top: -8px;">
                 <div class="complexity-desc" style="font-size: 10.5px; color: #0369a1; line-height: 1.4; background: #f0f9ff; padding: 8px 12px; border-radius: 6px; border: 1px solid #bae6fd; display: flex; align-items: flex-start;">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="margin-right: 8px; flex-shrink: 0; margin-top: 1px;"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>
                    <span class="complexity-span-text">Enter area and sector to view your exact complexity definition.</span>
                </div>
            </div>
        </div>

        <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 16px;">
            <div style="background: #00264b; color: white; width: 24px; height: 24px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 700;">3</div>
            <div style="font-size: 13px; font-weight: 700; color: #0f172a; text-transform: uppercase; letter-spacing: 0.5px;">Estimate & Files</div>
            <div style="flex: 1; height: 1px; background: #e2e8f0; margin-left: 8px;"></div>
        </div>

        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px;">
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
                <div class="file-upload-box" style="padding: 16px 8px; min-height: auto; margin: 0; background: #f8fafc; border-color: #e2e8f0;">
                    <input type="file" class="req-lease-file" multiple accept=".pdf, .jpg, .jpeg, .png" onchange="updateFileName(this, 'leaseFile_${uniqueId}')">
                    <div class="file-label-text" style="font-size: 11px;">📄 Leases</div>
                    <div id="leaseFile_${uniqueId}" class="file-name-display" style="font-size: 10px; margin-top: 4px;"></div>
                </div>
                <div class="file-upload-box" style="padding: 16px 8px; min-height: auto; margin: 0; background: #f8fafc; border-color: #e2e8f0;">
                    <input type="file" class="req-plan-file" multiple accept=".pdf, .jpg, .jpeg, .png" onchange="updateFileName(this, 'planFile_${uniqueId}')">
                    <div class="file-label-text" style="font-size: 11px;">📐 Plans</div>
                    <div id="planFile_${uniqueId}" class="file-name-display" style="font-size: 10px; margin-top: 4px;"></div>
                </div>
            </div>
            
            <div class="estimate-box" style="background: #f0f9ff; border: 2px solid #bae6fd; border-radius: 12px; padding: 16px; display: flex; flex-direction: column; justify-content: center; align-items: center; text-align: center; box-shadow: inset 0 2px 8px rgba(2,132,199,0.05);">
                <div style="font-size: 11px; color: #0369a1; font-weight: 600; margin-bottom: 6px;" class="est-breakdown">Awaiting Inputs...</div>
                <div style="font-size: 26px; font-weight: 700; color: #0f172a; line-height: 1;" class="est-total">TBC</div>
                <input type="hidden" class="req-hidden-cost" value="0">
                <input type="hidden" class="req-hidden-calc-area" value="0">
            </div>
        </div>
    `;
    container.appendChild(row);
};

window.autofillReqPremise = (selectEl) => {
    const selectedOpt = selectEl.options[selectEl.selectedIndex];
    if (!selectedOpt.value) return;

    const row = selectEl.closest('.premise-req-row');
    row.querySelector('.req-name-input').value = selectedOpt.dataset.name || '';
    row.querySelector('.req-hidden-sector').value = selectedOpt.dataset.sector || '';

    let sqm = parseFloat((selectedOpt.dataset.floor || '').replace(/[^\d.]/g, ''));
    if ((selectedOpt.dataset.floor || '').toLowerCase().includes('ha')) sqm = sqm * 10000;
    if (!isNaN(sqm)) row.querySelector('.req-floor-area-input').value = sqm; 

    const fullAddr = selectedOpt.dataset.address || '';
    const parts = fullAddr.split(',').map(s => s.trim());

    if (parts.length >= 3) {
        const country = parts.pop();
        const region = parts.pop();
        row.querySelector('.req-address-input').value = parts.join(', ');
        row.querySelector('.req-region-input').value = region;
        
        const countrySelect = row.querySelector('.req-country-select');
        if (country.toLowerCase().includes('australia')) countrySelect.value = 'Australia';
        else countrySelect.value = 'New Zealand';
    } else {
        row.querySelector('.req-address-input').value = fullAddr;
        row.querySelector('.req-region-input').value = '';
    }

    window.calculateRowEstimate(row);
};

window.formatTimeReadable = (decimalHours) => {
    const totalMinutes = Math.round(decimalHours * 60);
    const hrs = Math.floor(totalMinutes / 60);
    const mins = totalMinutes % 60;
    
    if (hrs > 0 && mins > 0) return `${hrs}h ${mins}min`;
    if (hrs > 0) return `${hrs}h`;
    if (mins > 0) return `${mins}min`;
    return `0h`;
};

// Master Granular, DB-Driven Hybrid Routing Engine
window.calculateRowEstimate = async (row) => {
    const getVal = (key) => {
        if (!state.pricingRules) return 0; 
        const rule = state.pricingRules.find(r => r.rule_key === key);
        return rule ? Number(rule.value) : 0;
    };

    const HOURLY_RATE = getVal('rate_hourly') || 350;
    const MAX_TRAVEL_HRS = getVal('travel_max_hrs') || 8.0;
    const RENTAL_ADMIN_HRS = getVal('rental_admin_hrs') || 0.33; 
    const CPI_MULTIPLIER = getVal('cpi_multiplier') || 1.00;

    const currentDate = new Date();
    const openOffices = (state.officesData || []).filter(office => currentDate >= new Date(office.open_date));

    const typeSelect = row.querySelector('.req-type-select');
    const siteAreaStr = row.querySelector('.req-site-area-input').value;
    const floorAreaStr = row.querySelector('.req-floor-area-input').value;
    
    const deadlineStr = row.querySelector('.req-deadline-input').value;
    const addressStr = row.querySelector('.req-address-input').value.trim();
    const regionStr = row.querySelector('.req-region-input').value.trim();
    const countryStr = row.querySelector('.req-country-select').value;
    
    const breakdownEl = row.querySelector('.est-breakdown');
    const totalEl = row.querySelector('.est-total');
    const hiddenCostEl = row.querySelector('.req-hidden-cost');
    const hiddenAreaEl = row.querySelector('.req-hidden-calc-area');

    const siteArea = parseFloat(siteAreaStr) || 0;
    const floorArea = parseFloat(floorAreaStr) || 0;

    if (!typeSelect.value || (siteArea === 0 && floorArea === 0)) {
        breakdownEl.innerText = "Enter areas & report type to estimate";
        totalEl.innerText = "TBC";
        totalEl.style.color = "#f59e0b";
        hiddenCostEl.value = 0;
        return;
    }
    
    breakdownEl.innerText = "Calculating precise routing & timing...";

    // 2. SMART AREA CALCULATION
    let calcArea = 0;
    if (siteArea >= floorArea) {
        calcArea = siteArea;
    } else {
        // Multi-story logic: Take site area (for ground floor footprint) 
        // then take the floor area for the rest (upper levels).
        // Adding them ensures the full walkable footprint of the site and the upper floors are accounted for.
        calcArea = siteArea + floorArea;
    }
    hiddenAreaEl.value = calcArea;

    // 3. RUSH FEE
    let speedHrs = 0;
    let speedText = "Standard";
    if (deadlineStr) {
        const diffDays = Math.ceil((new Date(deadlineStr) - new Date()) / (1000 * 60 * 60 * 24));
        if (diffDays <= 10) {
            speedHrs = getVal('rush_fee_hrs') || 4; 
            speedText = "Rush / Urgent";
        }
    }

    // 4. MULTI-OFFICE HYBRID ROUTING ENGINE
    let travelHrs = parseFloat(row.dataset.cachedTravel) || 0;
    let travelText = row.dataset.cachedTravelText || "Pending Route";
    const fullAddr = `${addressStr}, ${regionStr}, ${countryStr}`;
    
    if (addressStr && fullAddr !== row.dataset.lastAddress) {
        row.dataset.lastAddress = fullAddr;
        try {
            const geoRes = await fetch(`https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(fullAddr)}.json?access_token=${MAPBOX_TOKEN}&limit=1`);
            const geoJson = await geoRes.json();
            
            if (geoJson.features && geoJson.features.length > 0) {
                const [destLng, destLat] = geoJson.features[0].center;
                const homeOffice = getClosestLocation(destLat, destLng, openOffices);
                
                const dirRes = await fetch(`https://api.mapbox.com/directions/v5/mapbox/driving/${homeOffice.lng},${homeOffice.lat};${destLng},${destLat}?access_token=${MAPBOX_TOKEN}`);
                const dirJson = await dirRes.json();
                
                if (dirJson.routes && dirJson.routes.length > 0) {
                    const oneWayDriveHrs = dirJson.routes[0].duration / 3600;
                    
                    if (oneWayDriveHrs > 3.0 && state.airportsData && state.airportsData.length > 0) {
                        const destAirport = getClosestLocation(destLat, destLng, state.airportsData);
                        const flightMinsKey = `flight_mins_${homeOffice.id}`;
                        const flightMins = destAirport[flightMinsKey];
                        
                        if (flightMins && flightMins > 0) {
                            const localDriveRes = await fetch(`https://api.mapbox.com/directions/v5/mapbox/driving/${destAirport.lng},${destAirport.lat};${destLng},${destLat}?access_token=${MAPBOX_TOKEN}`);
                            const localDriveJson = await localDriveRes.json();
                            
                            const localDriveHrs = (localDriveJson.routes && localDriveJson.routes.length > 0) 
                                ? (localDriveJson.routes[0].duration / 3600) : 0.5;

                            const flightHrs = flightMins / 60;
                            const oneWayFlightTripHrs = Number(homeOffice.apt_drive_hrs) + flightHrs + RENTAL_ADMIN_HRS + localDriveHrs;
                            
                            if (oneWayFlightTripHrs < oneWayDriveHrs) {
                                travelHrs = oneWayFlightTripHrs * 2; 
                                travelText = `Fly ${homeOffice.name} → ${destAirport.code}`;
                            } else {
                                travelHrs = oneWayDriveHrs * 2; 
                                travelText = `Drive from ${homeOffice.name}`;
                            }
                        } else {
                            travelHrs = oneWayDriveHrs * 2; 
                            travelText = `Drive from ${homeOffice.name}`;
                        }
                    } else {
                        travelHrs = oneWayDriveHrs * 2; 
                        travelText = `Drive from ${homeOffice.name}`;
                    }
                    
                    // Travel time is mathematically precise, no minimum floor used.
                    travelHrs = Math.min(MAX_TRAVEL_HRS, travelHrs); 
                    travelHrs = Math.round(travelHrs * 10) / 10; 
                }
            }
        } catch(e) { 
            console.log("Routing failed.", e); 
            travelHrs = 1.0; 
        }
        row.dataset.cachedTravel = travelHrs;
        row.dataset.cachedTravelText = travelText;
    } else {
        travelText = row.dataset.cachedTravelText;
    }

    // 5. MATRIX-DRIVEN INSPECTION & REPORT ENGINE
    let matrixInspHrs = 0;
    let matrixRepHrs = 0;
    
    let sector = 'Special Purpose';
    const bldgTypeVal = row.querySelector('.req-bldg-type-select').value;
    if (bldgTypeVal === 'type_industrial') sector = 'Industrial';
    else if (bldgTypeVal === 'type_office') sector = 'Office';
    else if (bldgTypeVal === 'type_retail') sector = 'Retail';

    const compVal = row.querySelector('.req-complexity-select').value; // 'simple', 'standard', 'complex'
    const descSpan = row.querySelector('.complexity-span-text');

    // UNBREAKABLE FALLBACK MATRIX
    const fallbackMatrix = [
        { sector: 'Office', size_category: 'Small Suite', min_sqm: 0, max_sqm: 500, simple_def: 'Open plan, standard lighting & HVAC, no complex tenant fit-out.', simple_insp_hrs: 2, simple_rep_hrs: 3, standard_def: 'Enclosed meeting rooms, kitchenette, standard partitioned office services.', standard_insp_hrs: 3, standard_rep_hrs: 4, complex_def: 'High-density layout, specialized comms/server room, or medical/consulting use.', complex_insp_hrs: 4, complex_rep_hrs: 5 },
        { sector: 'Office', size_category: 'Medium (1–2 Floors)', min_sqm: 500, max_sqm: 2000, simple_def: 'Mostly open plan, uniform services across the floor, basic amenities.', simple_insp_hrs: 4, simple_rep_hrs: 5, standard_def: 'Mix of open plan and enclosed offices, standard staff amenities and typical HVAC zones.', standard_insp_hrs: 6, standard_rep_hrs: 7, complex_def: 'Inter-tenancy stairs, heavy IT infrastructure, high-spec cafeteria, or end-of-trip facilities.', complex_insp_hrs: 6, complex_rep_hrs: 8 },
        { sector: 'Office', size_category: 'Large (Multi-Floor)', min_sqm: 2000, max_sqm: 5000, simple_def: 'Warm-shell condition, ready for tenant fit-out, basic base-building MEP.', simple_insp_hrs: 6, simple_rep_hrs: 8, standard_def: 'Typical corporate fit-out over multiple floors, standard HVAC zoning and security.', standard_insp_hrs: 8, standard_rep_hrs: 12, complex_def: 'High-security zones, auditoriums, specialized HVAC, or backup generators.', complex_insp_hrs: 10, complex_rep_hrs: 16 },
        { sector: 'Office', size_category: 'Major / Tower Scale', min_sqm: 5000, max_sqm: null, simple_def: 'Base-build condition, uniform open floorplates, basic central plant.', simple_insp_hrs: 8, simple_rep_hrs: 12, standard_def: 'Standard multi-tenant corporate tower, typical central plant and lift services.', standard_insp_hrs: 12, standard_rep_hrs: 20, complex_def: 'Premium/A-grade complex fit-outs, heavy integrated tech, multiple central plant rooms.', complex_insp_hrs: 16, complex_rep_hrs: 24 },
        { sector: 'Industrial', size_category: 'Small Unit', min_sqm: 0, max_sqm: 500, simple_def: 'Basic shell, no specialized plant, dry storage, minimal office space.', simple_insp_hrs: 2, simple_rep_hrs: 3, standard_def: 'Small office/amenity block attached, 3-phase power, light trade use.', standard_insp_hrs: 3, standard_rep_hrs: 4, complex_def: 'Food-grade prep area, small cool room, or heavy extraction systems.', complex_insp_hrs: 4, complex_rep_hrs: 5 },
        { sector: 'Industrial', size_category: 'Medium Warehouse', min_sqm: 500, max_sqm: 2000, simple_def: 'Open warehouse, minimal office ratio, basic lighting and ventilation.', simple_insp_hrs: 3, simple_rep_hrs: 4, standard_def: 'Standard manufacturing/logistics, partial mezzanine, typical MEP.', standard_insp_hrs: 4, standard_rep_hrs: 6, complex_def: 'Specialized manufacturing, gantry cranes, dangerous goods (DG) storage.', complex_insp_hrs: 6, complex_rep_hrs: 8 },
        { sector: 'Industrial', size_category: 'Large Standalone', min_sqm: 2000, max_sqm: 5000, simple_def: 'Bulk dry storage, simple portal frame, low MEP needs.', simple_insp_hrs: 4, simple_rep_hrs: 6, standard_def: 'Logistics hub, moderate racking, standard office and yard component.', standard_insp_hrs: 6, standard_rep_hrs: 8, complex_def: 'Cold storage, heavy manufacturing plant, complex environmental controls.', complex_insp_hrs: 8, complex_rep_hrs: 12 },
        { sector: 'Industrial', size_category: 'Very Large / Bulk', min_sqm: 5000, max_sqm: 10000, simple_def: 'Open bulk warehouse, minimal compartmentalization or specialized zones.', simple_insp_hrs: 6, simple_rep_hrs: 8, standard_def: 'Standard distribution center, multiple loading docks, standard plant.', standard_insp_hrs: 8, standard_rep_hrs: 12, complex_def: 'Extensive temperature-controlled zones, automated sorting systems.', complex_insp_hrs: 12, complex_rep_hrs: 16 },
        { sector: 'Industrial', size_category: 'Mega / DC Scale', min_sqm: 10000, max_sqm: null, simple_def: 'Huge open dry-goods storage, minimal complex operational zones.', simple_insp_hrs: 8, simple_rep_hrs: 12, standard_def: 'Standard FMCG logistics, extensive but standard dock leveling and racking.', standard_insp_hrs: 12, standard_rep_hrs: 16, complex_def: 'High-tech ASRS (Automated Storage), massive refrigeration plant, heavy industrial processes.', complex_insp_hrs: 16, complex_rep_hrs: 24 },
        { sector: 'Retail', size_category: 'Small Shop / High-St', min_sqm: 0, max_sqm: 500, simple_def: 'Basic retail shell, no food prep, standard HVAC, single tenant.', simple_insp_hrs: 2, simple_rep_hrs: 3, standard_def: 'Cafe/light F&B with standard extraction, grease trap, and basic kitchen.', standard_insp_hrs: 3, standard_rep_hrs: 5, complex_def: 'Full commercial kitchen, intensive MEP, or pharmacy/medical use.', complex_insp_hrs: 4, complex_rep_hrs: 6 },
        { sector: 'Retail', size_category: 'Medium / Metro Supermarket', min_sqm: 500, max_sqm: 2500, simple_def: 'Open format retail (e.g., clothing/homeware), basic services.', simple_insp_hrs: 3, simple_rep_hrs: 5, standard_def: 'Convenience supermarket, basic deli/bakery, small display fridges.', standard_insp_hrs: 5, standard_rep_hrs: 8, complex_def: 'High-spec food market, extensive refrigeration, intensive lighting/HVAC.', complex_insp_hrs: 7, complex_rep_hrs: 10 },
        { sector: 'Retail', size_category: 'Large / Full-Line Supermarket', min_sqm: 2500, max_sqm: 5000, simple_def: 'Large format dry retail (e.g., furniture), uniform open space.', simple_insp_hrs: 4, simple_rep_hrs: 6, standard_def: 'Standard supermarket layout, moderate plant requirements, standard BOH.', standard_insp_hrs: 8, standard_rep_hrs: 12, complex_def: 'Full-service supermarket (butchery, bakery, massive CO₂ plant, heavy extraction).', complex_insp_hrs: 12, complex_rep_hrs: 18 },
        { sector: 'Retail', size_category: 'Big-Box / LFR Centre', min_sqm: 5000, max_sqm: 15000, simple_def: 'Basic big-box shell (e.g., hardware), minimal partitions, open plan.', simple_insp_hrs: 6, simple_rep_hrs: 8, standard_def: 'LFR centre with multiple standard tenancies, typical amenities.', standard_insp_hrs: 10, standard_rep_hrs: 14, complex_def: 'Mix of LFR and heavy F&B, complex roof plant, highly specialized tenancies.', complex_insp_hrs: 14, complex_rep_hrs: 20 },
        { sector: 'Retail', size_category: 'Regional Mall', min_sqm: 15000, max_sqm: null, simple_def: '(Rarely simple) Open concourses, basic retail shells, uniform systems.', simple_insp_hrs: 10, simple_rep_hrs: 14, standard_def: 'Standard mall, mix of fashion/services, standard food court and plant.', standard_insp_hrs: 16, standard_rep_hrs: 24, complex_def: 'Major food courts, cinemas, medical centres, massive centralized plant.', complex_insp_hrs: 24, complex_rep_hrs: 40 }
    ];

    const matrixData = (state.estimationMatrix && state.estimationMatrix.length > 0) ? state.estimationMatrix : fallbackMatrix;

    const match = matrixData.find(m => {
        const min = Number(m.min_sqm) || 0;
        const max = m.max_sqm !== null ? Number(m.max_sqm) : Infinity;
        return m.sector === sector && calcArea >= min && calcArea < max;
    });

    if (match) {
        if (descSpan) {
            descSpan.innerHTML = `<strong>${compVal.charAt(0).toUpperCase() + compVal.slice(1)}:</strong> ${match[`${compVal}_def`]}`;
        }
        matrixInspHrs = Number(match[`${compVal}_insp_hrs`]) || 0;
        matrixRepHrs = Number(match[`${compVal}_rep_hrs`]) || 0;
        row.dataset.sizeCategory = match.size_category;
    } else {
        if (descSpan) descSpan.innerHTML = '<strong>Special Purpose:</strong> Area is outside standard modeling. Fallback estimates apply.';
        row.dataset.sizeCategory = 'Special Purpose / Custom Scale';
    }

    const reportTypeHrs = getVal(typeSelect.value ? `rep_${typeSelect.value}` : null) || 0;

    let inspectionHrs = matrixInspHrs > 0 ? matrixInspHrs : 2.0;
    inspectionHrs = Math.round(inspectionHrs * 10) / 10; 

    // Pure Report Calculation without minimum floors overriding it
    let reportHrs = matrixRepHrs > 0 ? (matrixRepHrs + reportTypeHrs + speedHrs) : (8.0 + reportTypeHrs + speedHrs);
    reportHrs = Math.round(reportHrs * 10) / 10; 

    // 7. TOTAL CALCULATION
    const totalHrs = travelHrs + inspectionHrs + reportHrs;
    const baseFee = totalHrs * HOURLY_RATE;
    const inflatedFee = baseFee * CPI_MULTIPLIER;
    
    // --- VIP DISCOUNT LOGIC ---
    const clientId = state.currentUser?.clientSpoof?.id || state.currentUser?.id;
    const vipStats = window.getClientVipTier(clientId);
    
    const discountAmount = inflatedFee * vipStats.discount;
    const finalFee = Math.round(inflatedFee - discountAmount);

    let discountTag = '';
    if (vipStats.discount > 0) {
        discountTag = `<div style="margin-top: 8px; display: inline-flex; align-items: center; gap: 6px; font-size: 10px; font-weight: 700; color: #00264b; background: #f8fafc; border: 1px solid #cbd5e1; padding: 4px 10px; border-radius: 12px; letter-spacing: 0.5px; text-transform: uppercase; box-shadow: 0 2px 4px rgba(0,0,0,0.02);">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#0284c7" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"></path><line x1="7" y1="7" x2="7.01" y2="7"></line></svg>
            ${vipStats.discount * 100}% ${vipStats.tier.split(' ')[0]} Discount Applied
           </div><br>`;
    } else {
        discountTag = `<div style="margin-top: 8px; display: inline-flex; align-items: center; gap: 6px; font-size: 10px; font-weight: 700; color: #64748b; background: #f1f5f9; border: 1px solid #e2e8f0; padding: 4px 10px; border-radius: 12px; letter-spacing: 0.5px; text-transform: uppercase;">
            Standard Rate (No VIP Discount)
           </div><br>`;
    }

    let nextTierUpsell = '';
    if (state.discountsData && state.discountsData.length > 0) {
        const ascendingTiers = [...state.discountsData].sort((a, b) => Number(a.min_revenue) - Number(b.min_revenue));
        const nextTier = ascendingTiers.find(t => Number(t.min_revenue) > vipStats.revenue);

        if (nextTier) {
            const amountToGo = Number(nextTier.min_revenue) - vipStats.revenue;
            const nextTierName = `${nextTier.name} (${Number(nextTier.discount_percentage) * 100}% Off)`;
            
            nextTierUpsell = `
                <div style="margin-top: 4px; font-size: 10px; color: #64748b; font-weight: 500; letter-spacing: 0.2px;">
                    Only <strong>$${amountToGo.toLocaleString()}</strong> to unlock <strong>${nextTierName}</strong>
                </div>`;
        }
    }

    breakdownEl.innerHTML = `Travel: ${window.formatTimeReadable(travelHrs)} &nbsp;|&nbsp; Insp: ${window.formatTimeReadable(inspectionHrs)} &nbsp;|&nbsp; Report: ${window.formatTimeReadable(reportHrs)} <br>${discountTag} ${nextTierUpsell}`;
    
    totalEl.innerText = `$${finalFee.toLocaleString()}`;
    totalEl.style.color = "#0284c7"; 
    hiddenCostEl.value = finalFee; 
    
    row.dataset.breakdownInsp = inspectionHrs.toFixed(1);
    row.dataset.breakdownRep = reportHrs.toFixed(1);
    row.dataset.breakdownTrav = travelHrs.toFixed(1);
    row.dataset.discountApplied = vipStats.discount; 
};

window.openRequestModal = async () => {
    document.getElementById('requestModalOverlay').classList.add('active');
    
    document.getElementById('reqPremisesContainer').innerHTML = '';
    window.addPremiseRow();
    document.getElementById('reqNotes').value = '';

    const contactSelect = document.getElementById('reqContactId');
    contactSelect.innerHTML = '<option value="" disabled selected>Loading contacts...</option>';

    try {
        const clientId = state.currentUser.clientSpoof?.id || state.currentUser.id;
        const { data, error } = await supabase.from('contacts').select('*').eq('client_id', clientId).order('first_name');
        if (error) throw error;
        
        if (data && data.length > 0) {
            contactSelect.innerHTML = '<option value="" disabled selected>Select Property Manager...</option>' + 
                data.map(c => `<option value="${c.id}" data-name="${c.first_name} ${c.last_name}" data-email="${c.email}" data-wfmid="${c.wfm_id || ''}">${c.first_name} ${c.last_name} (${c.email})</option>`).join('');
        } else {
            contactSelect.innerHTML = '<option value="" disabled selected>No contacts found. Please add one.</option>';
        }
    } catch (err) {
        contactSelect.innerHTML = '<option value="" disabled selected>Error loading contacts</option>';
    }
};

window.closeRequestModal = () => {
    document.getElementById('requestModalOverlay').classList.remove('active');
    document.getElementById('requestReportForm').reset();
    
    document.getElementById('reqPremisesContainer').innerHTML = '';
    window.addPremiseRow();
};

window.updateFileName = (input, displayId) => {
    const displayEl = document.getElementById(displayId);
    if (input.files.length === 0) displayEl.innerText = '';
    else if (input.files.length === 1) displayEl.innerText = input.files[0].name;
    else displayEl.innerText = `${input.files.length} files selected`;
};

// Handle the bulk submission & WFM Sync
document.getElementById('requestReportForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('submitRequestBtn');
    const originalText = btn.innerText;
    btn.innerText = 'Uploading Files...';
    btn.disabled = true;

    try {
        const contactSelect = document.getElementById('reqContactId');
        if (!contactSelect.value) throw new Error("Please select a Property Manager.");
        
        const selectedOption = contactSelect.options[contactSelect.selectedIndex];
        const managerName = selectedOption.dataset.name;
        const managerEmail = selectedOption.dataset.email;
        const managerWfmId = selectedOption.dataset.wfmid || null;

        const clientName = state.currentUser.clientSpoof?.name || state.currentUser.name;
        const clientWfmId = state.currentUser.clientSpoof?.wfm_id || state.currentUser.wfm_id; 
        const notes = document.getElementById('reqNotes').value.trim();

        const rows = document.querySelectorAll('.premise-req-row');
        const inserts = [];
        const wfmPayloads = []; 
        let currentRow = 1;

        for (const row of rows) {
            btn.innerText = `Processing Premise ${currentRow} of ${rows.length}...`;
            
            const premiseName = row.querySelector('.req-name-input').value.trim(); 
            const siteArea = parseFloat(row.querySelector('.req-site-area-input').value) || 0; 
            const floorArea = parseFloat(row.querySelector('.req-floor-area-input').value) || 0; 
            
            const addressLine = row.querySelector('.req-address-input').value.trim();
            const region = row.querySelector('.req-region-input').value.trim();
            const country = row.querySelector('.req-country-select').value;
            const reportType = row.querySelector('.req-type-select').value;
            const deadline = row.querySelector('.req-deadline-input').value;
            const coNumber = row.querySelector('.req-co-input').value.trim();
            
            const baseCost = parseFloat(row.querySelector('.req-hidden-cost').value) || 0;
            const calcArea = parseFloat(row.querySelector('.req-hidden-calc-area').value) || 0;

            const leaseInput = row.querySelector('.req-lease-file');
            const planInput = row.querySelector('.req-plan-file');
            const fullAddress = `${addressLine}, ${region}, ${country}`;

            const travelText = row.dataset.cachedTravelText || "Pending/Local";
            const deadlineDate = new Date(deadline);
            const isRush = Math.ceil((deadlineDate - new Date()) / (1000 * 60 * 60 * 24)) <= 10;
            const speedText = isRush ? 'Urgent / Rush (<10 Days)' : 'Standard';

            const bldgType = row.querySelector('.req-bldg-type-select').selectedOptions[0].text;
            const complexityText = row.querySelector('.req-complexity-select').selectedOptions[0].text;
            
            const sizeCategory = row.dataset.sizeCategory || "Special Purpose / Custom";
            
            const trvH = parseFloat(row.dataset.breakdownTrav || '0.5');
            const inspH = parseFloat(row.dataset.breakdownInsp || '2.0');
            const repH = parseFloat(row.dataset.breakdownRep || '10.0');
            const totalH = trvH + inspH + repH;

            const complexityBreakdown = `
--- HOURS & COMPLEXITY PROFILE ---
Calculated Time: ${window.formatTimeReadable(totalH)} Total
• Travel: ${window.formatTimeReadable(trvH)} (Exact Route Math)
• Inspection: ${window.formatTimeReadable(inspH)} (Baseline + Complexity)
• Reporting: ${window.formatTimeReadable(repH)} (Drafting, Peer Review & Uploads)

Areas: Site ${siteArea.toLocaleString()} sqm | Floor ${floorArea.toLocaleString()} sqm
Scale: ${sizeCategory}
Calc Base: ${calcArea.toFixed(0).toLocaleString()} sqm
Turnaround: ${speedText}
Building Profile: ${bldgType} | Complexity: ${complexityText}
----------------------------------
`.trim();

            if (addressLine && reportType && deadline) {
                const leaseUrls = await uploadMultipleFiles(leaseInput, 'report_requests', 'leases');
                const planUrls = await uploadMultipleFiles(planInput, 'report_requests', 'plans');

                inserts.push({
                    client_name: clientName,
                    property_manager: managerName,
                    property_manager_email: managerEmail,
                    premise_name: premiseName, 
                    address: fullAddress,
                    report_type: reportType,
                    delivery_deadline: deadline,
                    co_number: coNumber || null,
                    notes: notes || null,
                    target_area: calcArea, 
                    estimated_cost: baseCost > 0 ? baseCost : null, 
                    status: 'Pending',
                    request_date: new Date().toISOString(),
                    lease_url: leaseUrls || null,
                    plan_url: planUrls || null
                });

                wfmPayloads.push({
                    request: {
                        client_name: clientName,
                        premise_name: premiseName,
                        address: fullAddress,
                        report_type: reportType,
                        delivery_deadline: deadline,
                        notes: `${complexityBreakdown}\n\nClient Notes:\n${notes || 'None'}`,
                        lease_url: leaseUrls || null,
                        plan_url: planUrls || null
                    },
                    budget: baseCost,
                    clientWfmId: clientWfmId,
                    contactWfmId: managerWfmId
                });
            }
            currentRow++;
        }

        if (inserts.length === 0) throw new Error("Please provide details for at least one premise.");

        btn.innerText = 'Saving to Database...';
        const { error: insertError } = await supabase.from('report_requests').insert(inserts);
        if (insertError) throw insertError;

        btn.innerText = 'Notifying Team...';
        const { error: emailError } = await supabase.functions.invoke('send-request-email', {
            body: { requests: inserts }
        });
        if (emailError) console.error("Email warning:", emailError);

        btn.innerText = 'Generating WFM Quotes...';
        let wfmSuccessCount = 0;
        for (const payload of wfmPayloads) {
            try {
                const { error: wfmError } = await supabase.functions.invoke('wfm-create-quote', {
                    body: payload
                });
                if (!wfmError) wfmSuccessCount++;
            } catch (e) {
                console.error("WFM Background Sync Error:", e);
            }
        }

        log("Report request sent successfully!");
        alert(`Success! Logged ${inserts.length} request(s).\n\n${wfmSuccessCount} Draft Quotes were automatically generated in WorkflowMax!`);
        window.closeRequestModal();

    } catch (err) {
        log("Error: " + err.message, true);
        alert("Failed to submit request:\n" + err.message);
    } finally {
        btn.innerText = originalText;
        btn.disabled = false;
    }
});

// --- ADD CONTACT SUB-MODAL LOGIC ---
window.openAddContactModal = () => document.getElementById('addContactModalOverlay').classList.add('active');
window.closeAddContactModal = () => {
    document.getElementById('addContactModalOverlay').classList.remove('active');
    document.getElementById('addContactForm').reset();
};

document.getElementById('addContactForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('submitContactBtn');
    btn.innerText = 'Saving...';
    btn.disabled = true;

    try {
        const clientId = state.currentUser.clientSpoof?.id || state.currentUser.id;
        
        const newContact = {
            client_id: clientId,
            first_name: document.getElementById('newContFirst').value.trim(),
            last_name: document.getElementById('newContLast').value.trim(),
            email: document.getElementById('newContEmail').value.trim(),
            mobile: document.getElementById('newContMobile').value.trim() || null,
            position: document.getElementById('newContPosition').value.trim() || null
        };

        const { data, error } = await supabase.from('contacts').insert([newContact]).select().single();
        if (error) throw error;

        const contactSelect = document.getElementById('reqContactId');
        
        if (contactSelect.options[0] && contactSelect.options[0].value === "") {
            contactSelect.innerHTML = '<option value="" disabled>Select Property Manager...</option>';
        }
        
        const newOptionHtml = `<option value="${data.id}" data-name="${data.first_name} ${data.last_name}" data-email="${data.email}">${data.first_name} ${data.last_name} (${data.email})</option>`;
        contactSelect.insertAdjacentHTML('beforeend', newOptionHtml);
        
        contactSelect.value = data.id;

        window.closeAddContactModal();
    } catch (err) {
        alert("Failed to create contact:\n" + err.message);
    } finally {
        btn.innerText = 'Save Contact';
        btn.disabled = false;
    }
});

// --- CREATE REPORT MODAL ---
window.openCreateReportModal = () => {
    const clientSelect = document.getElementById('newRepClient');
    const premiseSelect = document.getElementById('newRepPremise');
    
    clientSelect.innerHTML = '<option value="" disabled selected>Select Client...</option>' + 
        [...state.clientsData].sort((a,b)=>a.name.localeCompare(b.name)).map(c => `<option value="${c.id}">${c.name}</option>`).join('');
        
    premiseSelect.innerHTML = '<option value="" disabled selected>Select Premise...</option>' + 
        [...state.premisesData].sort((a,b)=>a.name.localeCompare(b.name)).map(p => `<option value="${p.id}">${p.name}</option>`).join('');
        
    document.getElementById('createReportModalOverlay').classList.add('active');
};
window.closeCreateReportModal = () => {
    document.getElementById('createReportModalOverlay').classList.remove('active');
    document.getElementById('createReportForm').reset();
    document.getElementById('newRepImagesName').innerText = '';
};

document.getElementById('createReportForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('submitCreateReportBtn');
    const originalText = btn.innerText;
    btn.innerText = 'Creating & Uploading...';
    btn.disabled = true;

    try {
        const premiseId = document.getElementById('newRepPremise').value;
        const jobNo = document.getElementById('newRepJobNo').value.trim();
        let reportName = document.getElementById('newRepName').value.trim();
        
        if (!reportName) {
            const selectedPremise = state.premisesData.find(p => p.id === premiseId);
            reportName = selectedPremise ? selectedPremise.name : 'Unknown Property';
        }
        
        const imageUrls = await uploadMultipleFiles(document.getElementById('newRepImages'), 'GEOMAP-JOB Covers', '', `${jobNo} - `);

        const formData = {
            client_id: document.getElementById('newRepClient').value,
            premise_id: premiseId,
            job_number: jobNo,
            name: reportName,
            report_type: document.getElementById('newRepType').value,
            status: document.getElementById('newRepStatus').value,
            surveyed_by: document.getElementById('newRepSurveyor').value || null,
            inspection_date: document.getElementById('newRepDate').value || null,
            delivery_date: document.getElementById('newRepDeliveryDate').value || null,
            pdf_url: document.getElementById('newRepPdf').value.trim() || null,
            info_url: document.getElementById('newRepInfo').value.trim() || null,
            invoice_url: document.getElementById('newRepInvoice').value.trim() || null,
            video_url: document.getElementById('newRepVideo').value.trim() || null
        };
        if (imageUrls) formData.image_url = imageUrls;

        const { error: insertError } = await supabase.from('reports').insert([formData]);
        if (insertError) throw insertError;

        log("Report created successfully!");
        window.closeCreateReportModal();
        if(window.refreshAppAdminData) await window.refreshAppAdminData();
    } catch (err) {
        log("Create Report Error: " + err.message, true);
        alert("Failed to create report:\n" + err.message);
    } finally {
        btn.innerText = originalText;
        btn.disabled = false;
    }
});

// --- EDIT REPORT MODAL ---
window.openEditReportModal = (id) => {
    let report = state.allReportsData.find(r => String(r.id) === String(id));
    if (!report && state.currentViewedPremise && state.currentViewedPremise.reports) {
        report = state.currentViewedPremise.reports.find(r => String(r.id) === String(id));
    }
    
    if (!report) { log("Error: Report not found in memory.", true); return; }
    
    state.currentEditReportId = report.id;
    state.currentEditJobNo = report.job_number;

    document.getElementById('editRepSurveyor').value = report.surveyed_by || '';
    document.getElementById('editRepDate').value = report.inspection_date || '';
    document.getElementById('editRepDeliveryDate').value = report.delivery_date || '';
    document.getElementById('editRepPdf').value = report.pdf_url || '';
    document.getElementById('editRepInfo').value = report.info_url || '';
    document.getElementById('editRepInvoice').value = report.invoice_url || '';
    document.getElementById('editRepVideo').value = report.video_url || '';
    
    document.getElementById('editRepImagesName').innerText = '';
    document.getElementById('editRepImages').value = ''; 

    document.getElementById('editReportModalOverlay').classList.add('active');
};
window.closeEditReportModal = () => {
    document.getElementById('editReportModalOverlay').classList.remove('active');
    document.getElementById('editReportForm').reset();
    state.currentEditReportId = null;
    state.currentEditJobNo = null;
};

document.getElementById('editReportForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('submitEditReportBtn');
    const originalText = btn.innerText;
    btn.innerText = 'Saving Updates...';
    btn.disabled = true;

    try {
        let report = state.allReportsData.find(r => String(r.id) === String(state.currentEditReportId));
        if (!report && state.currentViewedPremise && state.currentViewedPremise.reports) {
            report = state.currentViewedPremise.reports.find(r => String(r.id) === String(state.currentEditReportId));
        }

        let existingImages = [];
        if (report?.image_url) {
            if (Array.isArray(report.image_url)) existingImages = [...report.image_url];
            else if (typeof report.image_url === 'string' && report.image_url.trim() !== '') {
                try {
                    existingImages = JSON.parse(report.image_url);
                    if (!Array.isArray(existingImages)) existingImages = [report.image_url];
                } catch(err) { existingImages = report.image_url.split(',').map(s=>s.trim()); }
            }
        }

        const newImageUrls = await uploadMultipleFiles(document.getElementById('editRepImages'), 'GEOMAP-JOB Covers', '', `${state.currentEditJobNo} - `);
        if (newImageUrls?.length > 0) existingImages.push(...newImageUrls);

        const updateData = {
            surveyed_by: document.getElementById('editRepSurveyor').value || null,
            inspection_date: document.getElementById('editRepDate').value || null,
            delivery_date: document.getElementById('editRepDeliveryDate').value || null,
            pdf_url: document.getElementById('editRepPdf').value.trim() || null,
            info_url: document.getElementById('editRepInfo').value.trim() || null,
            invoice_url: document.getElementById('editRepInvoice').value.trim() || null,
            video_url: document.getElementById('editRepVideo').value.trim() || null
        };
        if (existingImages.length > 0) updateData.image_url = existingImages;

        const { error } = await supabase.from('reports').update(updateData).eq('id', state.currentEditReportId);
        if (error) throw error;

        log("Report updated successfully!");
        window.closeEditReportModal();
        if(window.refreshAppAdminData) await window.refreshAppAdminData();
        
        if (state.currentViewedPremise) {
            const updatedPremise = state.premisesData.find(p => String(p.id) === String(state.currentViewedPremise.id));
            if (updatedPremise) showDetail(updatedPremise);
        }
    } catch (err) {
        log("Edit Report Error: " + err.message, true);
        alert("Failed to update report:\n" + err.message);
    } finally {
        btn.innerText = originalText;
        btn.disabled = false;
    }
});

// --- CREATE CLIENT MODAL ---
window.openCreateClientModal = () => document.getElementById('createClientModalOverlay').classList.add('active');
window.closeCreateClientModal = () => {
    document.getElementById('createClientModalOverlay').classList.remove('active');
    document.getElementById('createClientForm').reset();
    document.getElementById('newClientLogoName').innerText = '';
};

document.getElementById('createClientForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('submitCreateClientBtn');
    btn.innerText = 'Saving...';
    btn.disabled = true;

    try {
        const clientName = document.getElementById('newClientName').value.trim();
        const logoInput = document.getElementById('newClientLogo');
        let logoUrl = null;

        if (logoInput.files && logoInput.files.length > 0) {
            const file = logoInput.files[0];
            const ext = file.name.split('.').pop();
            const safeName = clientName.replace(/[^a-zA-Z0-9.\-_ ]/g, ''); 
            const filePath = `${safeName}.${ext}`; 

            const { error: uploadError } = await supabase.storage.from('GEOMAP-Images').upload(filePath, file, { upsert: true });
            if (uploadError) throw new Error(`Failed to upload logo: ${uploadError.message}`);

            logoUrl = supabase.storage.from('GEOMAP-Images').getPublicUrl(filePath).data.publicUrl;
        }

        const formData = {
            name: clientName,
            access_code: document.getElementById('newClientCode').value.trim() || null,
            logo_url: logoUrl
        };

        const { data, error } = await supabase.from('clients').insert([formData]).select().single();
        if (error) throw error;

        log("Client created successfully!");
        if(window.refreshAppAdminData) await window.refreshAppAdminData();
        
        const clientSelect = document.getElementById('newRepClient');
        clientSelect.innerHTML = '<option value="" disabled>Select Client...</option>' + 
            [...state.clientsData].sort((a,b)=>a.name.localeCompare(b.name)).map(c => `<option value="${c.id}">${c.name}</option>`).join('');
        clientSelect.value = data.id;

        window.closeCreateClientModal();
    } catch (err) {
        log("Create Client Error: " + err.message, true);
        alert("Failed to create client:\n" + err.message);
    } finally {
        btn.innerText = 'Save Client';
        btn.disabled = false;
    }
});

// --- CREATE PREMISE MODAL ---
window.openCreatePremiseModal = () => document.getElementById('createPremiseModalOverlay').classList.add('active');
window.closeCreatePremiseModal = () => {
    document.getElementById('createPremiseModalOverlay').classList.remove('active');
    document.getElementById('createPremiseForm').reset();
};

document.getElementById('createPremiseForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('submitCreatePremiseBtn');
    btn.innerText = 'Geocoding & Saving...';
    btn.disabled = true;

    try {
        const address = document.getElementById('newPremiseAddress').value.trim();
        let lat = null, lng = null;
        try {
            const res = await fetch(`https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(address)}.json?access_token=${MAPBOX_TOKEN}&country=nz&limit=1`);
            const json = await res.json();
            if (json.features && json.features.length > 0) {
                lng = json.features[0].center[0];
                lat = json.features[0].center[1];
            }
        } catch(geoErr) { console.error("Geocoding failed", geoErr); }

        const formData = {
            name: document.getElementById('newPremiseName').value.trim(),
            address: address,
            lat: lat,
            lng: lng,
            sector: document.getElementById('newPremiseSector').value || null,
            legal_description: document.getElementById('newPremiseLegal').value.trim() || null,
            floor_area: document.getElementById('newPremiseFloor').value.trim() || null,
            site_area: document.getElementById('newPremiseSite').value.trim() || null,
            year_built: parseInt(document.getElementById('newPremiseYear').value) || null
        };

        const { data, error } = await supabase.from('premises').insert([formData]).select().single();
        if (error) throw error;

        log("Premise created successfully!");
        if(window.refreshAppAdminData) await window.refreshAppAdminData();
        
        const premiseSelect = document.getElementById('newRepPremise');
        premiseSelect.innerHTML = '<option value="" disabled>Select Premise...</option>' + 
            [...state.premisesData].sort((a,b)=>a.name.localeCompare(b.name)).map(p => `<option value="${p.id}">${p.name}</option>`).join('');
        premiseSelect.value = data.id;

        window.closeCreatePremiseModal();
    } catch (err) {
        log("Create Premise Error: " + err.message, true);
        alert("Failed to create premise:\n" + err.message);
    } finally {
        btn.innerText = 'Save Premise';
        btn.disabled = false;
    }
});

// --- EDIT CONTACT MODAL & PASTE LOGIC ---
window.openEditContactModal = (id) => {
    const contact = state.contactsData.find(c => String(c.id) === String(id));
    if (!contact) return;
    
    state.currentEditContactId = contact.id;

    document.getElementById('editContFirst').value = contact.first_name || '';
    document.getElementById('editContLast').value = contact.last_name || '';
    document.getElementById('editContEmail').value = contact.email || '';
    document.getElementById('editContMobile').value = contact.mobile || '';
    document.getElementById('editContPosition').value = contact.position || '';
    document.getElementById('editContLinkedin').value = contact.linkedin || '';
    
    document.getElementById('editContImage').value = '';
    document.getElementById('editContImageName').innerText = '';
    const imgEl = document.getElementById('editContImgElement');
    const initialsEl = document.getElementById('editContInitials');
    
    if (contact.profile_image_url) {
        imgEl.src = contact.profile_image_url;
        imgEl.style.display = 'block';
        initialsEl.style.display = 'none';
    } else {
        imgEl.style.display = 'none';
        initialsEl.innerText = `${(contact.first_name?.[0]||'')}${(contact.last_name?.[0]||'')}`.toUpperCase();
        initialsEl.style.display = 'block';
    }

    const modal = document.getElementById('editContactModalOverlay');
    modal.classList.add('active');
    
    setTimeout(() => document.getElementById('editContactBody').focus(), 100);
};

window.closeEditContactModal = () => {
    document.getElementById('editContactModalOverlay').classList.remove('active');
    document.getElementById('editContactForm').reset();
    state.currentEditContactId = null;
};

document.getElementById('editContactBody')?.addEventListener('paste', (e) => {
    const items = e.clipboardData?.items;
    if (!items) return;

    for (let item of items) {
        if (item.type.indexOf('image') !== -1) {
            const file = item.getAsFile();
            const dt = new DataTransfer();
            dt.items.add(file);
            
            const input = document.getElementById('editContImage');
            input.files = dt.files;
            
            window.previewContactImage(input);
            break; 
        }
    }
});

window.previewContactImage = (input) => {
    const displayEl = document.getElementById('editContImageName');
    const imgEl = document.getElementById('editContImgElement');
    const initialsEl = document.getElementById('editContInitials');
    
    if (input.files && input.files[0]) {
        displayEl.innerText = `Ready: ${input.files[0].name}`;
        displayEl.style.color = '#10b981';
        
        const reader = new FileReader();
        reader.onload = (e) => {
            imgEl.src = e.target.result;
            imgEl.style.display = 'block';
            initialsEl.style.display = 'none';
        };
        reader.readAsDataURL(input.files[0]);
    }
};

document.getElementById('editContactForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('submitEditContactBtn');
    const originalText = btn.innerText;
    btn.innerText = 'Saving...';
    btn.disabled = true;

    try {
        const contact = state.contactsData.find(c => String(c.id) === String(state.currentEditContactId));
        let profileUrl = contact.profile_image_url;

        if (document.getElementById('editContImage').files.length > 0) {
            btn.innerText = 'Uploading Photo...';
            const urls = await uploadMultipleFiles(document.getElementById('editContImage'), 'contact_profiles', '', `cont_${contact.id}_`);
            if (urls && urls.length > 0) profileUrl = urls[0];
        }

        const updateData = {
            first_name: document.getElementById('editContFirst').value.trim(),
            last_name: document.getElementById('editContLast').value.trim(),
            email: document.getElementById('editContEmail').value.trim() || null,
            mobile: document.getElementById('editContMobile').value.trim() || null,
            position: document.getElementById('editContPosition').value.trim() || null,
            linkedin: document.getElementById('editContLinkedin').value.trim() || null,
            profile_image_url: profileUrl
        };

        const { error } = await supabase.from('contacts').update(updateData).eq('id', state.currentEditContactId);
        if (error) throw error;

        log("Contact updated successfully!");
        window.closeEditContactModal();
        if (window.refreshAppAdminData) await window.refreshAppAdminData();
        
    } catch (err) {
        log("Edit Contact Error: " + err.message, true);
        alert("Failed to update contact:\n" + err.message);
    } finally {
        btn.innerText = originalText;
        btn.disabled = false;
    }
});

// --- CREATE ADMIN CONTACT MODAL & PASTE LOGIC ---
window.openCreateAdminContactModal = () => {
    const clientSelect = document.getElementById('createContClient');
    clientSelect.innerHTML = '<option value="" disabled selected>Select a Client...</option>' + 
        [...state.clientsData].sort((a,b)=>a.name.localeCompare(b.name)).map(c => `<option value="${c.id}">${c.name}</option>`).join('');
        
    document.getElementById('createAdminContactModalOverlay').classList.add('active');
    
    document.getElementById('createContImgElement').style.display = 'none';
    document.getElementById('createContInitials').style.display = 'flex';
    document.getElementById('createContInitials').innerText = '?';
    document.getElementById('createContImageName').innerText = '';
    
    setTimeout(() => document.getElementById('createAdminContactBody').focus(), 100);
};

window.closeCreateAdminContactModal = () => {
    document.getElementById('createAdminContactModalOverlay').classList.remove('active');
    document.getElementById('createAdminContactForm').reset();
};

document.getElementById('createAdminContactBody')?.addEventListener('paste', (e) => {
    const items = e.clipboardData?.items;
    if (!items) return;

    for (let item of items) {
        if (item.type.indexOf('image') !== -1) {
            const file = item.getAsFile();
            const dt = new DataTransfer();
            dt.items.add(file);
            
            const input = document.getElementById('createContImage');
            input.files = dt.files;
            window.previewNewContactImage(input);
            break; 
        }
    }
});

window.previewNewContactImage = (input) => {
    const displayEl = document.getElementById('createContImageName');
    const imgEl = document.getElementById('createContImgElement');
    const initialsEl = document.getElementById('createContInitials');
    
    if (input.files && input.files[0]) {
        displayEl.innerText = `Ready: ${input.files[0].name}`;
        displayEl.style.color = '#10b981';
        
        const reader = new FileReader();
        reader.onload = (e) => {
            imgEl.src = e.target.result;
            imgEl.style.display = 'block';
            initialsEl.style.display = 'none';
        };
        reader.readAsDataURL(input.files[0]);
    }
};

document.getElementById('createAdminContactForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('submitCreateAdminContactBtn');
    const originalText = btn.innerText;
    btn.innerText = 'Saving...';
    btn.disabled = true;

    try {
        let profileUrl = null;
        const clientId = document.getElementById('createContClient').value;
        
        if (!clientId) throw new Error("Please select a Client Company.");

        if (document.getElementById('createContImage').files.length > 0) {
            btn.innerText = 'Uploading Photo...';
            const uniquePrefix = `cont_new_${Date.now()}_`;
            const urls = await uploadMultipleFiles(document.getElementById('createContImage'), 'contact_profiles', '', uniquePrefix);
            if (urls && urls.length > 0) profileUrl = urls[0];
        }

        const newContact = {
            client_id: clientId,
            first_name: document.getElementById('createContFirst').value.trim(),
            last_name: document.getElementById('createContLast').value.trim(),
            email: document.getElementById('createContEmail').value.trim() || null,
            mobile: document.getElementById('createContMobile').value.trim() || null,
            position: document.getElementById('createContPosition').value.trim() || null,
            linkedin: document.getElementById('createContLinkedin').value.trim() || null,
            profile_image_url: profileUrl
        };

        const { error } = await supabase.from('contacts').insert([newContact]);
        if (error) throw error;

        log("Contact created successfully!");
        window.closeCreateAdminContactModal();
        if (window.refreshAppAdminData) await window.refreshAppAdminData();
        
    } catch (err) {
        log("Create Contact Error: " + err.message, true);
        alert("Failed to create contact:\n" + err.message);
    } finally {
        btn.innerText = originalText;
        btn.disabled = false;
    }
});
