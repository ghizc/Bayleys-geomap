// app.js

// 1. Imports
import { state } from './store.js';
import { ADMIN_UUID } from './config.js';
import { supabase, loginUser, getAdminData, getClientPremises, getClientById } from './api.js';
import { initMap, addMarkers, highlightMarker } from './map.js';
import { 
    log, toggleDashboardOverlay, renderBICharts, filterAdminView, 
    loadClientView, showDetail, updateGalleryImage, switchScreen, 
    renderFilterDropdown, normalizeStatus 
} from './ui.js';
import './modals.js'; // Running this executes the modal setup code

// 2. Global Hooks for Inline HTML Event Handlers

window.switchChart = (type, btnElement) => {
    // Handle UI button active state
    document.querySelectorAll('.chart-tab').forEach(el => el.classList.remove('active'));
    btnElement.classList.add('active');
    
    // Render the new chart using the ui.js function
    import('./ui.js').then(ui => {
        ui.renderBICharts(state.premisesData, state.allReportsData, type);
    });
};

window.filterDashboard = (filterType, cardElement) => {
    // 1. Highlight the clicked card
    document.querySelectorAll('.stat-card').forEach(el => el.classList.remove('active-filter'));
    cardElement.classList.add('active-filter');

    // 2. Filter map markers and left sidebar list based on KPI clicked
    import('./ui.js').then(ui => {
        let filteredPremises = [];
        
        if (filterType === 'all') {
            filteredPremises = state.premisesData;
            state.currentAdminSubFilter = 'all'; 
        } else {
            // Find reports matching the condition
            const matchingReports = state.allReportsData.filter(job => {
                const status = ui.normalizeStatus(job.status);
                if (filterType === 'active') return !['complete','invoice','cancelled'].includes(status);
                if (filterType === 'inspect') return status === 'new';
                if (filterType === 'invoice') return ['report','advice'].includes(status);
                return false;
            });
            
            // Get unique premises for those reports
            const premiseIds = new Set(matchingReports.map(r => r.premise_id));
            filteredPremises = state.premisesData.filter(p => premiseIds.has(p.id));
            
            // Sync sidebar filter
            if (filterType === 'inspect') state.currentAdminSubFilter = 'new';
            else state.currentAdminSubFilter = 'all'; // Default back to all for complex filters
        }

        // 3. Update Map
        import('./map.js').then(mapMod => {
            mapMod.addMarkers(filteredPremises);
        });

        // 4. Update Sidebar
        ui.filterAdminView(); 
    });
};

window.switchAdminTab = (type) => {
    state.activeAdminTab = type;
    document.getElementById('tabClientsBtn').classList.toggle('active', type === 'clients');
    document.getElementById('tabReportsBtn').classList.toggle('active', type === 'reports');
    document.getElementById('tabContactsBtn').classList.toggle('active', type === 'contacts');
    document.getElementById('tabQuotesBtn').classList.toggle('active', type === 'quotes'); // <-- ADD THIS
    
    // Show/Hide the pinned Add Contact button
    const addContactWrapper = document.getElementById('adminAddContactWrapper');
    if (addContactWrapper) {
        addContactWrapper.style.display = type === 'contacts' ? 'block' : 'none';
    }
    
    state.currentAdminSubFilter = 'all';
    renderFilterDropdown(type);
    filterAdminView();
};

window.triggerClientLoad = async (clientId) => {
    toggleDashboardOverlay(false);
    const client = state.clientsData.find(c => c.id === clientId);
    state.currentUser = { role: 'admin', name: 'Bayleys Admin', id: ADMIN_UUID, clientSpoof: client };
    document.getElementById('backToAdminBtn').style.display = 'block';
    
    await window.fetchAppClientPremises(client.id);
    switchScreen('premisesScreen');
    loadClientView();
};

