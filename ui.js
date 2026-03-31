// ui.js

import { state } from './store.js';
import { STATUS_OPTIONS, ADMIN_UUID } from './config.js';
import { initMap, addMarkers } from './map.js';
import { supabase } from './api.js'; 

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

export function renderBICharts(premises, reports, type = 'growth') {
    const ctx = document.getElementById('biChart');
    if (!ctx) return;

    // 1. Calculate Average Turnaround Time (Current Year Only)
    const currentYear = new Date().getFullYear();
    const reportsThisYear = reports.filter(r => {
        if (!r.delivery_date || !r.inspection_date) return false;
        const deliveryDate = new Date(r.delivery_date);
        return deliveryDate.getFullYear() === currentYear;
    });

    let avgTurnaround = '-';
    
    if (reportsThisYear.length > 0) {
        const totalDays = reportsThisYear.reduce((sum, r) => {
            const start = new Date(r.inspection_date);
            const end = new Date(r.delivery_date);
            const diffTime = end - start;
            // Use Math.max to prevent negative numbers if data is entered incorrectly
            return sum + Math.max(0, Math.ceil(diffTime / (1000 * 60 * 60 * 24)));
        }, 0);

        avgTurnaround = Math.round(totalDays / reportsThisYear.length) + ' Days';
    }
    
    const kpiEl = document.getElementById('kpiTurnaround');
    if (kpiEl) {
        kpiEl.innerHTML = `${currentYear} Avg Turnaround: <span>${avgTurnaround}</span>`;
    }

    // 2. Destroy existing chart before drawing a new one
    if (window.biChartInstance instanceof Chart) window.biChartInstance.destroy();
    const canvasContext = ctx.getContext('2d');

    // 3. Render Requested Chart
    if (type === 'growth') {
        const months = [], premiseCounts = [], reportCounts = [];
        
        // 1. Determine the "First Contact" date for every unique premise
        const premiseFirstContact = {}; 
        reports.forEach(r => {
            const date = r.inspection_date ? new Date(r.inspection_date) : (r.delivery_date ? new Date(r.delivery_date) : new Date(r.created_at));
            if (!premiseFirstContact[r.premise_id] || date < premiseFirstContact[r.premise_id]) {
                premiseFirstContact[r.premise_id] = date;
            }
        });

        for (let i = 5; i >= 0; i--) {
            const d = new Date(); 
            d.setDate(1); // <-- ADD THIS LINE: Forces the math to use the 1st of the month
            d.setMonth(d.getMonth() - i);
            months.push(d.toLocaleString('default', { month: 'short', year: '2-digit' }));

            // 2. Count Reports for this month (all activity)
            const reportsInMonth = reports.filter(r => {
                const targetDate = r.inspection_date ? new Date(r.inspection_date) : (r.delivery_date ? new Date(r.delivery_date) : new Date(r.created_at));
                return targetDate.getMonth() === d.getMonth() && targetDate.getFullYear() === d.getFullYear();
            }).length;
            reportCounts.push(reportsInMonth);

            // 3. Count ONLY Premises whose "First Contact" happened in this month
            const newPremisesInMonth = Object.values(premiseFirstContact).filter(firstDate => 
                firstDate.getMonth() === d.getMonth() && firstDate.getFullYear() === d.getFullYear()
            ).length;
            premiseCounts.push(newPremisesInMonth);
        }

        const gradBlue = canvasContext.createLinearGradient(0, 0, 0, 200);
        gradBlue.addColorStop(0, 'rgba(49, 130, 206, 0.5)'); gradBlue.addColorStop(1, 'rgba(49, 130, 206, 0.0)');
        const gradGreen = canvasContext.createLinearGradient(0, 0, 0, 200);
        gradGreen.addColorStop(0, 'rgba(16, 185, 129, 0.5)'); gradGreen.addColorStop(1, 'rgba(16, 185, 129, 0.0)');

        window.biChartInstance = new Chart(ctx, {
            type: 'line',
            data: { labels: months, datasets: [
                { label: 'Reports', data: reportCounts, borderColor: '#3182ce', backgroundColor: gradBlue, borderWidth: 3, fill: true, tension: 0.4, pointRadius: 3 },
                { label: 'Premises', data: premiseCounts, borderColor: '#10b981', backgroundColor: gradGreen, borderWidth: 3, fill: true, tension: 0.4, pointRadius: 3 }
            ]},
            options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'top', labels: {boxWidth:10, font:{size:10}} } }, scales: { x: {grid: {display: false}}, y: {beginAtZero: true, border: {display:false}} } }
        });

    } else if (type === 'sector') {
        const sectorCounts = {};
        premises.forEach(p => { const s = p.sector || 'Unassigned'; sectorCounts[s] = (sectorCounts[s] || 0) + 1; });
        
        window.biChartInstance = new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels: Object.keys(sectorCounts),
                datasets: [{ data: Object.values(sectorCounts), backgroundColor: ['#00264b', '#0284c7', '#10b981', '#f59e0b', '#8b5cf6', '#f43f5e', '#64748b'], borderWidth: 2, borderColor: '#fff' }]
            },
            options: { responsive: true, maintainAspectRatio: false, cutout: '65%', plugins: { legend: { position: 'right', labels: { boxWidth: 10, font: {size: 10} } } } }
        });

    } else if (type === 'workload') {
        const surveyors = {};
        reports.filter(r => !['complete','invoice','cancelled'].includes(normalizeStatus(r.status))).forEach(r => {
            const s = r.surveyed_by || 'Unassigned'; surveyors[s] = (surveyors[s] || 0) + 1;
        });

        window.biChartInstance = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: Object.keys(surveyors),
                datasets: [{ label: 'Active Jobs', data: Object.values(surveyors), backgroundColor: '#0284c7', borderRadius: 4 }]
            },
            options: { responsive: true, maintainAspectRatio: false, indexAxis: 'y', plugins: { legend: { display: false } }, scales: { x: { beginAtZero: true, ticks: { stepSize: 1 } }, y: {grid: {display: false}} } }
        });

    } else if (type === 'aging') {
        const aging = {'0-7 Days': 0, '8-14 Days': 0, '15-30 Days': 0, '30+ Days': 0};
        const now = new Date();
        reports.filter(r => !['complete','invoice'].includes(normalizeStatus(r.status))).forEach(r => {
            const start = r.inspection_date ? new Date(r.inspection_date) : new Date(r.created_at || now);
            const days = Math.floor((now - start) / (1000 * 60 * 60 * 24));
            if (days <= 7) aging['0-7 Days']++;
            else if (days <= 14) aging['8-14 Days']++;
            else if (days <= 30) aging['15-30 Days']++;
            else aging['30+ Days']++;
        });

        window.biChartInstance = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: Object.keys(aging),
                datasets: [{ label: 'Jobs', data: Object.values(aging), backgroundColor: ['#10b981', '#f59e0b', '#f43f5e', '#9f1239'], borderRadius: 4 }]
            },
            options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } }, x: {grid: {display: false}} } }
        });
    }
}

