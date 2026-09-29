import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import crypto from 'crypto'

/**
 * E2E が本番DBへ直接 fixture を作る／消すための、サービスロール（管理用の鍵）クライアント。
 *
 * 本番には全ての書き込みを記録する change_log の仕掛けがあり、サービスロールでの書き込みは
 * リクエストのヘッダー（x-agentpm-channel 等）を見て「誰が・どの経路から」書いたかを判定する。
 * ヘッダーを付けずに書くと経路が 'unattributed'（誰の書き込みか分からない）として記録され、
 * E2E を回すたびに本番の監査ログへノイズが残ってしまう。ここで 'system'（テストなど機械的な
 * 操作の経路）だと明示し、実行のたびに変わるリクエストIDも添える。
 */
export function createAdminDb(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY が .env.local に無い')
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      headers: {
        'x-agentpm-channel': 'system',
        'x-agentpm-request-id': `e2e-${crypto.randomUUID()}`,
      },
    },
  })
}