window.highlightSidebarCard = (premiseId) => {
    // 1. Remove highlight from all cards
    document.querySelectorAll('.card-item').forEach(card => card.classList.remove('active-card'));
    
    if (!premiseId) return;

    // 2. Find the card that matches this premise and highlight it
    document.querySelectorAll('.card-item').forEach(card => {
        const onclickText = card.getAttribute('onclick') || '';
        if (onclickText.includes(premiseId)) {
            card.classList.add('active-card');
            // Smoothly scroll the sidebar so the card is visible
            card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
    });
};

window.triggerDetailLoad = (premiseId) => {
    const p = state.premisesData.find(x => String(x.id) === String(premiseId));
    if (p) {
        import('./map.js').then(mapMod => mapMod.highlightMarker(p.id));
        window.highlightSidebarCard(p.id);
        showDetail(p);
    }
};

window.triggerStatusUpdate = async (reportId, newStatus, selectElement) => {
    if (!state.currentUser || state.currentUser.role !== 'admin') return;
    
    const safeClass = normalizeStatus(newStatus);
    selectElement.className = `status-select ${safeClass}-status`;
    selectElement.blur();
    
    try {
        const { error } = await supabase.from('reports').update({ status: newStatus }).eq('id', reportId);
        if (error) throw error;
        log(`Status updated to ${newStatus}`);
        
        await window.refreshAppAdminData();
        
        if (state.currentViewedPremise) {
            const updatedPremise = state.premisesData.find(x => String(x.id) === String(state.currentViewedPremise.id));
            if (updatedPremise) showDetail(updatedPremise);
        }
    } catch (err) { 
        log("Update failed: " + err.message, true); 
        alert("Update failed: " + err.message); 
    }
};

window.connectWFM = () => {
    const clientId = 'a1350549-4184-4675-9668-71fcf8f50dcc'; 
    const redirectUri = encodeURIComponent('https://qppsjxvkoihirzicllvg.supabase.co/functions/v1/wfm-callback'); 
    const scope = encodeURIComponent('openid profile email workflowmax offline_access');
    const state = 'bayleys_geomap_auth'; 
    
    const wfmAuthUrl = `https://oauth.workflowmax.com/oauth/authorize?response_type=code&client_id=${clientId}&redirect_uri=${redirectUri}&scope=${scope}&state=${state}&prompt=consent`;
    
    window.location.href = wfmAuthUrl;
};

/// app.js - Update this specific section
window.triggerWFMSync = async (btnElement, mode) => {
    if (!mode) return;

    const originalText = btnElement.innerHTML;
    btnElement.disabled = true;

    try {
        let currentPage = 1;
        let hasMore = true;
        let totalProcessed = 0;
        
        // We set a hard limit of 100 for jobs, but let clients sync infinitely
        const limit = mode === 'jobs' ? 100 : Infinity; 

        // Stop the loop if WFM says it's done, OR if we hit our 100 job limit
        while (hasMore && totalProcessed < limit) {
            btnElement.innerHTML = `🔄 Syncing ${mode} (Page ${currentPage})...`;
            
            const { data, error } = await supabase.functions.invoke('wfm-sync', {
                body: { mode: mode, page: currentPage }
            });
            
            if (error) throw error;
            if (data && data.error) throw new Error(data.error);

            totalProcessed += data.count;
            hasMore = data.hasMore;
            
            if (hasMore) {
                currentPage = data.nextPage;
            }
        }
        
        // Cap the success message number so it doesn't look weird if a batch pushed it to 105
        const finalCount = totalProcessed > limit ? limit : totalProcessed;
        
        alert(`Success! Synced the latest ${finalCount} ${mode}.`);
        if (window.refreshAppAdminData) await window.refreshAppAdminData();
        
    } catch (err) {
        console.error("System Error Details:", err);
        alert("System Error: " + (err.message || "Failed to connect to server."));
    } finally {
        btnElement.innerHTML = originalText;
        btnElement.disabled = false;
    }
};

// 3. Core Data Fetching Functions
window.refreshAppAdminData = async () => {
    log("Fetching data...");
    try {
        const { clients, reports, premises, contacts, requests } = await getAdminData();
        state.allReportsData = reports;
        state.premisesData = premises;
        state.contactsData = contacts;
        state.reportRequestsData = requests;
        
        if (state.currentUser && state.currentUser.role === 'admin') {
            toggleDashboardOverlay(true);
            const activeJobs = reports.filter(job => !['complete','invoice','cancelled'].includes(normalizeStatus(job.status))).length;
            const toInspect = reports.filter(job => normalizeStatus(job.status) === 'new').length;
            
            // --- NEW: Calculate Revenue to Invoice ---
            const invoiceReports = reports.filter(job => ['report','advice'].includes(normalizeStatus(job.status)));
            const invoiceTotal = invoiceReports.reduce((sum, job) => sum + (Number(job.budget) || 0), 0);
            
            // Format as currency (e.g., $15,000)
            const formattedRevenue = '$' + invoiceTotal.toLocaleString('en-NZ', { maximumFractionDigits: 0 });

            document.getElementById('statActive').innerText = activeJobs;
            document.getElementById('statInspect').innerText = toInspect;
            document.getElementById('statInvoice').innerText = formattedRevenue;
            document.getElementById('statPremises').innerText = premises.length;
            
            // This is the clean call to render your charts
            renderBICharts(premises, reports, 'growth');
        }

        state.clientsData = clients.map(client => {
            const clientReports = reports.filter(x => x.client_id === client.id);
            const uniquePremises = new Set(clientReports.map(rep => rep.premise_id));
            const activeCount = clientReports.filter(job => !['complete','invoice','cancelled'].includes(normalizeStatus(job.status))).length;
            
            // --- NEW: Auto-Archive Logic ---
            let isArchived = false;
            // Condition 1: Must have 3 or fewer premises and 0 active jobs
            if (activeCount === 0 && uniquePremises.size <= 3) {
                // Find their most recent activity
                let lastDate = client.created_at ? new Date(client.created_at) : new Date();
                const sortedReps = [...clientReports].sort((a,b) => new Date(b.delivery_date || b.created_at || 0) - new Date(a.delivery_date || a.created_at || 0));
                
                if (sortedReps.length > 0) {
                    lastDate = new Date(sortedReps[0].delivery_date || sortedReps[0].created_at || new Date());
                }
                
                // Condition 2: Must be inactive for more than 6 months (~180 days)
                const inactiveDays = (new Date() - lastDate) / (1000 * 60 * 60 * 24);
                if (inactiveDays > 180) isArchived = true;
            }

            return { ...client, count: uniquePremises.size, active: activeCount, isArchived };
        });
        
        if (state.mapInstance && state.mapInstance.loaded()) addMarkers(state.premisesData);
        else if (state.mapInstance) state.mapInstance.on('load', () => addMarkers(state.premisesData));
        
        filterAdminView();
        log("Data Loaded successfully!");
    } catch(err) {
        log("Fetch Error: " + err.message, true);
    }
};

window.fetchAppClientPremises = async (cid) => {
    log("Fetching client portfolio...");
    try {
        state.premisesData = await getClientPremises(cid);
        if (state.mapInstance && state.mapInstance.loaded()) addMarkers(state.premisesData);
        else if (state.mapInstance) state.mapInstance.on('load', () => addMarkers(state.premisesData));
        log("Portfolio ready.");
    } catch(err) {
        log("Error: " + err.message, true);
    }
};

// 4. Initialization & Event Listeners
window.onload = async () => {
    log("System starting...");
    try {
        // Centers perfectly over New Zealand at a wide zoom
        initMap('loginMapBackground', [174.0, -41.0], 5.5, 0, 0);
        
        // --- NEW: Load the Database Rules & Airports ---
        import('./api.js').then(async (apiMod) => {
            state.pricingRules = await apiMod.getPricingRules();
            state.airportsData = await apiMod.getAirports(); // <-- Add this line
        });
        
        // Simple ping to wake up DB
        await supabase.from('clients').select('id', { count: 'exact', head: true });
        log(`System Ready.`);
    } catch(e) { 
        log("DB Error: " + e.message, true); 
    }
};

document.getElementById('loginForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const rawInput = document.getElementById('userId').value.trim();
    const pass = document.getElementById('userPassword').value;
    const btn = document.getElementById('loginBtn');
    btn.textContent = "Verifying...";

    try {
        const userId = await loginUser(rawInput, pass);

        if (userId === ADMIN_UUID) {
            state.currentUser = { role: 'admin', name: 'Bayleys Admin', id: userId };
            await window.refreshAppAdminData();
            switchScreen('clientListScreen');
            window.switchAdminTab('clients'); 
        } else {
            const clientData = await getClientById(userId);
            state.currentUser = { role: 'client', ...clientData, id: userId };
            await window.fetchAppClientPremises(userId);
            switchScreen('premisesScreen');
            loadClientView();
        }
    } catch (err) { 
        log("Login Error: " + err.message, true); 
        alert(err.message); 
        btn.textContent = "Login"; 
    }
});

