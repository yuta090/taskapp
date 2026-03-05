'use client'

import { useState, useMemo, useCallback } from 'react'
import { AdminPageHeader } from '@/components/admin/AdminPageHeader'
import { AdminBadge } from '@/components/admin/AdminBadge'
import { AdminDataTable, type ColumnDef, matchesSearch, getNestedValue, compareValues } from '@/components/admin/AdminDataTable'

export interface InviteRow {
  [key: string]: unknown
  id: string
  org_id: string
  space_id: string
  email: string
  role: string
  expires_at: string
  accepted_at: string | null
  created_at: string
  orgName: string
  spaceName: string
  statusLabel: string
  statusVariant: 'success' | 'danger' | 'warning'
}

type InviteStatus = '' | 'pending' | 'expired' | 'accepted'

interface Props {
  initialData: InviteRow[]
}

export default function InvitesPageClient({ initialData }: Props) {
  const [statusFilter, setStatusFilter] = useState<InviteStatus>('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)
  const [sortKey, setSortKey] = useState<string | null>(null)
  const [sortDir, setSortDir] = useState<'asc' | 'desc' | null>(null)

  const handleSortChange = useCallback((key: string, dir: 'asc' | 'desc' | null) => {
    setSortKey(key)
    setSortDir(dir)
  }, [])

  const filtered = useMemo(() => {
    let result = initialData.filter((r) => {
      if (statusFilter === 'pending' && r.statusVariant !== 'warning') return false
      if (statusFilter === 'expired' && r.statusVariant !== 'danger') return false
      if (statusFilter === 'accepted' && r.statusVariant !== 'success') return false
      return true
    })
    const query = search.trim()
    if (query) {
      result = result.filter((r) => matchesSearch(r, query))
    }
    return result
  }, [initialData, statusFilter, search])

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

  const stats = useMemo(() => ({
    pending: initialData.filter((r) => r.statusVariant === 'warning').length,
    expired: initialData.filter((r) => r.statusVariant === 'danger').length,
    accepted: initialData.filter((r) => r.statusVariant === 'success').length,
  }), [initialData])

  const pagedRows = useMemo(() => {
    const start = (page - 1) * pageSize
    return sorted.slice(start, start + pageSize)
  }, [sorted, page, pageSize])

  const columns: ColumnDef<InviteRow>[] = useMemo(() => [
    { key: 'email', label: 'メール', sortable: true },
    {
      key: 'role',
      label: 'ロール',
      sortable: true,
      render: (value) => {
        const role = String(value)
        return <AdminBadge variant={role === 'client' ? 'info' : 'default'}>{role}</AdminBadge>
      },
    },
    { key: 'orgName', label: '組織', sortable: true },
    { key: 'spaceName', label: 'スペース' },
    {
      key: 'statusLabel',
      label: 'ステータス',
      sortable: true,
      render: (_value, row) => <AdminBadge variant={row.statusVariant}>{row.statusLabel}</AdminBadge>,
    },
    { key: 'expires_at', label: '有効期限', sortable: true },
    { key: 'created_at', label: '作成日', sortable: true },
  ], [])

  const handleStatusChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    setStatusFilter(e.target.value as InviteStatus)
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

  return (
    <div className="p-6 max-w-6xl">
      <AdminPageHeader
        title="招待トラッキング"
        description={`未承認 ${stats.pending} / 期限切れ ${stats.expired} / 承認済み ${stats.accepted}`}
      />

      {/* Filters */}
      <div className="flex items-center gap-3 mb-4">
        <select
          value={statusFilter}
          onChange={handleStatusChange}
          className="text-sm border border-gray-300 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
        >
          <option value="">ステータス: すべて</option>
          <option value="pending">未承認</option>
          <option value="expired">期限切れ</option>
          <option value="accepted">承認済み</option>
        </select>
      </div>

      <AdminDataTable<InviteRow>
        columns={columns}
        data={pagedRows}
        total={sorted.length}
        page={page}
        pageSize={pageSize}
        onPageChange={setPage}
        onPageSizeChange={handlePageSizeChange}
        searchValue={search}
        onSearchChange={handleSearchChange}
        searchPlaceholder="メール・組織名・スペース名で検索..."
        loading={false}
        emptyMessage="招待がありません"
        tableName="invites"
        sortKey={sortKey}
        sortDirection={sortDir}
        onSortChange={handleSortChange}
        allData={sorted}
      />
    </div>
  )
}
