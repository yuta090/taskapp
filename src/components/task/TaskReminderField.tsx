'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Clock } from '@phosphor-icons/react'
import { useEntitlements } from '@/lib/hooks/useEntitlements'

/**
 * 時刻指定LINEリマインドの設定フィールド（③・pro以上限定）。
 * datetime-local で「いつ顧問先グループへリマインドを送るか」を設定する。
 * 保存は POST /api/tasks/[taskId]/reminder（サーバ側でorg逆引き＋プラン検証）。
 *
 * 課金導線（④・事前導線）: useEntitlements で timed_line_reminders の可否を先読みし、
 * 未解禁のorgには操作させる前に「pro以上で利用できます」＋プランページへの導線を出す
 * （403を踏ませる前に案内する）。判定の真実源はサーバ側（設定403／cron fail-closed）で、
 * これは表示専用。取得失敗/ロード中は fail-closed（解禁UIを軽々に見せない）。
 *
 * 値の変換方針: remind_at は絶対時刻(ISO)で保存する。datetime-local はブラウザ
 * ローカル時刻(=顧問先運用はJST)の壁時計なので、表示はローカルgetterで組み立て
 * （toISOString で日付成分を出すとUTCずれの実害があるため使わない）、保存時のみ
 * new Date(local).toISOString() で絶対時刻へ正規化する。
 */

function toDatetimeLocalValue(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  // ローカル(JST)壁時計をそのまま datetime-local の 'YYYY-MM-DDTHH:mm' に整形
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

interface TaskReminderFieldProps {
  taskId: string
  initialRemindAt: string | null
  orgId?: string
}

export function TaskReminderField({ taskId, initialRemindAt, orgId }: TaskReminderFieldProps) {
  const { has, loading: entitlementsLoading } = useEntitlements(orgId)
  const [value, setValue] = useState(() => toDatetimeLocalValue(initialRemindAt))
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [planRequired, setPlanRequired] = useState(false)

  const entitled = has('timed_line_reminders')
  // 先読みで未解禁と分かっていれば操作前に案内。ロード中や既存設定がある場合は塞がない。
  const blockedUpfront = !entitlementsLoading && !entitled && !value
  const showUpsell = planRequired || blockedUpfront

  async function save(remindAt: string | null) {
    setSaving(true)
    setError(null)
    setPlanRequired(false)
    setSaved(false)
    try {
      const res = await fetch(`/api/tasks/${taskId}/reminder`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ remindAt }),
      })
      if (res.status === 403) {
        const json = await res.json().catch(() => ({}))
        if (json?.error === 'plan_required') {
          setPlanRequired(true)
          return
        }
        setError('権限がありません')
        return
      }
      if (!res.ok) {
        setError('保存に失敗しました')
        return
      }
      setSaved(true)
      setTimeout(() => setSaved(false), 1500)
    } catch {
      setError('保存に失敗しました')
    } finally {
      setSaving(false)
    }
  }

  function handleChange(next: string) {
    setValue(next)
    if (!next) {
      save(null)
      return
    }
    const ms = new Date(next).getTime()
    if (Number.isNaN(ms)) return
    save(new Date(ms).toISOString())
  }

  function handleClear() {
    setValue('')
    save(null)
  }

  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-gray-500 flex items-center gap-1">
        <Clock className="text-gray-400" />
        リマインド（LINEへ通知）
      </label>
      <div className="flex items-center gap-1.5">
        <input
          type="datetime-local"
          value={value}
          onChange={(e) => handleChange(e.target.value)}
          disabled={saving || blockedUpfront}
          data-testid="task-inspector-remind-at"
          className="flex-1 min-w-0 px-1.5 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-60 disabled:bg-gray-50"
        />
        {value && (
          <button
            type="button"
            onClick={handleClear}
            disabled={saving}
            className="text-xs text-gray-400 hover:text-gray-600 px-1"
          >
            解除
          </button>
        )}
      </div>
      {showUpsell && (
        <p className="text-xs text-amber-600">
          時刻リマインドは <span className="font-medium">pro 以上</span> のプランで利用できます。{' '}
          <Link href="/settings/billing" className="underline hover:text-amber-700">
            プランを見る
          </Link>
        </p>
      )}
      {error && <p className="text-xs text-red-500">{error}</p>}
      {saved && <p className="text-xs text-green-600">保存しました</p>}
      {value && !showUpsell && !error && (
        <p className="text-xs text-gray-400">設定時刻に、この案件のLINEグループへ秘書がリマインドします。</p>
      )}
    </div>
  )
}
