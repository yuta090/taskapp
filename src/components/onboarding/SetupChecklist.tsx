'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useQueryClient } from '@tanstack/react-query'
import { CheckCircle, CaretDown, CaretUp, Clock, MinusCircle } from '@phosphor-icons/react'
import { useOnboardingFlag } from '@/lib/hooks/useOnboardingFlag'
import { useSetupChecklistData, type UseSetupChecklistDataResult } from '@/lib/hooks/useSetupChecklistData'
import { computeSetupChecklist } from '@/lib/onboarding/computeSetupChecklist'
import { markNoClient } from '@/lib/onboarding/markNoClient'
import { setOnboardingFlag } from '@/lib/onboarding/setOnboardingFlag'
import { resetOnboardingFlagOnServer } from '@/lib/hooks/useOnboardingFlag'

interface SetupChecklistProps {
  orgId: string
  spaceId: string
}

const DISMISSED_LOCAL_KEY = 'taskapp_setup_checklist_dismissed'

/** ステップ → 「この設定はしない」で立てるフラグ */
const SKIP_FLAG_BY_STEP = { connect_line: 'skip_line', configure_ai: 'skip_ai' } as const
type SkippableStepKey = keyof typeof SKIP_FLAG_BY_STEP

/**
 * 「はじめての設定」を再表示する（左ナビのヘルプメニューから）。
 * 非表示フラグ（端末・サーバー両方）を消すだけで、「この設定はしない」の選択は保持する。
 */
export async function resetSetupChecklist(): Promise<void> {
  if (typeof window === 'undefined') return
  try {
    localStorage.removeItem(DISMISSED_LOCAL_KEY)
  } catch {
    // localStorage unavailable
  }
  await resetOnboardingFlagOnServer('setup_checklist')
}

/**
 * プロジェクトのタスク一覧最上部に常設する初回セットアップ進捗カード。
 * 一度きりのウォークスルー(InternalOnboardingWalkthrough)と異なり、アハ体験
 * （クライアントとのボール往復）までの行動導線を消えるまで提示し続ける。
 */
