import {
  Rocket,
  CheckSquare,
  VideoCamera,
  BookOpen,
  Stamp,
  CalendarBlank,
  GearSix,
  Robot,
  ChartBar,
  Bell,
  Wrench,
  ListBullets,
  Question,
} from '@phosphor-icons/react/dist/ssr'
import { CategoryCard } from './CategoryCard'

interface SectionIndexProps {
  section: 'internal' | 'client'
  extraContent?: string
}

const internalCards = [
  { href: '/docs/manual/internal/getting-started', icon: <Rocket size={20} />, title: 'はじめに・初期設定', description: 'アカウント作成・権限設定' },
  { href: '/docs/manual/internal/tasks', icon: <CheckSquare size={20} />, title: 'タスク管理', description: '作成・編集・ボール管理' },
  { href: '/docs/manual/internal/meetings', icon: <VideoCamera size={20} />, title: '会議管理', description: '議事録・決定事項・タスク生成' },
  { href: '/docs/manual/internal/wiki', icon: <BookOpen size={20} />, title: 'Wiki・仕様管理', description: 'ページ作成・カスタムブロック' },
  { href: '/docs/manual/internal/reviews', icon: <Stamp size={20} />, title: 'レビュー・承認', description: '承認フロー・監査証跡' },
  { href: '/docs/manual/internal/scheduling', icon: <CalendarBlank size={20} />, title: '日程調整', description: '提案・確定・GCal連携' },
  { href: '/docs/manual/internal/settings', icon: <GearSix size={20} />, title: 'プロジェクト設定', description: 'メンバー・連携・通知' },
  { href: '/docs/manual/internal/mcp-guide', icon: <Robot size={20} />, title: 'MCP（AI連携）', description: 'ツール一覧・会話例' },
  { href: '/docs/manual/internal/notifications', icon: <Bell size={20} />, title: '通知ガイド', description: 'チャネル別設定・受信者' },
  { href: '/docs/manual/internal/troubleshooting', icon: <Wrench size={20} />, title: 'トラブルシューティング', description: 'よくある問題と対処法' },
  { href: '/docs/manual/internal/glossary', icon: <ListBullets size={20} />, title: '用語集', description: '専門用語の一覧' },
]

const clientCards = [
  { href: '/docs/manual/client/getting-started', icon: <Rocket size={20} />, title: 'はじめに', description: 'ポータルへのアクセス方法' },
  { href: '/docs/manual/client/dashboard', icon: <ChartBar size={20} />, title: 'ダッシュボード', description: 'プロジェクト全体の状況確認' },
  { href: '/docs/manual/client/tasks', icon: <CheckSquare size={20} />, title: 'タスクの確認と対応', description: '確認・コメント・回答' },
  { href: '/docs/manual/client/meetings', icon: <VideoCamera size={20} />, title: '会議と日程調整', description: '日程回答・決定事項の確認' },
  { href: '/docs/manual/client/approvals', icon: <Stamp size={20} />, title: '承認・レビュー', description: '承認・変更依頼の操作' },
  { href: '/docs/manual/client/troubleshooting', icon: <Question size={20} />, title: 'お困りの場合', description: 'よくある問題と解決方法' },
]

const sectionMeta = {
  internal: {
    title: '開発会社向けマニュアル',
    subtitle: 'プロジェクト管理に必要な機能の使い方を解説します',
    cards: internalCards,
  },
  client: {
    title: 'クライアント向けご利用ガイド',
    subtitle: 'ポータルからの進捗確認・承認・日程調整の操作方法をご案内します',
    cards: clientCards,
  },
}

export function SectionIndex({ section, extraContent }: SectionIndexProps) {
  const meta = sectionMeta[section]

  return (
    <div className="max-w-3xl mx-auto px-6 md:px-8 py-8 md:py-12">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">{meta.title}</h1>
        <p className="text-sm text-gray-500 mt-2">{meta.subtitle}</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mt-8">
        {meta.cards.map((card) => (
          <CategoryCard key={card.href} {...card} />
        ))}
      </div>

      {extraContent && (
        <div
          className="mt-12 prose prose-gray prose-sm max-w-none
            prose-headings:font-bold
            prose-h2:text-lg prose-h2:mt-10 prose-h2:mb-4
            prose-h3:text-base prose-h3:mt-8 prose-h3:mb-3
            prose-table:text-sm
            prose-th:bg-gray-50 prose-th:px-3 prose-th:py-2
            prose-td:px-3 prose-td:py-2
            prose-code:text-indigo-600 prose-code:bg-gray-100 prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-code:text-xs
            prose-a:text-indigo-600 prose-a:no-underline hover:prose-a:underline
            prose-li:marker:text-gray-400"
          dangerouslySetInnerHTML={{ __html: extraContent }}
        />
      )}
    </div>
  )
}
