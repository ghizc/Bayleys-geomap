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
        const { clients, reports, premises } = await getAdminData();
        state.allReportsData = reports;
        state.premisesData = premises;
        
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
            return { ...client, count: uniquePremises.size, active: activeCount };
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