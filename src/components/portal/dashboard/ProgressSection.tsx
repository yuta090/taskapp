'use client'

import { CalendarBlank, Clock } from '@phosphor-icons/react'
import { BentoCard } from './BentoCard'

interface ProgressSectionProps {
  completedCount: number
  totalCount: number
  deadline?: string | null
  className?: string
}

export function ProgressSection({ completedCount, totalCount, deadline, className = '' }: ProgressSectionProps) {
  const percent = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0
  const radius = 70 // Larger radius
  const circumference = 2 * Math.PI * radius
  const strokeDashoffset = circumference - (percent / 100) * circumference

  // Calculate remaining days
  const getRemainingDays = () => {
    if (!deadline) return null
    const deadlineDate = new Date(deadline)
    const now = new Date()
    const diffTime = deadlineDate.getTime() - now.getTime()
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24))
    return diffDays
  }

  const remainingDays = getRemainingDays()
  const isOverdue = remainingDays !== null && remainingDays < 0

  const formatDeadline = (date: string) => {
    const d = new Date(date)
    return d.toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric' })
  }

  return (
    <BentoCard className={`!p-0 relative overflow-hidden h-full min-h-[300px] ${className}`}>

      {/* Background decoration - Aurora Gradient */}
      <div className="absolute inset-0 bg-gradient-to-br from-indigo-50/50 via-white to-white z-0" />
      <div className="absolute -top-24 -right-24 w-64 h-64 bg-indigo-500/5 rounded-full blur-3xl" />
      <div className="absolute bottom-0 left-0 w-full h-1/2 bg-gradient-to-t from-white via-white/80 to-transparent z-10" />

      <div className="relative z-20 flex flex-col items-center justify-center h-full p-6">

        <h3 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-4">PROJECT PROGRESS</h3>

        <div className="relative mb-4">
          {/* Main Progress SVG */}
          <svg className="transform -rotate-90 w-44 h-44 drop-shadow-xl">
            {/* Background Ring */}
            <circle
              cx="88"
              cy="88"
              r={radius}
              stroke="currentColor"
              strokeWidth="14"
              fill="transparent"
              className="text-gray-100"
            />
            {/* Progress Ring */}
            <circle
              cx="88"
              cy="88"
              r={radius}
              stroke="url(#gradient)"
              strokeWidth="14"
              fill="transparent"
              strokeDasharray={circumference}
              strokeDashoffset={strokeDashoffset}
              strokeLinecap="round"
              className="transition-all duration-1000 ease-out"
            />
            <defs>
              <linearGradient id="gradient" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#6366f1" />
                <stop offset="100%" stopColor="#a855f7" />
              </linearGradient>
            </defs>
          </svg>

          {/* Score in center */}
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-5xl font-black text-gray-900 tracking-tighter">
              {percent}<span className="text-xl text-gray-400 font-bold ml-0.5">%</span>
            </span>
            <span className="text-xs text-gray-400 mt-1">{completedCount}件完了</span>
          </div>
        </div>

        {/* Deadline Info */}
        {deadline && (
          <div className="flex flex-col items-center gap-2 mt-2 w-full">
            <div className="flex items-center gap-1.5 text-sm text-gray-600">
              <CalendarBlank className="w-4 h-4" weight="duotone" />
              <span>完了予定: {formatDeadline(deadline)}</span>
            </div>
            {remainingDays !== null && (
              <div className={`flex items-center gap-1.5 text-sm font-medium ${
                isOverdue ? 'text-rose-600' : remainingDays <= 7 ? 'text-amber-600' : 'text-gray-500'
              }`}>
                <Clock className="w-4 h-4" weight="duotone" />
                {isOverdue ? (
                  <span>{Math.abs(remainingDays)}日超過</span>
                ) : (
                  <span>残り{remainingDays}日</span>
                )}
              </div>
            )}
          </div>
        )}

      </div>
    </BentoCard>
  )
}
