import { createClient } from '@supabase/supabase-js';
import { config } from '../config.js';
let supabaseInstance = null;
export function getSupabaseClient() {
    if (!supabaseInstance) {
        if (!config.supabaseUrl || !config.supabaseServiceKey) {
            throw new Error('Supabase not configured. Set SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) and SUPABASE_SERVICE_KEY (or SUPABASE_SERVICE_ROLE_KEY)');
        }
        supabaseInstance = createClient(config.supabaseUrl, config.supabaseServiceKey, {
            auth: {
                autoRefreshToken: false,
                persistSession: false,
            },
        });
    }
    return supabaseInstance;
}
//# sourceMappingURL=client.js.map