export function SetupChecklist({ orgId, spaceId }: SetupChecklistProps) {
  const { shouldShow, markDone } = useOnboardingFlag('setup_checklist', DISMISSED_LOCAL_KEY)
  const data = useSetupChecklistData(orgId, spaceId)
  const queryClient = useQueryClient()
  const [collapsed, setCollapsed] = useState(false)
  const autoDismissedRef = useRef(false)

  const result = computeSetupChecklist(data, spaceId, orgId)

  // 「クライアントなし」: 楽観的にキャッシュへ反映してから保存し、保存後に再取得で整合させる
  const handleNoClient = useCallback(async () => {
    const queryKey = ['setupChecklistData', orgId, spaceId]
    queryClient.setQueryData<Omit<UseSetupChecklistDataResult, 'loading'>>(queryKey, (prev) =>
      prev ? { ...prev, noClient: true } : prev
    )
    await markNoClient()
    await queryClient.invalidateQueries({ queryKey })
  }, [queryClient, orgId, spaceId])

  // 「この設定はしない」(LINE / AI): クライアントなしと同じく、楽観的にキャッシュへ反映 → 保存 → 再取得
  const handleSkip = useCallback(
    async (stepKey: SkippableStepKey) => {
      const flag = SKIP_FLAG_BY_STEP[stepKey]
      const field = stepKey === 'connect_line' ? 'skipLine' : 'skipAi'
      const queryKey = ['setupChecklistData', orgId, spaceId]
      queryClient.setQueryData<Omit<UseSetupChecklistDataResult, 'loading'>>(queryKey, (prev) =>
        prev ? { ...prev, [field]: true } : prev
      )
      await setOnboardingFlag(flag)
      await queryClient.invalidateQueries({ queryKey })
    },
    [queryClient, orgId, spaceId]
  )

  // 全ステップ完了時は「完了」表示を一度だけ出し、以後は自動的に非表示扱いにする
  useEffect(() => {
    if (result.allDone && shouldShow === true && !autoDismissedRef.current) {
      autoDismissedRef.current = true
      void markDone()
    }
  }, [result.allDone, shouldShow, markDone])

  // client ロールには表示しない（本来 client は portal 側の画面を使うが、直接URL遷移した場合の保険）
  if (data.currentUserRole === 'client') return null
  // shouldShow が null（判定中）/ false（非表示済み）のときは何も出さずフラッシュを防ぐ
  if (shouldShow !== true) return null
  if (data.loading) return null

  if (result.allDone) {
    return (
      <div
        data-testid="setup-checklist-complete"
        className="mx-5 mt-3 mb-1 flex items-center gap-2 rounded-lg border border-green-100 bg-green-50 px-4 py-3"
      >
        <CheckCircle weight="fill" className="w-5 h-5 flex-shrink-0 text-green-600" />
        <span className="text-sm font-medium text-green-700">セットアップ完了！🎉</span>
      </div>
    )
  }

  return (
    <div data-testid="setup-checklist" className="mx-5 mt-3 mb-1 rounded-lg border border-gray-200 bg-surface">
      <div className="flex items-center gap-3 px-4 py-2.5">
        <button
          type="button"
          onClick={() => setCollapsed((prev) => !prev)}
          aria-expanded={!collapsed}
          data-testid="setup-checklist-toggle"
          className="flex items-center gap-1.5 text-sm font-medium text-gray-900 hover:text-gray-700 transition-colors"
        >
          {collapsed ? <CaretDown className="w-3.5 h-3.5" /> : <CaretUp className="w-3.5 h-3.5" />}
          はじめての設定 {result.completedCount}/{result.totalCount}
        </button>
        <div className="flex-1 h-1.5 rounded-full bg-gray-100 overflow-hidden">
          <div
            className="h-full bg-indigo-600 transition-all"
            style={{ width: `${(result.completedCount / result.totalCount) * 100}%` }}
          />
        </div>
        <button
          type="button"
          onClick={() => void markDone()}
          title="非表示にしても、左下のヘルプ →「はじめての設定を再表示」で戻せます"
          className="flex-shrink-0 rounded-md border border-gray-200 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50 hover:text-gray-900 transition-colors"
        >
          非表示にする
        </button>
      </div>

      {!collapsed && (
        <ul className="border-t border-gray-100 divide-y divide-gray-100">
          {result.steps.map((step) => {
            const isCurrent = step.key === result.currentStepKey
            return (
              <li
                key={step.key}
                data-testid={`setup-step-${step.key}`}
                data-current={isCurrent ? 'true' : undefined}
                className={`flex items-center gap-3 px-4 py-2.5 ${isCurrent ? 'bg-indigo-50/60' : ''}`}
              >
                {step.done ? (
                  <CheckCircle weight="fill" className="w-4 h-4 flex-shrink-0 text-green-600" />
                ) : step.pending ? (
                  <Clock className="w-4 h-4 flex-shrink-0 text-gray-400" />
                ) : step.skipped ? (
                  <MinusCircle className="w-4 h-4 flex-shrink-0 text-gray-400" />
                ) : (
                  <div
                    className={`w-4 h-4 flex-shrink-0 rounded-full border-2 ${
                      isCurrent ? 'border-indigo-500' : 'border-gray-300'
                    }`}
                  />
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p
                      className={`text-sm ${
                        step.done
                          ? 'text-gray-500'
                          : step.pending || step.skipped
                            ? 'text-gray-400'
                            : `font-medium ${isCurrent ? 'text-indigo-900' : 'text-gray-900'}`
                      }`}
                    >
                      {step.title}
                    </p>
                    {isCurrent && (
                      <span className="flex-shrink-0 rounded-full bg-indigo-600 px-1.5 py-0.5 text-[10px] font-medium leading-none text-white">
                        今ここ
                      </span>
                    )}
                    {step.pending && (
                      <span className="flex-shrink-0 rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium leading-none text-gray-500">
                        準備中
                      </span>
                    )}
                    {step.skipped && (
                      <span className="flex-shrink-0 rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium leading-none text-gray-500">
                        スキップ
                      </span>
                    )}
                  </div>
                  {/* truncate しない: 「連携すると何ができるか」のメリット文が1行で切れて読めなくなるため */}
                  <p className="text-xs text-gray-500">{step.description}</p>
                  {step.dmUnreachable && (
                    <p className="text-[11px] text-amber-600">
                      現在DMが届いていません（ブロックの可能性があります）
                    </p>
                  )}
                </div>
                {step.canMarkNoClient && (
                  <button
                    type="button"
                    onClick={() => void handleNoClient()}
                    className="flex-shrink-0 text-xs text-gray-500 hover:text-gray-700 transition-colors"
                  >
                    クライアントなし
                  </button>
                )}
                {step.canSkip && (step.key === 'connect_line' || step.key === 'configure_ai') && (
                  <button
                    type="button"
                    onClick={() => void handleSkip(step.key as SkippableStepKey)}
                    className="flex-shrink-0 text-xs text-gray-500 hover:text-gray-700 transition-colors"
                  >
                    この設定はしない
                  </button>
                )}
                {!step.done && !step.pending && step.href && (
                  <Link
                    href={step.href}
                    className="flex-shrink-0 text-xs font-medium text-indigo-600 hover:text-indigo-700 transition-colors"
                  >
                    {step.ctaLabel}
                  </Link>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
