'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/client'
import { AdminPageHeader } from '@/components/admin/AdminPageHeader'
import { AdminBadge } from '@/components/admin/AdminBadge'
import { AdminDataTable, type ColumnDef, matchesSearch, getNestedValue, compareValues } from '@/components/admin/AdminDataTable'

interface InviteRow {
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

function computeStatus(
  acceptedAt: string | null,
  expiresAt: string,
  now: number,
): { label: string; variant: 'success' | 'danger' | 'warning' } {
  if (acceptedAt) return { label: '承認済み', variant: 'success' }
  if (new Date(expiresAt).getTime() < now) return { label: '期限切れ', variant: 'danger' }
  return { label: '未承認', variant: 'warning' }
}

export default function AdminInvitesPage() {
  const [rows, setRows] = useState<InviteRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
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

  useEffect(() => {
    let cancelled = false
    async function load() {
      const supabase = createClient()
      const client = supabase as SupabaseClient
      const now = Date.now()
      const [invitesResult, orgsResult, spacesResult] = await Promise.all([
        client.from('invites').select('id, org_id, space_id, email, role, expires_at, accepted_at, created_at').order('created_at', { ascending: false }),
        client.from('organizations').select('id, name'),
        client.from('spaces').select('id, name'),
      ])
      if (cancelled) return

      const queryError = invitesResult.error ?? orgsResult.error ?? spacesResult.error
      if (queryError) {
        setError(queryError.message)
        setLoading(false)
        return
      }

      const orgMap = new Map<string, string>()
      ;(orgsResult.data as Array<{ id: string; name: string }> | null)?.forEach((o) => orgMap.set(o.id, o.name))
      const spaceMap = new Map<string, string>()
      ;(spacesResult.data as Array<{ id: string; name: string }> | null)?.forEach((s) => spaceMap.set(s.id, s.name))

      const mapped: InviteRow[] = ((invitesResult.data as Array<{
        id: string
        org_id: string
        space_id: string
        email: string
        role: string
        expires_at: string
        accepted_at: string | null
        created_at: string
      }>) ?? []).map((inv) => {
        const status = computeStatus(inv.accepted_at, inv.expires_at, now)
        return {
          ...inv,
          orgName: orgMap.get(inv.org_id) ?? '-',
          spaceName: spaceMap.get(inv.space_id) ?? '-',
          statusLabel: status.label,
          statusVariant: status.variant,
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
  }, [rows, statusFilter, search])

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
    pending: rows.filter((r) => r.statusVariant === 'warning').length,
    expired: rows.filter((r) => r.statusVariant === 'danger').length,
    accepted: rows.filter((r) => r.statusVariant === 'success').length,
  }), [rows])

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
        loading={loading}
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
