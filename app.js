// app.js

// 1. Imports
import { state } from './store.js';
import { ADMIN_UUID } from './config.js';
import { supabase, loginUser, getAdminData, getClientPremises, getClientById } from './api.js';
import { initMap, addMarkers } from './map.js';
import { 
    log, toggleDashboardOverlay, renderGrowthChart, filterAdminView, 
    loadClientView, showDetail, updateGalleryImage, switchScreen, 
    renderFilterDropdown, normalizeStatus 
} from './ui.js';
import './modals.js'; // Running this executes the modal setup code

// 2. Global Hooks for Inline HTML Event Handlers
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

window.triggerDetailLoad = (premiseId) => {
    const p = state.premisesData.find(x => String(x.id) === String(premiseId));
    if (p) showDetail(p);
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

// 3. Core Data Fetching Functions
window.refreshAppAdminData = async () => {
    log("Fetching data...");
    try {
        const { clients, reports, premises } = await getAdminData();
        state.allReportsData = reports;
        state.premisesData = premises;
        
        if (state.currentUser && state.currentUser.role === 'admin') {
            toggleDashboardOverlay(true);
            const activeJobs = reports.filter(job => !['complete','invoice','pending'].includes(normalizeStatus(job.status))).length;
            const toInspect = reports.filter(job => normalizeStatus(job.status) === 'new').length;
            const toInvoice = reports.filter(job => ['report','advice'].includes(normalizeStatus(job.status))).length;

            document.getElementById('statActive').innerText = activeJobs;
            document.getElementById('statInspect').innerText = toInspect;
            document.getElementById('statInvoice').innerText = toInvoice;
            document.getElementById('statPremises').innerText = premises.length;
            renderGrowthChart(premises, reports);
        }

        state.clientsData = clients.map(client => {
            const clientReports = reports.filter(x => x.client_id === client.id);
            const uniquePremises = new Set(clientReports.map(rep => rep.premise_id));
            const activeCount = clientReports.filter(job => !['complete','invoice','pending'].includes(normalizeStatus(job.status))).length;
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
        initMap('loginMapBackground', [173.0, -41.2], 4.8, 0, 0);
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
    if (state.mapInstance) state.mapInstance.flyTo({ zoom: 14, pitch: 0 });
    
    if (document.getElementById('clientListScreen').classList.contains('active')) {
        toggleDashboardOverlay(true);
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