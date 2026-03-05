'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/client'
import { AdminPageHeader } from '@/components/admin/AdminPageHeader'
import { AdminBadge } from '@/components/admin/AdminBadge'
import { AdminDataTable, type ColumnDef, matchesSearch, getNestedValue, compareValues } from '@/components/admin/AdminDataTable'

interface ReviewRow {
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

export default function AdminReviewsPage() {
  const [rows, setRows] = useState<ReviewRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
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

  useEffect(() => {
    let cancelled = false
    async function load() {
      const supabase = createClient()
      const client = supabase as SupabaseClient
      const now = Date.now()
      const [reviewsResult, tasksResult, spacesResult, approvalsResult] = await Promise.all([
        client.from('reviews').select('id, org_id, space_id, task_id, status, created_at, updated_at').order('created_at', { ascending: true }),
        client.from('tasks').select('id, title'),
        client.from('spaces').select('id, name'),
        client.from('review_approvals').select('review_id, state'),
      ])
      if (cancelled) return

      const queryError = reviewsResult.error ?? tasksResult.error ?? spacesResult.error ?? approvalsResult.error
      if (queryError) {
        setError(queryError.message)
        setLoading(false)
        return
      }

      const taskMap = new Map<string, string>()
      ;(tasksResult.data as Array<{ id: string; title: string }> | null)?.forEach((t) => taskMap.set(t.id, t.title))

      const spaceMap = new Map<string, string>()
      ;(spacesResult.data as Array<{ id: string; name: string }> | null)?.forEach((s) => spaceMap.set(s.id, s.name))

      const approvalMap = new Map<string, { pending: number; approved: number; blocked: number }>()
      ;(approvalsResult.data as Array<{ review_id: string; state: string }> | null)?.forEach((a) => {
        const entry = approvalMap.get(a.review_id) ?? { pending: 0, approved: 0, blocked: 0 }
        if (a.state === 'pending') entry.pending++
        else if (a.state === 'approved') entry.approved++
        else if (a.state === 'blocked') entry.blocked++
        approvalMap.set(a.review_id, entry)
      })

      const mapped: ReviewRow[] = ((reviewsResult.data as Array<{
        id: string
        org_id: string
        space_id: string
        task_id: string
        status: string
        created_at: string
        updated_at: string
      }>) ?? []).map((r) => {
        const approval = approvalMap.get(r.id)
        const summary = approval
          ? `${approval.approved}承認 / ${approval.pending}待ち / ${approval.blocked}ブロック`
          : '-'
        return {
          id: r.id,
          task_id: r.task_id,
          space_id: r.space_id,
          status: r.status,
          created_at: r.created_at,
          updated_at: r.updated_at,
          taskTitle: taskMap.get(r.task_id) ?? r.task_id.slice(0, 8),
          spaceName: spaceMap.get(r.space_id) ?? '-',
          approvalSummary: summary,
          days: Math.floor((now - new Date(r.created_at).getTime()) / 86400000),
        }
      })
      setRows(mapped)
      setLoading(false)
    }
    load()
    return () => { cancelled = true }
  }, [])

  const filtered = useMemo(() => {
    let result = rows.filter((r) => {
      if (statusFilter && r.status !== statusFilter) return false
      return true
    })
    const query = search.trim()
    if (query) {
      result = result.filter((r) => matchesSearch(r as unknown as Record<string, unknown>, query))
    }
    return result
  }, [rows, statusFilter, search])

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
    open: rows.filter((r) => r.status === 'open').length,
    closed: rows.filter((r) => r.status !== 'open').length,
  }), [rows])

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

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          {error}
        </div>
      )}

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
        loading={loading}
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