// UI Event Bindings
document.getElementById('adminSearchInput')?.addEventListener('input', (e) => {
    document.getElementById('adminClearSearch').style.display = e.target.value.length > 0 ? 'flex' : 'none';
    filterAdminView();
});
document.getElementById('adminClearSearch')?.addEventListener('click', () => {
    const input = document.getElementById('adminSearchInput');
    input.value = '';
    document.getElementById('adminClearSearch').style.display = 'none';
    filterAdminView();
    input.focus();
});

document.getElementById('clientSearchInput')?.addEventListener('input', (e) => {
    document.getElementById('clientClearSearch').style.display = e.target.value.length > 0 ? 'flex' : 'none';
    loadClientView();
});
document.getElementById('clientClearSearch')?.addEventListener('click', () => {
    const input = document.getElementById('clientSearchInput');
    input.value = '';
    document.getElementById('clientClearSearch').style.display = 'none';
    loadClientView();
    input.focus();
});

// --- Filter Dropdown Toggle ---
document.getElementById('filterToggleBtn')?.addEventListener('click', (e) => {
    e.stopPropagation(); // Prevents the document click listener below from firing immediately
    const btn = e.currentTarget;
    const dropdown = document.getElementById('filterDropdown');
    
    btn.classList.toggle('active');
    dropdown.classList.toggle('active');
});

