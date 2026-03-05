'use client'

import { useCallback } from 'react'
import {
  CaretLeft,
  CaretRight,
  MagnifyingGlass,
  CaretUp,
  CaretDown,
  DownloadSimple,
  CaretUpDown,
} from '@phosphor-icons/react'

export interface ColumnDef<T> {
  key: string
  label: string
  render?: (value: unknown, row: T) => React.ReactNode
  width?: string
  sortable?: boolean
}

type SortDirection = 'asc' | 'desc' | null

interface AdminDataTableProps<T> {
  columns: ColumnDef<T>[]
  data: T[]
  total: number
  page: number
  pageSize: number
  onPageChange: (page: number) => void
  onPageSizeChange?: (size: number) => void
  searchValue?: string
  onSearchChange?: (value: string) => void
  loading?: boolean
  emptyMessage?: string
  tableName?: string
  sortKey?: string | null
  sortDirection?: SortDirection
  onSortChange?: (key: string, direction: SortDirection) => void
  allData?: T[]
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const PAGE_SIZE_OPTIONS = [25, 50, 100] as const

function isISODate(value: unknown): value is string {
  return typeof value === 'string' && ISO_DATE_RE.test(value)
}

function isUUID(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value)
}

function formatAutoValue(value: unknown): React.ReactNode {
  if (value == null) return <span className="text-gray-300">-</span>
  if (typeof value === 'boolean') return value ? 'true' : 'false'

  if (isISODate(value)) {
    try {
      return new Date(value).toLocaleString('ja-JP', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      })
    } catch {
      return String(value)
    }
  }

  if (typeof value === 'number') {
    return value.toLocaleString('ja-JP')
  }

  if (isUUID(value)) {
    return (
      <span title={value} className="font-mono text-xs cursor-help">
        {value.slice(0, 8)}...
      </span>
    )
  }

  if (typeof value === 'object') {
    return (
      <span className="text-xs text-gray-400 font-mono">
        {JSON.stringify(value)}
      </span>
    )
  }

  const str = String(value)
  if (str.length > 80) {
    return (
      <span title={str}>
        {str.slice(0, 80)}...
      </span>
    )
  }
  return str
}

export function getNestedValue(obj: Record<string, unknown>, key: string): unknown {
  return key.split('.').reduce<unknown>((acc, k) => {
    if (acc != null && typeof acc === 'object') return (acc as Record<string, unknown>)[k]
    return undefined
  }, obj)
}

export function compareValues(a: unknown, b: unknown): number {
  if (a == null && b == null) return 0
  if (a == null) return -1
  if (b == null) return 1

  if (typeof a === 'number' && typeof b === 'number') return a - b
  if (isISODate(a) && isISODate(b)) return a.localeCompare(b)

  return String(a).localeCompare(String(b), 'ja-JP', { sensitivity: 'base' })
}

export function matchesSearch(row: Record<string, unknown>, query: string): boolean {
  const lower = query.toLowerCase()
  for (const val of Object.values(row)) {
    if (typeof val === 'string' && val.toLowerCase().includes(lower)) return true
    if (typeof val === 'number' && String(val).includes(lower)) return true
  }
  return false
}

function generateCSV<T extends Record<string, unknown>>(
  columns: ColumnDef<T>[],
  rows: T[],
): string {
  const FORMULA_CHARS = /^[\s\u0000-\u0020]*[=+\-@\t\r]/
  const escape = (v: unknown): string => {
    const str = v == null ? '' : String(v)
    // Neutralize formula injection: prefix with apostrophe (standard spreadsheet defense)
    const safe = FORMULA_CHARS.test(str) ? `'${str}` : str
    if (safe.includes(',') || safe.includes('"') || safe.includes('\n')) {
      return `"${safe.replace(/"/g, '""')}"`
    }
    return safe
  }

  const header = columns.map((c) => escape(c.label)).join(',')
  const body = rows.map((row) =>
    columns.map((col) => escape(getNestedValue(row, col.key))).join(','),
  )
  return [header, ...body].join('\n')
}

