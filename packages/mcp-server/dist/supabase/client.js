import { createClient } from '@supabase/supabase-js';
import { config } from '../config.js';
let supabaseInstance = null;
export function getSupabaseClient() {
    if (!supabaseInstance) {
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