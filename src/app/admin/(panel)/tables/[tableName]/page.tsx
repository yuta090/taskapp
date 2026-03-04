'use client'

import { useEffect, useState, useCallback } from 'react'
import { useParams } from 'next/navigation'
import { AdminPageHeader } from '@/components/admin/AdminPageHeader'
import { AdminDataTable, type ColumnDef } from '@/components/admin/AdminDataTable'
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

  const [data, setData] = useState<Row[]>([])
  const [columns, setColumns] = useState<ColumnDef<Row>[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)

  const handlePageChange = useCallback((newPage: number) => {
    setLoading(true)
    setPage(newPage)
  }, [])

  useEffect(() => {
    let cancelled = false

    async function load() {
      if (!isAllowedTable(tableName)) return

      const supabase = createClient()
      const from = (page - 1) * PAGE_SIZE
      const to = from + PAGE_SIZE - 1

      const { data: rows, count, error } = await (supabase as SupabaseClient)
        .from(tableName)
        .select('*', { count: 'exact' })
        .range(from, to)
        .order('created_at', { ascending: false })

      if (cancelled) return

      if (!error && rows) {
        setData(rows as Row[])
        setTotal(count ?? 0)

        if (rows.length > 0) {
          const keys = Object.keys(rows[0] as Record<string, unknown>)
          setColumns(keys.map((key) => ({
            key,
            label: key,
            width: key === 'id' ? '280px' : undefined,
          })))
        }
      }

      if (!cancelled) setLoading(false)
    }

    load()

    return () => { cancelled = true }
  }, [tableName, page])

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

      <AdminDataTable
        columns={columns}
        data={data}
        total={total}
        page={page}
        pageSize={PAGE_SIZE}
        onPageChange={handlePageChange}
        searchValue={search}
        onSearchChange={setSearch}
        loading={loading}
      />
    </div>
  )
}
