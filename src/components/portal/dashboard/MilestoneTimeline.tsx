'use client'

import { type MilestoneStatus } from '../ui'

interface Milestone {
  id: string
  name: string
  status: MilestoneStatus
  dueDate?: string | null
}

interface MilestoneTimelineProps {
  milestones: Milestone[]
  className?: string
}

export function MilestoneTimeline({ milestones, className = '' }: MilestoneTimelineProps) {
  if (milestones.length === 0) {
    return null
  }

  const formatDate = (date: string | null | undefined) => {
    if (!date) return undefined
    const d = new Date(date)
    return d.toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric' })
  }

  return (
    <div className={`space-y-4 ${className}`}>
      {milestones.map((milestone) => {
        // Map available statuses to Gantt visualization states
        const isCompleted = milestone.status === 'completed'
        const isCurrent = milestone.status === 'current'
        // 'upcoming' is the default/pending state

        return (

          <div key={milestone.id} className="relative group">
            <div className="flex items-end justify-between mb-2">
              <div className="flex items-center gap-3">
                {/* Status Indicator */}
                <div className={`
                    w-2.5 h-2.5 rounded-full ring-2 ring-white shadow-sm
                    ${isCompleted ? 'bg-emerald-400' : isCurrent ? 'bg-indigo-500 animate-pulse' : 'bg-gray-200'}
                 `} />

                <div>
                  <div className="flex items-center gap-2">
                    <span className={`text-sm font-bold tracking-tight ${isCurrent ? 'text-indigo-900' : 'text-gray-700'}`}>
                      {milestone.name}
                    </span>
                    {isCurrent && (
                      <span className="text-[10px] bg-indigo-50 text-indigo-600 px-2 py-0.5 rounded-full font-bold border border-indigo-100">
                        NOW
                      </span>
                    )}
                  </div>
                </div>
              </div>
              <span className="text-xs text-gray-400 font-mono font-medium opacity-0 group-hover:opacity-100 transition-opacity">
                {formatDate(milestone.dueDate)}
              </span>
            </div>

            {/* Progress Track */}
            <div className="h-2.5 w-full bg-gray-100/80 rounded-full overflow-hidden shadow-inner">
              <div
                className={`h-full rounded-full transition-all duration-1000 ease-out relative ${isCompleted ? 'bg-gradient-to-r from-emerald-400 to-emerald-500 w-full' :
                  isCurrent ? 'bg-gradient-to-r from-indigo-400 to-indigo-600 w-1/2' : // Illustrative visual 50%
                    'bg-transparent w-0'
                  }`}
              >
                {isCurrent && (
                  <div className="absolute inset-0 bg-white/20 animate-[shimmer_2s_infinite]" />
                )}
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
