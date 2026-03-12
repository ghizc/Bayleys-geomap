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
    // 1. Fetch Clients (Usually under 1000, so a standard fetch is fine)
    const clientsRes = await supabase.from('clients').select('*');
    if (clientsRes.error) throw clientsRes.error;

    // 2. Fetch ALL Reports using a pagination loop
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

    // 3. Fetch ALL Premises using a pagination loop
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
        premises: allPremises
    };
}

/**
 * Fetches premises for a specific client
 */
export async function getClientPremises(clientId) {
    const { data, error } = await supabase
        .from('premises')
        .select('*, reports!inner(*)')
        .eq('reports.client_id', clientId);
        
    if (error) throw error;
    return data || [];
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