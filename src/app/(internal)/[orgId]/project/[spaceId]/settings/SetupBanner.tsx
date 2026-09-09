'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  RocketLaunch,
  Check,
  CaretRight,
  X,
} from '@phosphor-icons/react'
import { useGitHubInstallation } from '@/lib/hooks/useGitHub'
import { useSlackWorkspace } from '@/lib/hooks/useSlack'
import { useSpaceRow } from '@/lib/hooks/useSpaceRow'
import { useSpaceContentCounts } from '@/lib/hooks/useSpaceContentCounts'
import type { SettingSectionId } from './types'

interface SetupStep {
  id: string
  label: string
  description: string
  targetSection: SettingSectionId
  completed: boolean
}

interface SetupBannerProps {
  orgId: string
  spaceId: string
  onNavigate: (section: SettingSectionId) => void
  activeConnectionCount: number
}

export function SetupBanner({ orgId, spaceId, onNavigate, activeConnectionCount }: SetupBannerProps) {
  const { data: githubInstallation } = useGitHubInstallation(orgId)
  const { data: slackWorkspace } = useSlackWorkspace(orgId)
  const [dismissed, setDismissed] = useState(false)
  // 初期構成(preset_genre)はプロジェクト1行の共有キャッシュから。件数は「初期構成」設定と
  // 同じ ['spaceContentCounts', spaceId] を見る。どちらもここで別に取ると往復が増える。
  const { space, isPending: spacePending } = useSpaceRow(spaceId)
  const presetGenre = (space?.preset_genre as string | null) ?? null
  const { counts, isPending: countsPending, isError: fetchError } = useSpaceContentCounts(spaceId)
  const memberCount = counts?.members ?? null
  const milestoneCount = counts?.milestones ?? null
  const loading = countsPending

  // C2 fix: check localStorage on spaceId change
  useEffect(() => {
    const key = `setup-dismissed-${spaceId}`
    // eslint-disable-next-line react-hooks/set-state-in-effect -- localStorage（外部ストレージ）との同期
    setDismissed(localStorage.getItem(key) === 'true')
  }, [spaceId])

  // C3 fix: use activeConnectionCount prop (already filtered to active status)
  const steps: SetupStep[] = useMemo(() => {
    if (loading || spacePending) return []
    const hasMembers = (memberCount ?? 0) > 1
    const hasMilestones = (milestoneCount ?? 0) > 0
    const hasIntegration = activeConnectionCount > 0 || !!githubInstallation || !!slackWorkspace
    const hasPreset = !!presetGenre && presetGenre !== 'blank'

    return [
      {
        id: 'members',
        label: 'メンバーを追加',
        description: 'プロジェクトメンバーを招待しましょう',
        targetSection: 'members' as SettingSectionId,
        completed: hasMembers,
      },
      {
        id: 'milestones',
        label: 'マイルストーンを設定',
        description: 'スケジュールの骨格を作りましょう',
        targetSection: 'milestones' as SettingSectionId,
        completed: hasMilestones || hasPreset,
      },
      {
        id: 'integrations',
        label: '外部ツールを連携',
        description: 'Slack, GitHub, カレンダーなど',
        targetSection: 'slack' as SettingSectionId,
        completed: hasIntegration,
      },
    ]
  }, [loading, spacePending, memberCount, milestoneCount, activeConnectionCount, githubInstallation, slackWorkspace, presetGenre])

  const completedCount = steps.filter((s) => s.completed).length
  const allDone = steps.length > 0 && completedCount === steps.length

  const handleDismiss = useCallback(() => {
    setDismissed(true)
    localStorage.setItem(`setup-dismissed-${spaceId}`, 'true')
  }, [spaceId])

  // 全部終わったら閉じた印を残す。表示するかどうかは下の allDone で決めるので、
  // ここは localStorage への書き込みだけ（state は触らない）
  useEffect(() => {
    if (allDone && !dismissed) {
      localStorage.setItem(`setup-dismissed-${spaceId}`, 'true')
    }
  }, [allDone, dismissed, spaceId])

  if (dismissed || allDone || loading || fetchError || steps.length === 0) return null

  const progressPercent = Math.round((completedCount / steps.length) * 100)

  return (
    <div className="bg-gradient-to-r from-indigo-50 to-blue-50 border border-indigo-100 rounded-xl p-5 mb-6">
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2">
          <RocketLaunch className="text-lg text-indigo-600" weight="fill" />
          <h3 className="text-sm font-semibold text-gray-900">プロジェクトセットアップ</h3>
          <span className="text-xs text-gray-500">
            {completedCount}/{steps.length} 完了
          </span>
        </div>
        <button
          onClick={handleDismiss}
          className="text-gray-400 hover:text-gray-600 transition-colors cursor-pointer"
          aria-label="閉じる"
        >
          <X className="text-base" />
        </button>
      </div>

      {/* Progress bar */}
      <div className="h-1 bg-indigo-100 rounded-full mb-4 overflow-hidden">
        <div
          className="h-full bg-indigo-500 rounded-full transition-all duration-500"
          style={{ width: `${progressPercent}%` }}
        />
      </div>

      {/* Steps */}
      <div className="space-y-2">
        {steps.map((step) => (
          <button
            key={step.id}
            onClick={() => !step.completed && onNavigate(step.targetSection)}
            className={`
              w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left transition-colors
              ${step.completed
                ? 'bg-surface/50 cursor-default'
                : 'bg-surface hover:bg-surface/80 cursor-pointer'
              }
            `}
            disabled={step.completed}
          >
            <div
              className={`
                w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0
                ${step.completed
                  ? 'bg-emerald-500 text-white'
                  : 'border-2 border-gray-300'
                }
              `}
            >
              {step.completed && <Check className="text-xs" weight="bold" />}
            </div>
            <div className="flex-1 min-w-0">
              <div className={`text-sm ${step.completed ? 'text-gray-400 line-through' : 'text-gray-900 font-medium'}`}>
                {step.label}
              </div>
              {!step.completed && (
                <div className="text-xs text-gray-500">{step.description}</div>
              )}
            </div>
            {!step.completed && (
              <CaretRight className="text-sm text-gray-400 flex-shrink-0" />
            )}
          </button>
        ))}
      </div>
    </div>
  )
}
