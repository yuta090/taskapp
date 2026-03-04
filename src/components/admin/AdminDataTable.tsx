'use client'

import { CaretLeft, CaretRight, MagnifyingGlass } from '@phosphor-icons/react'

export interface ColumnDef<T> {
  key: string
  label: string
  render?: (value: unknown, row: T) => React.ReactNode
  width?: string
}

interface AdminDataTableProps<T> {
  columns: ColumnDef<T>[]
  data: T[]
  total: number
  page: number
  pageSize: number
  onPageChange: (page: number) => void
  searchValue?: string
  onSearchChange?: (value: string) => void
  loading?: boolean
  emptyMessage?: string
}

export function AdminDataTable<T extends Record<string, unknown>>({
  columns,
  data,
  total,
  page,
  pageSize,
  onPageChange,
  searchValue,
  onSearchChange,
  loading,
  emptyMessage = 'データがありません',
}: AdminDataTableProps<T>) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  return (
    <div>
      {/* Search */}
      {onSearchChange && (
        <div className="mb-4 relative">
          <MagnifyingGlass size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={searchValue ?? ''}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="検索..."
            className="w-full max-w-sm pl-9 pr-3 py-2 rounded-lg border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
          />
        </div>
      )}

      {/* Table */}
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                {columns.map((col) => (
                  <th
                    key={col.key}
                    className="text-left px-4 py-2.5 text-xs font-medium text-gray-500 uppercase tracking-wide"
                    style={col.width ? { width: col.width } : undefined}
                  >
                    {col.label}
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
                          {col.render ? col.render(value, row) : renderValue(value)}
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
          <p className="text-xs text-gray-500">
            {total} 件中 {Math.min((page - 1) * pageSize + 1, total)}〜{Math.min(page * pageSize, total)} 件
          </p>
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

function getNestedValue(obj: Record<string, unknown>, key: string): unknown {
  return key.split('.').reduce<unknown>((acc, k) => {
    if (acc != null && typeof acc === 'object') return (acc as Record<string, unknown>)[k]
    return undefined
  }, obj)
}

function renderValue(value: unknown): React.ReactNode {
  if (value == null) return <span className="text-gray-300">-</span>
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'object') return <span className="text-xs text-gray-400 font-mono">{JSON.stringify(value)}</span>
  const str = String(value)
  if (str.length > 80) return str.slice(0, 80) + '...'
  return str
}
