'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { useCreateSink, ALLOWED_SINK_EVENTS, DEFAULT_SINK_EVENTS, type SinkMeta } from '@/lib/hooks/useSinks'
import { useChannelGroups } from '@/lib/hooks/useChannelGroups'

interface CreateSinkFormProps {
  orgId: string
  onCreated: (sink: SinkMeta, secret: string) => void
  onCancel: () => void
}

const EVENT_LABEL: Record<string, string> = {
  'task.created': '作成',
  'task.done': '完了',
  'task.dismissed': '削除/却下',
  'task.reopened': '再オープン',
}

/**
 * sink作成フォーム。PR-1 APIはprovider='webhook'のみ受け付ける。
 * 「作成」は新規リソース作成の一回きりの明示アクションであり、既存リソース編集の
 * 保存ボタンではないため、他の確定アクション(確認コード発行等)と同じくボタン式でよい。
 */
export function CreateSinkForm({ orgId, onCreated, onCancel }: CreateSinkFormProps) {
  const [displayName, setDisplayName] = useState('')
  const [url, setUrl] = useState('')
  const [events, setEvents] = useState<string[]>(DEFAULT_SINK_EVENTS)
  const [groupId, setGroupId] = useState<string>('')

  const createSink = useCreateSink()
  const { groups } = useChannelGroups(orgId)

  const canSubmit = displayName.trim().length > 0 && url.trim().length > 0 && events.length > 0

  const toggleEvent = (event: string) => {
    setEvents((prev) => (prev.includes(event) ? prev.filter((e) => e !== event) : [...prev, event]))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!canSubmit) return
    try {
      const result = await createSink.mutateAsync({
        orgId,
        displayName: displayName.trim(),
        url: url.trim(),
        events,
        groupId: groupId || null,
      })
      onCreated(result.sink, result.secret)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'シンクの作成に失敗しました')
    }
  }

  return (
    <form onSubmit={(e) => void handleSubmit(e)} className="rounded-lg border border-gray-200 bg-white p-3 space-y-3">
      <div>
        <label htmlFor="sink-display-name" className="block text-xs font-medium text-gray-700 mb-1">
          表示名
        </label>
        <input
          id="sink-display-name"
          type="text"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder="例: 自社の受注管理システム"
          className="w-full h-8 rounded-md border border-gray-200 px-2 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500"
        />
      </div>
      <div>
        <label htmlFor="sink-url" className="block text-xs font-medium text-gray-700 mb-1">
          URL
        </label>
        <input
          id="sink-url"
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://example.com/webhook"
          className="w-full h-8 rounded-md border border-gray-200 px-2 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500"
        />
      </div>
      <div>
        <span className="block text-xs font-medium text-gray-700 mb-1">購読イベント</span>
        <div className="flex flex-wrap gap-x-3 gap-y-1.5">
          {ALLOWED_SINK_EVENTS.map((event) => (
            <label key={event} className="flex items-center gap-1.5 text-xs text-gray-700">
              <input
                type="checkbox"
                checked={events.includes(event)}
                onChange={() => toggleEvent(event)}
                aria-label={event}
              />
              {EVENT_LABEL[event] ?? event}
            </label>
          ))}
        </div>
      </div>
      <div>
        <label htmlFor="sink-group" className="block text-xs font-medium text-gray-700 mb-1">
          対象グループ(任意)
        </label>
        <select
          id="sink-group"
          value={groupId}
          onChange={(e) => setGroupId(e.target.value)}
          className="w-full h-8 rounded-md border border-gray-200 px-2 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500"
        >
          <option value="">組織全体</option>
          {groups.map((group) => (
            <option key={group.id} value={group.id}>
              {group.displayName ?? group.externalGroupId}
            </option>
          ))}
        </select>
      </div>
      <div className="flex items-center gap-2 pt-1">
        <button
          type="submit"
          disabled={!canSubmit || createSink.isPending}
          className="h-8 rounded-md px-3 text-xs font-medium bg-indigo-600 text-white hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {createSink.isPending ? '作成中...' : '作成'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="h-8 rounded-md px-3 text-xs font-medium bg-white text-gray-700 border border-gray-200 hover:bg-gray-50 transition-colors"
        >
          キャンセル
        </button>
      </div>
    </form>
  )
}
