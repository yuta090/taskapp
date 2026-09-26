import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { config, getAuthContextOrNull } from '../config.js';
let supabaseInstance = null;
/**
 * ctx（AsyncLocalStorage の認証コンテキスト）ごとに1個だけ作る。WeakMap なので
 * ctx がリクエストの終わりに GC されれば一緒に片付く。同じ呼び出しの中で
 * getSupabaseClient() を何度呼んでも、request-id 等のヘッダーが変わらないようにする。
 */
const clientsByCtx = new WeakMap();
function assertConfigured() {
    if (!config.supabaseUrl || !config.supabaseServiceKey) {
        throw new Error('Supabase not configured. Set SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) and SUPABASE_SERVICE_KEY (or SUPABASE_SERVICE_ROLE_KEY)');
    }
}
/**
 * change_log トリガー（誰が・どの経路で書いたか。supabase 側 PR #1027）向けのヘッダー。
 * service_role の JWT を使うときだけ DB 側が信用する。ここで使うのは AsyncLocalStorage
 * に積まれた「このサーバー自身が認証した ctx」だけで、外から来たリクエストのヘッダーは
 * 一切見ない（なりすまし防止）。
 */
function buildAttributionHeaders(ctx) {
    const headers = {
        'x-agentpm-channel': ctx.channel,
        'x-agentpm-request-id': randomUUID(),
    };
    if (ctx.userId)
        headers['x-agentpm-actor-id'] = ctx.userId;
    // 'dev-key' はローカル開発の目印（本物の鍵ではない）。cli_usage_logs 等への記録でも
    // 同様に除外している（src/app/api/tools/route.ts 等）
    if (ctx.keyId && ctx.keyId !== 'dev-key')
        headers['x-agentpm-api-key-id'] = ctx.keyId;
    return headers;
}
export function getSupabaseClient() {
    const ctx = getAuthContextOrNull();
    if (!ctx) {
        if (!supabaseInstance) {
            assertConfigured();
            supabaseInstance = createClient(config.supabaseUrl, config.supabaseServiceKey, {
                auth: {
                    autoRefreshToken: false,
                    persistSession: false,
                },
            });
        }
        return supabaseInstance;
    }
    const cached = clientsByCtx.get(ctx);
    if (cached)
        return cached;
    assertConfigured();
    const client = createClient(config.supabaseUrl, config.supabaseServiceKey, {
        auth: {
            autoRefreshToken: false,
            persistSession: false,
        },
        global: { headers: buildAttributionHeaders(ctx) },
    });
    clientsByCtx.set(ctx, client);
    return client;
}
//# sourceMappingURL=client.js.map