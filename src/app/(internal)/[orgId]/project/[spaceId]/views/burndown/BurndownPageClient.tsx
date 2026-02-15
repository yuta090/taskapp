'use client'

import { useEffect, useState, useCallback } from 'react'
import { ChartLine, Spinner } from '@phosphor-icons/react'
import { Breadcrumb } from '@/components/shared'
import { BurndownChart, BurndownControls } from '@/components/burndown'
import { useMilestones } from '@/lib/hooks/useMilestones'
import { useBurndown } from '@/lib/hooks/useBurndown'
import { ViewsTabNav } from '@/components/shared/ViewsTabNav'

interface BurndownPageClientProps {
  orgId: string
  spaceId: string
}

export function BurndownPageClient({ orgId, spaceId }: BurndownPageClientProps) {
  const {
    milestones,
    loading: milestonesLoading,
    fetchMilestones,
  } = useMilestones({ spaceId })

  const [selectedMilestoneId, setSelectedMilestoneId] = useState<string>('')
  const [initialized, setInitialized] = useState(false)

  // Initialize: fetch milestones
  useEffect(() => {
    let cancelled = false
    const init = async () => {
      await fetchMilestones()
      if (!cancelled) setInitialized(true)
    }
    init()
    return () => { cancelled = true }
  }, [fetchMilestones])

  // "" means project-wide (null milestoneId), otherwise specific milestone
  const effectiveMilestoneId = selectedMilestoneId === '' ? null : selectedMilestoneId

  const { data, loading: burndownLoading, error, refetch } = useBurndown({
    spaceId,
    milestoneId: effectiveMilestoneId,
  })

  // Fetch burndown when effective milestone changes
  useEffect(() => {
    if (initialized) {
      refetch()
    }
  }, [effectiveMilestoneId, initialized, refetch])

  const handleSelectMilestone = useCallback((id: string) => {
    setSelectedMilestoneId(id)
  }, [])

  const loading = !initialized || milestonesLoading
  const projectBasePath = `/${orgId}/project/${spaceId}`

  const breadcrumbItems = [
    { label: 'Webリニューアル', href: projectBasePath },
    { label: 'バーンダウン' },
  ]

  // Summary from latest snapshot
  const summary = data
    ? {
        remaining: data.dailySnapshots.length > 0
          ? data.dailySnapshots[data.dailySnapshots.length - 1].remaining
          : 0,
        total: data.totalTasks,
        startDate: formatDisplayDate(data.startDate),
        endDate: formatDisplayDate(data.endDate),
      }
    : undefined

  return (
    <div className="flex flex-col h-full bg-gray-50">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 bg-white border-b border-gray-200">
        <div className="flex items-center gap-2">
          <ChartLine className="text-lg text-gray-500" />
          <Breadcrumb items={breadcrumbItems} />
        </div>
      </div>

      {/* Views Tab Nav */}
      <ViewsTabNav orgId={orgId} spaceId={spaceId} activeView="burndown" />

      {/* Content */}
      <div className="flex-1 p-4 overflow-auto">
        {loading ? (
          <div className="flex items-center justify-center h-64">
            <div className="flex items-center gap-2 text-gray-500">
              <Spinner className="w-5 h-5 animate-spin" />
              <span className="text-sm">読み込み中...</span>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Controls */}
            <BurndownControls
              milestones={milestones}
              selectedMilestoneId={selectedMilestoneId}
              onSelectMilestone={handleSelectMilestone}
              summary={summary}
            />

            {/* Chart */}
            {burndownLoading ? (
              <div className="flex items-center justify-center h-64">
                <div className="flex items-center gap-2 text-gray-500">
                  <Spinner className="w-5 h-5 animate-spin" />
                  <span className="text-sm">チャートを計算中...</span>
                </div>
              </div>
            ) : error ? (
              <div className="flex items-center justify-center h-64">
                <div className="text-center">
                  <p className="text-sm text-red-600 mb-2">{error.message}</p>
                  <button
                    onClick={refetch}
                    className="px-3 py-1.5 text-xs font-medium text-gray-600 bg-gray-100 rounded hover:bg-gray-200 transition-colors"
                  >
                    再試行
                  </button>
                </div>
              </div>
            ) : data ? (
              <div className="bg-white rounded-lg border border-gray-200 p-4">
                <BurndownChart data={data} />
              </div>
            ) : null}
          </div>
        )}
      </div>
    </div>
  )
}

function formatDisplayDate(dateStr: string): string {
  const [, m, d] = dateStr.split('-').map(Number)
  return `${m}/${d}`
}
