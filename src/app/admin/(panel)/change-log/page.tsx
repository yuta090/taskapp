import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createAdminClient } from '@/lib/supabase/admin'
import { verifySuperadmin } from '@/lib/admin/verify-superadmin'
import { AdminPageHeader } from '@/components/admin/AdminPageHeader'
import {
  CHANGE_LOG_PAGE_LIMIT,
  parseChangeLogFilters,
  opLabel,
  channelLabel,
  channelOptions,
  actorKindLabel,
  rowIdOf,
  type ChangeLogFilters,
  type ChangeLogOp,
} from '@/lib/change-log/adminFilters'

/**
 * データの変更の控え（change_log）を探す運営画面。
 * DB トリガーが主要な表の追加・更新・削除を全部記録している。誰が・どの経路で・何を・いつ変えたかを、
 * 表・行・人・組織・経路・操作・期間で絞って見る。秘密の列は記録の時点で伏せてある。
 */

interface ChangeLogRow {
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

async function fetchChangeLog(filters: ChangeLogFilters) {
  const admin = createAdminClient({ channel: 'admin' })

  let query = admin.from('change_log').select('*')
  if (filters.table) query = query.eq('table_name', filters.table)
  if (filters.rowId) query = query.eq('row_pk->>id', filters.rowId)
  if (filters.actorId) query = query.eq('actor_user_id', filters.actorId)
  if (filters.orgId) query = query.eq('org_id', filters.orgId)
  if (filters.channel) query = query.eq('channel', filters.channel)
  if (filters.op) query = query.eq('op', filters.op)
  if (filters.from) query = query.gte('occurred_at', filters.from)
  if (filters.to) query = query.lte('occurred_at', filters.to)

  const { data, error } = await query.order('id', { ascending: false }).limit(CHANGE_LOG_PAGE_LIMIT)
  if (error) console.error('[admin/change-log] change_log query error:', error.message)
  const rows = (data ?? []) as ChangeLogRow[]

  // 表示用に、出てきた人と組織の名前だけを引く（2本は並べて投げる）
  const actorIds = [...new Set(rows.map((r) => r.actor_user_id).filter((id): id is string => !!id))]
  const orgIds = [...new Set(rows.map((r) => r.org_id).filter((id): id is string => !!id))]
  const [profilesResult, orgsResult] = await Promise.all([
    actorIds.length > 0
      ? admin.from('profiles').select('id, display_name').in('id', actorIds)
      : Promise.resolve({ data: [] as Array<{ id: string; display_name: string | null }> }),
    orgIds.length > 0
      ? admin.from('organizations').select('id, name').in('id', orgIds)
      : Promise.resolve({ data: [] as Array<{ id: string; name: string }> }),
  ])

  const actorNames = new Map<string, string>()
  for (const p of (profilesResult.data ?? []) as Array<{ id: string; display_name: string | null }>) {
    if (p.display_name) actorNames.set(p.id, p.display_name)
  }
  const orgNames = new Map<string, string>()
  for (const o of (orgsResult.data ?? []) as Array<{ id: string; name: string }>) orgNames.set(o.id, o.name)

  return { rows, actorNames, orgNames, failed: !!error }
}

/** 今の絞り込みに1つ足した/替えた URL（行・人・組織をクリックしてその場で絞る用） */
function hrefWith(filters: Record<string, string | undefined>): string {
  const params = new URLSearchParams()
  for (const [k, v] of Object.entries(filters)) if (v) params.set(k, v)
  const qs = params.toString()
  return qs ? `/admin/change-log?${qs}` : '/admin/change-log'
}

const OP_BADGE: Record<ChangeLogOp, string> = {
  I: 'text-emerald-700 bg-emerald-50',
  U: 'text-indigo-ink bg-indigo-50',
  D: 'text-red-700 bg-red-50',
}

export default async function AdminChangeLogPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  // (panel) layout でも門番を通しているが、service role でデータを取るページなので
  // データ取得の直前でも確認する（Next.js の推奨: 認可はデータ源の近くで）。
  const currentUserId = await verifySuperadmin()
  if (!currentUserId) redirect('/admin/login')

  const raw = await searchParams
  const filters = parseChangeLogFilters(raw)
  const { rows, actorNames, orgNames, failed } = await fetchChangeLog(filters)

  // 入力欄に戻す値（URL のまま。日付は YYYY-MM-DD）
  const formValue = (key: string) => {
    const v = raw[key]
    return (Array.isArray(v) ? v[0] : v) ?? ''
  }
  const current: Record<string, string | undefined> = {
    table: filters.table,
    row: filters.rowId,
    actor: filters.actorId,
    org: filters.orgId,
    channel: filters.channel,
    op: filters.op,
    from: filters.from ? formValue('from') : undefined,
    to: filters.to ? formValue('to') : undefined,
  }
  const inputClass =
    'w-full rounded-md border border-gray-200 bg-surface px-2 py-1 text-xs text-gray-900 placeholder:text-gray-400'

