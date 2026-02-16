import { SettingsHeader } from './SettingsHeader'
import { SettingsLayout } from './SettingsLayout'

interface PageProps {
  params: Promise<{
    orgId: string
    spaceId: string
  }>
}

export default async function SettingsPage({ params }: PageProps) {
  const { orgId, spaceId } = await params

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <SettingsHeader orgId={orgId} spaceId={spaceId} />
      <SettingsLayout orgId={orgId} spaceId={spaceId} />
    </div>
  )
}
