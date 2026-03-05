'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { SupabaseClient } from '@supabase/supabase-js'
import { AdminPageHeader } from '@/components/admin/AdminPageHeader'
import { AdminBadge } from '@/components/admin/AdminBadge'
import { AdminDataTable, type ColumnDef, matchesSearch, getNestedValue, compareValues } from '@/components/admin/AdminDataTable'
import { AdminFilterBar, type FilterDef } from '@/components/admin/AdminFilterBar'

interface SpaceRow {
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

export default function AdminSpacesPage() {
  const [data, setData] = useState<SpaceRow[]>([])
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

      const [spacesResult, orgsResult, tasksResult, membersResult] =
        await Promise.all([
          supabase
            .from('spaces')
            .select('id, org_id, name, type, archived_at, created_at')
            .order('created_at', { ascending: false }),
          supabase.from('organizations').select('id, name'),
          supabase.from('tasks').select('space_id'),
          supabase.from('space_memberships').select('space_id'),
        ])

      if (cancelled) return

      const queryError = spacesResult.error ?? orgsResult.error ?? tasksResult.error ?? membersResult.error
      if (queryError) {
        setError(queryError.message)
        setLoading(false)
        return
      }

      const orgMap = new Map<string, string>()
      if (orgsResult.data) {
        for (const o of orgsResult.data) {
          const rec = o as Record<string, unknown>
          orgMap.set(rec.id as string, rec.name as string)
        }
      }

      const taskCountMap = new Map<string, number>()
      if (tasksResult.data) {
        for (const t of tasksResult.data) {
          const rec = t as Record<string, unknown>
          const spaceId = rec.space_id as string
          taskCountMap.set(spaceId, (taskCountMap.get(spaceId) ?? 0) + 1)
        }
      }

      const memberCountMap = new Map<string, number>()
      if (membersResult.data) {
        for (const m of membersResult.data) {
          const rec = m as Record<string, unknown>
          const spaceId = rec.space_id as string
          memberCountMap.set(spaceId, (memberCountMap.get(spaceId) ?? 0) + 1)
        }
      }

      const rows: SpaceRow[] = (spacesResult.data ?? []).map((s) => {
        const space = s as Record<string, unknown>
        return {
          id: space.id as string,
          name: space.name as string,
          org_name: orgMap.get(space.org_id as string) ?? '-',
          type: space.type as string,
          member_count: memberCountMap.get(space.id as string) ?? 0,
          task_count: taskCountMap.get(space.id as string) ?? 0,
          status: space.archived_at ? 'archived' : 'active',
          created_at: space.created_at as string,
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
      <AdminPageHeader
        title="スペース管理"
        description={`${filtered.length} スペース`}
      />

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
        loading={loading}
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
