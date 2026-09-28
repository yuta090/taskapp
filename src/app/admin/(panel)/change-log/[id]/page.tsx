import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { createAdminClient } from '@/lib/supabase/admin'
import { verifySuperadmin } from '@/lib/admin/verify-superadmin'
import { AdminPageHeader } from '@/components/admin/AdminPageHeader'
import {
  parseChangeLogId,
  previewJson,
  opLabel,
  channelLabel,
  actorKindLabel,
  rowIdOf,
  type ChangeLogOp,
} from '@/lib/change-log/adminFilters'

/**
 * 変更履歴（change_log）の1件の詳細。変更前後の中身と、同じ操作でまとめて起きた変更
 * （同じ取引番号 txid。例: ページを消したときに一緒に付け替わった子ページ）を見る。
 */

interface ChangeLogDetail {
  id: number
  occurred_at: string
  txid: number
  table_name: string
  op: ChangeLogOp
  row_pk: Record<string, unknown> | null
  org_id: string | null
  space_id: string | null
  actor_kind: string
  actor_user_id: string | null
  api_key_id: string | null
  channel: string
  request_id: string | null
  changed_columns: string[] | null
  old_row: Record<string, unknown> | null
  new_row: Record<string, unknown> | null
}

interface SiblingRow {
  id: number
  table_name: string
  op: ChangeLogOp
  row_pk: Record<string, unknown> | null
}

function JsonBlock({ label, value }: { label: string; value: unknown }) {
  const json = previewJson(value)
  if (!json) return null
  return (
    <div>
      <h2 className="text-sm font-medium text-gray-700 mb-2">{label}</h2>
      <pre className="text-xs text-gray-700 bg-gray-50 border border-gray-200 rounded-lg p-3 whitespace-pre-wrap break-all max-h-[32rem] overflow-auto">
        {json.preview}
      </pre>
      {json.truncated && (
        <details className="mt-2">
          <summary className="text-xs text-gray-500 cursor-pointer hover:text-gray-700">
            長いので先頭だけを出しています。全文を開く（{json.full.length.toLocaleString()}文字）
          </summary>
          <pre className="mt-1 text-xs text-gray-700 bg-gray-50 border border-gray-200 rounded-lg p-3 whitespace-pre-wrap break-all max-h-[48rem] overflow-auto">
            {json.full}
          </pre>
        </details>
      )}
    </div>
  )
}

export default async function AdminChangeLogDetailPage({ params }: { params: Promise<{ id: string }> }) {
  // (panel) layout でも門番を通しているが、service role でデータを取るページなので
  // データ取得の直前でも確認する（Next.js の推奨: 認可はデータ源の近くで）。
  const currentUserId = await verifySuperadmin()
  if (!currentUserId) redirect('/admin/login')

  const { id: rawId } = await params
  const id = parseChangeLogId(rawId)
  if (id === null) notFound()

  const admin = createAdminClient({ channel: 'admin' })
  const { data, error } = await admin.from('change_log').select('*').eq('id', id).maybeSingle()
  if (error) console.error('[admin/change-log/[id]] change_log query error:', error.message)
  if (!data) notFound()
  const row = data as ChangeLogDetail

  // 同じ操作でまとめて起きた変更・操作した人・組織の名前を並べて引く
  const [siblingsResult, actorResult, orgResult] = await Promise.all([
    admin
      .from('change_log')
      .select('id, table_name, op, row_pk')
      .eq('txid', row.txid)
      .neq('id', row.id)
      .order('id', { ascending: true })
      .limit(50),
    row.actor_user_id
      ? admin.from('profiles').select('display_name').eq('id', row.actor_user_id).maybeSingle()
      : Promise.resolve({ data: null }),
    row.org_id
      ? admin.from('organizations').select('name').eq('id', row.org_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ])
  const siblings = (siblingsResult.data ?? []) as SiblingRow[]
  const actorName = (actorResult.data as { display_name: string | null } | null)?.display_name ?? null
  const orgName = (orgResult.data as { name: string } | null)?.name ?? null

  const facts: Array<[string, React.ReactNode]> = [
    ['時刻', new Date(row.occurred_at).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })],
    ['操作', opLabel(row.op)],
    ['表', row.table_name],
    ['行の ID', rowIdOf(row.row_pk)],
    ['組織', row.org_id ? `${orgName ?? '-'}（${row.org_id}）` : '-'],
    ['プロジェクト', row.space_id ?? '-'],
    [
      '操作した人',
      row.actor_user_id ? `${actorName ?? '-'}（${row.actor_user_id}）・${actorKindLabel(row.actor_kind)}` : actorKindLabel(row.actor_kind),
    ],
    ['APIキー', row.api_key_id ?? '-'],
    ['経路', channelLabel(row.channel)],
    ['リクエスト ID', row.request_id ?? '-'],
    ['取引番号', String(row.txid)],
    ['変わった列', row.changed_columns && row.changed_columns.length > 0 ? row.changed_columns.join(', ') : '-'],
  ]

  const rowId = typeof row.row_pk?.id === 'string' ? row.row_pk.id : undefined

  return (
    <div className="p-6 max-w-5xl">
      <AdminPageHeader
        title={`変更履歴 #${row.id}`}
        description="1件の変更の詳細。秘密の列は記録の時点で伏せてある"
        actions={
          <Link href="/admin/change-log" className="text-xs text-gray-500 hover:text-gray-700">
            一覧へ戻る
          </Link>
        }
      />

      <div className="bg-surface border border-gray-200 rounded-xl p-5 mb-6">
        <dl className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-2 text-sm">
          {facts.map(([label, value]) => (
            <div key={label} className="flex gap-3">
              <dt className="w-28 shrink-0 text-gray-500">{label}</dt>
              <dd className="text-gray-900 break-all">{value}</dd>
            </div>
          ))}
        </dl>
        {rowId && (
          <Link
            href={`/admin/change-log?table=${encodeURIComponent(row.table_name)}&row=${encodeURIComponent(rowId)}`}
            className="mt-4 inline-block text-xs text-indigo-ink hover:underline"
          >
            この行の変更履歴をすべて見る
          </Link>
        )}
      </div>

      <div className="space-y-6">
        <JsonBlock label="変更前" value={row.old_row} />
        <JsonBlock label="変更後" value={row.new_row} />

        {siblings.length > 0 && (
          <div>
            <h2 className="text-sm font-medium text-gray-700 mb-2">同じ操作でまとめて起きた変更（{siblings.length}件）</h2>
            <ul className="bg-surface border border-gray-200 rounded-xl divide-y divide-gray-100 text-xs">
              {siblings.map((s) => (
                <li key={s.id} className="px-4 py-2 flex gap-3">
                  <Link href={`/admin/change-log/${s.id}`} className="text-indigo-ink hover:underline">
                    #{s.id}
                  </Link>
                  <span className="text-gray-700">{opLabel(s.op)}</span>
                  <span className="text-gray-700">{s.table_name}</span>
                  <span className="text-gray-500 break-all">{rowIdOf(s.row_pk)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  )
}