export function renderFilterDropdown(type) {
    const dropdown = document.getElementById('filterDropdown');
    
    // Add the contacts option logic
    let options = [];
    if (type === 'clients') {
        options = [
            { val: 'all', label: 'All Clients' }, { val: 'active', label: 'Active Clients' }, 
            { val: 'inactive', label: 'Inactive Clients' }, { val: 'archived', label: 'Archived Clients' } 
        ];
    } else if (type === 'contacts') {
        options = [{ val: 'all', label: 'All Contacts' }];
    } else {
        options = [{ val: 'all', label: 'All Job Statuses' }, ...STATUS_OPTIONS.map(o => ({ val: o.toLowerCase(), label: o }))];
    }

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
export function getPremiseDisplayData(premise) {
    // 1. Get all reports for this premise
    const reports = premise.reports ? premise.reports : state.allReportsData.filter(r => String(r.premise_id) === String(premise.id));
    
    // 2. Sort them by Job Number (Highest to Lowest)
    const sortedReports = [...reports].sort((a, b) => {
        const jobA = parseInt(String(a.job_number).replace(/\D/g, '')) || 0;
        const jobB = parseInt(String(b.job_number).replace(/\D/g, '')) || 0;
        return jobB - jobA; 
    });

    // 3. Extract ALL images from sorted reports
    let allImages = [];
    sortedReports.forEach(report => {
        if (report.image_url) {
            try {
                const parsed = Array.isArray(report.image_url) ? report.image_url : JSON.parse(report.image_url);
                if (Array.isArray(parsed)) allImages.push(...parsed);
            } catch(e) {
                allImages.push(...report.image_url.split(',').map(s => s.trim()));
            }
        }
    });

    // 4. Return everything the UI needs in one clean package
    return { 
        reports: sortedReports,
        latest: sortedReports.length > 0 ? sortedReports[0] : {},
        status: sortedReports.length > 0 ? (sortedReports[0].status || 'Complete') : 'Complete',
        images: allImages,
        displayImage: allImages.length > 0 ? allImages[0] : null
    };
}

export function filterAdminView() {
    const type = state.activeAdminTab;
    const list = document.getElementById('clientList');
    const query = (document.getElementById('adminSearchInput').value || '').toLowerCase().trim();
    const subFilterVal = state.currentAdminSubFilter;

    if (type === 'clients') {
        let filtered = state.clientsData;
        
        // 1. Apply Sub-Filters (Archived clients are hidden by default)
        if (subFilterVal === 'all') filtered = filtered.filter(c => !c.isArchived);
        else if (subFilterVal === 'active') filtered = filtered.filter(c => c.active > 0 && !c.isArchived);
        else if (subFilterVal === 'inactive') filtered = filtered.filter(c => c.active === 0 && !c.isArchived);
        else if (subFilterVal === 'archived') filtered = filtered.filter(c => c.isArchived);

        // 2. Apply Search
        if (query) filtered = filtered.filter(c => c.name.toLowerCase().includes(query));
        
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

            // 3. Set the Badge based on Archived state
            const badgeHtml = c.isArchived
                ? `<span style="color: #64748b; font-weight: 600;">ARCHIVED</span>`
                : (c.active > 0 
                    ? `<span>${c.active} Active Jobs</span>` 
                    : `<span class="inactive">${inactiveDisplay}</span>`);

            const displayUrl = c.website ? c.website.replace(/^https?:\/\//, '').replace(/\/$/, '') : '';
            const actualUrl = c.website ? (c.website.startsWith('http') ? c.website : `https://${c.website}`) : '#';

            let subRow = '';
            if (c.group || c.website) {
                let parts = [];
                if (c.group) parts.push(`<span style="color: #0284c7; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px;">${c.group}</span>`);
                if (c.website) parts.push(`<span style="display: inline-flex; align-items: center; gap: 4px;"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#64748b" stroke-width="2.5"><circle cx="12" cy="12" r="10"></circle><line x1="2" y1="12" x2="22" y2="12"></line><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path></svg><a href="${actualUrl}" target="_blank" onclick="event.stopPropagation();" style="color: #64748b; text-decoration: none; transition: 0.2s;" onmouseover="this.style.color='#0284c7'" onmouseout="this.style.color='#64748b'">${displayUrl}</a></span>`);
                subRow = `<div style="font-size: 10px; margin-bottom: 12px; display: flex; align-items: center; justify-content: center; gap: 8px;">${parts.join(' <span style="color: #cbd5e1; font-size: 12px;">•</span> ')}</div>`;
            }

            return `
            <div class="card-item client-card" onclick="window.triggerClientLoad('${c.id}')">
                <img src="${c.logo_url || 'https://via.placeholder.com/200x60?text=No+Logo'}" alt="${c.name} Logo" onerror="this.src='https://via.placeholder.com/200x60?text=No+Logo'">
                <div class="client-card-title">${c.name}</div>
                ${subRow}
                <div class="client-card-meta">${c.count} Premises &nbsp;•&nbsp; ${badgeHtml}</div>
            </div>`;
        }).join('');

        } else if (type === 'contacts') {
        let filtered = state.contactsData;
        
        // Map the client name into the contact object for easy searching and display
        filtered = filtered.map(c => {
            const client = state.clientsData.find(cl => cl.id === c.client_id);
            return { ...c, client_name: client ? client.name : 'Unknown Company' };
        });

        // Search by Contact Name OR Company Name
        if (query) {
            filtered = filtered.filter(c => 
                `${c.first_name} ${c.last_name}`.toLowerCase().includes(query) || 
                (c.client_name).toLowerCase().includes(query)
            );
        }
        
        // Sort alphabetically by first name
        filtered.sort((a, b) => (a.first_name || '').localeCompare(b.first_name || ''));
        
        if (filtered.length === 0) return list.innerHTML = `<div style="text-align:center; padding: 40px 20px; color: #94a3b8; font-size: 13px; font-weight: 500;">No contacts found matching criteria.</div>`;

        list.innerHTML = filtered.map(c => {
            const fullName = `${c.first_name || ''} ${c.last_name || ''}`.trim();
            const position = c.position ? `<div style="font-size: 11px; color: #0284c7; font-weight: 700; text-transform: uppercase; margin-top: 4px; letter-spacing: 0.5px;">${c.position}</div>` : '';
            
            // Build Icons & Links (Only show if they exist in DB)
            const email = c.email ? `<div style="margin-top: 8px; font-size: 12px; color: #475569; display: flex; align-items: center; gap: 8px;"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#64748b" stroke-width="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path><polyline points="22,6 12,13 2,6"></polyline></svg> <a href="mailto:${c.email}" style="color: #475569; text-decoration: none; font-weight: 500;">${c.email}</a></div>` : '';
            const phone = c.mobile ? `<div style="margin-top: 6px; font-size: 12px; color: #475569; display: flex; align-items: center; gap: 8px;"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#64748b" stroke-width="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path></svg> <a href="tel:${c.mobile}" style="color: #475569; text-decoration: none; font-weight: 500;">${c.mobile}</a></div>` : '';
            const linkedin = c.linkedin ? `<a href="${c.linkedin}" target="_blank" style="margin-top: 12px; display: inline-flex; align-items: center; gap: 6px; font-size: 11px; font-weight: 700; color: #0284c7; text-decoration: none; padding: 6px 10px; background: #f0f9ff; border-radius: 6px; border: 1px solid #bae6fd; transition: 0.2s;" onmouseover="this.style.background='#e0f2fe'" onmouseout="this.style.background='#f0f9ff'"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6z"></path><rect x="2" y="9" width="4" height="12"></rect><circle cx="4" cy="4" r="2"></circle></svg> View LinkedIn</a>` : '';

            return `
            <div class="card-item" style="cursor: default;">
                <div style="font-weight: 700; font-size: 16px; color: #0f172a;">${fullName}</div>
                <div style="font-size: 12px; color: #64748b; font-weight: 500; margin-top: 2px;">@ ${c.client_name}</div>
                ${position}
                <div style="margin-top: 14px; border-top: 1px dashed #e2e8f0; padding-top: 10px;">
                    ${email}
                    ${phone}
                    ${linkedin}
                </div>
            </div>`;
        }).join('');

    } else if (type === 'reports') {
        let filtered = state.allReportsData;
        if (query) filtered = filtered.filter(r => String(r.job_number).includes(query) || (r.report_type||'').toLowerCase().includes(query) || (r.name||'').toLowerCase().includes(query) || (state.premisesData.find(p => p.id === r.premise_id)?.address || '').toLowerCase().includes(query));
        if (subFilterVal !== 'all') filtered = filtered.filter(r => normalizeStatus(r.status) === subFilterVal);
        
        const statusOrder = { 'new': 1, 'inspection': 2, 'report': 3, 'advice': 4, 'invoice': 5, 'cancelled': 6, 'complete': 7 };
        filtered.sort((a, b) => (statusOrder[normalizeStatus(a.status)] || 99) - (statusOrder[normalizeStatus(b.status)] || 99) || (Number(b.job_number) || 0) - (Number(a.job_number) || 0));

        if (filtered.length === 0) return list.innerHTML = `<div style="text-align:center; padding: 40px 20px; color: #94a3b8; font-size: 13px; font-weight: 500;">No reports found matching criteria.</div>`;

        list.innerHTML = filtered.map(r => {
            const safeClass = normalizeStatus(r.status);
            // FIX: Gracefully handle unlinked reports so they don't break the UI
            let displayName = r.name || 'Unlinked Report';
            if (r.premise_id) {
                const p = state.premisesData.find(p => p.id === r.premise_id);
                if (p) displayName = p.name || displayName;
            }
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

    const statusOrder = { 'new': 1, 'inspection': 2, 'report': 3, 'advice': 4, 'invoice': 5, 'cancelled': 6, 'complete': 7 };
    filtered.sort((a, b) => (statusOrder[normalizeStatus(getPremiseDisplayData(a).status)] || 99) - (statusOrder[normalizeStatus(getPremiseDisplayData(b).status)] || 99) || (a.name || '').localeCompare(b.name || ''));

    if(filtered.length === 0) return list.innerHTML = `<div style="text-align:center; padding: 40px 20px; color: #94a3b8; font-size: 13px; font-weight: 500;">No premises found matching "${query}"</div>`;

    list.innerHTML = filtered.map(p => {
        const { displayImage, status } = getPremiseDisplayData(p);
        const safeClass = normalizeStatus(status);
        return `<div class="card-item premise-card" onclick="window.triggerDetailLoad('${p.id}')">
            <div class="premise-card-image"><img src="${displayImage || 'https://via.placeholder.com/400x300?text=No+Image'}"><div class="status-pill ${safeClass}-status">${status}</div></div>
            <div class="card-title">${p.name}</div><div class="card-meta">${p.floor_area} &nbsp;•&nbsp; ${p.sector}</div>
        </div>`;
    }).join('');
}

export function showDetail(p) {
    state.currentViewedPremise = p; 
    toggleDashboardOverlay(false);
    
    const reqBtn = document.getElementById('requestReportBtn');
    if (reqBtn) reqBtn.style.display = 'none';

    const detailPanel = document.getElementById('propertyDetailPanel');
    document.querySelector('.screen.active .main-content')?.appendChild(detailPanel);

    // This now perfectly extracts everything it needs from the single unified function!
    const { reports, latest, images, status } = getPremiseDisplayData(p);
    
    detailPanel.classList.add('active');
    
    state.currentGalleryImages = images.length > 0 ? images : ['https://via.placeholder.com/450x360?text=No+Image'];
    state.currentGalleryIndex = 0;
    updateGalleryImage();

    // 1. Fill Property Stats
    document.getElementById('detailTitle').innerText = p.name;
    document.getElementById('detailAddress').innerText = p.address;
    document.getElementById('detailFloor').innerText = p.floor_area || '-';
    document.getElementById('detailSite').innerText = p.site_area || '-';
    document.getElementById('detailSector').innerText = p.sector || '-';
    document.getElementById('detailAge').innerText = p.year_built ? `${new Date().getFullYear() - p.year_built} Years` : '-';
    document.getElementById('detailSurveyor').innerText = latest.surveyed_by || '-';
    document.getElementById('detailInspected').innerText = latest.inspection_date || '-';
    document.getElementById('detailDelivery').innerText = latest.delivery_date || '-';
    document.getElementById('detailLegal').innerText = p.legal_description || '-'; 

    document.getElementById('videoBtn').style.display = latest.video_url ? 'flex' : 'none';
    document.getElementById('videoBtn').onclick = () => window.open(latest.video_url, '_blank');
    document.getElementById('btnEnrichData').style.display = (state.currentUser && state.currentUser.role === 'admin') ? 'block' : 'none';
    
    // 2. Render Reports Table
    const isAdmin = state.currentUser && state.currentUser.role === 'admin';
    const header = document.getElementById('reportsTableHeader');
    const body = document.getElementById('reportsTableBody');

    if (header && body) {
        header.innerHTML = `<tr>
            <th>Property</th><th>Type</th><th>Job #</th><th>Status</th>
            <th style="text-align:center;">PDF</th><th style="text-align:center;">INFO</th><th style="text-align:center;">INV</th>${isAdmin ? '<th style="text-align:center;">EDIT</th>' : ''}
        </tr>`;
        
        body.innerHTML = reports.map(r => {
            const pdfIcon = r.pdf_url ? `<a href="${r.pdf_url}" target="_blank" class="icon-btn"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg></a>` : '-';
            const infoIcon = r.info_url ? `<a href="${r.info_url}" target="_blank" class="icon-btn"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg></a>` : '-';
            const invIcon = r.invoice_url ? `<a href="${r.invoice_url}" target="_blank" class="icon-btn"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg></a>` : '-';
            const editIcon = isAdmin ? `<button type="button" onclick="window.openEditReportModal('${r.id}')" class="icon-btn"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>` : '';
            
            const safeClass = normalizeStatus(r.status);
            const statusHtml = isAdmin
                ? `<select onchange="window.triggerStatusUpdate('${r.id}', this.value, this)" class="status-select ${safeClass}-status">
                    ${STATUS_OPTIONS.map(opt => `<option value="${opt}" ${safeClass === opt.toLowerCase() ? 'selected' : ''}>${opt}</option>`).join('')}
                   </select>`
                : `<span class="status-pill ${safeClass}-status">${r.status}</span>`;
            
            return `<tr>
                <td style="max-width: 140px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${r.name || p.name}</td>
                <td>${r.report_type || '-'}</td>
                <td>${r.job_number}</td>
                <td>${statusHtml}</td>
                <td style="text-align:center;">${pdfIcon}</td>
                <td style="text-align:center;">${infoIcon}</td>
                <td style="text-align:center;">${invIcon}</td>
                ${isAdmin ? `<td style="text-align:center;">${editIcon}</td>` : ''}
            </tr>`;
        }).join('');
    }

if (state.mapInstance && p.lat) {
        // 19.5 is incredibly close, perfect for seeing the vector property boundary
        state.mapInstance.flyTo({ center: [p.lng, p.lat], zoom: 19.5, pitch: 70 });
    }
}

// ui.js - Optimized Sync & Reset Logic
document.getElementById('btnEnrichData').onclick = async () => {
    const premise = state.currentViewedPremise;
    if (!premise) return;

    const url = prompt(`Paste OneRoof URL for ${premise.name}:`);
    if (!url) return;

    const btn = document.getElementById('btnEnrichData');
    const originalHTML = '<span style="font-weight:700;">✨ Auto-Enrich</span>';
    
    // 1. Set Loading State
    btn.innerHTML = '<span class="spin">🔄</span> Syncing...';
    btn.disabled = true;

    // Helper to force hectare conversion if AI forgets
    const convertArea = (val) => {
        if (typeof val === 'string' && val.toLowerCase().includes('ha')) {
            const num = parseFloat(val.replace(/[^\d.]/g, ''));
            return (num * 10000).toLocaleString() + ' m²';
        }
        return val || '-';
    };

    try {
        const { data, error } = await supabase.functions.invoke('enrich-premise', {
            body: { premise_id: premise.id, oneroof_url: url }
        });

        if (error || (data && data.error)) throw new Error(error?.message || data?.error);

        const res = data.data;

        // Safety formatter to ensure commas and m² are ALWAYS present
        const formatArea = (val) => {
            if (!val || val === '-') return '-';
            let clean = val.toString().replace(/[^\d.]/g, ''); 
            let num = parseFloat(clean);
            if (isNaN(num)) return val;
            return num.toLocaleString() + ' m²'; 
        };

        document.getElementById('detailTitle').innerText = res.name || '-';
        document.getElementById('detailAddress').innerText = res.address || '-';
        document.getElementById('detailFloor').innerText = formatArea(res.floor_area);
        document.getElementById('detailSite').innerText = formatArea(res.site_area);
        document.getElementById('detailSector').innerText = res.sector || '-';
        document.getElementById('detailLegal').innerText = res.legal_description || '-';
                
        if (res.year_built) {
            document.getElementById('detailAge').innerText = `${new Date().getFullYear() - parseInt(res.year_built)} Years`;
        }

        if (window.refreshAppAdminData) await window.refreshAppAdminData();

    } catch (err) {
        alert("System Error: " + err.message);
    } finally {
        btn.innerHTML = originalHTML;
        btn.disabled = false;
        btn.style.background = '#10b981';
    }
};

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
    const isDetailOpen = document.getElementById('propertyDetailPanel')?.classList.contains('active');
    document.getElementById('requestReportBtn').style.display = (id === 'premisesScreen' && !isDetailOpen) ? 'flex' : 'none';    
    requestAnimationFrame(() => {
        setTimeout(() => {
            const mapContainer = id === 'clientListScreen' ? 'adminMap' : 'premisesMap';
            if (document.getElementById(mapContainer)) {
                
                // Centers on Bayleys Auckland City, Zoom 15.5 for clear 3D buildings
                initMap(mapContainer, [174.7554, -36.8454], 15.5, 60, -17.6);
                
                if (state.premisesData.length > 0 && state.mapInstance) {
                    if (state.mapInstance.loaded()) addMarkers(state.premisesData);
                    else state.mapInstance.on('load', () => addMarkers(state.premisesData));
                }
            }
        }, 100);
    });
}