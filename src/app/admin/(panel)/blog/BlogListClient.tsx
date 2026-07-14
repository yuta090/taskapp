'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { AdminPageHeader } from '@/components/admin/AdminPageHeader'
import { AdminBadge } from '@/components/admin/AdminBadge'
import {
  AdminDataTable,
  type ColumnDef,
  matchesSearch,
  getNestedValue,
  compareValues,
} from '@/components/admin/AdminDataTable'

export interface BlogRow {
  [key: string]: unknown
  id: string
  slug: string
  title: string
  status: 'draft' | 'published' | 'archived'
  published_at: string | null
  updated_at: string
  noindex: boolean
}

const STATUS_LABEL: Record<string, string> = {
  draft: '下書き',
  published: '公開',
  archived: 'アーカイブ',
}
function statusVariant(s: string): 'default' | 'success' | 'warning' {
  if (s === 'published') return 'success'
  if (s === 'archived') return 'warning'
  return 'default'
}

export default function BlogListClient({ initialData }: { initialData: BlogRow[] }) {
  const [rows] = useState<BlogRow[]>(initialData)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)
  const [sortKey, setSortKey] = useState<string | undefined>('updated_at')
  const [sortDir, setSortDir] = useState<'asc' | 'desc' | null>('desc')

  const columns: ColumnDef<BlogRow>[] = useMemo(
    () => [
      { key: 'title', label: 'タイトル', sortable: true, width: '280px' },
      { key: 'slug', label: 'slug', sortable: true, width: '200px' },
      {
        key: 'status',
        label: 'ステータス',
        sortable: true,
        render: (v) => (
          <AdminBadge variant={statusVariant(String(v))}>
            {STATUS_LABEL[String(v)] ?? String(v)}
          </AdminBadge>
        ),
      },
      {
        key: 'noindex',
        label: 'noindex',
        render: (v) => (v ? <AdminBadge variant="warning">noindex</AdminBadge> : null),
      },
      { key: 'published_at', label: '公開日', sortable: true },
      { key: 'updated_at', label: '更新日', sortable: true },
      {
        key: 'id',
        label: '',
        width: '72px',
        render: (v) => (
          <Link
            href={`/admin/blog/${String(v)}`}
            className="text-indigo-600 hover:text-indigo-800 text-sm"
          >
            編集
          </Link>
        ),
      },
    ],
    []
  )

  const filtered = useMemo(() => {
    const q = search.trim()
    const matched = q ? rows.filter((r) => matchesSearch(r, q)) : rows
    if (!sortKey || !sortDir) return matched
    return [...matched].sort((a, b) => {
      const cmp = compareValues(getNestedValue(a, sortKey), getNestedValue(b, sortKey))
      return sortDir === 'asc' ? cmp : -cmp
    })
  }, [rows, search, sortKey, sortDir])

  const paged = useMemo(
    () => filtered.slice((page - 1) * pageSize, page * pageSize),
    [filtered, page, pageSize]
  )

  return (
    <div className="p-6 max-w-6xl">
      <AdminPageHeader
        title="ブログ"
        description="SEO記事の作成・編集・公開。CTAは記事ごとに差し替えできます。"
        actions={
          <div className="flex gap-2">
            <Link
              href="/admin/blog/cta"
              className="px-3 py-1.5 text-sm rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50"
            >
              CTA管理
            </Link>
            <Link
              href="/admin/blog/new"
              className="px-3 py-1.5 text-sm rounded-lg bg-indigo-600 text-white hover:bg-indigo-700"
            >
              新規作成
            </Link>
          </div>
        }
      />

      <AdminDataTable<BlogRow>
        columns={columns}
        data={paged}
        total={filtered.length}
        page={page}
        pageSize={pageSize}
        onPageChange={setPage}
        onPageSizeChange={(s) => {
          setPageSize(s)
          setPage(1)
        }}
        searchValue={search}
        onSearchChange={(v) => {
          setSearch(v)
          setPage(1)
        }}
        searchPlaceholder="タイトル・slugで検索..."
        emptyMessage="記事がありません。「新規作成」から始めてください。"
        tableName="blog_posts"
        sortKey={sortKey}
        sortDirection={sortDir}
        onSortChange={(key, dir) => {
          setSortKey(dir ? key : undefined)
          setSortDir(dir)
        }}
        allData={filtered}
      />
    </div>
  )
}
