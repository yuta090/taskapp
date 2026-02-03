import { GeneralSettings } from './GeneralSettings'
import { MilestonesSettings } from './MilestonesSettings'
import { MembersSettings } from './MembersSettings'
import { ApiSettings } from './ApiSettings'
import { GitHubSettings } from './GitHubSettings'
import { ExportSettings } from './ExportSettings'
import { SettingsHeader } from './SettingsHeader'

interface PageProps {
  params: Promise<{
    orgId: string
    spaceId: string
  }>
}

export default async function SettingsPage({ params }: PageProps) {
  const { orgId, spaceId } = await params

  return (
    <div className="flex-1 flex flex-col">
      <SettingsHeader orgId={orgId} spaceId={spaceId} />
      <div className="flex-1 overflow-y-auto">
        <div className="content-wrap py-6">

      {/* Settings sections */}
      <div className="space-y-8">
        {/* General settings section */}
        <section className="bg-white border border-gray-200 rounded-xl p-6">
          <GeneralSettings spaceId={spaceId} />
        </section>

        {/* Milestones section */}
        <section className="bg-white border border-gray-200 rounded-xl p-6">
          <MilestonesSettings spaceId={spaceId} />
        </section>

        {/* Members section */}
        <section className="bg-white border border-gray-200 rounded-xl p-6">
          <MembersSettings orgId={orgId} spaceId={spaceId} />
        </section>

        {/* GitHub Settings section */}
        <section className="bg-white border border-gray-200 rounded-xl p-6">
          <GitHubSettings orgId={orgId} spaceId={spaceId} />
        </section>

        {/* API Settings section (admin only) */}
        <section className="bg-white border border-gray-200 rounded-xl p-6">
          <ApiSettings orgId={orgId} spaceId={spaceId} />
        </section>

        {/* Export Settings section */}
        <section className="bg-white border border-gray-200 rounded-xl p-6">
          <ExportSettings spaceId={spaceId} />
        </section>
      </div>
        </div>
      </div>
    </div>
  )
}
