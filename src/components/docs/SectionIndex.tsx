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
  SquaresFour,
  Target,
  Tray,
  UserGear,
  ChatCircleDots,
  PlugsConnected,
  Folder,
  ShieldCheck,
  CreditCard,
  Terminal,
  PaperPlaneTilt,
  House,
} from '@phosphor-icons/react/dist/ssr'
import { CategoryCard } from './CategoryCard'
import { getManualNavEntries, type ManualSection } from '@/lib/docs/manualNav'

interface SectionIndexProps {
  section: ManualSection
  extraContent?: string
}

/**
 * 目次の並び・見出し・説明は manualNav.ts が持つ。ここは絵柄だけを足す。
 * 絵柄が無いページは既定の絵柄で出す（目次に載せたのに表示が壊れる、を防ぐ）。
 */
const ICONS: Record<string, React.ReactNode> = {
  'internal/getting-started': <Rocket size={20} />,
  'internal/dashboard': <SquaresFour size={20} />,
  'internal/my-tasks': <Target size={20} />,
  'internal/inbox': <Tray size={20} />,
  'internal/tasks': <CheckSquare size={20} />,
  'internal/meetings': <VideoCamera size={20} />,
  'internal/wiki': <BookOpen size={20} />,
  'internal/files': <Folder size={20} />,
  'internal/reviews': <Stamp size={20} />,
  'internal/scheduling': <CalendarBlank size={20} />,
  'internal/secretary': <Robot size={20} />,
  'internal/integrations': <PlugsConnected size={20} />,
  'internal/slack-setup': <ChatCircleDots size={20} />,
  'internal/notifications': <Bell size={20} />,
  'internal/settings': <GearSix size={20} />,
  'internal/user-settings': <UserGear size={20} />,
  'internal/security': <ShieldCheck size={20} />,
  'internal/billing': <CreditCard size={20} />,
  'internal/cli': <Terminal size={20} />,
  'internal/mcp-guide': <Robot size={20} />,
  'internal/troubleshooting': <Wrench size={20} />,
  'internal/glossary': <ListBullets size={20} />,
  'client/getting-started': <Rocket size={20} />,
  'client/dashboard': <House size={20} />,
  'client/tasks': <CheckSquare size={20} />,
  'client/approvals': <Stamp size={20} />,
  'client/meetings': <VideoCamera size={20} />,
  'client/files': <Folder size={20} />,
  'client/wiki': <BookOpen size={20} />,
  'client/requests': <PaperPlaneTilt size={20} />,
  'client/troubleshooting': <Question size={20} />,
}

const sectionMeta: Record<ManualSection, { title: string; subtitle: string }> = {
  internal: {
    title: '開発会社向けマニュアル',
    subtitle: 'プロジェクト管理に必要な機能の使い方を解説します',
  },
  client: {
    title: 'クライアント向けご利用ガイド',
    subtitle: 'ポータルからの進捗確認・承認・日程調整の操作方法をご案内します',
  },
}

export function SectionIndex({ section, extraContent }: SectionIndexProps) {
  const meta = sectionMeta[section]
  const entries = getManualNavEntries(section)

  return (
    <div className="max-w-3xl mx-auto px-6 md:px-8 py-8 md:py-12">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">{meta.title}</h1>
        <p className="text-sm text-gray-500 mt-2">{meta.subtitle}</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mt-8">
        {entries.map((entry) => (
          <CategoryCard
            key={entry.slug}
            href={`/docs/manual/${section}/${entry.slug}`}
            icon={ICONS[`${section}/${entry.slug}`] ?? <BookOpen size={20} />}
            title={entry.title}
            description={entry.description}
          />
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
