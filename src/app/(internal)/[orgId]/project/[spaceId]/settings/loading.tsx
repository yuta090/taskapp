import {
  Gear,
  FolderSimple,
  Flag,
  UsersThree,
  GithubLogo,
  ChatCircleDots,
  Calendar,
  VideoCamera,
  Brain,
  Key,
  Export,
  MagnifyingGlass,
} from '@phosphor-icons/react/dist/ssr'
import { SkeletonLine, SkeletonBlock } from '@/components/shared/Skeleton'

const categories = [
  {
    label: 'プロジェクト運用',
    items: [
      { label: '基本設定', Icon: FolderSimple },
      { label: 'マイルストーン', Icon: Flag },
      { label: 'メンバー', Icon: UsersThree },
    ],
  },
  {
    label: '外部連携',
    items: [
      { label: 'GitHub', Icon: GithubLogo },
      { label: 'Slack', Icon: ChatCircleDots },
      { label: 'Google Calendar', Icon: Calendar },
      { label: 'ビデオ会議', Icon: VideoCamera },
    ],
  },
  {
    label: 'AI・自動化',
    items: [{ label: 'AI設定', Icon: Brain }],
  },
  {
    label: 'セキュリティ・API',
    items: [{ label: 'APIキー', Icon: Key }],
  },
  {
    label: 'データ管理',
    items: [{ label: 'データエクスポート', Icon: Export }],
  },
]

export default function Loading() {
  return (
    <div className="flex-1 min-h-0 flex flex-col">
      {/* Real header */}
      <header className="h-12 border-b border-gray-100 flex items-center px-5 flex-shrink-0">
        <div className="flex items-center gap-2">
          <Gear className="text-lg text-gray-500" />
          <SkeletonLine className="w-20" />
          <span className="text-gray-300 mx-1">/</span>
          <span className="text-sm text-gray-700">設定</span>
        </div>
      </header>
      {/* Body: real sidebar nav + content skeleton */}
      <div className="flex-1 min-h-0 flex">
        {/* Sidebar nav — real text */}
        <nav className="w-[200px] flex-shrink-0 border-r border-gray-100 py-4 px-2 space-y-4" aria-hidden="true">
          {/* Search placeholder */}
          <div className="px-2 mb-4">
            <div className="relative">
              <MagnifyingGlass className="absolute left-2 top-1/2 -translate-y-1/2 text-sm text-gray-400" />
              <div className="w-full pl-7 pr-2 py-1.5 text-[13px] text-gray-400 bg-gray-50 border border-gray-200 rounded-md">
                検索...
              </div>
            </div>
          </div>
          {categories.map((cat) => (
            <div key={cat.label} className="space-y-0.5">
              <div className="px-2 mb-1.5 text-[10px] font-semibold text-gray-400 uppercase tracking-wider">
                {cat.label}
              </div>
              {cat.items.map((item, i) => (
                <div
                  key={item.label}
                  className={`flex items-center gap-2.5 px-2 py-1.5 rounded-md text-xs ${
                    i === 0 && cat.label === 'プロジェクト運用'
                      ? 'bg-gray-100 text-gray-900 font-medium'
                      : 'text-gray-600'
                  }`}
                >
                  <item.Icon className="w-4 h-4 flex-shrink-0" />
                  {item.label}
                </div>
              ))}
            </div>
          ))}
        </nav>
        {/* Content skeleton */}
        <div className="flex-1 min-w-0 overflow-y-auto">
          <div className="max-w-[800px] mx-auto px-6 py-6 space-y-6">
            <SkeletonLine className="w-24 h-4" />
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="space-y-2">
                <SkeletonLine className="w-20 h-2.5" />
                <SkeletonBlock className={`h-9 rounded-md ${i % 2 === 0 ? 'w-full' : 'w-3/4'}`} />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
