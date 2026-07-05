'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import {
  Lightning,
  Cursor,
  CheckCircle,
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

const ONBOARDING_KEY = 'taskapp_portal_onboarded'

interface WalkthroughStep {
  icon: React.ElementType
  iconColor: string
  iconBg: string
  title: string
  description: string
  /** CSS selector for the element to spotlight; falls back to a centered dialog if absent/unmatched. */
  targetSelector?: string
}

const steps: WalkthroughStep[] = [
  {
    icon: Lightning,
    iconColor: 'text-amber-600',
    iconBg: 'bg-amber-100',
    title: '確認が必要なタスク',
    description: 'ここに届いた成果物や仕様書を確認します。',
    targetSelector: '[data-walkthrough="portal-action-section"]',
  },
  {
    icon: Cursor,
    iconColor: 'text-indigo-600',
    iconBg: 'bg-indigo-100',
    title: 'クリックして詳細を見る',
    description: 'クリックすると右側に詳細説明や期限が開きます。',
    targetSelector: '[data-walkthrough="portal-action-card"]',
  },
  {
    icon: CheckCircle,
    iconColor: 'text-emerald-600',
    iconBg: 'bg-emerald-100',
    title: '承認・修正依頼',
    description: '問題なければ承認、修正が必要なら修正依頼を選びます。',
    targetSelector: '[data-walkthrough="portal-action-buttons"]',
  },
  {
    icon: RocketLaunch,
    iconColor: 'text-purple-600',
    iconBg: 'bg-purple-100',
    title: '準備完了です！',
    description: 'これでプロジェクトポータルを使い始められます。',
  },
]

/**
 * Clear the onboarding flag (localStorage + server) so the walkthrough
 * shows again on next mount. Server clear must complete before callers
 * reload/navigate, otherwise `useOnboardingFlag` re-reads the still-true
 * server flag and the walkthrough stays hidden.
 */
export async function resetPortalOnboarding(): Promise<void> {
  if (typeof window === 'undefined') return
  try {
    localStorage.removeItem(ONBOARDING_KEY)
  } catch {
    // localStorage unavailable
  }
  await resetOnboardingFlagOnServer('portal_walkthrough')
}

export function PortalOnboardingWalkthrough() {
  const { shouldShow, markDone } = useOnboardingFlag('portal_walkthrough', ONBOARDING_KEY)
  const [isOpen, setIsOpen] = useState(false)
  const [currentStep, setCurrentStep] = useState(0)
  const [fadeIn, setFadeIn] = useState(false)

  // Trigger fade-in once the server/localStorage check resolves to "not yet seen".
  useEffect(() => {
    if (shouldShow) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- opens once the async server/localStorage flag check resolves
      setIsOpen(true)
      // Trigger fade-in after browser paint
      const timer = setTimeout(() => setFadeIn(true), 50)
      return () => clearTimeout(timer)
    }
  }, [shouldShow])

  const handleClose = useCallback(() => {
    setFadeIn(false)
    // Wait for fade-out before unmounting
    const timer = setTimeout(() => {
      setIsOpen(false)
      void markDone()
    }, 200)
    return () => clearTimeout(timer)
  }, [markDone])

  const handleNext = useCallback(() => {
    if (currentStep < steps.length - 1) {
      setCurrentStep((prev) => prev + 1)
    } else {
      handleClose()
    }
  }, [currentStep, handleClose])

  const handlePrev = useCallback(() => {
    if (currentStep > 0) {
      setCurrentStep((prev) => prev - 1)
    }
  }, [currentStep])

  const step = steps[currentStep]
  const targetRect = useSpotlightRect(step.targetSelector, isOpen)
  const panelRef = useRef<HTMLDivElement>(null)
  const panelStyle = usePanelPosition(panelRef, targetRect)

  // Esc closes, arrow keys navigate, clicking the spotlighted target
  // advances the step, and clicking the dimmed background closes.
  useWalkthroughDismissal({
    isOpen,
    panelRef,
    targetSelector: step.targetSelector,
    onNext: handleNext,
    onPrev: handlePrev,
    onClose: handleClose,
  })

  if (!isOpen) return null

  const Icon = step.icon
  const isLast = currentStep === steps.length - 1

  return (
    <div
      role="dialog"
      aria-labelledby="onboarding-title"
      aria-describedby="onboarding-description"
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
        className={`${targetRect ? '' : 'relative'} pointer-events-auto w-full max-w-lg bg-white rounded-2xl shadow-2xl overflow-hidden transition-all duration-200 ${
          fadeIn ? 'scale-100 translate-y-0' : 'scale-95 translate-y-4'
        }`}
        style={panelStyle}
      >
        {/* Top accent bar */}
        <div className="h-1 bg-amber-500" />

        {/* Close / Skip */}
        <button
          onClick={handleClose}
          className="absolute top-4 right-4 p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
          aria-label="閉じる"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Content */}
        <div className="px-8 pt-8 pb-6">
          {/* Icon */}
          <div
            className={`w-14 h-14 rounded-xl ${step.iconBg} flex items-center justify-center mb-5`}
          >
            <Icon className={`w-7 h-7 ${step.iconColor}`} weight="duotone" />
          </div>

          {/* Step indicator */}
          <div className="flex items-center gap-1 mb-4">
            {steps.map((_, i) => (
              <div
                key={i}
                className={`h-1 rounded-full transition-all duration-300 ${
                  i === currentStep
                    ? 'w-8 bg-amber-500'
                    : i < currentStep
                      ? 'w-4 bg-amber-300'
                      : 'w-4 bg-gray-200'
                }`}
              />
            ))}
            <span className="ml-2 text-xs text-gray-400 font-medium">
              {currentStep + 1}/{steps.length}
            </span>
          </div>

          {/* Title */}
          <h2
            id="onboarding-title"
            className="text-xl font-semibold text-gray-900 mb-2"
          >
            {step.title}
          </h2>

          {/* Description */}
          <p
            id="onboarding-description"
            className="text-sm text-gray-600 leading-relaxed"
          >
            {step.description}
          </p>
        </div>

        {/* Footer Actions */}
        <div className="px-8 pb-6 flex items-center justify-between">
          {/* Left side: Skip or Back */}
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

          {/* Right side: Next or Complete */}
          <button
            onClick={handleNext}
            className={`flex items-center gap-1.5 px-5 py-2.5 text-sm font-medium rounded-lg transition-colors ${
              isLast
                ? 'bg-amber-500 hover:bg-amber-600 text-white'
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
    </div>
  )
}
