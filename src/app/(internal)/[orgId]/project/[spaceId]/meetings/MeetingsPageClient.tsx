'use client'

import { useState, useCallback, useEffect, useMemo } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Notebook } from '@phosphor-icons/react'
import { useInspector } from '@/components/layout'
import { Breadcrumb } from '@/components/shared'
import { MeetingRow } from '@/components/meeting/MeetingRow'
import { MeetingInspector } from '@/components/meeting/MeetingInspector'
import { MeetingCreateSheet, type MeetingCreateData } from '@/components/meeting'
import { useMeetings } from '@/lib/hooks/useMeetings'
import type { Meeting } from '@/types/database'

interface MeetingsPageClientProps {
  orgId: string
  spaceId: string
}

export function MeetingsPageClient({ orgId, spaceId }: MeetingsPageClientProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { setInspector } = useInspector()
  const [isCreateSheetOpen, setIsCreateSheetOpen] = useState(false)
  const {
    meetings,
    participants,
    loading,
    error,
    fetchMeetings,
    createMeeting,
    startMeeting,
    endMeeting,
  } = useMeetings({ orgId, spaceId })

  const projectBasePath = `/${orgId}/project/${spaceId}/meetings`
  const selectedMeetingId = searchParams.get('meeting')

  useEffect(() => {
    void fetchMeetings()
  }, [fetchMeetings])

  useEffect(() => {
    return () => {
      setInspector(null)
    }
  }, [setInspector])

  const updateQuery = useCallback(
    (updates: Record<string, string | null>) => {
      const params = new URLSearchParams(searchParams.toString())
      Object.entries(updates).forEach(([key, value]) => {
        if (value === null) {
          params.delete(key)
        } else {
          params.set(key, value)
        }
      })
      const query = params.toString()
      router.replace(query ? `${projectBasePath}?${query}` : projectBasePath)
    },
    [router, projectBasePath, searchParams]
  )

  const selectedMeeting: Meeting | null = useMemo(() => {
    if (!selectedMeetingId) return null
    return meetings.find((meeting) => meeting.id === selectedMeetingId) ?? null
  }, [meetings, selectedMeetingId])

  useEffect(() => {
    if (!selectedMeeting) {
      setInspector(null)
      return
    }

    setInspector(
      <MeetingInspector
        meeting={selectedMeeting}
        participants={participants[selectedMeeting.id] || []}
        onClose={() => updateQuery({ meeting: null })}
        onStart={async () => {
          try {
            await startMeeting(selectedMeeting.id)
          } catch {
            alert('会議の開始に失敗しました')
          }
        }}
        onEnd={async () => {
          try {
            await endMeeting(selectedMeeting.id)
          } catch {
            alert('会議の終了に失敗しました')
          }
        }}
      />
    )
  }, [endMeeting, participants, selectedMeeting, setInspector, startMeeting, updateQuery])

  const handleOpenCreateSheet = () => {
    setIsCreateSheetOpen(true)
  }

  const handleCreateMeeting = async (data: MeetingCreateData) => {
    try {
      const created = await createMeeting({
        title: data.title,
        heldAt: data.heldAt,
        clientParticipantIds: data.clientParticipantIds,
        internalParticipantIds: data.internalParticipantIds,
      })
      setIsCreateSheetOpen(false)
      updateQuery({ meeting: created.id })
    } catch (err) {
      const message = err instanceof Error ? err.message : '会議の作成に失敗しました'
      alert(message)
    }
  }

  const breadcrumbItems = [
    { label: 'Webリニューアル', href: `/${orgId}/project/${spaceId}` },
    { label: '議事録' },
  ]

  return (
    <div className="flex-1 flex flex-col">
      {/* Header */}
      <header className="h-12 border-b border-gray-100 flex items-center px-5 flex-shrink-0">
        <div className="flex items-center gap-2">
          <Notebook className="text-lg text-gray-500" />
          <Breadcrumb items={breadcrumbItems} />
        </div>
        <button
          type="button"
          data-testid="meetings-create"
          onClick={handleOpenCreateSheet}
          className="ml-auto px-3 py-1.5 text-xs font-medium text-white bg-gray-900 rounded-lg hover:bg-gray-800 transition-colors"
        >
          新規会議
        </button>
      </header>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        <div className="content-wrap py-4">
          {loading && (
            <div className="text-center text-gray-400 py-16">読み込み中...</div>
          )}
          {error && (
            <div className="text-center text-red-500 py-16">
              読み込みに失敗しました
            </div>
          )}
          {!loading && !error && meetings.length === 0 && (
            <div className="text-center text-gray-400 py-20">
              <Notebook className="text-4xl mx-auto mb-3 opacity-50" />
              <p className="text-sm">会議はありません</p>
              <p className="text-xs mt-1 text-gray-300">space: {spaceId}</p>
            </div>
          )}
          {!loading && !error && meetings.length > 0 && (
            <div className="border-t border-gray-100">
              {meetings.map((meeting) => (
                <MeetingRow
                  key={meeting.id}
                  meeting={meeting}
                  isSelected={meeting.id === selectedMeetingId}
                  onClick={() => updateQuery({ meeting: meeting.id })}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Meeting Create Sheet */}
      <MeetingCreateSheet
        spaceId={spaceId}
        isOpen={isCreateSheetOpen}
        onClose={() => setIsCreateSheetOpen(false)}
        onSubmit={handleCreateMeeting}
      />
    </div>
  )
}
