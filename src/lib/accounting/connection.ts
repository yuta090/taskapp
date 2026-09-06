import { createAdminClient } from '@/lib/supabase/admin'
import { getValidTokenDetailed } from '@/lib/integrations/token-manager'
import { refreshAccountingToken } from '@/lib/accounting/oauth'
import { getAccountingAdapter } from '@/lib/accounting/adapters'
import type { AccountingAdapter, AccountingContext, AccountingProviderId } from '@/lib/accounting/types'
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * 接続（org が持つ会計/請求サービスのトークン）から、アダプタを叩ける状態を作る。
 *
 * 3つのルート（取引先一覧・発行・状態同期）が同じ手順を踏むため1本化する。とくに
 * 「未接続」「失効した」「一時的に繋がらない」の3つを取り違えると、利用者に出す案内が
 * 間違う（再接続が要るのに「あとで試して」と言う等）ので、ここで区別して返す。
 */

export type AccountingConnectionResult =
  | { status: 'ok'; connectionId: string; adapter: AccountingAdapter; ctx: AccountingContext }
  /** そもそも繋いでいない。接続画面へ誘導する。 */
  | { status: 'not_connected' }
  /** トークンが失効した。繋ぎ直しが要る。 */
  | { status: 'auth_failed' }
  /** 一時的な障害。時間をおけば直る。 */
  | { status: 'transient_error' }

export async function resolveAccountingConnection(
  orgId: string,
  provider: AccountingProviderId,
): Promise<AccountingConnectionResult> {
  const adapter = getAccountingAdapter(provider)
  if (!adapter) return { status: 'not_connected' }

  const admin = createAdminClient()
  const { data: connection } = await (admin as SupabaseClient)
    .from('integration_connections')
    .select('id, metadata, status')
    .eq('provider', provider)
    .eq('owner_type', 'org')
    .eq('owner_id', orgId)
    .maybeSingle()

  if (!connection) return { status: 'not_connected' }

  const token = await getValidTokenDetailed(connection.id, (refreshToken) =>
    refreshAccountingToken(provider, refreshToken),
  )

  if (token.status === 'auth_failed') return { status: 'auth_failed' }
  if (token.status === 'transient_error') return { status: 'transient_error' }

  return {
    status: 'ok',
    connectionId: connection.id,
    adapter,
    ctx: {
      credentials: { token: token.token },
      // 事業所ID等の接続ごとの設定は metadata に置く（freee は company_id が必須）。
      config: (connection.metadata ?? {}) as Record<string, unknown>,
    },
  }
}

/** 接続の失敗を、利用者に出す文言とHTTPステータスに写す。 */
export function connectionErrorResponse(
  status: Exclude<AccountingConnectionResult['status'], 'ok'>,
): { error: string; httpStatus: number } {
  switch (status) {
    case 'not_connected':
      return { error: 'まだ接続されていません。設定画面から接続してください。', httpStatus: 409 }
    case 'auth_failed':
      return { error: '接続の有効期限が切れました。つなぎ直してください。', httpStatus: 401 }
    case 'transient_error':
      return { error: '一時的に接続できませんでした。少し時間をおいて試してください。', httpStatus: 503 }
  }
}
