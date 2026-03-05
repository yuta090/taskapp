'use client'

import { useState, useMemo, useCallback } from 'react'
import { AdminPageHeader } from '@/components/admin/AdminPageHeader'
import { AdminBadge } from '@/components/admin/AdminBadge'
import { AdminDataTable, type ColumnDef, matchesSearch, getNestedValue, compareValues } from '@/components/admin/AdminDataTable'

export interface ReviewRow {
  [key: string]: unknown
  id: string
  task_id: string
  space_id: string
  status: string
  created_at: string
  updated_at: string
  taskTitle: string
  spaceName: string
  approvalSummary: string
  days: number
}

type ReviewStatusFilter = '' | 'open' | 'approved' | 'changes_requested'

function statusVariant(status: string) {
  if (status === 'approved') return 'success' as const
  if (status === 'changes_requested') return 'danger' as const
  if (status === 'open') return 'warning' as const
  return 'default' as const
}

interface Props {
  initialData: ReviewRow[]
}

export default function ReviewsPageClient({ initialData }: Props) {
  const [statusFilter, setStatusFilter] = useState<ReviewStatusFilter>('')
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
      if (statusFilter && r.status !== statusFilter) return false
      return true
    })
    const query = search.trim()
    if (query) {
      result = result.filter((r) => matchesSearch(r as unknown as Record<string, unknown>, query))
    }
    return result
  }, [initialData, statusFilter, search])

  const sorted = useMemo(() => {
    if (!sortKey || !sortDir) return filtered
    const arr = [...filtered]
    arr.sort((a, b) => {
      const va = getNestedValue(a as unknown as Record<string, unknown>, sortKey)
      const vb = getNestedValue(b as unknown as Record<string, unknown>, sortKey)
      const cmp = compareValues(va, vb)
      return sortDir === 'desc' ? -cmp : cmp
    })
    return arr
  }, [filtered, sortKey, sortDir])

  const stats = useMemo(() => ({
    open: initialData.filter((r) => r.status === 'open').length,
    closed: initialData.filter((r) => r.status !== 'open').length,
  }), [initialData])

  const pagedRows = useMemo(() => {
    const start = (page - 1) * pageSize
    return sorted.slice(start, start + pageSize)
  }, [sorted, page, pageSize])

  const columns: ColumnDef<ReviewRow>[] = useMemo(() => [
    { key: 'taskTitle', label: 'タスク', sortable: true, width: '250px' },
    { key: 'spaceName', label: 'スペース', sortable: true },
    {
      key: 'status',
      label: 'ステータス',
      sortable: true,
      render: (value) => <AdminBadge variant={statusVariant(String(value))}>{String(value)}</AdminBadge>,
    },
    { key: 'approvalSummary', label: '承認状況' },
    {
      key: 'days',
      label: '経過日数',
      sortable: true,
      render: (value) => {
        const d = Number(value)
        return (
          <AdminBadge variant={d > 7 ? 'danger' : d > 3 ? 'warning' : 'default'}>
            {d}日
          </AdminBadge>
        )
      },
    },
    { key: 'created_at', label: '作成日', sortable: true },
    { key: 'updated_at', label: '更新日', sortable: true },
  ], [])

  const handleStatusChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    setStatusFilter(e.target.value as ReviewStatusFilter)
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
        title="レビュー滞留"
        description={`オープン ${stats.open} / クローズ ${stats.closed}`}
      />

      {/* Filters */}
      <div className="flex items-center gap-3 mb-4">
        <select
          value={statusFilter}
          onChange={handleStatusChange}
          className="text-sm border border-gray-300 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
        >
          <option value="">ステータス: すべて</option>
          <option value="open">Open</option>
          <option value="approved">Approved</option>
          <option value="changes_requested">Changes Requested</option>
        </select>
      </div>

      <AdminDataTable<ReviewRow>
        columns={columns}
        data={pagedRows}
        total={sorted.length}
        page={page}
        pageSize={pageSize}
        onPageChange={setPage}
        onPageSizeChange={handlePageSizeChange}
        searchValue={search}
        onSearchChange={handleSearchChange}
        searchPlaceholder="タスク名・スペース名で検索..."
        loading={false}
        emptyMessage="レビューがありません"
        tableName="reviews"
        sortKey={sortKey}
        sortDirection={sortDir}
        onSortChange={handleSortChange}
        allData={sorted}
      />
    </div>
  )
}
