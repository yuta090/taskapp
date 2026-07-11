'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import {
  useCreateSink,
  useCreateNotionSink,
  useCreateGoogleSheetsSink,
  ALLOWED_SINK_EVENTS,
  DEFAULT_SINK_EVENTS,
  type SinkMeta,
  type SinkProvider,
  type NotionConnectionStatus,
  type GoogleSheetsConnectionStatus,
} from '@/lib/hooks/useSinks'
import { useChannelGroups } from '@/lib/hooks/useChannelGroups'

interface CreateSinkFormProps {
  orgId: string
  onCreated: (sink: SinkMeta, secret?: string) => void
  onCancel: () => void
  notionConnection?: NotionConnectionStatus
  googleSheetsConnection?: GoogleSheetsConnectionStatus
}

const EVENT_LABEL: Record<string, string> = {
  'task.created': '作成',
  'task.done': '完了',
  'task.dismissed': '削除/却下',
  'task.reopened': '再オープン',
}

const CREATABLE_PROVIDERS: Array<{ value: SinkProvider; label: string }> = [
  { value: 'webhook', label: 'Webhook' },
  { value: 'notion', label: 'Notion' },
  { value: 'google_sheets', label: 'Google Sheets' },
]

/**
 * sink作成フォーム。provider='webhook'|'notion'|'google_sheets'に対応。
 * 「作成」は新規リソース作成の一回きりの明示アクションであり、既存リソース編集の
 * 保存ボタンではないため、他の確定アクション(確認コード発行等)と同じくボタン式でよい。
 */
export function CreateSinkForm({
  orgId,
  onCreated,
  onCancel,
  notionConnection = { connected: false, workspaceName: null },
  googleSheetsConnection = { connected: false },
}: CreateSinkFormProps) {
  const [provider, setProvider] = useState<SinkProvider>('webhook')
  const [displayName, setDisplayName] = useState('')
  const [url, setUrl] = useState('')
  const [databaseId, setDatabaseId] = useState('')
  const [spreadsheetId, setSpreadsheetId] = useState('')
  const [sheetName, setSheetName] = useState('')
  const [events, setEvents] = useState<string[]>(DEFAULT_SINK_EVENTS)
  const [groupId, setGroupId] = useState<string>('')

  const createSink = useCreateSink()
  const createNotionSink = useCreateNotionSink()
  const createGoogleSheetsSink = useCreateGoogleSheetsSink()
  const { groups } = useChannelGroups(orgId)

  const isNotion = provider === 'notion'
  const isGoogleSheets = provider === 'google_sheets'
  const canSubmit = isNotion
    ? displayName.trim().length > 0 &&
      databaseId.trim().length > 0 &&
      events.length > 0 &&
      notionConnection.connected
    : isGoogleSheets
      ? displayName.trim().length > 0 &&
        spreadsheetId.trim().length > 0 &&
        sheetName.trim().length > 0 &&
        events.length > 0 &&
        googleSheetsConnection.connected
      : displayName.trim().length > 0 && url.trim().length > 0 && events.length > 0

  const toggleEvent = (event: string) => {
    setEvents((prev) => (prev.includes(event) ? prev.filter((e) => e !== event) : [...prev, event]))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!canSubmit) return
    try {
      if (isNotion) {
        const result = await createNotionSink.mutateAsync({
          orgId,
          displayName: displayName.trim(),
          databaseId: databaseId.trim(),
          events,
          groupId: groupId || null,
        })
        onCreated(result.sink)
        return
      }
      if (isGoogleSheets) {
        const result = await createGoogleSheetsSink.mutateAsync({
          orgId,
          displayName: displayName.trim(),
          spreadsheetId: spreadsheetId.trim(),
          sheetName: sheetName.trim(),
          events,
          groupId: groupId || null,
        })
        onCreated(result.sink)
        return
      }
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

  const isPending = isNotion
    ? createNotionSink.isPending
    : isGoogleSheets
      ? createGoogleSheetsSink.isPending
      : createSink.isPending

  return (
    <form onSubmit={(e) => void handleSubmit(e)} className="rounded-lg border border-gray-200 bg-white p-3 space-y-3">
      <div>
        <span className="block text-xs font-medium text-gray-700 mb-1">連携先の種類</span>
        <div role="radiogroup" aria-label="連携先の種類" className="flex items-center gap-3">
          {CREATABLE_PROVIDERS.map((option) => (
            <label key={option.value} className="flex items-center gap-1.5 text-xs text-gray-700">
              <input
                type="radio"
                name="sink-provider"
                value={option.value}
                checked={provider === option.value}
                onChange={() => setProvider(option.value)}
                aria-label={option.label}
              />
              {option.label}
            </label>
          ))}
        </div>
      </div>
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
      {isNotion ? (
        <div>
          <label htmlFor="sink-database-id" className="block text-xs font-medium text-gray-700 mb-1">
            データベースID
          </label>
          <input
            id="sink-database-id"
            type="text"
            value={databaseId}
            onChange={(e) => setDatabaseId(e.target.value)}
            placeholder="例: 12345678-1234-1234-1234-123456789012"
            className="w-full h-8 rounded-md border border-gray-200 px-2 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
          {notionConnection.connected ? (
            <p className="mt-1 text-[11px] text-green-600">
              接続済み: {notionConnection.workspaceName ?? 'Notionワークスペース'}
            </p>
          ) : (
            <p className="mt-1 text-[11px] text-gray-500">
              先にNotionワークスペースへ接続してください。{' '}
              <a
                href={`/api/integrations/auth/notion?orgId=${encodeURIComponent(orgId)}`}
                className="text-indigo-600 hover:text-indigo-800 underline"
              >
                Notion に接続
              </a>
            </p>
          )}
        </div>
      ) : isGoogleSheets ? (
        <div className="space-y-3">
          <div>
            <label htmlFor="sink-spreadsheet-id" className="block text-xs font-medium text-gray-700 mb-1">
              スプレッドシートID
            </label>
            <input
              id="sink-spreadsheet-id"
              type="text"
              value={spreadsheetId}
              onChange={(e) => setSpreadsheetId(e.target.value)}
              placeholder="例: 1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms"
              className="w-full h-8 rounded-md border border-gray-200 px-2 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
            {googleSheetsConnection.connected ? (
              <p className="mt-1 text-[11px] text-green-600">接続済み</p>
            ) : (
              <p className="mt-1 text-[11px] text-gray-500">
                先にGoogleアカウントへ接続してください。{' '}
                <a
                  href={`/api/integrations/auth/google_sheets?orgId=${encodeURIComponent(orgId)}`}
                  className="text-indigo-600 hover:text-indigo-800 underline"
                >
                  Google Sheets に接続
                </a>
              </p>
            )}
          </div>
          <div>
            <label htmlFor="sink-sheet-name" className="block text-xs font-medium text-gray-700 mb-1">
              シート名
            </label>
            <input
              id="sink-sheet-name"
              type="text"
              value={sheetName}
              onChange={(e) => setSheetName(e.target.value)}
              placeholder="例: タスク"
              className="w-full h-8 rounded-md border border-gray-200 px-2 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </div>
        </div>
      ) : (
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
      )}
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
          disabled={!canSubmit || isPending}
          className="h-8 rounded-md px-3 text-xs font-medium bg-indigo-600 text-white hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {isPending ? '作成中...' : '作成'}
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