  return (
    <div className="p-6 max-w-7xl">
      <AdminPageHeader
        title="変更履歴"
        description="データの追加・更新・削除の控え。誰が・どの経路で・何を・いつ変えたか（新しい順に最大100件）"
      />

      <form method="get" className="bg-surface border border-gray-200 rounded-xl p-4 mb-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <label className="text-xs text-gray-600 space-y-1">
            <span>表</span>
            <input name="table" defaultValue={formValue('table')} placeholder="wiki_pages" className={inputClass} />
          </label>
          <label className="text-xs text-gray-600 space-y-1">
            <span>行の ID</span>
            <input name="row" defaultValue={formValue('row')} placeholder="UUID" className={inputClass} />
          </label>
          <label className="text-xs text-gray-600 space-y-1">
            <span>操作した人の ID</span>
            <input name="actor" defaultValue={formValue('actor')} placeholder="UUID" className={inputClass} />
          </label>
          <label className="text-xs text-gray-600 space-y-1">
            <span>組織の ID</span>
            <input name="org" defaultValue={formValue('org')} placeholder="UUID" className={inputClass} />
          </label>
          <label className="text-xs text-gray-600 space-y-1">
            <span>経路</span>
            <select name="channel" defaultValue={filters.channel ?? ''} className={inputClass}>
              <option value="">すべて</option>
              {channelOptions().map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-gray-600 space-y-1">
            <span>操作</span>
            <select name="op" defaultValue={filters.op ?? ''} className={inputClass}>
              <option value="">すべて</option>
              <option value="I">追加</option>
              <option value="U">更新</option>
              <option value="D">削除</option>
            </select>
          </label>
          <label className="text-xs text-gray-600 space-y-1">
            <span>いつから</span>
            <input type="date" name="from" defaultValue={formValue('from')} className={inputClass} />
          </label>
          <label className="text-xs text-gray-600 space-y-1">
            <span>いつまで</span>
            <input type="date" name="to" defaultValue={formValue('to')} className={inputClass} />
          </label>
        </div>
        <div className="mt-3 flex items-center gap-3">
          <button type="submit" className="px-3 py-1.5 text-xs rounded-md bg-indigo-600 text-white hover:bg-indigo-700">
            絞り込む
          </button>
          <Link href="/admin/change-log" className="text-xs text-gray-500 hover:text-gray-700">
            条件を消す
          </Link>
        </div>
      </form>

      {failed && (
        <p className="mb-4 text-sm text-red-700">変更履歴を読み込めませんでした。サーバーの記録を確認してください。</p>
      )}

      <div className="bg-surface border border-gray-200 rounded-xl overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-200">
              <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500">時刻</th>
              <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500">操作</th>
              <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500">表 / 行</th>
              <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500">組織</th>
              <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500">操作した人</th>
              <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500">経路</th>
              <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500">変わった列 / 中身</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-gray-400">
                  条件に合う変更はありません
                </td>
              </tr>
            )}
            {rows.map((r) => {
              const rowId = rowIdOf(r.row_pk)
              const actorName = r.actor_user_id ? (actorNames.get(r.actor_user_id) ?? r.actor_user_id.slice(0, 8)) : null
              return (
                <tr key={r.id} className="border-b border-gray-100 hover:bg-gray-50 align-top">
                  <td className="px-4 py-2 text-xs text-gray-500 whitespace-nowrap">
                    {new Date(r.occurred_at).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}
                  </td>
                  <td className="px-4 py-2">
                    <span className={`inline-flex text-xs px-2 py-0.5 rounded-full ${OP_BADGE[r.op]}`}>{opLabel(r.op)}</span>
                  </td>
                  <td className="px-4 py-2 text-xs">
                    <Link href={hrefWith({ ...current, table: r.table_name })} className="text-gray-900 hover:underline">
                      {r.table_name}
                    </Link>
                    <div>
                      <Link
                        href={hrefWith({ table: r.table_name, row: typeof r.row_pk?.id === 'string' ? r.row_pk.id : undefined })}
                        className="text-gray-500 hover:underline break-all"
                        title="この行の履歴だけを見る"
                      >
                        {rowId}
                      </Link>
                    </div>
                  </td>
                  <td className="px-4 py-2 text-xs text-gray-700">
                    {r.org_id ? (
                      <Link href={hrefWith({ ...current, org: r.org_id })} className="hover:underline">
                        {orgNames.get(r.org_id) ?? r.org_id.slice(0, 8)}
                      </Link>
                    ) : (
                      '-'
                    )}
                  </td>
                  <td className="px-4 py-2 text-xs text-gray-700">
                    {actorName ? (
                      <Link href={hrefWith({ ...current, actor: r.actor_user_id! })} className="hover:underline">
                        {actorName}
                      </Link>
                    ) : (
                      <span className="text-gray-400">-</span>
                    )}
                    <div className="text-gray-400">
                      {actorKindLabel(r.actor_kind)}
                      {r.api_key_id && `（キー ${r.api_key_id.slice(0, 8)}）`}
                    </div>
                  </td>
                  <td className="px-4 py-2 text-xs text-gray-700 whitespace-nowrap">{channelLabel(r.channel)}</td>
                  <td className="px-4 py-2 text-xs text-gray-700">
                    {r.changed_columns && r.changed_columns.length > 0 && (
                      <p className="text-gray-600 break-all">{r.changed_columns.join(', ')}</p>
                    )}
                    <details>
                      <summary className="text-gray-500 cursor-pointer hover:text-gray-700">中身</summary>
                      {r.old_row && (
                        <>
                          <p className="mt-1 text-gray-500">変更前</p>
                          <pre className="text-xs text-gray-600 bg-gray-50 border border-gray-200 rounded p-2 whitespace-pre-wrap break-all max-w-md max-h-80 overflow-auto">
                            {JSON.stringify(r.old_row, null, 2)}
                          </pre>
                        </>
                      )}
                      {r.new_row && (
                        <>
                          <p className="mt-1 text-gray-500">変更後</p>
                          <pre className="text-xs text-gray-600 bg-gray-50 border border-gray-200 rounded p-2 whitespace-pre-wrap break-all max-w-md max-h-80 overflow-auto">
                            {JSON.stringify(r.new_row, null, 2)}
                          </pre>
                        </>
                      )}
                      <p className="mt-1 text-gray-400">取引番号 {r.txid}（同じ番号は1回の操作でまとめて起きた変更）</p>
                    </details>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
