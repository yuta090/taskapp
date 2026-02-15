import Link from 'next/link'

interface NavEntry {
  slug: string[]
  label: string
}

const navOrder: NavEntry[] = [
  { slug: ['internal'], label: '概要' },
  { slug: ['internal', 'getting-started'], label: 'はじめに・初期設定' },
  { slug: ['internal', 'tasks'], label: 'タスク管理' },
  { slug: ['internal', 'meetings'], label: '会議管理' },
  { slug: ['internal', 'wiki'], label: 'Wiki・仕様管理' },
  { slug: ['internal', 'reviews'], label: 'レビュー・承認' },
  { slug: ['internal', 'scheduling'], label: '日程調整' },
  { slug: ['internal', 'settings'], label: 'プロジェクト設定' },
  { slug: ['internal', 'mcp-guide'], label: 'MCP（AI連携）' },
  { slug: ['internal', 'notifications'], label: '通知ガイド' },
  { slug: ['internal', 'troubleshooting'], label: 'トラブルシューティング' },
  { slug: ['internal', 'glossary'], label: '用語集' },
  { slug: ['client'], label: '概要' },
  { slug: ['client', 'getting-started'], label: 'はじめに' },
  { slug: ['client', 'dashboard'], label: 'ダッシュボード' },
  { slug: ['client', 'tasks'], label: 'タスクの確認と対応' },
  { slug: ['client', 'meetings'], label: '会議と日程調整' },
  { slug: ['client', 'approvals'], label: '承認・レビュー' },
  { slug: ['client', 'troubleshooting'], label: 'お困りの場合' },
]

function slugsEqual(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((s, i) => s === b[i])
}

interface PrevNextNavProps {
  currentSlug: string[]
}

export function PrevNextNav({ currentSlug }: PrevNextNavProps) {
  const currentSection = currentSlug[0]
  const sectionEntries = navOrder.filter((e) => e.slug[0] === currentSection)
  const currentIndex = sectionEntries.findIndex((e) =>
    slugsEqual(e.slug, currentSlug),
  )

  if (currentIndex === -1) return null

  const prev = currentIndex > 0 ? sectionEntries[currentIndex - 1] : null
  const next =
    currentIndex < sectionEntries.length - 1
      ? sectionEntries[currentIndex + 1]
      : null

  if (!prev && !next) return null

  return (
    <nav
      aria-label="前後のページ"
      className="flex justify-between border-t border-gray-200 pt-6 mt-12"
    >
      <div>
        {prev && (
          <Link
            href={`/docs/manual/${prev.slug.join('/')}`}
            className="text-sm text-gray-600 hover:text-indigo-600 transition-colors"
          >
            &larr; 前: {prev.label}
          </Link>
        )}
      </div>
      <div>
        {next && (
          <Link
            href={`/docs/manual/${next.slug.join('/')}`}
            className="text-sm text-gray-600 hover:text-indigo-600 transition-colors"
          >
            次: {next.label} &rarr;
          </Link>
        )}
      </div>
    </nav>
  )
}
