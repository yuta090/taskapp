'use client'

import { useState, useMemo, useCallback, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { AdminPageHeader } from '@/components/admin/AdminPageHeader'
import { AdminBadge } from '@/components/admin/AdminBadge'
import { AdminDataTable, type ColumnDef, matchesSearch, getNestedValue, compareValues } from '@/components/admin/AdminDataTable'
import { AdminFilterBar, type FilterDef } from '@/components/admin/AdminFilterBar'
import Link from 'next/link'

export interface UserRow {
  [key: string]: unknown
  id: string
  display_name: string | null
  email: string
  is_superadmin: boolean
  memberships_count: number
  created_at: string
}

const FILTERS: FilterDef[] = [
  {
    key: 'superadmin',
    label: '権限',
    options: [
      { label: '管理者のみ', value: 'admin' },
      { label: '一般のみ', value: 'normal' },
    ],
  },
]

const BASE_COLUMNS: ColumnDef<UserRow>[] = [
  {
    key: 'display_name',
    label: '名前',
    sortable: true,
    render: (_value, row) => (
      <div className="flex items-center gap-2">
        <span className="font-medium text-gray-900">{row.display_name || '(未設定)'}</span>
        {row.is_superadmin && <AdminBadge variant="indigo">Admin</AdminBadge>}
      </div>
    ),
  },
  {
    key: 'email',
    label: 'メール',
    sortable: true,
    render: (value) => {
      const email = String(value)
      if (!email) return <span className="text-gray-300">-</span>
      return <span className="text-sm text-gray-600">{email}</span>
    },
  },
  {
    key: 'id',
    label: 'ユーザーID',
    sortable: true,
    render: (value) => (
      <span className="font-mono text-xs text-gray-600" title={String(value)}>
        {String(value).slice(0, 8)}...
      </span>
    ),
  },
  {
    key: 'memberships_count',
    label: '組織数',
    sortable: true,
  },
  {
    key: 'created_at',
    label: '登録日',
    sortable: true,
  },
]

interface Props {
  initialData: UserRow[]
  /** ログイン中の運営の user id。自分の行には剥奪ボタンを出さない（API 側でも拒否する） */
  currentUserId: string
}

/**
 * 運営（superadmin）の付与・剥奪。
 *
 * profiles.is_superadmin は DB トリガーで service role 限定にしたので、運営を後から
 * 増やす／外す正規の経路は PATCH /api/admin/users だけ。押した瞬間に表示を変え（楽観更新・
 * 保存ボタン無し）、失敗したら元に戻す。自分自身は外せない（運営 0 人を防ぐ）。
 */
function useSuperadminToggle(initialData: UserRow[]) {
  const router = useRouter()
  const [overrides, setOverrides] = useState<Record<string, boolean>>({})
  const [pending, setPending] = useState<Record<string, boolean>>({})

  // サーバーから取り直した一覧（router.refresh 後）が来たら、楽観更新の上書きは捨てて
  // サーバーの値を正とする（別の運営が同時に変えていた場合に古い表示が残らないように）
  useEffect(() => {
    setOverrides({})
  }, [initialData])

  const rows = useMemo(
    () => initialData.map((r) => (r.id in overrides ? { ...r, is_superadmin: overrides[r.id] } : r)),
    [initialData, overrides],
  )

  const toggle = useCallback(
    async (row: UserRow) => {
      const next = !row.is_superadmin
      const label = row.display_name || row.email || row.id
      const ok = window.confirm(
        next
          ? `${label} を管理者にします。運営パネルの全機能にアクセスできるようになります。よろしいですか？`
          : `${label} の管理者権限を外します。よろしいですか？`,
      )
      if (!ok) return
      setOverrides((prev) => ({ ...prev, [row.id]: next }))
      setPending((prev) => ({ ...prev, [row.id]: true }))
      try {
        const res = await fetch('/api/admin/users', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: row.id, isSuperadmin: next }),
        })
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string }
          throw new Error(body.error || `HTTP ${res.status}`)
        }
        router.refresh()
      } catch (e) {
        setOverrides((prev) => ({ ...prev, [row.id]: row.is_superadmin }))
        window.alert(`管理者権限の変更に失敗しました: ${e instanceof Error ? e.message : String(e)}`)
      } finally {
        setPending((prev) => ({ ...prev, [row.id]: false }))
      }
    },
    [router],
  )

  return { rows, toggle, pending }
}

interface SuperadminCellProps {
  row: UserRow
  isSelf: boolean
  busy: boolean
  onToggle: (row: UserRow) => void
}

