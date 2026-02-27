// ui.js

import { state } from './store.js';
import { STATUS_OPTIONS, ADMIN_UUID } from './config.js';
import { initMap, addMarkers } from './map.js';

// --- UTILS & LOGGING ---
const logBox = document.getElementById('debugConsole');
let logTimeout;

export function log(msg, isError = false) { 
    console.log(msg); 
    logBox.innerText = msg; 
    logBox.className = isError ? 'error' : '';
    logBox.style.opacity = '1';
    logBox.style.transform = 'translateY(0)';
    
    clearTimeout(logTimeout);
    if (!isError) {
        logTimeout = setTimeout(() => { 
            logBox.style.opacity = '0'; 
            logBox.style.transform = 'translateY(10px)'; 
        }, 2500);
    }
}

export const normalizeStatus = (status) => (status || '').toString().toLowerCase().trim();

// --- UI DASHBOARD FUNCTIONS ---
export function toggleDashboardOverlay(show) {
    const dash = document.getElementById('adminDashboardWidgets');
    if (dash && state.currentUser && state.currentUser.role === 'admin') {
        if (show) {
            dash.style.display = 'flex';
            setTimeout(() => dash.classList.remove('hidden'), 10);
        } else {
            dash.classList.add('hidden');
            setTimeout(() => { if (dash.classList.contains('hidden')) dash.style.display = 'none'; }, 300);
        }
    }
}

export function renderGrowthChart(premises, reports) {
    const ctx = document.getElementById('growthChart');
    if (!ctx) return;

    const months = [];
    const premiseCounts = [];
    const reportCounts = [];

    for (let i = 5; i >= 0; i--) {
        const d = new Date();
        d.setMonth(d.getMonth() - i);
        months.push(d.toLocaleString('default', { month: 'short', year: '2-digit' }));

        premiseCounts.push(premises.filter(p => p.created_at && new Date(p.created_at).getMonth() === d.getMonth() && new Date(p.created_at).getFullYear() === d.getFullYear()).length);
        reportCounts.push(reports.filter(r => {
            const targetDateStr = r.delivery_date || r.inspection_date || r.created_at;
            return targetDateStr && new Date(targetDateStr).getMonth() === d.getMonth() && new Date(targetDateStr).getFullYear() === d.getFullYear();
        }).length);
    }

    if (window.growthChart instanceof Chart) window.growthChart.destroy();

    const canvasContext = ctx.getContext('2d');
    const gradBlue = canvasContext.createLinearGradient(0, 0, 0, 200);
    gradBlue.addColorStop(0, 'rgba(49, 130, 206, 0.5)'); gradBlue.addColorStop(1, 'rgba(49, 130, 206, 0.0)');
    const gradGreen = canvasContext.createLinearGradient(0, 0, 0, 200);
    gradGreen.addColorStop(0, 'rgba(16, 185, 129, 0.5)'); gradGreen.addColorStop(1, 'rgba(16, 185, 129, 0.0)');

    window.growthChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: months,
            datasets: [
                { label: 'New Reports', data: reportCounts, borderColor: '#3182ce', backgroundColor: gradBlue, borderWidth: 3, fill: true, tension: 0.4, pointRadius: 4, pointBackgroundColor: '#fff', pointBorderColor: '#3182ce', pointBorderWidth: 2 },
                { label: 'New Premises', data: premiseCounts, borderColor: '#10b981', backgroundColor: gradGreen, borderWidth: 3, fill: true, tension: 0.4, pointRadius: 4, pointBackgroundColor: '#fff', pointBorderColor: '#10b981', pointBorderWidth: 2 }
            ]
        },
        options: {
            responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
            plugins: { 
                legend: { position: 'top', labels: { boxWidth: 10, font: { size: 11, family: 'sans-serif', weight: '500' }, color: '#475569', usePointStyle: true } },
                tooltip: { backgroundColor: 'rgba(15,23,42,0.95)', titleFont: {size: 13, weight:'bold'}, bodyFont: {size: 12}, padding: 12, cornerRadius: 8, boxPadding: 6 } 
            },
            scales: { 
                x: { grid: { display: false }, ticks: { font: { size: 10 }, color: '#94a3b8' }, border: {display: false} },
                y: { beginAtZero: true, grid: { color: 'rgba(226, 232, 240, 0.6)', borderDash: [5, 5] }, border: { display: false }, ticks: { font: { size: 10 }, color: '#94a3b8', stepSize: 1, precision: 0 } }
            }
        }
    });
}

