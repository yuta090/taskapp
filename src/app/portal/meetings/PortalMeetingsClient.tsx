'use client'

import { useState } from 'react'
import { Calendar, Clock, CaretRight, FileText, X } from '@phosphor-icons/react'
import { PortalShell } from '@/components/portal'

interface Project {
  id: string
  name: string
  orgId: string
  orgName?: string
}

interface Meeting {
  id: string
  title: string
  heldAt: string | null
  status: string
  minutesMd?: string | null
  summarySubject?: string | null
  summaryBody?: string | null
  startedAt?: string | null
  endedAt?: string | null
}

interface PortalMeetingsClientProps {
  currentProject: Project
  projects: Project[]
  meetings: Meeting[]
  actionCount?: number
}

function formatDate(date: string): string {
  const d = new Date(date)
  return d.toLocaleDateString('ja-JP', {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  })
}

function formatTime(date: string): string {
  const d = new Date(date)
  return d.toLocaleTimeString('ja-JP', {
    hour: '2-digit',
    minute: '2-digit',
  })
}

// Meeting Inspector component
function MeetingInspector({
  meeting,
  onClose,
}: {
  meeting: Meeting
  onClose: () => void
}) {
  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 shrink-0">
        <span className="text-sm font-medium text-gray-900">議事録詳細</span>
        <button
          onClick={onClose}
          className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded transition-colors"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        <div className="px-4 py-3 border-b border-gray-100 bg-gray-50">
          <h3 className="font-medium text-gray-900">{meeting.title}</h3>
          <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
            <span>{meeting.heldAt ? formatDate(meeting.heldAt) : '-'}</span>
            {meeting.startedAt && meeting.endedAt && (
              <span>
                {formatTime(meeting.startedAt)} - {formatTime(meeting.endedAt)}
              </span>
            )}
          </div>
        </div>

        <div className="p-4">
          {meeting.summarySubject && (
            <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-lg">
              <div className="text-xs font-medium text-amber-700 mb-1">サマリー</div>
              <p className="text-sm text-amber-900">{meeting.summarySubject}</p>
              {meeting.summaryBody && (
                <p className="text-sm text-amber-800 mt-2">{meeting.summaryBody}</p>
              )}
            </div>
          )}

          {meeting.minutesMd ? (
            <div className="prose prose-sm max-w-none">
              <div className="text-xs font-medium text-gray-500 mb-2">議事録</div>
              <div className="whitespace-pre-wrap text-sm text-gray-700">
                {meeting.minutesMd}
              </div>
            </div>
          ) : (
            <div className="text-center py-8 text-gray-400">
              <FileText className="w-8 h-8 mx-auto mb-2" />
              <p className="text-sm">議事録はありません</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export function PortalMeetingsClient({
  currentProject,
  projects,
  meetings,
  actionCount = 0,
}: PortalMeetingsClientProps) {
  const [selectedMeeting, setSelectedMeeting] = useState<Meeting | null>(null)

  // Inspector content
  const inspector = selectedMeeting ? (
    <MeetingInspector
      meeting={selectedMeeting}
      onClose={() => setSelectedMeeting(null)}
    />
  ) : null

  return (
    <PortalShell
      currentProject={currentProject}
      projects={projects}
      actionCount={actionCount}
      inspector={inspector}
    >
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-4xl mx-auto space-y-6">
          {/* Page Header */}
          <div>
            <h1 className="text-2xl font-bold text-gray-900">議事録</h1>
            <p className="mt-1 text-sm text-gray-600">
              過去のミーティングの議事録を確認できます
            </p>
          </div>

          {meetings.length === 0 ? (
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-8 text-center">
              <FileText className="w-12 h-12 text-gray-300 mx-auto mb-3" />
              <p className="text-gray-600">議事録はまだありません</p>
            </div>
          ) : (
            <div className="space-y-3">
              {meetings.map((meeting) => (
                <button
                  key={meeting.id}
                  onClick={() => setSelectedMeeting(meeting)}
                  className={`w-full text-left bg-white rounded-xl border shadow-sm p-4 hover:shadow-md transition-all ${
                    selectedMeeting?.id === meeting.id
                      ? 'border-amber-500 ring-1 ring-amber-500'
                      : 'border-gray-200'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <h3 className="text-sm font-medium text-gray-900 truncate">
                        {meeting.title}
                      </h3>
                      <div className="flex items-center gap-3 mt-1.5 text-xs text-gray-500">
                        <span className="flex items-center gap-1">
                          <Calendar className="w-3.5 h-3.5" />
                          {formatDate(meeting.heldAt || '')}
                        </span>
                        {meeting.startedAt && (
                          <span className="flex items-center gap-1">
                            <Clock className="w-3.5 h-3.5" />
                            {formatTime(meeting.startedAt)}
                          </span>
                        )}
                      </div>
                      {meeting.summarySubject && (
                        <p className="mt-2 text-xs text-gray-600 line-clamp-2">
                          {meeting.summarySubject}
                        </p>
                      )}
                    </div>
                    <CaretRight className="w-5 h-5 text-gray-400 shrink-0" />
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </PortalShell>
  )
}