// Close filter dropdown when clicking outside of it
document.addEventListener('click', (e) => {
    const dropdown = document.getElementById('filterDropdown');
    const toggleBtn = document.getElementById('filterToggleBtn');
    
    if (dropdown && dropdown.classList.contains('active')) {
        // If the click is outside both the dropdown and the button, close it
        if (!dropdown.contains(e.target) && !toggleBtn.contains(e.target)) {
            dropdown.classList.remove('active');
            toggleBtn.classList.remove('active');
        }
    }
});

// Detail Panel Gallery Navigation
document.getElementById('nextImgBtn').onclick = (e) => {
    e.stopPropagation();
    state.currentGalleryIndex = (state.currentGalleryIndex + 1) % state.currentGalleryImages.length;
    updateGalleryImage();
};

document.getElementById('prevImgBtn').onclick = (e) => {
    e.stopPropagation();
    state.currentGalleryIndex = (state.currentGalleryIndex - 1 + state.currentGalleryImages.length) % state.currentGalleryImages.length;
    updateGalleryImage();
};

document.getElementById('closeDetailBtn').onclick = () => {
    document.getElementById('propertyDetailPanel').classList.remove('active');
    state.currentViewedPremise = null;
    
    // Clear both highlights
    import('./map.js').then(mapMod => mapMod.highlightMarker(null));
    if (window.highlightSidebarCard) window.highlightSidebarCard(null); 
    
    if (state.mapInstance) state.mapInstance.flyTo({ zoom: 14, pitch: 0 });
    
    if (document.getElementById('clientListScreen').classList.contains('active')) {
        toggleDashboardOverlay(true);
    } else if (document.getElementById('premisesScreen').classList.contains('active')) {
        // ADD THIS: Bring the button back when the panel closes
        document.getElementById('requestReportBtn').style.display = 'flex';
    }
};

