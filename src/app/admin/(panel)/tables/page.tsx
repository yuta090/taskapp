import { createAdminClient } from '@/lib/supabase/admin'
import { AdminPageHeader } from '@/components/admin/AdminPageHeader'
import { TABLE_CATEGORIES, TABLE_LABELS } from '@/lib/admin/table-config'
import Link from 'next/link'
import { Table } from '@phosphor-icons/react/dist/ssr'

async function getRowCount(tableName: string) {
  const admin = createAdminClient()
  const { count } = await admin.from(tableName).select('*', { count: 'exact', head: true })
  return count ?? 0
}

export default async function AdminTablesPage() {
  // 全テーブルのカウントを並列取得
  const allTables = TABLE_CATEGORIES.flatMap((c) => c.tables)
  const counts = await Promise.all(allTables.map((t) => getRowCount(t)))
  const countMap = new Map<string, number>()
  allTables.forEach((t, i) => countMap.set(t, counts[i]))

  return (
    <div className="p-6 max-w-6xl">
      <AdminPageHeader
        title="テーブルブラウザ"
        description={`${allTables.length} テーブル`}
      />

      {TABLE_CATEGORIES.map((category) => (
        <div key={category.label} className="mb-6">
          <h2 className="text-sm font-medium text-gray-500 mb-2">{category.label}</h2>
          <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {category.tables.map((tableName) => (
              <Link
                key={tableName}
                href={`/admin/tables/${tableName}`}
                className="bg-white border border-gray-200 rounded-xl p-4 hover:border-indigo-300 hover:shadow-sm transition-all group"
              >
                <div className="flex items-center gap-2 mb-1">
                  <Table size={16} className="text-gray-400 group-hover:text-indigo-500" />
                  <span className="text-sm font-medium text-gray-900">{TABLE_LABELS[tableName]}</span>
                </div>
                <p className="text-xs text-gray-400 font-mono">{tableName}</p>
                <p className="text-xs text-gray-500 mt-1">{countMap.get(tableName)?.toLocaleString()} 行</p>
              </Link>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
