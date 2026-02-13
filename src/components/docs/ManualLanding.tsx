import Link from 'next/link'
import { Buildings, Users, CaretRight } from '@phosphor-icons/react/dist/ssr'
import { CategoryCard } from './CategoryCard'

const popularPages = [
  { href: '/docs/manual/internal/getting-started', label: 'はじめに・初期設定' },
  { href: '/docs/manual/internal/tasks', label: 'タスク管理' },
  { href: '/docs/manual/client/dashboard', label: 'ダッシュボードの使い方' },
  { href: '/docs/manual/internal/mcp-guide', label: 'MCP（AI連携）ガイド' },
]

export function ManualLanding() {
  return (
    <div className="max-w-3xl mx-auto px-6 md:px-8 py-8 md:py-12">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">TaskApp マニュアル</h1>
        <p className="text-sm text-gray-500 mt-2">
          プロジェクト管理に必要な操作方法をまとめています
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-8">
        <CategoryCard
          href="/docs/manual/internal"
          icon={<Buildings size={20} />}
          title="開発会社向けマニュアル"
          description="プロジェクト管理・タスク・会議・Wikiを活用"
          badge="12 記事"
        />
        <CategoryCard
          href="/docs/manual/client"
          icon={<Users size={20} />}
          title="クライアント向けご利用ガイド"
          description="進捗確認・承認・日程調整をかんたんに"
          badge="6 記事"
        />
      </div>

      <div className="mt-12">
        <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
          よく見られているページ
        </h2>
        <div className="space-y-1">
          {popularPages.map((page) => (
            <Link
              key={page.href}
              href={page.href}
              className="flex items-center gap-1.5 text-sm text-indigo-600 hover:text-indigo-800 hover:underline py-1"
            >
              <CaretRight size={14} />
              {page.label}
            </Link>
          ))}
        </div>
      </div>
    </div>
  )
}