document.getElementById('backToAdminBtn').onclick = async () => {
    state.currentUser = { role: 'admin', name: 'Bayleys Admin', id: ADMIN_UUID };
    await window.refreshAppAdminData();
    switchScreen('clientListScreen');
    window.switchAdminTab('clients');
    const searchInput = document.getElementById('adminSearchInput');
    searchInput.value = '';
    document.getElementById('adminClearSearch').style.display = 'none';
};

window.updateQuoteStatus = async (id, newStatus) => {
    try {
        const { error } = await supabase.from('report_requests').update({ status: newStatus }).eq('id', id);
        if (error) throw error;
        
        log(`Quote marked as ${newStatus}`);
        await window.refreshAppAdminData(); // Refresh the list instantly
    } catch (err) {
        alert("Failed to update status: " + err.message);
    }
};

window.generateWFMQuote = async (requestId, event) => {
    const r = state.reportRequestsData.find(req => String(req.id) === String(requestId));
    if (!r) return;

    // 1. Attempt to extract the Target Area to guess the budget
    let sqm = 0;
    const areaMatch = r.notes?.match(/Target Area:\s*([\d,.]+)/i);
    if (areaMatch) sqm = parseFloat(areaMatch[1].replace(/,/g, ''));

    // 2. Look up the Base Cost calculated by the web form
    let suggestedBudget = r.estimated_cost || 3500;
    if (sqm > 0 && state.pricingRules && state.pricingRules.length > 0) {
        let matchingPricing = state.pricingRules.filter(p => p.report_type === r.report_type);
        matchingPricing.sort((a, b) => a.max_sqm - b.max_sqm);
        const tierData = matchingPricing.find(p => sqm <= p.max_sqm);
        
        if (tierData) {
            // Defaulting to the office/retail average for the prompt
            suggestedBudget = tierData.office_fee || tierData.retail_fee || 0; 
            suggestedBudget += 150; // Add the flat travel buffer
        }
    }

    // 3. Prompt the Admin to confirm the Budget amount before sending
    const budgetInput = prompt(
        `Confirm the estimated budget for the ${r.report_type} at ${r.premise_name || r.address}:\n(You can adjust this later in WFM)`, 
        suggestedBudget || 3500
    );
    
    if (budgetInput === null) return; // User clicked Cancel

    const finalBudget = parseFloat(budgetInput.replace(/[^\d.]/g, '')) || 0;

    // 4. UI Loading State
    const btn = event.currentTarget;
    const originalHtml = btn.innerHTML;
    btn.innerHTML = '<span class="spin">🔄</span> Creating Quote...';
    btn.disabled = true;

    try {
        // 5. Send to Supabase Edge Function to securely hit the WFM API
        const { data, error } = await supabase.functions.invoke('wfm-create-quote', {
            body: { 
                request: r,
                budget: finalBudget
            }
        });

        if (error) throw error;
        if (data && data.error) throw new Error(data.error);

        btn.innerHTML = '✓ Quote Created!';
        btn.style.background = '#10b981';
        btn.style.borderColor = '#10b981';

        // 6. Open the newly created quote in a new tab!
        setTimeout(() => {
            btn.innerHTML = originalHtml;
            btn.style.background = '#00264b';
            btn.style.borderColor = '#00264b';
            btn.disabled = false;
            
            // If the API returns the specific quote URL, open it, otherwise open the draft list
            const url = data.quoteUrl || 'https://practicemanager.xero.com/Quote/Draft.aspx';
            window.open(url, '_blank');
        }, 1500);

    } catch (err) {
        alert("Failed to create quote in WFM:\n" + err.message);
        btn.innerHTML = originalHtml;
        btn.disabled = false;
    }
};