import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.39.0";
import { GoogleGenerativeAI } from "npm:@google/generative-ai";

const corsHeaders = { 
    'Access-Control-Allow-Origin': '*', 
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' 
};

serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

    try {
        const { premise_id, oneroof_url } = await req.json();
        const res = await fetch(oneroof_url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        const html = await res.text();

        const genAI = new GoogleGenerativeAI(Deno.env.get('GEMINI_API_KEY'));
        const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

        // Inside index.ts prompt

        const prompt = `
        Extract property details from this OneRoof HTML. 
        Return ONLY a valid JSON object. No markdown.

        STRICT FORMATTING RULES:
        1. "name": Extract Street Number and Street Name ONLY (e.g. "20 Brunswick Street").
        2. "address": Extract the FULL address string.
        3. "floor_area": Check the value. If "ha", multiply by 10,000. Return as "X,XXX m²" (e.g., "11,900 m²"). ALWAYS include commas and " m²".
        4. "site_area": Check the value. If "ha", multiply by 10,000. Return as "X,XXX m²" (e.g., "14,200 m²"). ALWAYS include commas and " m²".
        5. "year_built": Use the year from the "Home built" timeline event (e.g., 2000).
        6. "legal_description": Extract the full LOT/DP string.
        7. "sector": Use "Commercial - Retail".

        HTML Snippet: ${html.substring(0, 250000)}`;

        const result = await model.generateContent(prompt);
        let text = result.response.text().replace(/```json/gi, "").replace(/```/g, "").trim();
        const extracted = JSON.parse(text);

        const supabase = createClient(Deno.env.get('SUPABASE_URL'), Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'));
        
        // Update the database
        const { error: dbError } = await supabase.from('premises').update({
            name: extracted.name,
            address: extracted.address,
            floor_area: extracted.floor_area,
            site_area: extracted.site_area,
            year_built: extracted.year_built,
            legal_description: extracted.legal_description,
            sector: extracted.sector
        }).eq('id', premise_id);

        if (dbError) throw dbError;

        return new Response(JSON.stringify({ success: true, data: extracted }), { 
            headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        });

    } catch (err) {
        console.error("Function Error:", err.message);
        return new Response(JSON.stringify({ error: err.message }), { 
            status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        });
    }
});