export function renderFilterDropdown(type) {
    const dropdown = document.getElementById('filterDropdown');
    const options = type === 'clients' 
        ? [{ val: 'all', label: 'All Clients' }, { val: 'active', label: 'Active Clients' }, { val: 'inactive', label: 'Inactive Clients' }]
        : [{ val: 'all', label: 'All Job Statuses' }, ...STATUS_OPTIONS.map(o => ({ val: o.toLowerCase(), label: o }))];

    dropdown.innerHTML = options.map(opt => `
        <div class="filter-option ${opt.val === state.currentAdminSubFilter ? 'selected' : ''}" data-val="${opt.val}">
            ${opt.label}
        </div>
    `).join('');

    dropdown.querySelectorAll('.filter-option').forEach(el => {
        el.addEventListener('click', (e) => {
            e.stopPropagation();
            state.currentAdminSubFilter = el.dataset.val;
            renderFilterDropdown(type);
            document.getElementById('filterDropdown').classList.remove('active');
            document.getElementById('filterToggleBtn').classList.remove('active');
            filterAdminView();
        });
    });
}

// --- DATA PROCESSING & LIST RENDERING ---
export function getPremiseDisplayData(p) {
    const reports = p.reports || state.allReportsData.filter(r => r.premise_id === p.id) || [];
    reports.sort((a, b) => (Number(b.job_number) || 0) - (Number(a.job_number) || 0));
    const latest = reports.length > 0 ? reports[0] : {};
    
    let allImages = [];
    reports.forEach(r => {
        let rawImages = r.image_url;
        if (Array.isArray(rawImages)) allImages.push(...rawImages);
        else if (typeof rawImages === 'string' && rawImages.trim() !== '') {
            try { allImages.push(...JSON.parse(rawImages)); } 
            catch(e) { allImages.push(...rawImages.split(',').map(s=>s.trim())); }
        }
    });
    
    let images = [...new Set(allImages)];
    return { reports, latest, images, displayImage: images[0] || null, status: latest.status || 'Active', condition: latest.condition || p.condition || '-' };
}

export function filterAdminView() {
    const type = state.activeAdminTab;
    const list = document.getElementById('clientList');
    const query = (document.getElementById('adminSearchInput').value || '').toLowerCase().trim();
    const subFilterVal = state.currentAdminSubFilter;

    if (type === 'clients') {
        let filtered = state.clientsData;
        if (query) filtered = filtered.filter(c => c.name.toLowerCase().includes(query));
        if (subFilterVal === 'active') filtered = filtered.filter(c => c.active > 0);
        else if (subFilterVal === 'inactive') filtered = filtered.filter(c => c.active === 0);
        
        filtered.sort((a, b) => a.name.localeCompare(b.name));
        
        if (filtered.length === 0) return list.innerHTML = `<div style="text-align:center; padding: 40px 20px; color: #94a3b8; font-size: 13px; font-weight: 500;">No clients found matching criteria.</div>`;

        list.innerHTML = filtered.map(c => {
            let inactiveDisplay = '';
            if (c.active === 0) {
                const clientReps = state.allReportsData.filter(r => r.client_id === c.id && r.delivery_date);
                if (clientReps.length > 0) {
                    clientReps.sort((a,b) => new Date(b.delivery_date) - new Date(a.delivery_date));
                    const diffDays = Math.floor((new Date() - new Date(clientReps[0].delivery_date)) / (1000 * 60 * 60 * 24));
                    
                    if (diffDays < 0) inactiveDisplay = `0 days inactive`;
                    else if (diffDays < 7) inactiveDisplay = `${diffDays} days inactive`;
                    else if (diffDays < 30) inactiveDisplay = `${Math.floor(diffDays/7)} wks inactive`;
                    else if (diffDays < 365) inactiveDisplay = `${Math.floor(diffDays/30)} mos inactive`;
                    else inactiveDisplay = `${Math.floor(diffDays/365)} yrs inactive`;
                } else {
                    inactiveDisplay = "No prior reports";
                }
            }

            const badgeHtml = c.active > 0 
                ? `<span>${c.active} Active Jobs</span>` 
                : `<span class="inactive">${inactiveDisplay}</span>`;

            return `
            <div class="card-item client-card" onclick="window.triggerClientLoad('${c.id}')">
                <img src="${c.logo_url}" alt="${c.name} Logo">
                <div class="client-card-title">${c.name}</div>
                <div class="client-card-meta">${c.count} Premises &nbsp;•&nbsp; ${badgeHtml}</div>
            </div>`;
        }).join('');
    } else if (type === 'reports') {
        let filtered = state.allReportsData;
        if (query) filtered = filtered.filter(r => String(r.job_number).includes(query) || (r.report_type||'').toLowerCase().includes(query) || (r.name||'').toLowerCase().includes(query) || (state.premisesData.find(p => p.id === r.premise_id)?.address || '').toLowerCase().includes(query));
        if (subFilterVal !== 'all') filtered = filtered.filter(r => normalizeStatus(r.status) === subFilterVal);
        
        const statusOrder = { 'new': 1, 'inspection': 2, 'report': 3, 'advice': 4, 'invoice': 5, 'pending': 6, 'complete': 7 };
        filtered.sort((a, b) => (statusOrder[normalizeStatus(a.status)] || 99) - (statusOrder[normalizeStatus(b.status)] || 99) || (Number(b.job_number) || 0) - (Number(a.job_number) || 0));

        if (filtered.length === 0) return list.innerHTML = `<div style="text-align:center; padding: 40px 20px; color: #94a3b8; font-size: 13px; font-weight: 500;">No reports found matching criteria.</div>`;

        list.innerHTML = filtered.map(r => {
            const safeClass = normalizeStatus(r.status);
            const displayName = r.name || (state.premisesData.find(p => p.id === r.premise_id)?.name || 'Unknown Property');
            return `
            <div class="card-item report-card-admin" onclick="window.triggerDetailLoad('${r.premise_id}')">
                <div style="display:flex; align-items: flex-start; gap: 14px;">
                    <div class="report-card-icon">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>
                    </div>
                    <div style="flex: 1; min-width: 0;">
                        <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom: 4px;">
                            <div>
                                <div style="font-weight:700; font-size:14px; color:#0f172a; letter-spacing:-0.2px;">Job #${r.job_number}</div>
                                <div style="font-weight:600; font-size:11px; color:#0284c7; margin-top:2px;">${r.report_type} Report</div>
                            </div>
                            <div class="status-pill ${safeClass}-status" style="position:static; margin-left: 8px;">${r.status}</div>
                        </div>
                        <div style="font-size:11px; color:#64748b; display:flex; align-items:flex-start; gap:4px; margin-top: 6px; line-height: 1.3;">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0; margin-top:1px;"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg>
                            <span style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${displayName}</span>
                        </div>
                    </div>
                </div>
            </div>`;
        }).join('');
    }
}

