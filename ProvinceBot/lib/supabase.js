import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL2;
const supabaseKey = process.env.SUPABASE_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error("Missing Supabase configuration in .env");
}

export const supabase = createClient(supabaseUrl, supabaseKey);

export async function uploadImage(buffer, filename, mimetype) {
    try {
        const { data, error } = await supabase.storage
            .from('event-images')
            .upload(filename, buffer, {
                contentType: mimetype,
                upsert: true
            });

        if (error) {
            console.error("Error uploading image:", error);
            throw error;
        }

        const { data: { publicUrl } } = supabase.storage
            .from('event-images')
            .getPublicUrl(filename);

        return publicUrl;
    } catch (err) {
        console.error("Exception in uploadImage:", err);
        throw err;
    }
}
