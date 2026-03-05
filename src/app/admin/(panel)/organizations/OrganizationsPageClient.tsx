'use client'

import { useState, useMemo, useCallback } from 'react'
import { AdminPageHeader } from '@/components/admin/AdminPageHeader'
import { AdminBadge } from '@/components/admin/AdminBadge'
import { AdminDataTable, type ColumnDef, matchesSearch, getNestedValue, compareValues } from '@/components/admin/AdminDataTable'
import { AdminFilterBar, type FilterDef } from '@/components/admin/AdminFilterBar'

export interface OrgRow {
  [key: string]: unknown
  id: string
  name: string
  member_count: number
  space_count: number
  plan: string
  status: string
  created_at: string
}

const FILTERS: FilterDef[] = [
  {
    key: 'plan',
    label: 'プラン',
    options: [
      { label: 'free', value: 'free' },
      { label: 'pro', value: 'pro' },
      { label: 'enterprise', value: 'enterprise' },
    ],
  },
  {
    key: 'status',
    label: 'ステータス',
    options: [
      { label: 'active', value: 'active' },
      { label: 'trialing', value: 'trialing' },
      { label: 'past_due', value: 'past_due' },
      { label: 'canceled', value: 'canceled' },
    ],
  },
]

function statusVariant(status: string) {
  if (status === 'active') return 'success' as const
  if (status === 'trialing') return 'info' as const
  if (status === 'past_due') return 'danger' as const
  return 'default' as const
}

const COLUMNS: ColumnDef<OrgRow>[] = [
  {
    key: 'name',
    label: '組織名',
    sortable: true,
    render: (_value, row) => <span className="font-medium text-gray-900">{row.name}</span>,
  },
  { key: 'member_count', label: 'メンバー', sortable: true },
  { key: 'space_count', label: 'スペース', sortable: true },
  {
    key: 'plan',
    label: 'プラン',
    sortable: true,
    render: (_value, row) => <AdminBadge variant="default">{row.plan}</AdminBadge>,
  },
  {
    key: 'status',
    label: 'ステータス',
    sortable: true,
    render: (_value, row) =>
      row.status ? (
        <AdminBadge variant={statusVariant(row.status)}>{row.status}</AdminBadge>
      ) : (
        <span className="text-gray-400">-</span>
      ),
  },
  { key: 'created_at', label: '作成日', sortable: true },
]

interface Props {
  initialData: OrgRow[]
}

export default function OrganizationsPageClient({ initialData }: Props) {
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
    const planFilter = activeFilters.plan
    if (planFilter) {
      result = result.filter((r) => r.plan === planFilter)
    }
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
      <AdminPageHeader title="組織管理" description={`${filtered.length} 組織`} />

      <AdminFilterBar
        filters={FILTERS}
        activeFilters={activeFilters}
        onFilterChange={handleFilterChange}
      />

      <AdminDataTable<OrgRow>
        columns={COLUMNS}
        data={paged}
        total={sorted.length}
        page={page}
        pageSize={pageSize}
        onPageChange={setPage}
        onPageSizeChange={handlePageSizeChange}
        searchValue={search}
        onSearchChange={handleSearchChange}
        searchPlaceholder="組織名・プランで検索..."
        loading={false}
        tableName="organizations"
        emptyMessage="組織が見つかりません"
        sortKey={sortKey}
        sortDirection={sortDir}
        onSortChange={handleSortChange}
        allData={sorted}
      />
    </div>
  )
}