export function loadClientView() {
    const displayClient = state.currentUser.clientSpoof || state.currentUser;
    document.getElementById('brandLogo').src = displayClient.logo_url || '';
    document.getElementById('userNameDisplay').innerText = displayClient.name;
    document.getElementById('userAvatar').innerText = displayClient.name.substring(0, 2).toUpperCase();
    
    if (state.currentUser.role === 'client') document.getElementById('backToAdminBtn').style.display = 'none';
    
    const query = (document.getElementById('clientSearchInput').value || '').toLowerCase().trim();
    const list = document.getElementById('premisesList');
    
    let filtered = [...state.premisesData];
    if (query) filtered = filtered.filter(p => (p.name||'').toLowerCase().includes(query) || (p.address||'').toLowerCase().includes(query) || (p.sector||'').toLowerCase().includes(query));

    const statusOrder = { 'new': 1, 'inspection': 2, 'report': 3, 'advice': 4, 'invoice': 5, 'pending': 6, 'complete': 7 };
    filtered.sort((a, b) => (statusOrder[normalizeStatus(getPremiseDisplayData(a).status)] || 99) - (statusOrder[normalizeStatus(getPremiseDisplayData(b).status)] || 99) || (a.name || '').localeCompare(b.name || ''));

    if(filtered.length === 0) return list.innerHTML = `<div style="text-align:center; padding: 40px 20px; color: #94a3b8; font-size: 13px; font-weight: 500;">No premises found matching "${query}"</div>`;

    list.innerHTML = filtered.map(p => {
        const { displayImage, status, condition } = getPremiseDisplayData(p);
        const safeClass = normalizeStatus(status);
        return `<div class="card-item premise-card" onclick="window.triggerDetailLoad('${p.id}')">
            <div class="premise-card-image"><img src="${displayImage || 'https://via.placeholder.com/400x300?text=No+Image'}"><div class="status-pill ${safeClass}-status">${status}</div></div>
            <div class="card-title">${p.name}</div><div class="card-meta">${p.floor_area} &nbsp;•&nbsp; ${p.sector} &nbsp;•&nbsp; ${condition}</div>
        </div>`;
    }).join('');
}

