'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { SupabaseClient } from '@supabase/supabase-js'
import { AdminPageHeader } from '@/components/admin/AdminPageHeader'
import { AdminBadge } from '@/components/admin/AdminBadge'
import { AdminDataTable, type ColumnDef, matchesSearch, getNestedValue, compareValues } from '@/components/admin/AdminDataTable'
import { AdminFilterBar, type FilterDef } from '@/components/admin/AdminFilterBar'

interface OrgRow {
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

export default function AdminOrganizationsPage() {
  const [data, setData] = useState<OrgRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
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

  useEffect(() => {
    let cancelled = false

    async function fetchData() {
      setLoading(true)
      const supabase: SupabaseClient = createClient()

      const [orgsResult, membershipsResult, spacesResult, billingsResult] =
        await Promise.all([
          supabase
            .from('organizations')
            .select('id, name, created_at')
            .order('created_at', { ascending: false }),
          supabase.from('org_memberships').select('org_id'),
          supabase.from('spaces').select('org_id').is('archived_at', null),
          supabase.from('org_billing').select('org_id, plan_id, status'),
        ])

      if (cancelled) return

      const queryError = orgsResult.error ?? membershipsResult.error ?? spacesResult.error ?? billingsResult.error
      if (queryError) {
        setError(queryError.message)
        setLoading(false)
        return
      }

      const memberCountMap = new Map<string, number>()
      const spaceCountMap = new Map<string, number>()
      const billingMap = new Map<string, { plan_id: string; status: string }>()

      if (membershipsResult.data) {
        for (const m of membershipsResult.data) {
          const rec = m as Record<string, unknown>
          const orgId = rec.org_id as string
          memberCountMap.set(orgId, (memberCountMap.get(orgId) ?? 0) + 1)
        }
      }
      if (spacesResult.data) {
        for (const s of spacesResult.data) {
          const rec = s as Record<string, unknown>
          const orgId = rec.org_id as string
          spaceCountMap.set(orgId, (spaceCountMap.get(orgId) ?? 0) + 1)
        }
      }
      if (billingsResult.data) {
        for (const b of billingsResult.data) {
          const rec = b as Record<string, unknown>
          billingMap.set(rec.org_id as string, {
            plan_id: rec.plan_id as string,
            status: rec.status as string,
          })
        }
      }

      const rows: OrgRow[] = (orgsResult.data ?? []).map((o) => {
        const org = o as Record<string, unknown>
        const billing = billingMap.get(org.id as string)
        return {
          id: org.id as string,
          name: org.name as string,
          member_count: memberCountMap.get(org.id as string) ?? 0,
          space_count: spaceCountMap.get(org.id as string) ?? 0,
          plan: billing?.plan_id ?? 'free',
          status: billing?.status ?? '',
          created_at: org.created_at as string,
        }
      })

      if (!cancelled) {
        setData(rows)
        setLoading(false)
      }
    }

    fetchData()
    return () => {
      cancelled = true
    }
  }, [])

  const filtered = useMemo(() => {
    let result = data
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
      <AdminPageHeader title="組織管理" description={`${filtered.length} 組織`} />

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          {error}
        </div>
      )}

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
        loading={loading}
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
