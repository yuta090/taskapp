import type { TaskSyncAdapter } from '@/lib/task-sync/types'

/**
 * 外部側テナントの正規化識別子（integration_connections.external_account_key）を導出する。
 *
 * これが「同じorgが同じ外部テナントへ二重に繋ぐ」事故を制約で防ぐ鍵になる（DBの式一意インデックス
 * が (provider, owner_type, owner_id, coalesce(external_account_key,'')) で効く）。
 * したがって**表記揺れを必ず潰す**こと: 大文字小文字・末尾スラッシュ・ポート表記が違うだけで
 * 別テナント扱いになると、二重取り込みが素通りしてしまう。
 *
 * 接続先が固定のツール（Asana / Trello / Linear / Jooto）は null を返す。null は DB 側で ''
 * に潰され、従来どおり「1org 1接続」に制限される。これらは1つの資格情報が1テナントを指すため、
 * 複数接続を開く意味がない（開くと同じデータを二重に取り込むだけ）。
 */
export function deriveExternalAccountKey(adapter: TaskSyncAdapter, baseUrl: string | null): string | null {
  if (adapter.hostPolicy.kind === 'fixed') return null
  if (!baseUrl) return null
  try {
    const url = new URL(baseUrl)
    // ホスト名だけを正規化キーにする（パス・クエリ・末尾スラッシュの差を吸収）。
    // 同一ホストの別パスに別テナントが同居する構成は対象ツールに無い。
    return url.hostname.toLowerCase()
  } catch {
    return null
  }
}
