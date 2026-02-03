'use client'

import { Gear } from '@phosphor-icons/react'
import { Breadcrumb } from '@/components/shared'

interface SettingsHeaderProps {
  orgId: string
  spaceId: string
}

export function SettingsHeader({ orgId, spaceId }: SettingsHeaderProps) {
  const breadcrumbItems = [
    { label: 'Webリニューアル', href: `/${orgId}/project/${spaceId}` },
    { label: '設定' },
  ]

  return (
    <header className="h-12 border-b border-gray-100 flex items-center px-5 flex-shrink-0">
      <div className="flex items-center gap-2">
        <Gear className="text-lg text-gray-500" />
        <Breadcrumb items={breadcrumbItems} />
      </div>
    </header>
  )
}
