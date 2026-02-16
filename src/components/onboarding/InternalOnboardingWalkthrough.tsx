'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  PlusCircle,
  ArrowsLeftRight,
  Eye,
  RocketLaunch,
  X,
  CaretRight,
  CaretLeft,
} from '@phosphor-icons/react'

const ONBOARDING_KEY = 'taskapp_internal_onboarded'

interface WalkthroughStep {
  icon: React.ElementType
  iconColor: string
  iconBg: string
  title: string
  description: string
  detail?: string
}

const steps: WalkthroughStep[] = [
  {
    icon: PlusCircle,
    iconColor: 'text-blue-600',
    iconBg: 'bg-blue-100',
    title: 'タスク作成の流れ',
    description:
      'タイトルを入力してEnterで即作成。詳細は右側のインスペクターで編集できます。',
    detail:
      '「詳細オプション」を開くと、タスクタイプ・担当者・期限・マイルストーンなどを作成時に設定できます。まずはタイトルだけで作成し、後から詳細を追加するのがおすすめです。',
  },
  {
    icon: ArrowsLeftRight,
    iconColor: 'text-amber-600',
    iconBg: 'bg-amber-100',
    title: 'ボールの概念',
    description:
      '「ボール」は次にアクションを取る側を表します。',
    detail:
      '「社内」= チームが作業中。「外部」= クライアントの確認待ち。ボールを「外部」にすると、クライアント側の関係者を指定する必要があります。タスクの停滞を防ぐための仕組みです。',
  },
  {
    icon: Eye,
    iconColor: 'text-indigo-600',
    iconBg: 'bg-indigo-100',
    title: 'ポータル公開',
    description:
      '「ポータル公開」をONにすると、クライアントのポータルにタスクが表示されます。',
    detail:
      '黄色いバッジがついた要素はクライアントに見えるものです。社内の作業タスクは非公開のままにして、成果物や確認事項だけを公開するのがベストプラクティスです。',
  },
  {
    icon: RocketLaunch,
    iconColor: 'text-emerald-600',
    iconBg: 'bg-emerald-100',
    title: '準備完了！',
    description:
      'これでプロジェクト管理を始められます。',
    detail:
      'タスク一覧の左側でプロジェクトを切り替え、右側のインスペクターで詳細を編集。ガントチャートやバーンダウンチャートで進捗も確認できます。',
  },
]

function isOnboarded(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return localStorage.getItem(ONBOARDING_KEY) === 'true'
  } catch {
    return false
  }
}

function markOnboarded(): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(ONBOARDING_KEY, 'true')
  } catch {
    // localStorage unavailable
  }
}

export function InternalOnboardingWalkthrough() {
  const [isOpen, setIsOpen] = useState(false)
  const [currentStep, setCurrentStep] = useState(0)
  const [fadeIn, setFadeIn] = useState(false)

  useEffect(() => {
    if (!isOnboarded()) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- must run after hydration; localStorage unavailable during SSR
      setIsOpen(true)
      const timer = setTimeout(() => setFadeIn(true), 50)
      return () => clearTimeout(timer)
    }
  }, [])

  const handleClose = useCallback(() => {
    setFadeIn(false)
    const timer = setTimeout(() => {
      setIsOpen(false)
      markOnboarded()
    }, 200)
    return () => clearTimeout(timer)
  }, [])

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

  useEffect(() => {
    if (!isOpen) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleClose()
      } else if (e.key === 'ArrowRight') {
        handleNext()
      } else if (e.key === 'ArrowLeft') {
        handlePrev()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, handleClose, handleNext, handlePrev])

  if (!isOpen) return null

  const step = steps[currentStep]
  const Icon = step.icon
  const isLast = currentStep === steps.length - 1

  return (
    <div
      role="dialog"
      aria-labelledby="internal-onboarding-title"
      aria-describedby="internal-onboarding-description"
      className={`fixed inset-0 z-[100] flex items-center justify-center p-4 transition-opacity duration-200 ${
        fadeIn ? 'opacity-100' : 'opacity-0'
      }`}
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={handleClose}
      />

      {/* Card */}
      <div
        className={`relative w-full max-w-lg bg-white rounded-2xl shadow-2xl overflow-hidden transition-all duration-200 ${
          fadeIn ? 'scale-100 translate-y-0' : 'scale-95 translate-y-4'
        }`}
      >
        {/* Top accent bar */}
        <div className="h-1 bg-gradient-to-r from-blue-400 via-blue-500 to-indigo-500" />

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
                    ? 'w-8 bg-blue-500'
                    : i < currentStep
                      ? 'w-4 bg-blue-300'
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
            id="internal-onboarding-title"
            className="text-xl font-bold text-gray-900 mb-2"
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

          {/* Detail */}
          {step.detail && (
            <p className="mt-3 text-sm text-gray-500 leading-relaxed">
              {step.detail}
            </p>
          )}
        </div>

        {/* Footer Actions */}
        <div className="px-8 pb-6 flex items-center justify-between">
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
                ? 'bg-blue-500 hover:bg-blue-600 text-white'
                : 'bg-gray-900 hover:bg-gray-800 text-white'
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
