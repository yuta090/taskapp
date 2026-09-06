'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { MANUAL_ACQUISITION_CHANNELS, getAcquisitionChannelLabel } from '@/lib/acquisition/firstTouch'

interface OrgAcquisitionEditorProps {
  orgId: string
  channel: string
  isManual: boolean
  note: string | null
}

type SaveState = { kind: 'idle' } | { kind: 'saving' } | { kind: 'saved' } | { kind: 'error'; message: string }

/**
 * 流入経路の手動登録（運営用）。
 * 選択・メモを変えたらその場で保存する（保存ボタン無し・楽観更新）。
 * 自動判定の値は残したまま、運営の判断（channel / note）だけ上書きする。
 */
export function OrgAcquisitionEditor({ orgId, channel: initialChannel, isManual: initialIsManual, note: initialNote }: OrgAcquisitionEditorProps) {
  const router = useRouter()
  const [channel, setChannel] = useState(initialChannel)
  const [isManual, setIsManual] = useState(initialIsManual)
  const [note, setNote] = useState(initialNote ?? '')
  const [savedNote, setSavedNote] = useState(initialNote ?? '')
  const [state, setState] = useState<SaveState>({ kind: 'idle' })

  async function save(next: { channel: string; note: string }) {
    setState({ kind: 'saving' })
    try {
      const res = await fetch(`/api/admin/organizations/${orgId}/acquisition`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(next),
      })
      const json = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) {
        setState({ kind: 'error', message: json.error ?? '保存できませんでした' })
        return false
      }
      setIsManual(true)
      setSavedNote(next.note)
      setState({ kind: 'saved' })
      router.refresh()
      return true
    } catch {
      setState({ kind: 'error', message: '保存できませんでした（通信エラー）' })
      return false
    }
  }

  async function handleChannelChange(nextChannel: string) {
    const prev = channel
    setChannel(nextChannel)
    const ok = await save({ channel: nextChannel, note })
    if (!ok) setChannel(prev)
  }

  async function handleNoteBlur() {
    if (note.trim() === savedNote.trim()) return
    // channel が unknown のままメモだけ保存はできない（API が unknown を弾く）ので、その場合は other にする
    const nextChannel = MANUAL_ACQUISITION_CHANNELS.includes(channel as (typeof MANUAL_ACQUISITION_CHANNELS)[number])
      ? channel
      : 'other'
    if (nextChannel !== channel) setChannel(nextChannel)
    await save({ channel: nextChannel, note: note.trim() })
  }

  const selectable = MANUAL_ACQUISITION_CHANNELS.includes(channel as (typeof MANUAL_ACQUISITION_CHANNELS)[number])

  return (
    <div className="space-y-3">
      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1" htmlFor={`acq-channel-${orgId}`}>
          流入経路
          <span className="ml-2 font-normal text-gray-400">{isManual ? '運営が登録' : '自動判定'}</span>
        </label>
        <select
          id={`acq-channel-${orgId}`}
          value={selectable ? channel : ''}
          onChange={(e) => void handleChannelChange(e.target.value)}
          disabled={state.kind === 'saving'}
          className="w-full rounded-lg border border-gray-300 bg-surface px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
        >
          {!selectable && <option value="">{getAcquisitionChannelLabel(channel)}（未登録）</option>}
          {MANUAL_ACQUISITION_CHANNELS.map((c) => (
            <option key={c} value={c}>
              {getAcquisitionChannelLabel(c)}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1" htmlFor={`acq-note-${orgId}`}>
          メモ（紹介者・イベント名など）
        </label>
        <textarea
          id={`acq-note-${orgId}`}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onBlur={() => void handleNoteBlur()}
          rows={2}
          maxLength={500}
          placeholder="例: 〇〇さんの紹介 / 9月の税理士会セミナー"
          className="w-full rounded-lg border border-gray-300 bg-surface px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
      </div>
      <p className="text-xs min-h-4" aria-live="polite">
        {state.kind === 'saving' && <span className="text-gray-400">保存中…</span>}
        {state.kind === 'saved' && <span className="text-green-600">保存しました</span>}
        {state.kind === 'error' && <span className="text-red-600">{state.message}</span>}
      </p>
    </div>
  )
}