function SuperadminCell({ row, isSelf, busy, onToggle }: SuperadminCellProps) {
  return (
    <div className="flex items-center gap-2">
      {row.is_superadmin ? (
        <AdminBadge variant="indigo">管理者</AdminBadge>
      ) : (
        <span className="text-gray-400">-</span>
      )}
      {!isSelf && (
        <button
          type="button"
          disabled={busy}
          onClick={() => onToggle(row)}
          className={
            row.is_superadmin
              ? 'text-xs text-red-600 hover:text-red-700 hover:underline disabled:opacity-50'
              : 'text-xs text-indigo-600 hover:text-indigo-700 hover:underline disabled:opacity-50'
          }
        >
          {row.is_superadmin ? '管理者を外す' : '管理者にする'}
        </button>
      )}
    </div>
  )
}

/** 「管理者」列を組織数の前に差し込む（並びは従来どおり） */
function buildColumns(cell: Omit<SuperadminCellProps, 'row' | 'isSelf' | 'busy'> & {
  currentUserId: string
  pending: Record<string, boolean>
}): ColumnDef<UserRow>[] {
  const superadminCol: ColumnDef<UserRow> = {
    key: 'is_superadmin',
    label: '管理者',
    sortable: true,
    render: (_value, row) => (
      <SuperadminCell
        row={row}
        isSelf={row.id === cell.currentUserId}
        busy={!!cell.pending[row.id]}
        onToggle={cell.onToggle}
      />
    ),
  }
  const idx = BASE_COLUMNS.findIndex((c) => c.key === 'memberships_count')
  return [...BASE_COLUMNS.slice(0, idx), superadminCol, ...BASE_COLUMNS.slice(idx)]
}

export default function UsersPageClient({ initialData, currentUserId }: Props) {
  const { rows: data, toggle, pending } = useSuperadminToggle(initialData)
  const columns = useMemo(
    () => buildColumns({ currentUserId, pending, onToggle: toggle }),
    [currentUserId, pending, toggle],
  )
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)
  const [activeFilters, setActiveFilters] = useState<Record<string, string>>({})
  const [sortKey, setSortKey] = useState<string | null>(null)
  const [sortDir, setSortDir] = useState<'asc' | 'desc' | null>(null)

  const handleFilterChange = useCallback((key: string, value: string) => {
    setActiveFilters((prev) => ({ ...prev, [key]: value }))
    setPage(1)
  }, [])

  const handleSearchChange = useCallback((value: string) => {
    setSearch(value)
    setPage(1)
  }, [])

  const handlePageSizeChange = useCallback((size: number) => {
    setPageSize(size)
    setPage(1)
  }, [])

  const handleSortChange = useCallback((key: string, dir: 'asc' | 'desc' | null) => {
    setSortKey(key)
    setSortDir(dir)
  }, [])

  const filtered = useMemo(() => {
    let result = data
    const superadminFilter = activeFilters.superadmin
    if (superadminFilter === 'admin') {
      result = result.filter((r) => r.is_superadmin)
    } else if (superadminFilter === 'normal') {
      result = result.filter((r) => !r.is_superadmin)
    }
    const query = search.trim()
    if (query) {
      result = result.filter((r) => matchesSearch(r, query))
    }
    return result
  }, [data, activeFilters, search])

  const sorted = useMemo(() => {
    if (!sortKey || !sortDir) return filtered
    const arr = [...filtered]
    arr.sort((a, b) => {
      const va = getNestedValue(a, sortKey)
      const vb = getNestedValue(b, sortKey)
      const cmp = compareValues(va, vb)
      return sortDir === 'desc' ? -cmp : cmp
    })
    return arr
  }, [filtered, sortKey, sortDir])

  const paged = useMemo(() => {
    const start = (page - 1) * pageSize
    return sorted.slice(start, start + pageSize)
  }, [sorted, page, pageSize])

  return (
    <div className="p-6 max-w-6xl">
      <AdminPageHeader
        title="ユーザー管理"
        description={`${filtered.length} ユーザー`}
        actions={
          <Link
            href="/admin/users/create"
            className="px-3 py-1.5 bg-indigo-600 text-white text-sm rounded-lg hover:bg-indigo-700 transition-colors"
          >
            新規作成
          </Link>
        }
      />

      <AdminFilterBar
        filters={FILTERS}
        activeFilters={activeFilters}
        onFilterChange={handleFilterChange}
      />

      <AdminDataTable<UserRow>
        columns={columns}
        data={paged}
        total={sorted.length}
        page={page}
        pageSize={pageSize}
        onPageChange={setPage}
        onPageSizeChange={handlePageSizeChange}
        searchValue={search}
        onSearchChange={handleSearchChange}
        searchPlaceholder="名前・メールで検索..."
        loading={false}
        tableName="users"
        emptyMessage="ユーザーが見つかりません"
        sortKey={sortKey}
        sortDirection={sortDir}
        onSortChange={handleSortChange}
        allData={sorted}
      />
    </div>
  )
}
