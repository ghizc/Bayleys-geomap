// modals.js

import { state } from './store.js';
import { MAPBOX_TOKEN } from './config.js';
import { supabase, uploadMultipleFiles } from './api.js';
import { log, filterAdminView, showDetail } from './ui.js';

// --- REQUEST REPORT MODAL ---

// Function to dynamically add a Premise + Report Type row
window.addPremiseRow = () => {
    const container = document.getElementById('reqPremisesContainer');
    const rowCount = container.children.length;
    
    const row = document.createElement('div');
    row.className = 'premise-req-row';
    // Style it as a distinct "card" so multiple requests don't blend together visually
    row.style.cssText = 'background: white; padding: 16px; border: 1px solid #cbd5e1; border-radius: 8px; position: relative; margin-bottom: 12px; box-shadow: 0 2px 4px rgba(0,0,0,0.02);';

    row.innerHTML = `
        ${rowCount > 0 ? `<button type="button" class="icon-btn" style="position: absolute; top: 12px; right: 12px; border:none; background:transparent; color:#ef4444; width: 24px; height: 24px;" onclick="this.closest('.premise-req-row').remove()" title="Remove Request">✕</button>` : ''}
        
        <div class="form-row" style="margin-bottom: 12px; ${rowCount > 0 ? 'padding-right: 24px;' : ''}">
            <div class="form-group" style="flex: 2; margin-bottom: 0;">
                <label class="form-label" style="font-size: 10px;">Street Address & City</label>
                <input type="text" class="form-input req-address-input" required placeholder="123 Example St, Auckland">
            </div>
            <div class="form-group" style="flex: 1; margin-bottom: 0;">
                <label class="form-label" style="font-size: 10px;">ZIP / Postcode</label>
                <input type="text" class="form-input req-zip-input" required placeholder="1010">
            </div>
            <div class="form-group" style="flex: 1; margin-bottom: 0;">
                <label class="form-label" style="font-size: 10px;">Country</label>
                <select class="form-input req-country-select" required style="cursor:pointer;">
                    <option value="New Zealand" selected>New Zealand</option>
                    <option value="Australia">Australia</option>
                </select>
            </div>
        </div>

        <div class="form-row" style="margin-bottom: 0;">
            <div class="form-group" style="flex: 1.5; margin-bottom: 0;">
                <label class="form-label" style="font-size: 10px;">Report Type</label>
                <select class="form-input req-type-select" required style="cursor:pointer;">
                    <option value="" disabled selected>Select...</option>
                    <option value="BCA">BCA (Building Condition Assessment)</option>
                    <option value="COO">COO (Change of Operator/Owner)</option>
                    <option value="FMP">FMP (Forward Maintenance Plan)</option>
                    <option value="MGA">MGA (Make Good Assessment)</option>
                    <option value="PCR">PCR (Property Condition Report)</option>
                    <option value="RCA">RCA (Reinstatement Cost Assessment)</option>
                    <option value="RMP">RMP (Roof Maintenance Plan)</option>
                    <option value="TDD">TDD (Technical Due Diligence)</option>
                    <option value="Capex">CapEx (Capital Expenditure)</option>
                </select>
            </div>
            <div class="form-group" style="flex: 1; margin-bottom: 0;">
                <label class="form-label" style="font-size: 10px;">Delivery Deadline</label>
                <input type="date" class="form-input req-deadline-input" required>
            </div>
            <div class="form-group" style="flex: 1; margin-bottom: 0;">
                <label class="form-label" style="font-size: 10px;">Client Order # (Optional)</label>
                <input type="text" class="form-input req-co-input" placeholder="e.g. PO-9921">
            </div>
        </div>
    `;
    container.appendChild(row);
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
                data.map(c => `<option value="${c.id}" data-name="${c.first_name} ${c.last_name}" data-email="${c.email}">${c.first_name} ${c.last_name} (${c.email})</option>`).join('');
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
    document.getElementById('leaseFileName').innerText = '';
    document.getElementById('planFileName').innerText = '';
};

window.updateFileName = (input, displayId) => {
    const displayEl = document.getElementById(displayId);
    if (input.files.length === 0) displayEl.innerText = '';
    else if (input.files.length === 1) displayEl.innerText = input.files[0].name;
    else displayEl.innerText = `${input.files.length} files selected`;
};

// Handle the bulk submission
document.getElementById('requestReportForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('submitRequestBtn');
    const originalText = btn.innerText;
    btn.innerText = 'Uploading...';
    btn.disabled = true;

    try {
        const contactSelect = document.getElementById('reqContactId');
        if (!contactSelect.value) throw new Error("Please select a Property Manager.");
        
        const selectedOption = contactSelect.options[contactSelect.selectedIndex];
        const managerName = selectedOption.dataset.name;
        const managerEmail = selectedOption.dataset.email;

        log("Packaging request and uploading files...");
        const leaseUrls = await uploadMultipleFiles(document.getElementById('reqLeaseFile'), 'report_requests', 'leases');
        const planUrls = await uploadMultipleFiles(document.getElementById('reqPlanFile'), 'report_requests', 'plans');

        const clientName = state.currentUser.clientSpoof?.name || state.currentUser.name;
        const notes = document.getElementById('reqNotes').value.trim();

        // Gather all rows and format them as an array of inserts
        const rows = document.querySelectorAll('.premise-req-row');
        const inserts = [];

        rows.forEach(row => {
            const addressLine = row.querySelector('.req-address-input').value.trim();
            const zip = row.querySelector('.req-zip-input').value.trim();
            const country = row.querySelector('.req-country-select').value;
            const reportType = row.querySelector('.req-type-select').value;
            const deadline = row.querySelector('.req-deadline-input').value;
            const coNumber = row.querySelector('.req-co-input').value.trim();
            
            // Format the address cleanly into one string for the database
            const fullAddress = `${addressLine}, ${zip}, ${country}`;

            if (addressLine && reportType && deadline) {
                inserts.push({
                    client_name: clientName,
                    property_manager: managerName,
                    property_manager_email: managerEmail,
                    address: fullAddress,
                    report_type: reportType,
                    delivery_deadline: deadline,
                    co_number: coNumber || null, // Saving this directly to the database
                    notes: notes || null,
                    status: 'Pending',
                    request_date: new Date().toISOString(),
                    lease_url: leaseUrls || null,
                    plan_url: planUrls || null
                });
            }
        });

        if (inserts.length === 0) throw new Error("Please provide details for at least one premise.");

        // Insert all rows into the database at once
        const { error: insertError } = await supabase.from('report_requests').insert(inserts);
        if (insertError) throw insertError;

        log("Report request sent successfully!");
        alert(`Success! ${inserts.length} report request(s) have been generated and sent to david.guy@bayleysbc.co.nz.`);
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

        // Add the new contact to the dropdown instantly
        const contactSelect = document.getElementById('reqContactId');
        
        // Clear the "No contacts found" dummy option if it exists
        if (contactSelect.options[0] && contactSelect.options[0].value === "") {
            contactSelect.innerHTML = '<option value="" disabled>Select Property Manager...</option>';
        }
        
        const newOptionHtml = `<option value="${data.id}" data-name="${data.first_name} ${data.last_name}" data-email="${data.email}">${data.first_name} ${data.last_name} (${data.email})</option>`;
        contactSelect.insertAdjacentHTML('beforeend', newOptionHtml);
        
        // Auto-select the newly created contact
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
            legal_description: document.getElementById('newPremiseLegal').value.trim() || null, // <-- NEW LINE
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