'use client'

import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import {
  RocketLaunch,
  Check,
  CaretRight,
  X,
} from '@phosphor-icons/react'
import { createClient } from '@/lib/supabase/client'
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
  const [dismissed, setDismissed] = useState(false)
  const [memberCount, setMemberCount] = useState<number | null>(null)
  const [milestoneCount, setMilestoneCount] = useState<number | null>(null)
  const [presetGenre, setPresetGenre] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState(false)
  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null)
  if (supabaseRef.current == null) supabaseRef.current = createClient()
  const supabase = supabaseRef.current

  // C2 fix: reset all state on spaceId change, check localStorage correctly
  useEffect(() => {
    const key = `setup-dismissed-${spaceId}`
    const isDismissed = localStorage.getItem(key) === 'true'
    setDismissed(isDismissed)
    setLoading(true)
    setFetchError(false)
    setMemberCount(null)
    setMilestoneCount(null)
    setPresetGenre(null)
  }, [spaceId])

  // R2 fix: fetch with error handling and cancellation guard
  useEffect(() => {
    let cancelled = false

    const load = async () => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const sb = supabase as any
        const [spaceRes, memberRes, msRes] = await Promise.all([
          sb.from('spaces').select('*').eq('id', spaceId).single(),
          sb.from('space_memberships').select('id', { count: 'exact', head: true }).eq('space_id', spaceId),
          sb.from('milestones').select('id', { count: 'exact', head: true }).eq('space_id', spaceId),
        ])
        if (cancelled) return
        // R2 fix: Supabase returns { data, error } without throwing — check explicitly
        if (spaceRes.error || memberRes.error || msRes.error) {
          setFetchError(true)
          return
        }
        setPresetGenre(spaceRes.data?.preset_genre ?? null)
        setMemberCount(memberRes.count ?? 0)
        setMilestoneCount(msRes.count ?? 0)
      } catch {
        if (!cancelled) setFetchError(true)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()

    return () => { cancelled = true }
  }, [spaceId, supabase])

  // C3 fix: use activeConnectionCount prop (already filtered to active status)
  const steps: SetupStep[] = useMemo(() => {
    if (loading) return []
    const hasMembers = (memberCount ?? 0) > 1
    const hasMilestones = (milestoneCount ?? 0) > 0
    const hasIntegration = activeConnectionCount > 0
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
  }, [loading, memberCount, milestoneCount, activeConnectionCount, presetGenre])

  const completedCount = steps.filter((s) => s.completed).length
  const allDone = steps.length > 0 && completedCount === steps.length

  const handleDismiss = useCallback(() => {
    setDismissed(true)
    localStorage.setItem(`setup-dismissed-${spaceId}`, 'true')
  }, [spaceId])

  // Auto-dismiss when all steps complete
  useEffect(() => {
    if (allDone && !dismissed) {
      handleDismiss()
    }
  }, [allDone, dismissed, handleDismiss])

  if (dismissed || loading || fetchError || steps.length === 0) return null

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
                ? 'bg-white/50 cursor-default'
                : 'bg-white hover:bg-white/80 cursor-pointer'
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
