'use client'

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { createPortal } from 'react-dom'
import {
  PlusCircle,
  ArrowsLeftRight,
  Eye,
  RocketLaunch,
  X,
  CaretRight,
  CaretLeft,
} from '@phosphor-icons/react'
import { useOnboardingFlag, resetOnboardingFlagOnServer } from '@/lib/hooks/useOnboardingFlag'
import { useSpotlightRect } from '@/lib/hooks/useSpotlightRect'
import { usePanelPosition } from '@/lib/hooks/usePanelPosition'
import { useWalkthroughDismissal } from '@/lib/hooks/useWalkthroughDismissal'
import { WalkthroughBackdrop } from '@/components/onboarding/WalkthroughBackdrop'

const ONBOARDING_KEY = 'taskapp_internal_onboarded'

interface WalkthroughStep {
  icon: React.ElementType
  iconColor: string
  iconBg: string
  title: string
  description: string
  /**
   * CSS selectors for the element to spotlight, in priority order — later
   * entries are fallbacks for states where the primary is absent (e.g. a
   * brand-new project with zero task rows). Falls back to a centered dialog
   * if none match.
   */
  targetSelectors?: readonly string[]
  /** 編集できる人にだけ見せる手順か（既定 false）。無い「タスクを追加」ボタン等、閲覧者には案内できない内容につける */
  requiresEdit?: boolean
}

const steps: WalkthroughStep[] = [
  {
    icon: PlusCircle,
    iconColor: 'text-blue-600',
    iconBg: 'bg-blue-100',
    title: 'タスク作成の流れ',
    description: '右上の「タスクを追加」ボタンから作成できます。タイトルを入力してEnter、詳細は後から編集できます。',
    // ヘッダーの常設「タスクを追加」ボタンが DOM 順で先頭に見つかりハイライトされる
    // （空状態のCTA・一覧最下段のインライン行にも同じ目印がある）。
    // サイドバー内の要素は別スタッキングコンテキストで隠れるため使わない。
    targetSelectors: ['[data-walkthrough="task-create"]'],
    requiresEdit: true,
  },
  {
    icon: ArrowsLeftRight,
    iconColor: 'text-amber-600',
    iconBg: 'bg-amber-100',
    title: 'ボールの概念',
    description: '次にアクションを取る側を表します。「社内」はチーム、「外部」はクライアント対応中です。',
    targetSelectors: [
      '[data-walkthrough="task-row-ball"]',
      '[data-walkthrough="filter-client-wait"]',
    ],
  },
  {
    icon: Eye,
    iconColor: 'text-indigo-600',
    iconBg: 'bg-indigo-100',
    title: 'クライアントに公開',
    description: 'ONにするとクライアントのポータルにタスクが表示されます。',
    targetSelectors: [
      '[data-walkthrough="task-row-visibility"]',
      '[data-walkthrough="filter-client-wait"]',
    ],
  },
  {
    icon: RocketLaunch,
    iconColor: 'text-emerald-600',
    iconBg: 'bg-emerald-100',
    title: '準備完了！',
    description:
      'これでプロジェクト管理を始められます。秘書コンソールのQRでLINE秘書と友だち追加し、' +
      '表示されたコードをトークに送信すると連携完了です（コード送信まで行って初めて連携されます）。',
  },
]

/**
 * Clear the onboarding flag (localStorage + server) so the walkthrough
 * shows again on next mount. Server clear must complete before callers
 * reload/navigate, otherwise `useOnboardingFlag` re-reads the still-true
 * server flag and the walkthrough stays hidden.
 */
export async function resetInternalOnboarding(): Promise<void> {
  if (typeof window === 'undefined') return
  try {
    localStorage.removeItem(ONBOARDING_KEY)
  } catch {
    // localStorage unavailable
  }
  await resetOnboardingFlagOnServer('internal_walkthrough')
}

interface InternalOnboardingWalkthroughProps {
  /**
   * 編集できる人か（既定 true）。false（閲覧者・相手先）のときは、無い
   * 「タスクを追加」ボタンを案内する手順1「タスク作成の流れ」を飛ばす。
   */
  canEdit?: boolean
  /**
   * canEdit の元になる役割の判定が確定しているか（既定 true）。false の間は
   * ガイドを開かない。役割が未確定のまま開くと、後で確定して手順の数
   * （visibleSteps）が変わったときに、開いたまま表示中の手順の中身が
   * すり替わってしまう（例: 手順1が飛ばされた状態で開いた直後に、実は
   * 編集者だと分かって手順1が追加され、同じ番号なのに違う内容になる）。
   * 呼び出し元は useCanEditSpace の resolved を渡す。
   */
  roleResolved?: boolean
}

