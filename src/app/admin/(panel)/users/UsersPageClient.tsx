'use client'

import { useState, useMemo, useCallback } from 'react'
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

const COLUMNS: ColumnDef<UserRow>[] = [
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
    key: 'is_superadmin',
    label: '管理者',
    sortable: true,
    render: (_value, row) =>
      row.is_superadmin ? (
        <AdminBadge variant="indigo">管理者</AdminBadge>
      ) : (
        <span className="text-gray-400">-</span>
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
}

export default function UsersPageClient({ initialData }: Props) {
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
        columns={COLUMNS}
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
