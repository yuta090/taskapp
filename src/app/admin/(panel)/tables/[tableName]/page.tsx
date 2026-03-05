'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import { useParams } from 'next/navigation'
import { AdminPageHeader } from '@/components/admin/AdminPageHeader'
import { AdminDataTable, type ColumnDef, matchesSearch, getNestedValue, compareValues } from '@/components/admin/AdminDataTable'
import { isAllowedTable, TABLE_LABELS, type AllowedTable } from '@/lib/admin/table-config'
import { createClient } from '@/lib/supabase/client'
import type { SupabaseClient } from '@supabase/supabase-js'
import Link from 'next/link'
import { ArrowLeft } from '@phosphor-icons/react'

const PAGE_SIZE = 50

type Row = Record<string, unknown>

export default function AdminTableDetailPage() {
  const params = useParams()
  const tableName = params.tableName as string

  const [allRows, setAllRows] = useState<Row[]>([])
  const [columns, setColumns] = useState<ColumnDef<Row>[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [sortKey, setSortKey] = useState<string | null>(null)
  const [sortDir, setSortDir] = useState<'asc' | 'desc' | null>(null)

  const handleSortChange = useCallback((key: string, dir: 'asc' | 'desc' | null) => {
    setSortKey(key)
    setSortDir(dir)
  }, [])

  const handleSearchChange = useCallback((value: string) => {
    setSearch(value)
    setPage(1)
  }, [])

  const handlePageChange = useCallback((newPage: number) => {
    setPage(newPage)
  }, [])

  useEffect(() => {
    let cancelled = false

    async function load() {
      if (!isAllowedTable(tableName)) return

      setLoading(true)
      const supabase = createClient()

      const { data: rows, count, error: queryError } = await (supabase as SupabaseClient)
        .from(tableName)
        .select('*', { count: 'exact' })
        .order('created_at', { ascending: false })
        .limit(1000)

      if (cancelled) return

      if (queryError) {
        setError(queryError.message)
        setLoading(false)
        return
      }

      if (rows) {
        setAllRows(rows as Row[])
        setTotal(count ?? 0)

        if (rows.length > 0) {
          const keys = Object.keys(rows[0] as Record<string, unknown>)
          setColumns(keys.map((key) => ({
            key,
            label: key,
            sortable: true,
            width: key === 'id' ? '280px' : undefined,
          })))
        }
      }

      if (!cancelled) setLoading(false)
    }

    load()

    return () => { cancelled = true }
  }, [tableName])

  const filtered = useMemo(() => {
    const query = search.trim()
    if (!query) return allRows
    return allRows.filter((r) => matchesSearch(r, query))
  }, [allRows, search])

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
    const start = (page - 1) * PAGE_SIZE
    return sorted.slice(start, start + PAGE_SIZE)
  }, [sorted, page])

  if (!isAllowedTable(tableName)) {
    return (
      <div className="p-6">
        <p className="text-red-600">無効なテーブル名: {tableName}</p>
      </div>
    )
  }

  const label = TABLE_LABELS[tableName as AllowedTable]

  return (
    <div className="p-6 max-w-full">
      <div className="mb-4">
        <Link
          href="/admin/tables"
          className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700"
        >
          <ArrowLeft size={14} />
          テーブル一覧
        </Link>
      </div>

      <AdminPageHeader
        title={label}
        description={`${tableName} / ${total} 行`}
      />

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          {error}
        </div>
      )}

      <AdminDataTable
        columns={columns}
        data={paged}
        total={sorted.length}
        page={page}
        pageSize={PAGE_SIZE}
        onPageChange={handlePageChange}
        searchValue={search}
        onSearchChange={handleSearchChange}
        loading={loading}
        sortKey={sortKey}
        sortDirection={sortDir}
        onSortChange={handleSortChange}
        allData={sorted}
      />
    </div>
  )
}