export function InternalOnboardingWalkthrough({
  canEdit = true,
  roleResolved = true,
}: InternalOnboardingWalkthroughProps = {}) {
  const { shouldShow, markDone } = useOnboardingFlag('internal_walkthrough', ONBOARDING_KEY)
  const [isOpen, setIsOpen] = useState(false)
  const [currentStep, setCurrentStep] = useState(0)
  const [fadeIn, setFadeIn] = useState(false)

  const visibleSteps = useMemo(
    () => (canEdit ? steps : steps.filter((s) => !s.requiresEdit)),
    [canEdit]
  )

  useEffect(() => {
    // 役割が確定するまでは開かない（詳細は roleResolved の説明を参照）
    if (shouldShow && roleResolved) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- opens once the async server/localStorage flag check resolves
      setIsOpen(true)
      const timer = setTimeout(() => setFadeIn(true), 50)
      return () => clearTimeout(timer)
    }
  }, [shouldShow, roleResolved])

  const handleClose = useCallback(() => {
    setFadeIn(false)
    const timer = setTimeout(() => {
      setIsOpen(false)
      void markDone()
    }, 200)
    return () => clearTimeout(timer)
  }, [markDone])

  const handleNext = useCallback(() => {
    if (currentStep < visibleSteps.length - 1) {
      setCurrentStep((prev) => prev + 1)
    } else {
      handleClose()
    }
  }, [currentStep, handleClose, visibleSteps.length])

  const handlePrev = useCallback(() => {
    if (currentStep > 0) {
      setCurrentStep((prev) => prev - 1)
    }
  }, [currentStep])

  const step = visibleSteps[currentStep]
  const { rect: targetRect, matchedSelector } = useSpotlightRect(step.targetSelectors, isOpen)
  const panelRef = useRef<HTMLDivElement>(null)
  const panelStyle = usePanelPosition(panelRef, targetRect)

  // Esc closes, arrow keys navigate, clicking the spotlighted target
  // advances the step, and clicking the dimmed background closes.
  useWalkthroughDismissal({
    isOpen,
    panelRef,
    targetSelector: matchedSelector ?? undefined,
    onNext: handleNext,
    onPrev: handlePrev,
    onClose: handleClose,
  })

  if (!isOpen) return null

  const Icon = step.icon
  const isLast = currentStep === visibleSteps.length - 1

  // 親ペイン（main等）のスタッキングコンテキストに閉じ込められると
  // サイドバーの下に描画されるため、body直下にポータルで出す
  return createPortal(
    <div
      role="dialog"
      aria-labelledby="internal-onboarding-title"
      aria-describedby="internal-onboarding-description"
      className={`fixed inset-0 z-[100] pointer-events-none transition-opacity duration-200 ${
        targetRect ? '' : 'flex items-center justify-center p-4'
      } ${fadeIn ? 'opacity-100' : 'opacity-0'}`}
    >
      {/* Dimmed area: blocks clicks to the UI underneath and closes the
          tour; only the spotlight hole lets clicks reach the real target. */}
      <WalkthroughBackdrop targetRect={targetRect} onClose={handleClose} />
      {targetRect && (
        <div
          data-testid="walkthrough-spotlight-ring"
          className="fixed rounded-lg ring-4 ring-indigo-600 pointer-events-none transition-all duration-200"
          style={{
            top: targetRect.top - 8,
            left: targetRect.left - 8,
            width: targetRect.width + 16,
            height: targetRect.height + 16,
          }}
        />
      )}

      {/* Card */}
      <div
        ref={panelRef}
        data-testid="walkthrough-panel"
        className={`${targetRect ? '' : 'relative'} pointer-events-auto w-[calc(100vw-2rem)] max-w-lg bg-surface rounded-2xl shadow-2xl overflow-hidden transition-all duration-200 ${
          fadeIn ? 'scale-100 translate-y-0' : 'scale-95 translate-y-4'
        }`}
        style={panelStyle}
      >
        {/* Top accent bar */}
        <div className="h-1 bg-indigo-600" />

        {/* Close / Skip */}
        <button
          onClick={handleClose}
          className="absolute top-4 right-4 p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
          aria-label="閉じる"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Content */}
        <div className="px-5 pt-6 pb-5 md:px-8 md:pt-8 md:pb-6">
          {/* Icon */}
          <div
            className={`w-11 h-11 md:w-14 md:h-14 rounded-xl ${step.iconBg} flex items-center justify-center mb-4 md:mb-5`}
          >
            <Icon className={`w-5 h-5 md:w-7 md:h-7 ${step.iconColor}`} weight="duotone" />
          </div>

          {/* Step indicator */}
          <div className="flex items-center gap-1 mb-4">
            {visibleSteps.map((_, i) => (
              <div
                key={i}
                className={`h-1 rounded-full transition-all duration-300 ${
                  i === currentStep
                    ? 'w-8 bg-indigo-600'
                    : i < currentStep
                      ? 'w-4 bg-indigo-200'
                      : 'w-4 bg-gray-200'
                }`}
              />
            ))}
            <span className="ml-2 text-xs text-gray-400 font-medium">
              {currentStep + 1}/{visibleSteps.length}
            </span>
          </div>

          {/* Title */}
          <h2
            id="internal-onboarding-title"
            className="text-lg md:text-xl font-bold text-gray-900 mb-2"
          >
            {step.title}
          </h2>

          {/* Description */}
          <p
            id="internal-onboarding-description"
            className="text-sm text-gray-600 leading-relaxed"
          >
            {step.description}
          </p>
        </div>

        {/* Footer Actions */}
        <div className="px-5 pb-5 md:px-8 md:pb-6 flex items-center justify-between">
          <div>
            {currentStep === 0 ? (
              <button
                onClick={handleClose}
                className="text-sm text-gray-400 hover:text-gray-600 transition-colors px-3 py-1.5 rounded-lg hover:bg-gray-50"
              >
                スキップ
              </button>
            ) : (
              <button
                onClick={handlePrev}
                className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 transition-colors px-3 py-1.5 rounded-lg hover:bg-gray-50"
              >
                <CaretLeft className="w-4 h-4" />
                戻る
              </button>
            )}
          </div>

          <button
            onClick={handleNext}
            className={`flex items-center gap-1.5 px-5 py-2.5 text-sm font-medium rounded-lg transition-colors ${
              isLast
                ? 'bg-indigo-600 hover:bg-indigo-700 text-white'
                : 'bg-indigo-600 hover:bg-indigo-700 text-white'
            }`}
          >
            {isLast ? (
              '始めましょう'
            ) : (
              <>
                次へ
                <CaretRight className="w-4 h-4" />
              </>
            )}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
