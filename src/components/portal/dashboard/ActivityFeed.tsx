'use client'

import { useState } from 'react'
import { CaretDown, CaretUp, CheckCircle, ChatCircle, Flag, Bell } from '@phosphor-icons/react'

type ActivityType = 'task_completed' | 'comment' | 'milestone' | 'notification'

interface Activity {
  id: string
  type: ActivityType
  message: string
  timestamp: string
  actor?: string
}

interface ActivityFeedProps {
  activities: Activity[]
  maxDisplay?: number
  className?: string
}

const activityConfig = {
  task_completed: {
    icon: CheckCircle,
    iconColor: 'text-emerald-500',
    bgColor: 'bg-emerald-100',
  },
  comment: {
    icon: ChatCircle,
    iconColor: 'text-blue-500',
    bgColor: 'bg-blue-100',
  },
  milestone: {
    icon: Flag,
    iconColor: 'text-purple-500',
    bgColor: 'bg-purple-100',
  },
  notification: {
    icon: Bell,
    iconColor: 'text-amber-500',
    bgColor: 'bg-amber-100',
  },
}

function formatTimestamp(timestamp: string): string {
  const date = new Date(timestamp)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMs / 3600000)
  const diffDays = Math.floor(diffMs / 86400000)

  if (diffMins < 1) return 'たった今'
  if (diffMins < 60) return `${diffMins}分前`
  if (diffHours < 24) return `${diffHours}時間前`
  if (diffDays < 7) return `${diffDays}日前`

  return date.toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric' })
}

export function ActivityFeed({ activities, maxDisplay = 2, className = '' }: ActivityFeedProps) {
  const [expanded, setExpanded] = useState(false)

  if (activities.length === 0) {
    return null
  }

  const displayActivities = expanded ? activities : activities.slice(0, maxDisplay)
  const hasMore = activities.length > maxDisplay

  return (
    <div className={className}>
      <div className="space-y-3">
        {displayActivities.map((activity) => {
          const config = activityConfig[activity.type]
          const Icon = config.icon

          return (
            <div key={activity.id} className="flex items-start gap-2">
              <div className={`w-6 h-6 rounded-full ${config.bgColor} flex items-center justify-center shrink-0`}>
                <Icon className={`w-3 h-3 ${config.iconColor}`} weight="fill" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs text-gray-700 leading-relaxed">{activity.message}</p>
                <p className="text-[10px] text-gray-400 mt-0.5">
                  {formatTimestamp(activity.timestamp)}
                </p>
              </div>
            </div>
          )
        })}
      </div>
      {hasMore && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center justify-center gap-1 w-full text-xs text-gray-500 hover:text-gray-700 transition-colors py-2 mt-2"
        >
          {expanded ? (
            <>
              <CaretUp className="w-3 h-3" />
              閉じる
            </>
          ) : (
            <>
              <CaretDown className="w-3 h-3" />
              もっと見る ({activities.length - maxDisplay}件)
            </>
          )}
        </button>
      )}
    </div>
  )
}