export function showDetail(p) {
    state.currentViewedPremise = p; 
    toggleDashboardOverlay(false);
    
    const detailPanel = document.getElementById('propertyDetailPanel');
    document.querySelector('.screen.active .main-content')?.appendChild(detailPanel);

    const { reports, latest, images, status, condition } = getPremiseDisplayData(p);
    detailPanel.classList.add('active');
    
    state.currentGalleryImages = images.length > 0 ? images : ['https://via.placeholder.com/450x360?text=No+Image'];
    state.currentGalleryIndex = 0;
    updateGalleryImage();

    document.getElementById('detailTitle').innerText = p.name;
    document.getElementById('detailAddress').innerText = p.address;
    document.getElementById('detailFloor').innerText = p.floor_area || '-';
    document.getElementById('detailSite').innerText = p.site_area || '-';
    document.getElementById('detailSector').innerText = p.sector || '-';
    document.getElementById('detailAge').innerText = p.year_built ? `${new Date().getFullYear() - p.year_built} Years` : '-';
    document.getElementById('detailCond').innerText = condition;
    document.getElementById('detailSurveyor').innerText = latest.surveyed_by || '-';
    document.getElementById('detailInspected').innerText = latest.inspection_date || '-';
    document.getElementById('detailDelivery').innerText = latest.delivery_date || '-';
    document.getElementById('videoBtn').style.display = latest.video_url ? 'flex' : 'none';
    document.getElementById('videoBtn').onclick = () => window.open(latest.video_url, '_blank');
    
    const isAdmin = state.currentUser && state.currentUser.role === 'admin';
    document.getElementById('reportsTableHeader').innerHTML = `<tr>
        <th>Property</th><th>Type</th><th>Job #</th><th>Status</th>
        <th style="text-align:center;">PDF</th><th style="text-align:center;">INFO</th><th style="text-align:center;">INV</th>${isAdmin ? '<th style="text-align:center;">EDIT</th>' : ''}
    </tr>`;
    
    document.getElementById('reportsTableBody').innerHTML = reports.map(r => {
        const pdfIcon = r.pdf_url ? `<a href="${r.pdf_url}" target="_blank" class="icon-btn" title="View PDF"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg></a>` : '-';
        const infoIcon = r.info_url ? `<a href="${r.info_url}" target="_blank" class="icon-btn" title="Files"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg></a>` : '-';
        const invIcon = r.invoice_url ? `<a href="${r.invoice_url}" target="_blank" class="icon-btn" title="Invoice"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg></a>` : '-';
        
        const editIcon = isAdmin ? `<button type="button" onclick="window.openEditReportModal('${r.id}')" class="icon-btn" title="Edit Report"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>` : '';
        
        const safeClass = normalizeStatus(r.status);
        
        const statusHtml = isAdmin
            ? `<select onchange="window.triggerStatusUpdate('${r.id}', this.value, this)" class="status-select ${safeClass}-status">
                ${STATUS_OPTIONS.map(opt => `<option value="${opt}" ${safeClass === opt.toLowerCase() ? 'selected' : ''}>${opt}</option>`).join('')}
               </select>`
            : `<span class="status-pill ${safeClass}-status" style="position:static;">${r.status}</span>`;
        const propertyDisplayName = r.name || p.name;
        
        return `<tr>
            <td style="max-width: 140px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${propertyDisplayName}">
                <span style="font-weight:600; color:#0f172a; font-size:11.5px;">${propertyDisplayName}</span>
            </td>
            <td><span style="color:#0284c7; font-weight:600; font-size:11px;">${r.report_type || '-'}</span></td>
            <td><span style="font-family:monospace; font-weight:600; color:#475569; font-size:12px;">${r.job_number}</span></td>
            <td>${statusHtml}</td>
            <td style="text-align:center;">${pdfIcon}</td>
            <td style="text-align:center;">${infoIcon}</td>
            <td style="text-align:center;">${invIcon}</td>
            ${isAdmin ? `<td style="text-align:center;">${editIcon}</td>` : ''}
        </tr>`;
    }).join('');

    if (state.mapInstance && p.lat) state.mapInstance.flyTo({ center: [p.lng, p.lat], zoom: 16, pitch: 60 });
}

export function updateGalleryImage() {
    document.getElementById('detailImg').src = state.currentGalleryImages[state.currentGalleryIndex];
    document.getElementById('imgCounter').innerText = `${state.currentGalleryIndex + 1} / ${state.currentGalleryImages.length}`;
    const showNav = state.currentGalleryImages.length > 1;
    document.getElementById('prevImgBtn').style.display = showNav ? 'flex' : 'none';
    document.getElementById('nextImgBtn').style.display = showNav ? 'flex' : 'none';
}

export function switchScreen(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById(id).classList.add('active');
    document.getElementById('requestReportBtn').style.display = (id === 'premisesScreen') ? 'flex' : 'none';
    
    requestAnimationFrame(() => {
        setTimeout(() => {
            const mapContainer = id === 'clientListScreen' ? 'adminMap' : 'premisesMap';
            if (document.getElementById(mapContainer)) {
                initMap(mapContainer, [174.7633, -36.8485], 13);
                if (state.premisesData.length > 0 && state.mapInstance) {
                    if (state.mapInstance.loaded()) addMarkers(state.premisesData);
                    else state.mapInstance.on('load', () => addMarkers(state.premisesData));
                }
            }
        }, 100);
    });
}