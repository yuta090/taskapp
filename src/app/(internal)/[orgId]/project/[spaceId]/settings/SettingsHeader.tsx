'use client'

import { Gear } from '@phosphor-icons/react'
import { Breadcrumb } from '@/components/shared'
import { AnnouncementBell } from '@/components/announcement/AnnouncementBell'
import { useSpaceName } from '@/lib/hooks/useSpaceName'

interface SettingsHeaderProps {
  orgId: string
  spaceId: string
}

export function SettingsHeader({ orgId, spaceId }: SettingsHeaderProps) {
  const spaceName = useSpaceName(spaceId)
  const breadcrumbItems = [
    { label: spaceName || 'プロジェクト', href: `/${orgId}/project/${spaceId}` },
    { label: '設定' },
  ]

  return (
    <header className="h-12 border-b border-gray-100 flex items-center px-5 flex-shrink-0">
      <div className="flex items-center gap-2">
        <Gear className="text-lg text-gray-500" />
        <Breadcrumb items={breadcrumbItems} />
      </div>
      {/* お知らせベル。ヘッダーの一番右に置く。この目印(data-header-bell)があると、
          AppShell がページ上部に出す「ベルだけの1行」が globals.css の :has() で消える。
          モバイルは AppShell のヘッダーにベルがあるので md 未満では出さない。 */}
      <div data-header-bell className="hidden md:block ml-auto">
        <AnnouncementBell />
      </div>
    </header>
  )
}
