// modals.js

import { state } from './store.js';
import { MAPBOX_TOKEN } from './config.js';
import { supabase, uploadMultipleFiles } from './api.js';
import { log, filterAdminView, showDetail } from './ui.js';

// --- REQUEST REPORT MODAL ---
window.openRequestModal = () => document.getElementById('requestModalOverlay').classList.add('active');
window.closeRequestModal = () => {
    document.getElementById('requestModalOverlay').classList.remove('active');
    document.getElementById('requestReportForm').reset();
    document.getElementById('leaseFileName').innerText = '';
    document.getElementById('planFileName').innerText = '';
};
window.updateFileName = (input, displayId) => {
    const displayEl = document.getElementById(displayId);
    if (input.files.length === 0) displayEl.innerText = '';
    else if (input.files.length === 1) displayEl.innerText = input.files[0].name;
    else displayEl.innerText = `${input.files.length} files selected`;
};

document.getElementById('requestReportForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('submitRequestBtn');
    const originalText = btn.innerText;
    btn.innerText = 'Uploading...';
    btn.disabled = true;

    try {
        log("Packaging request and uploading files...");
        const leaseUrls = await uploadMultipleFiles(document.getElementById('reqLeaseFile'), 'report_requests', 'leases');
        const planUrls = await uploadMultipleFiles(document.getElementById('reqPlanFile'), 'report_requests', 'plans');

        const formData = {
            client_name: state.currentUser ? state.currentUser.name : 'Unknown Client',
            property_manager: document.getElementById('reqManagerName').value,
            property_manager_email: document.getElementById('reqManagerEmail').value,
            address: document.getElementById('reqAddress').value,
            report_type: document.getElementById('reqType').value,
            delivery_deadline: document.getElementById('reqDeadline').value,
            status: 'Pending',
            request_date: new Date().toISOString()
        };

        if (leaseUrls) formData.lease_url = leaseUrls; 
        if (planUrls) formData.plan_url = planUrls;
        
        const { error: insertError } = await supabase.from('report_requests').insert([formData]);
        if (insertError) throw insertError;

        log("Report request sent successfully!");
        alert("Success! Your report request has been sent to David.");
        window.closeRequestModal();
    } catch (err) {
        log("Error: " + err.message, true);
        alert("Failed to submit request:\n" + err.message);
    } finally {
        btn.innerText = originalText;
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
            condition: document.getElementById('newRepCondition').value || null,
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

    document.getElementById('editRepCondition').value = report.condition || '';
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
            condition: document.getElementById('editRepCondition').value || null,
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