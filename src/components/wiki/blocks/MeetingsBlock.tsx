'use client'

import { createReactBlockSpec } from '@blocknote/react'
import { useState, useEffect } from 'react'
import { Notebook, ArrowRight, CalendarBlank, Circle } from '@phosphor-icons/react'
import { createClient } from '@/lib/supabase/client'
import type { SupabaseClient } from '@supabase/supabase-js'

// Props stored in block JSON
const meetingsBlockConfig = {
  type: 'meetingsList' as const,
  propSchema: {
    orgId: { default: '' },
    spaceId: { default: '' },
    limit: { default: '5' },
  },
  content: 'none' as const,
}

function MeetingsBlockComponent({ block, editor }: { block: { props: { orgId: string; spaceId: string; limit: string } }; editor: { isEditable: boolean } }) {
  const { orgId, spaceId, limit } = block.props
  const [meetings, setMeetings] = useState<Array<{
    id: string
    title: string
    held_at: string | null
    status: string
  }>>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!orgId || !spaceId) {
      setLoading(false)
      return
    }

    const fetchMeetings = async () => {
      try {
        const supabase = createClient()
         
        const { data } = await (supabase as SupabaseClient)
          .from('meetings')
          .select('id, title, held_at, status')
          .eq('org_id', orgId)
          .eq('space_id', spaceId)
          .order('held_at', { ascending: false, nullsFirst: false })
          .limit(parseInt(limit) || 5)

        setMeetings(data || [])
      } catch {
        setMeetings([])
      } finally {
        setLoading(false)
      }
    }

    fetchMeetings()
  }, [orgId, spaceId, limit])

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '未定'
    return new Date(dateStr).toLocaleDateString('ja-JP', {
      month: 'numeric',
      day: 'numeric',
    })
  }

  const statusColor = (status: string) => {
    switch (status) {
      case 'ended': return 'text-green-500'
      case 'in_progress': return 'text-amber-500'
      default: return 'text-gray-400'
    }
  }

  const statusLabel = (status: string) => {
    switch (status) {
      case 'ended': return '終了'
      case 'in_progress': return '進行中'
      default: return '予定'
    }
  }

  const basePath = orgId && spaceId ? `/${orgId}/project/${spaceId}/meetings` : '#'

  return (
    <div className="my-2 rounded-lg border border-gray-200 bg-gray-50/50 overflow-hidden" contentEditable={false}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-200 bg-white">
        <div className="flex items-center gap-2">
          <Notebook className="text-indigo-500 text-base" />
          <span className="text-sm font-semibold text-gray-800">最新の議事録</span>
        </div>
        <a
          href={basePath}
          className="flex items-center gap-1 text-xs text-indigo-500 hover:text-indigo-700 transition-colors"
        >
          すべて表示
          <ArrowRight className="text-xs" />
        </a>
      </div>

      {/* Content */}
      <div className="px-4 py-2">
        {loading ? (
          <div className="py-3 text-center text-xs text-gray-400">読み込み中...</div>
        ) : !orgId || !spaceId ? (
          <div className="py-3 text-center text-xs text-gray-400">
            {editor.isEditable ? 'ページを保存するとプロジェクトの議事録が表示されます' : '議事録データがありません'}
          </div>
        ) : meetings.length === 0 ? (
          <div className="py-3 text-center text-xs text-gray-400">議事録がありません</div>
        ) : (
          <div className="divide-y divide-gray-100">
            {meetings.map(meeting => (
              <a
                key={meeting.id}
                href={`${basePath}?meeting=${meeting.id}`}
                className="flex items-center gap-3 py-2 hover:bg-gray-100/50 -mx-2 px-2 rounded transition-colors"
              >
                <Circle weight="fill" className={`text-[8px] flex-shrink-0 ${statusColor(meeting.status)}`} />
                <span className="text-sm text-gray-800 truncate flex-1">{meeting.title}</span>
                <span className="flex items-center gap-1 text-xs text-gray-400 flex-shrink-0">
                  <CalendarBlank className="text-xs" />
                  {formatDate(meeting.held_at)}
                </span>
                <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                  meeting.status === 'ended' ? 'bg-green-50 text-green-600' :
                  meeting.status === 'in_progress' ? 'bg-amber-50 text-amber-600' :
                  'bg-gray-100 text-gray-500'
                }`}>
                  {statusLabel(meeting.status)}
                </span>
              </a>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export const MeetingsBlock = createReactBlockSpec(meetingsBlockConfig, {
  render: (props) => <MeetingsBlockComponent block={props.block} editor={props.editor} />,
})
