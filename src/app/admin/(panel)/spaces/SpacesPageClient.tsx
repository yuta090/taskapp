'use client'

import { useState, useMemo, useCallback } from 'react'
import { AdminPageHeader } from '@/components/admin/AdminPageHeader'
import { AdminBadge } from '@/components/admin/AdminBadge'
import { AdminDataTable, type ColumnDef, matchesSearch, getNestedValue, compareValues } from '@/components/admin/AdminDataTable'
import { AdminFilterBar, type FilterDef } from '@/components/admin/AdminFilterBar'

export interface SpaceRow {
  [key: string]: unknown
  id: string
  name: string
  org_name: string
  type: string
  member_count: number
  task_count: number
  status: string
  created_at: string
}

const FILTERS: FilterDef[] = [
  {
    key: 'status',
    label: 'ステータス',
    options: [
      { label: 'アクティブ', value: 'active' },
      { label: 'アーカイブ', value: 'archived' },
    ],
  },
]

const COLUMNS: ColumnDef<SpaceRow>[] = [
  {
    key: 'name',
    label: 'スペース名',
    sortable: true,
    render: (_value, row) => <span className="font-medium text-gray-900">{row.name}</span>,
  },
  { key: 'org_name', label: '組織', sortable: true },
  {
    key: 'type',
    label: 'タイプ',
    sortable: true,
    render: (_value, row) => (
      <AdminBadge variant={row.type === 'project' ? 'info' : 'default'}>{row.type}</AdminBadge>
    ),
  },
  { key: 'member_count', label: 'メンバー', sortable: true },
  { key: 'task_count', label: 'タスク', sortable: true },
  {
    key: 'status',
    label: 'ステータス',
    sortable: true,
    render: (_value, row) =>
      row.status === 'active' ? (
        <AdminBadge variant="success">アクティブ</AdminBadge>
      ) : (
        <AdminBadge variant="default">アーカイブ</AdminBadge>
      ),
  },
  { key: 'created_at', label: '作成日', sortable: true },
]

interface Props {
  initialData: SpaceRow[]
}

export default function SpacesPageClient({ initialData }: Props) {
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
    let result = initialData
    const statusFilter = activeFilters.status
    if (statusFilter) {
      result = result.filter((r) => r.status === statusFilter)
    }
    const query = search.trim()
    if (query) {
      result = result.filter((r) => matchesSearch(r, query))
    }
    return result
  }, [initialData, activeFilters, search])

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
        title="スペース管理"
        description={`${filtered.length} スペース`}
      />

      <AdminFilterBar
        filters={FILTERS}
        activeFilters={activeFilters}
        onFilterChange={handleFilterChange}
      />

      <AdminDataTable<SpaceRow>
        columns={COLUMNS}
        data={paged}
        total={sorted.length}
        page={page}
        pageSize={pageSize}
        onPageChange={setPage}
        onPageSizeChange={handlePageSizeChange}
        searchValue={search}
        onSearchChange={handleSearchChange}
        searchPlaceholder="スペース名・組織名で検索..."
        loading={false}
        tableName="spaces"
        emptyMessage="スペースが見つかりません"
        sortKey={sortKey}
        sortDirection={sortDir}
        onSortChange={handleSortChange}
        allData={sorted}
      />
    </div>
  )
}
