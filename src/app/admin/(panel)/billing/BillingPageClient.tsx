'use client'

import { useState, useMemo, useCallback } from 'react'
import { AdminPageHeader } from '@/components/admin/AdminPageHeader'
import { AdminBadge } from '@/components/admin/AdminBadge'
import { AdminStatCard } from '@/components/admin/AdminStatCard'
import { AdminDataTable, type ColumnDef, matchesSearch, getNestedValue, compareValues } from '@/components/admin/AdminDataTable'

export interface BillingRow {
  [key: string]: unknown
  org_id: string
  plan_id: string
  status: string
  stripe_customer_id: string | null
  stripe_subscription_id: string | null
  current_period_end: string | null
  cancel_at_period_end: boolean
  created_at: string
  orgName: string
  planName: string
}

function statusVariant(status: string) {
  if (status === 'active') return 'success' as const
  if (status === 'trialing') return 'info' as const
  if (status === 'past_due') return 'danger' as const
  return 'default' as const
}

interface Props {
  initialData: BillingRow[]
}

export default function BillingPageClient({ initialData }: Props) {
  const [statusFilter, setStatusFilter] = useState('')
  const [planFilter, setPlanFilter] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)
  const [sortKey, setSortKey] = useState<string | null>(null)
  const [sortDir, setSortDir] = useState<'asc' | 'desc' | null>(null)

  const handleSortChange = useCallback((key: string, dir: 'asc' | 'desc' | null) => {
    setSortKey(key)
    setSortDir(dir)
  }, [])

  const planNames = useMemo(() => {
    const names = new Set<string>()
    for (const r of initialData) names.add(r.planName)
    return Array.from(names).sort()
  }, [initialData])

  const filtered = useMemo(() => {
    let result = initialData.filter((r) => {
      if (statusFilter && r.status !== statusFilter) return false
      if (planFilter && r.planName !== planFilter) return false
      return true
    })
    const query = search.trim()
    if (query) {
      result = result.filter((r) => matchesSearch(r, query))
    }
    return result
  }, [initialData, statusFilter, planFilter, search])

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
    active: initialData.filter((r) => r.status === 'active').length,
    trialing: initialData.filter((r) => r.status === 'trialing').length,
    pastDue: initialData.filter((r) => r.status === 'past_due').length,
    canceled: initialData.filter((r) => r.status === 'canceled').length,
  }), [initialData])

  const pagedRows = useMemo(() => {
    const start = (page - 1) * pageSize
    return sorted.slice(start, start + pageSize)
  }, [sorted, page, pageSize])

  const columns: ColumnDef<BillingRow>[] = useMemo(() => [
    { key: 'orgName', label: '組織', sortable: true },
    {
      key: 'planName',
      label: 'プラン',
      sortable: true,
      render: (value) => <AdminBadge variant="default">{String(value)}</AdminBadge>,
    },
    {
      key: 'status',
      label: 'ステータス',
      sortable: true,
      render: (value) => <AdminBadge variant={statusVariant(String(value))}>{String(value)}</AdminBadge>,
    },
    {
      key: 'stripe_customer_id',
      label: 'Stripe',
      render: (value) => {
        if (!value) return <span className="text-gray-300">-</span>
        const str = String(value)
        return <span className="font-mono text-xs">{str.slice(0, 16)}...</span>
      },
    },
    { key: 'current_period_end', label: '期間終了', sortable: true },
    {
      key: 'cancel_at_period_end',
      label: 'キャンセル予定',
      render: (value) => (value ? <AdminBadge variant="warning">予定</AdminBadge> : <span className="text-gray-300">-</span>),
    },
  ], [])

  const handleStatusChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    setStatusFilter(e.target.value)
    setPage(1)
  }, [])

  const handlePlanChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    setPlanFilter(e.target.value)
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
        title="課金状況"
        description="組織の課金・プラン状態"
      />

      <div className="grid grid-cols-4 gap-4 mb-6">
        <AdminStatCard label="アクティブ" value={stats.active} />
        <AdminStatCard label="トライアル" value={stats.trialing} />
        <AdminStatCard label="支払い遅延" value={stats.pastDue} />
        <AdminStatCard label="キャンセル済み" value={stats.canceled} />
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 mb-4">
        <select
          value={statusFilter}
          onChange={handleStatusChange}
          className="text-sm border border-gray-300 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
        >
          <option value="">ステータス: すべて</option>
          <option value="active">Active</option>
          <option value="trialing">Trialing</option>
          <option value="past_due">Past Due</option>
          <option value="canceled">Canceled</option>
        </select>
        <select
          value={planFilter}
          onChange={handlePlanChange}
          className="text-sm border border-gray-300 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
        >
          <option value="">プラン: すべて</option>
          {planNames.map((name) => (
            <option key={name} value={name}>{name}</option>
          ))}
        </select>
      </div>

      <AdminDataTable<BillingRow>
        columns={columns}
        data={pagedRows}
        total={sorted.length}
        page={page}
        pageSize={pageSize}
        onPageChange={setPage}
        onPageSizeChange={handlePageSizeChange}
        searchValue={search}
        onSearchChange={handleSearchChange}
        searchPlaceholder="組織名・プラン・ステータスで検索..."
        loading={false}
        emptyMessage="課金データがありません"
        tableName="billing"
        sortKey={sortKey}
        sortDirection={sortDir}
        onSortChange={handleSortChange}
        allData={sorted}
      />
    </div>
  )
}
