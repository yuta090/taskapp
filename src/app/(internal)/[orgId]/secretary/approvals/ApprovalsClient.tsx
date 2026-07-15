'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  CheckCircle,
  XCircle,
  Warning,
  Spinner,
  ClipboardText,
  CalendarBlank,
  User,
  ChatCircleDots,
} from '@phosphor-icons/react'
import { SecretaryTabNav } from '@/components/secretary/SecretaryTabNav'

interface PendingApprovalItem {
  taskId: string
  title: string
  dueDate: string | null
  dueTime: string | null
  assigneeHint: string | null
  groupId: string
  groupName: string | null
  requestedAt: string | null
  approvalNotifiedAt: string | null
}

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土']

/** 'YYYY-MM-DD' をローカル日付として安全に整形（toISOStringのUTCずれを避けるため手分解）。 */
function formatDue(dueDate: string | null, dueTime: string | null): string | null {
  if (!dueDate) return null
  const [y, m, d] = dueDate.split('-').map(Number)
  if (!y || !m || !d) return null
  const wd = WEEKDAYS[new Date(y, m - 1, d).getDay()]
  const base = `${m}/${d}(${wd})`
  if (!dueTime) return base
  const [hh, mm] = dueTime.split(':')
  return `${base} ${hh}:${mm}`
}

/**
 * 「確認待ち」トレイ（Stage 2.7-B §5）— /{orgId}/secretary/approvals
 *
 * セッションユーザー宛の pending 申し送り候補を一覧し、その場で承認/却下する。
 * LINE 1:1 が届かなかった場合の確実なフォールバック（承認/却下はどちらの経路でも同じRPCを通る）。
 * 楽観更新: 成功したら即座にリストから消す（保存ボタンは無い）。
 */
export function ApprovalsClient({ orgId }: { orgId: string }) {
  const [items, setItems] = useState<PendingApprovalItem[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  // taskId -> 'approve' | 'reject' の実行中状態
  const [busy, setBusy] = useState<Record<string, 'approve' | 'reject'>>({})
  const [rowError, setRowError] = useState<Record<string, string>>({})

  const reload = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const res = await fetch(`/api/channels/digest-tasks/pending?orgId=${orgId}`)
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error ?? '取得に失敗しました')
      setItems(json.items ?? [])
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : '取得に失敗しました')
    } finally {
      setLoading(false)
    }
  }, [orgId])

  useEffect(() => {
    void reload()
  }, [reload])

  const act = useCallback(
    async (taskId: string, action: 'approve' | 'reject') => {
      setBusy((b) => ({ ...b, [taskId]: action }))
      setRowError((e) => {
        const next = { ...e }
        delete next[taskId]
        return next
      })
      try {
        const res = await fetch('/api/channels/digest-tasks/approval', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ orgId, taskId, action }),
        })
        if (!res.ok) {
          const json = await res.json().catch(() => ({}))
          // 409 は他経路(LINE/別タブ)で既に処理済み。その場合もリストから消して整合させる
          if (res.status === 409) {
            setItems((prev) => prev.filter((it) => it.taskId !== taskId))
            return
          }
          const msg =
            res.status === 403
              ? 'この項目を承認する権限がありません（責任者本人のみ）。'
              : res.status === 404
                ? '対象が見つかりませんでした。'
                : (json.error ?? '処理に失敗しました')
          throw new Error(msg)
        }
        // 楽観更新: 成功したら消す
        setItems((prev) => prev.filter((it) => it.taskId !== taskId))
      } catch (e) {
        setRowError((prev) => ({
          ...prev,
          [taskId]: e instanceof Error ? e.message : '処理に失敗しました',
        }))
      } finally {
        setBusy((b) => {
          const next = { ...b }
          delete next[taskId]
          return next
        })
      }
    },
    [orgId],
  )

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <SecretaryTabNav orgId={orgId} activeTab="approvals" />

      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-2xl">
          <section className="mb-4">
            <h2 className="text-sm font-semibold text-gray-900">確認待ち</h2>
            <p className="mt-1 text-xs text-gray-500">
              申し送りをタスク化してよいか、あなたの承認を待っています。
              承認すると本体タスクになり担当の画面に追加されます。却下するとタスクにはなりません。
            </p>
          </section>

          {loadError && (
            <div className="mb-4 flex items-start gap-2 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              <Warning className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span>{loadError}</span>
              <button
                type="button"
                onClick={() => void reload()}
                className="ml-auto underline hover:no-underline"
              >
                再読み込み
              </button>
            </div>
          )}

          {loading ? (
            <div className="flex items-center gap-2 py-8 text-sm text-gray-400">
              <Spinner className="w-4 h-4 animate-spin" />
              読み込み中...
            </div>
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
              <ClipboardText className="w-8 h-8 text-gray-300" />
              <p className="text-sm text-gray-500">確認待ちの申し送りはありません。</p>
            </div>
          ) : (
            <ul className="space-y-2">
              {items.map((item) => {
                const due = formatDue(item.dueDate, item.dueTime)
                const acting = busy[item.taskId]
                const err = rowError[item.taskId]
                return (
                  <li
                    key={item.taskId}
                    className="rounded-lg border border-gray-200 bg-white p-4"
                  >
                    <p className="text-sm font-medium text-gray-900">{item.title}</p>

                    <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500">
                      {item.groupName && (
                        <span className="inline-flex items-center gap-1">
                          <ChatCircleDots className="w-3.5 h-3.5" />
                          {item.groupName}
                        </span>
                      )}
                      {due && (
                        <span className="inline-flex items-center gap-1">
                          <CalendarBlank className="w-3.5 h-3.5" />
                          {due}
                        </span>
                      )}
                      {item.assigneeHint && (
                        <span className="inline-flex items-center gap-1">
                          <User className="w-3.5 h-3.5" />
                          {item.assigneeHint}
                        </span>
                      )}
                      {item.approvalNotifiedAt === null && (
                        <span className="inline-flex items-center gap-1 text-amber-600">
                          <Warning className="w-3.5 h-3.5" />
                          LINE未送信
                        </span>
                      )}
                    </div>

                    {err && (
                      <p className="mt-2 rounded bg-red-50 border border-red-200 px-2 py-1.5 text-xs text-red-700">
                        {err}
                      </p>
                    )}

                    <div className="mt-3 flex items-center gap-2">
                      <button
                        type="button"
                        disabled={Boolean(acting)}
                        onClick={() => void act(item.taskId, 'approve')}
                        className="inline-flex items-center justify-center gap-1.5 rounded-md bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50 transition-colors"
                      >
                        {acting === 'approve' ? (
                          <Spinner className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <CheckCircle weight="bold" className="w-3.5 h-3.5" />
                        )}
                        承認してタスク化
                      </button>
                      <button
                        type="button"
                        disabled={Boolean(acting)}
                        onClick={() => void act(item.taskId, 'reject')}
                        className="inline-flex items-center justify-center gap-1.5 rounded-md border border-gray-200 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50 transition-colors"
                      >
                        {acting === 'reject' ? (
                          <Spinner className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <XCircle weight="bold" className="w-3.5 h-3.5" />
                        )}
                        却下
                      </button>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}
