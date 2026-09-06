'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowsClockwise } from '@phosphor-icons/react'

interface MilestoneReconcileButtonProps {
  /** 指定すればその組織だけ再集計。無ければ全組織 */
  orgId?: string
}

type State = { kind: 'idle' } | { kind: 'running' } | { kind: 'done'; added: number } | { kind: 'error'; message: string }

/**
 * 節目の「いま再集計」ボタン（運営用）。毎時の cron と同じ処理を手動で起動する。
 * 終わったらページを再取得して最新の数字を出す。
 */
export function MilestoneReconcileButton({ orgId }: MilestoneReconcileButtonProps) {
  const router = useRouter()
  const [state, setState] = useState<State>({ kind: 'idle' })

  async function run() {
    setState({ kind: 'running' })
    try {
      const res = await fetch('/api/admin/milestones/reconcile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(orgId ? { orgId } : {}),
      })
      const json = (await res.json().catch(() => ({}))) as { added?: number; error?: string }
      if (!res.ok) {
        setState({ kind: 'error', message: json.error ?? '再集計に失敗しました' })
        return
      }
      setState({ kind: 'done', added: json.added ?? 0 })
      router.refresh()
    } catch {
      setState({ kind: 'error', message: '再集計に失敗しました（通信エラー）' })
    }
  }

  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        onClick={() => void run()}
        disabled={state.kind === 'running'}
        className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-surface px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
      >
        <ArrowsClockwise size={14} className={state.kind === 'running' ? 'animate-spin' : undefined} />
        {state.kind === 'running' ? '再集計中…' : 'いま再集計する'}
      </button>
      <span className="text-xs" aria-live="polite">
        {state.kind === 'done' && <span className="text-green-600">完了（新しく {state.added} 件の節目を記録）</span>}
        {state.kind === 'error' && <span className="text-red-600">{state.message}</span>}
      </span>
    </div>
  )
}