function downloadCSV(csv: string, filename: string): void {
  const bom = '\uFEFF'
  const blob = new Blob([bom + csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${filename}.csv`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

export function AdminDataTable<T extends Record<string, unknown>>({
  columns,
  data,
  total,
  page,
  pageSize,
  onPageChange,
  onPageSizeChange,
  searchValue,
  onSearchChange,
  loading,
  emptyMessage = 'データがありません',
  tableName,
  sortKey = null,
  sortDirection = null,
  onSortChange,
  allData,
}: AdminDataTableProps<T>) {
  const handleSearchInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      onSearchChange?.(e.target.value)
    },
    [onSearchChange],
  )

  const toggleSort = useCallback((key: string) => {
    if (!onSortChange) return
    let newDir: SortDirection
    if (sortKey !== key) {
      newDir = 'asc'
    } else if (sortDirection === 'asc') {
      newDir = 'desc'
    } else if (sortDirection === 'desc') {
      newDir = null
    } else {
      newDir = 'asc'
    }
    onSortChange(key, newDir)
  }, [onSortChange, sortKey, sortDirection])

  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  const exportData = allData ?? data
  const handleExport = useCallback(() => {
    const filename = tableName ?? 'export'
    const csv = generateCSV(columns, exportData)
    downloadCSV(csv, filename)
  }, [columns, exportData, tableName])

  const getSortIcon = useCallback((col: ColumnDef<T>) => {
    if (!col.sortable) return null
    if (sortKey !== col.key || sortDirection === null) {
      return <CaretUpDown size={14} className="text-gray-300 ml-1 inline-block" />
    }
    if (sortDirection === 'asc') {
      return <CaretUp size={14} weight="bold" className="text-indigo-500 ml-1 inline-block" />
    }
    return <CaretDown size={14} weight="bold" className="text-indigo-500 ml-1 inline-block" />
  }, [sortKey, sortDirection])

  return (
    <div>
      {/* Toolbar: Search + Export */}
      <div className="mb-4 flex items-center gap-3">
        {onSearchChange && (
          <div className="relative flex-1 max-w-sm">
            <MagnifyingGlass size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={searchValue ?? ''}
              onChange={handleSearchInput}
              placeholder="検索..."
              className="w-full pl-9 pr-3 py-2 rounded-lg border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            />
          </div>
        )}
        <button
          type="button"
          onClick={handleExport}
          className="inline-flex items-center gap-1.5 px-3 py-2 text-sm text-gray-600 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
        >
          <DownloadSimple size={16} />
          CSV
        </button>
      </div>

      {/* Table */}
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="overflow-x-auto max-h-[70vh] overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10">
              <tr className="bg-gray-50 border-b border-gray-200">
                {columns.map((col) => (
                  <th
                    key={col.key}
                    className={`text-left px-4 py-2.5 text-xs font-medium text-gray-500 uppercase tracking-wide${
                      col.sortable ? ' cursor-pointer select-none hover:text-gray-700' : ''
                    }`}
                    style={col.width ? { width: col.width } : undefined}
                    onClick={col.sortable ? () => toggleSort(col.key) : undefined}
                  >
                    {col.label}
                    {getSortIcon(col)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr>
                  <td colSpan={columns.length} className="px-4 py-8 text-center text-gray-400">
                    読み込み中...
                  </td>
                </tr>
              ) : data.length === 0 ? (
                <tr>
                  <td colSpan={columns.length} className="px-4 py-8 text-center text-gray-400">
                    {emptyMessage}
                  </td>
                </tr>
              ) : (
                data.map((row, i) => (
                  <tr key={i} className="hover:bg-gray-50 transition-colors">
                    {columns.map((col) => {
                      const value = getNestedValue(row, col.key)
                      return (
                        <td key={col.key} className="px-4 py-2.5 text-gray-700">
                          {col.render ? col.render(value, row) : formatAutoValue(value)}
                        </td>
                      )
                    })}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200 bg-gray-50">
          <div className="flex items-center gap-3">
            <p className="text-xs text-gray-500">
              {total} 件中 {Math.min((page - 1) * pageSize + 1, total)}〜{Math.min(page * pageSize, total)} 件
            </p>
            {onPageSizeChange && (
              <select
                value={pageSize}
                onChange={(e) => onPageSizeChange(Number(e.target.value))}
                className="text-xs border border-gray-300 rounded px-1.5 py-1 bg-white text-gray-600 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              >
                {PAGE_SIZE_OPTIONS.map((size) => (
                  <option key={size} value={size}>
                    {size}件
                  </option>
                ))}
              </select>
            )}
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => onPageChange(page - 1)}
              disabled={page <= 1}
              className="p-1.5 rounded hover:bg-gray-200 disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <CaretLeft size={16} />
            </button>
            <span className="text-xs text-gray-600 px-2">
              {page} / {totalPages}
            </span>
            <button
              onClick={() => onPageChange(page + 1)}
              disabled={page >= totalPages}
              className="p-1.5 rounded hover:bg-gray-200 disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <CaretRight size={16} />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
