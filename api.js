// api.js

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

/**
 * Authenticates a user
 */
export async function loginUser(rawUserId, password) {
    const fakeEmail = `${rawUserId}@bayleys.co.nz`; 
    const { data, error } = await supabase.auth.signInWithPassword({ 
        email: fakeEmail, 
        password: password 
    });
    
    if (error) throw new Error("Incorrect Username or Password");
    return data.user.id;
}

/**
 * Fetches core data for Admin
 */
/**
 * Fetches core data for Admin (Bypasses 1000 row limits)
 */
export async function getAdminData() {
    // 1. Fetch Clients
    const clientsRes = await supabase.from('clients').select('*');
    if (clientsRes.error) throw clientsRes.error;

    // 2. Fetch Contacts
    const contactsRes = await supabase.from('contacts').select('*');
    if (contactsRes.error) throw contactsRes.error;

    // 3. Fetch Report Requests (Newest First) ---
    const requestsRes = await supabase.from('report_requests').select('*').order('request_date', { ascending: false });
    if (requestsRes.error) throw requestsRes.error;

    // 4. Fetch ALL Reports using a pagination loop
    let allReports = [];
    let rFetchMore = true;
    let rFrom = 0;
    while (rFetchMore) {
        const { data, error } = await supabase.from('reports').select('*').range(rFrom, rFrom + 999);
        if (error) throw error;
        if (data && data.length > 0) {
            allReports.push(...data);
            rFrom += 1000;
        }
        if (!data || data.length <= 999) rFetchMore = false;
    }

    // 5. Fetch ALL Premises using a pagination loop
    let allPremises = [];
    let pFetchMore = true;
    let pFrom = 0;
    while (pFetchMore) {
        const { data, error } = await supabase.from('premises').select('*').range(pFrom, pFrom + 999);
        if (error) throw error;
        if (data && data.length > 0) {
            allPremises.push(...data);
            pFrom += 1000;
        }
        if (!data || data.length <= 999) pFetchMore = false;
    }

    return {
        clients: clientsRes.data || [],
        reports: allReports,
        premises: allPremises,
        contacts: contactsRes.data || [],
        requests: requestsRes.data || []
    };
}

/**
 * Fetches premises for a specific client
 */
export async function getClientPremises(clientId) {
    // 1. Fetch any report where the user is the Primary OR Shared client
    const { data: reports, error: rErr } = await supabase
        .from('reports')
        .select('*')
        .or(`client_id.eq.${clientId},shared_clients.cs.{${clientId}}`);
        
    if (rErr) throw rErr;
    if (!reports || reports.length === 0) return [];

    // 2. Extract unique Premise IDs from those reports
    const premiseIds = [...new Set(reports.map(r => r.premise_id))];

    // 3. Fetch the Premises
    const { data: premises, error: pErr } = await supabase
        .from('premises')
        .select('*')
        .in('id', premiseIds);

    if (pErr) throw pErr;

    // 4. Bind the reports into the premises so the UI works exactly as before
    return premises.map(p => ({
        ...p,
        reports: reports.filter(r => r.premise_id === p.id)
    }));
}

/**
 * Fetches specific client data by ID
 */
export async function getClientById(clientId) {
    const { data, error } = await supabase.from('clients').select('*').eq('id', clientId).single();
    if (error) throw error;
    return data;
}

/**
 * Uploads multiple files to a Supabase bucket
 */
export async function uploadMultipleFiles(fileInput, bucketName, folderName = '', prefix = '') {
    if (!fileInput.files || fileInput.files.length === 0) return null;
    const uploadedUrls = [];
    
    for (const file of fileInput.files) {
        const safeName = file.name.replace(/[^a-zA-Z0-9.\-_]/g, '_');
        let filePath = folderName ? `${folderName}/` : '';
        filePath += `${prefix}${Date.now()}_${safeName}`;
        
        const { error } = await supabase.storage.from(bucketName).upload(filePath, file);
        if (error) throw new Error(`Failed to upload ${file.name}: ${error.message}`);
        
        const { data } = supabase.storage.from(bucketName).getPublicUrl(filePath);
        uploadedUrls.push(data.publicUrl);
    }
    return uploadedUrls;
}

/**
 * Fetches the global pricing rules engine
 */
export async function getPricingRules() {
    const { data, error } = await supabase.from('pricing_rules').select('*');
    if (error) throw error;
    return data || [];
}

export async function getAirports() {
    const { data, error } = await supabase.from('nz_airports').select('*');
    if (error) throw error;
    return data || [];
}

export async function getOffices() {
    const { data, error } = await supabase.from('offices').select('*');
    if (error) throw error;
    return data || [];
}

export async function getDiscounts() {
    // Order descending so highest revenue tier is first
    const { data, error } = await supabase.from('discounts').select('*').eq('is_active', true).order('min_revenue', { ascending: false });
    if (error) throw error;
    return data || [];
}
