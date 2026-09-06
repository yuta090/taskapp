import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * OAuth 接続の保存先（integration_connections）に書き込む共通処理。
 *
 * ここで upsert(onConflict) を使ってはいけない理由:
 *   一意キーは 20260721193711_task_sync_credentials 以降
 *     (provider, owner_type, owner_id, coalesce(external_account_key, ''))
 *   という「式付き」のインデックスになった。PostgREST の on_conflict は列名しか受け付けず
 *   式に合わせられないため、`onConflict: 'provider,owner_type,owner_id'` は Postgres に
 *     "there is no unique or exclusion constraint matching the ON CONFLICT specification"
 *   で拒否される。これによりカレンダー/Zoom/Teams/Notion/スプレッドシート/Google タスク/会計の
 *   OAuth 接続がすべて save_failed になっていた（2026-09-06 本番で再現・是正）。
 *
 * 代わりに「external_account_key 未設定（NULL または ''）の既存行」を引いて update、
 * 無ければ insert する。OAuth 接続は外部テナント識別子を持たないので、この 3 列で 1 行に定まる。
 * 同一ユーザーの連打程度の競合では insert 側が一意制約で弾かれるだけで、壊れた行は残らない。
 */
export interface OAuthConnectionRow {
  provider: string
  owner_type: 'user' | 'org'
  owner_id: string
  org_id: string
  [column: string]: unknown
}

export interface SaveOAuthConnectionResult {
  data: { id: string } | null
  error: { message: string; code?: string } | null
}

export async function saveOAuthConnection(
  admin: SupabaseClient,
  row: OAuthConnectionRow,
): Promise<SaveOAuthConnectionResult> {
  const { data: existing, error: findError } = await admin
    .from('integration_connections')
    .select('id')
    .eq('provider', row.provider)
    .eq('owner_type', row.owner_type)
    .eq('owner_id', row.owner_id)
    // 一意キーの coalesce(external_account_key, '') に合わせ、NULL と '' を同じ「未設定」として扱う
    .or('external_account_key.is.null,external_account_key.eq.')
    .maybeSingle()

  if (findError) {
    return { data: null, error: findError }
  }

  if (existing?.id) {
    const { data, error } = await admin
      .from('integration_connections')
      .update(row)
      .eq('id', existing.id)
      .select('id')
      .single()
    return { data: data ?? null, error }
  }

  const { data, error } = await admin
    .from('integration_connections')
    .insert(row)
    .select('id')
    .single()
  return { data: data ?? null, error }
}
