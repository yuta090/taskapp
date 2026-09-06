import { createAdminClient } from '@/lib/supabase/admin'
import { resolveAccountingConnection } from '@/lib/accounting/connection'
import type { AccountingProviderId, DocumentStatus, DocumentType } from '@/lib/accounting/types'
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * 発行済み書類の状態を会計サービスから取り直す（入金の取り込み）。
 *
 * これが無いと「請求書を出した」で終わってしまい、入金されたかどうかは会計ソフトを
 * 개別に見に行くしかない。定期的に引き直すことで、TaskApp 側だけを見ていれば
 * 「まだ入金されていない請求」が分かる状態にする。
 *
 * 追いかけるのは**まだ確定していない書類だけ**。入金済み・取消済み・受注済みは終端で、
 * それ以上変わらないため対象から外す（無駄な呼び出しでレート制限を使い切らない）。
 */

/** 1回の実行で見る最大件数。レート制限とワーカーの実行時間の両方に効く安全弁。 */
const BATCH_SIZE = 50

/** 同じ書類を立て続けに引き直さない最短間隔。 */
const MIN_RECHECK_INTERVAL_MS = 30 * 60 * 1000

/** まだ動きうる状態。これ以外（paid / canceled / accepted）は終端として追わない。 */
const PENDING_STATUSES: DocumentStatus[] = ['draft', 'issued', 'unknown']

export interface SyncSummary {
  checked: number
  updated: number
  failed: number
}

interface PendingRow {
  id: string
  org_id: string
  provider: AccountingProviderId
  doc_type: DocumentType
  external_id: string | null
  status: DocumentStatus
}

export async function syncBillingDocumentsBatch(now: Date = new Date()): Promise<SyncSummary> {
  const admin = createAdminClient()
  const summary: SyncSummary = { checked: 0, updated: 0, failed: 0 }

  const cutoff = new Date(now.getTime() - MIN_RECHECK_INTERVAL_MS).toISOString()

  const { data: rows } = await (admin as SupabaseClient)
    .from('billing_documents')
    .select('id, org_id, provider, doc_type, external_id, status')
    .in('status', PENDING_STATUSES)
    .not('external_id', 'is', null)
    .or(`remote_synced_at.is.null,remote_synced_at.lt.${cutoff}`)
    .order('remote_synced_at', { ascending: true, nullsFirst: true })
    .limit(BATCH_SIZE)

  const pending = (rows ?? []) as PendingRow[]
  if (pending.length === 0) return summary

  // 同じ org × provider は接続の解決とトークン更新を1回で済ませる
  const connections = new Map<string, Awaited<ReturnType<typeof resolveAccountingConnection>>>()

  for (const row of pending) {
    summary.checked++

    const key = `${row.org_id}:${row.provider}`
    let connection = connections.get(key)
    if (!connection) {
      connection = await resolveAccountingConnection(row.org_id, row.provider)
      connections.set(key, connection)
    }

    if (connection.status !== 'ok') {
      // 未接続・失効・一時障害。ここで止めず次の書類へ進む（1つの接続の不調で
      // 他org の入金取り込みまで止めない）
      summary.failed++
      continue
    }

    try {
      const remote = await connection.adapter.getDocument(
        connection.ctx,
        row.doc_type,
        row.external_id as string,
      )

      const patch: Record<string, unknown> = {
        raw_status: remote.rawStatus,
        remote_synced_at: now.toISOString(),
        updated_at: now.toISOString(),
      }

      // 畳めなかった状態(unknown)で既知の状態を上書きしない。
      // 「発行済み」が「不明」に戻ると、督促の判断材料が消えてしまう。
      if (remote.status !== 'unknown') patch.status = remote.status
      if (remote.documentNumber) patch.document_number = remote.documentNumber
      if (remote.totalAmount != null) patch.total_amount = remote.totalAmount
      if (remote.webUrl) patch.web_url = remote.webUrl

      await (admin as SupabaseClient).from('billing_documents').update(patch).eq('id', row.id)

      if (remote.status !== 'unknown' && remote.status !== row.status) summary.updated++
    } catch (err) {
      summary.failed++
      console.error(`[accounting-sync] ${row.provider} ${row.id} failed:`, (err as Error).message)
      // 失敗しても remote_synced_at を進める。進めないと、恒久的に失敗する1件が
      // 毎回バッチの先頭に居座り、後ろの書類が永久に確認されなくなる
      await (admin as SupabaseClient)
        .from('billing_documents')
        .update({ remote_synced_at: now.toISOString() })
        .eq('id', row.id)
    }
  }

  return summary
}
