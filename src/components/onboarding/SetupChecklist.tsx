'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { CheckCircle, CaretDown, CaretUp, Clock } from '@phosphor-icons/react'
import { useOnboardingFlag } from '@/lib/hooks/useOnboardingFlag'
import { useSetupChecklistData } from '@/lib/hooks/useSetupChecklistData'
import { computeSetupChecklist } from '@/lib/onboarding/computeSetupChecklist'

interface SetupChecklistProps {
  orgId: string
  spaceId: string
}

const DISMISSED_LOCAL_KEY = 'taskapp_setup_checklist_dismissed'

/**
 * プロジェクトのタスク一覧最上部に常設する初回セットアップ進捗カード。
 * 一度きりのウォークスルー(InternalOnboardingWalkthrough)と異なり、アハ体験
 * （クライアントとのボール往復）までの行動導線を消えるまで提示し続ける。
 */
export function SetupChecklist({ orgId, spaceId }: SetupChecklistProps) {
  const { shouldShow, markDone } = useOnboardingFlag('setup_checklist', DISMISSED_LOCAL_KEY)
  const data = useSetupChecklistData(orgId, spaceId)
  const [collapsed, setCollapsed] = useState(false)
  const autoDismissedRef = useRef(false)

  const result = computeSetupChecklist(data, spaceId, orgId)

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
    <div data-testid="setup-checklist" className="mx-5 mt-3 mb-1 rounded-lg border border-gray-200 bg-white">
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
          className="flex-shrink-0 text-xs text-gray-400 hover:text-gray-600 transition-colors"
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
                          : step.pending
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
                  </div>
                  <p className="text-xs text-gray-500 truncate">{step.description}</p>
                </div>
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
