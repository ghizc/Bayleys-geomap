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
export async function getAdminData() {
    const [clientsRes, reportsRes, premisesRes] = await Promise.all([
        supabase.from('clients').select('*'),
        supabase.from('reports').select('*'),
        supabase.from('premises').select('*')
    ]);

    if (clientsRes.error) throw clientsRes.error;
    if (reportsRes.error) throw reportsRes.error;
    if (premisesRes.error) throw premisesRes.error;

    return {
        clients: clientsRes.data || [],
        reports: reportsRes.data || [],
        premises: premisesRes.data || []
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