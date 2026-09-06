'use client'

import { useCallback, useDeferredValue, useMemo, useRef, useState } from 'react'
import { ArrowCounterClockwise, FloppyDisk, Envelope } from '@phosphor-icons/react'
import {
  INVITE_PLACEHOLDERS,
  INVITE_TEMPLATE_DEFAULTS,
  INVITE_TEMPLATE_KEYS,
  INVITE_TEMPLATE_LIMITS,
  INVITE_TEMPLATE_META,
  renderInviteEmail,
  renderTemplateString,
  validateInviteTemplateFields,
  type InviteTemplateFields,
  type InviteTemplateKey,
  type InviteTemplateVars,
} from '@/lib/email/templates/invite'
import type { InviteTemplateRow } from '@/lib/email/templates/loadInviteTemplate'

type FieldKey = keyof InviteTemplateFields

const FIELD_DEFS: Array<{ key: FieldKey; label: string; hint: string; multiline: boolean }> = [
  { key: 'subject', label: '件名', hint: 'メールの件名', multiline: false },
  { key: 'heading', label: '見出し', hint: 'メール本文の一番上に大きく出る言葉', multiline: false },
  { key: 'body', label: '本文', hint: '空行を入れると段落が分かれます', multiline: true },
  { key: 'cta_label', label: 'ボタンの文字', hint: '招待を開くボタンに表示する言葉', multiline: false },
  { key: 'note', label: 'ボタン下の補足', hint: '空でもかまいません', multiline: false },
]

function sampleVars(appName: string): InviteTemplateVars {
  const vars = {} as InviteTemplateVars
  for (const p of INVITE_PLACEHOLDERS) vars[p.varKey] = p.sample
  vars.appName = appName
  return vars
}

function fieldsEqual(a: InviteTemplateFields, b: InviteTemplateFields): boolean {
  return (Object.keys(a) as FieldKey[]).every((k) => a[k] === b[k])
}

interface Props {
  initialRows: Record<InviteTemplateKey, InviteTemplateRow>
  appName: string
}

export default function EmailTemplatesClient({ initialRows, appName }: Props) {
  const [rows, setRows] = useState(initialRows)
  const [activeKey, setActiveKey] = useState<InviteTemplateKey>('invite_client')
  const [drafts, setDrafts] = useState<Record<InviteTemplateKey, InviteTemplateFields>>({
    invite_client: { ...initialRows.invite_client.fields },
    invite_member: { ...initialRows.invite_member.fields },
  })
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const [previewMode, setPreviewMode] = useState<'html' | 'text'>('html')

  // 差し込み語チップを押したとき、最後に触った入力欄のカーソル位置に入れる
  const inputRefs = useRef<Partial<Record<FieldKey, HTMLInputElement | HTMLTextAreaElement | null>>>({})
  const [lastFocused, setLastFocused] = useState<FieldKey>('body')

  const row = rows[activeKey]
  const draft = drafts[activeKey]
  const meta = INVITE_TEMPLATE_META[activeKey]
  const vars = useMemo(() => sampleVars(appName), [appName])

  const dirty = !fieldsEqual(draft, row.fields)
  const isDefaultDraft = fieldsEqual(draft, INVITE_TEMPLATE_DEFAULTS[activeKey])
  const validation = useMemo(() => validateInviteTemplateFields(draft), [draft])

  // プレビュー(iframe srcDoc)は値が変わるたびに文書を丸ごと作り直すので、
  // 打鍵中は前の値を保ち(useDeferredValue)、入力が落ち着いてから描き直す。
  // draft と activeKey を1つに束ねて遅延させる（別々だとタブ切替の一瞬だけ色と文面がズレる）
  const previewInput = useMemo(() => ({ draft, activeKey }), [draft, activeKey])
  const deferredInput = useDeferredValue(previewInput)
  const preview = useMemo(() => {
    const { draft: d, activeKey: k } = deferredInput
    // 入力途中でも常にプレビューは出す（検証NGでもそのまま描く）
    const fields: InviteTemplateFields = {
      subject: d.subject,
      heading: d.heading,
      body: d.body,
      cta_label: d.cta_label || ' ',
      note: d.note,
    }
    return renderInviteEmail({
      variant: k === 'invite_client' ? 'client' : 'member',
      fields,
      vars,
      inviteUrl: k === 'invite_client' ? 'https://agentpm.app/portal/xxxxxxxx' : 'https://agentpm.app/invite/xxxxxxxx',
      message: '（招待するときに添える一言があれば、ここに引用として入ります）',
    })
  }, [deferredInput, vars])

  const updateField = useCallback(
    (key: FieldKey, value: string) => {
      setDrafts((prev) => ({ ...prev, [activeKey]: { ...prev[activeKey], [key]: value } }))
      setNotice(null)
    },
    [activeKey],
  )

  const insertPlaceholder = useCallback(
    (token: string) => {
      const target = lastFocused
      const el = inputRefs.current[target]
      const current = draft[target]
      if (el && typeof el.selectionStart === 'number') {
        const start = el.selectionStart
        const end = el.selectionEnd ?? start
        const next = current.slice(0, start) + token + current.slice(end)
        updateField(target, next)
        requestAnimationFrame(() => {
          el.focus()
          const pos = start + token.length
          el.setSelectionRange(pos, pos)
        })
      } else {
        updateField(target, current + token)
      }
    },
    [draft, lastFocused, updateField],
  )

  const applyResult = useCallback(
    (key: InviteTemplateKey, result: { fields: InviteTemplateFields; isCustom: boolean; updatedAt: string | null }) => {
      setRows((prev) => ({ ...prev, [key]: { key, ...result } }))
      setDrafts((prev) => ({ ...prev, [key]: { ...result.fields } }))
    },
    [],
  )

  const handleSave = useCallback(async () => {
    if (!validation.ok || saving) return
    setSaving(true)
    setNotice(null)
    try {
      const res = await fetch('/api/admin/email-templates', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: activeKey, fields: validation.fields }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error || '保存に失敗しました')
      if (!json?.fields) throw new Error('保存結果を受け取れませんでした')
      applyResult(activeKey, json)
      setNotice({ kind: 'ok', text: '保存しました。次に送る招待メールから、この文面が使われます。' })
    } catch (e: unknown) {
      setNotice({ kind: 'error', text: e instanceof Error ? e.message : '保存に失敗しました' })
    } finally {
      setSaving(false)
    }
  }, [activeKey, validation, saving, applyResult])

  const handleReset = useCallback(async () => {
    if (saving) return
    if (!confirm('この文面を最初の状態（既定の文面）に戻しますか？')) return
    setSaving(true)
    setNotice(null)
    try {
      const res = await fetch('/api/admin/email-templates', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: activeKey, reset: true }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error || '既定に戻せませんでした')
      if (!json?.fields) throw new Error('保存結果を受け取れませんでした')
      applyResult(activeKey, json)
      setNotice({ kind: 'ok', text: '既定の文面に戻しました。' })
    } catch (e: unknown) {
      setNotice({ kind: 'error', text: e instanceof Error ? e.message : '既定に戻せませんでした' })
    } finally {
      setSaving(false)
    }
  }, [activeKey, saving, applyResult])

  const inputClass =
    'w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-surface text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent'

  return (
    <div className="p-6 max-w-7xl">
      <div className="mb-6">
        <h1 className="text-lg font-bold text-gray-900">メール文面</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          招待メールの文面を編集します。保存すると、次に送る招待メールから新しい文面が使われます。
        </p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-gray-200 mb-6">
        {INVITE_TEMPLATE_KEYS.map((key) => {
          const active = key === activeKey
          const custom = rows[key].isCustom
          const unsaved = !fieldsEqual(drafts[key], rows[key].fields)
          return (
            <button
              key={key}
              type="button"
              onClick={() => {
                setActiveKey(key)
                setNotice(null)
              }}
              className={`inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
                active ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              <Envelope size={16} />
              {INVITE_TEMPLATE_META[key].label}
              {custom && <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-600">編集済み</span>}
              {unsaved && <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-600">未保存</span>}
            </button>
          )
        })}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 items-start">
        {/* Editor */}
        <div className="bg-surface border border-gray-200 rounded-xl p-5">
          <div className="mb-4">
            <h2 className="text-sm font-semibold text-gray-900">{meta.label}</h2>
            <p className="text-xs text-gray-500 mt-0.5">{meta.description}</p>
            <p className="text-xs text-gray-400 mt-1">
              {row.isCustom
                ? `編集済みの文面（最終更新: ${row.updatedAt ? new Date(row.updatedAt).toLocaleString('ja-JP') : '-'}）`
                : '既定の文面（まだ編集されていません）'}
            </p>
          </div>

          <div className="mb-4">
            <p className="text-xs font-medium text-gray-600 mb-1.5">差し込み語（押すと入力欄に入ります。送るときに実際の名前などに置き換わります）</p>
            <div className="flex flex-wrap gap-1.5">
              {INVITE_PLACEHOLDERS.map((p) => (
                <button
                  key={p.token}
                  type="button"
                  onClick={() => insertPlaceholder(p.token)}
                  title={`${p.description}（例: ${p.sample}）`}
                  className="px-2 py-1 text-xs font-mono rounded-md border border-gray-200 bg-gray-50 text-gray-700 hover:bg-indigo-50 hover:border-indigo-200 hover:text-indigo-700 transition-colors"
                >
                  {p.token}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-3">
            {FIELD_DEFS.map((def) => {
              const value = draft[def.key]
              const limit = INVITE_TEMPLATE_LIMITS[def.key]
              const common = {
                value,
                onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => updateField(def.key, e.target.value),
                onFocus: () => setLastFocused(def.key),
                className: inputClass,
              }
              return (
                <div key={def.key}>
                  <div className="flex items-baseline justify-between mb-1">
                    <label className="text-xs font-medium text-gray-600">
                      {def.label}
                      {def.key !== 'note' && <span className="text-red-500 ml-0.5">*</span>}
                    </label>
                    <span className={`text-[10px] ${value.length > limit ? 'text-red-500' : 'text-gray-400'}`}>
                      {value.length}/{limit}
                    </span>
                  </div>
                  {def.multiline ? (
                    <textarea
                      {...common}
                      ref={(el) => {
                        inputRefs.current[def.key] = el
                      }}
                      rows={8}
                      className={`${inputClass} resize-y leading-relaxed`}
                    />
                  ) : (
                    <input
                      {...common}
                      ref={(el) => {
                        inputRefs.current[def.key] = el
                      }}
                      type="text"
                    />
                  )}
                  <p className="text-[11px] text-gray-400 mt-0.5">{def.hint}</p>
                </div>
              )
            })}
          </div>

          {!validation.ok && <p className="mt-3 text-xs text-red-600">{validation.error}</p>}
          {notice && (
            <p className={`mt-3 text-xs ${notice.kind === 'ok' ? 'text-green-600' : 'text-red-600'}`}>{notice.text}</p>
          )}

          <div className="flex items-center justify-between mt-5 pt-4 border-t border-gray-100">
            <button
              type="button"
              onClick={handleReset}
              disabled={saving || (!row.isCustom && isDefaultDraft)}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <ArrowCounterClockwise size={16} />
              既定の文面に戻す
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving || !dirty || !validation.ok}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <FloppyDisk size={16} weight="bold" />
              {saving ? '保存中...' : '保存する'}
            </button>
          </div>
        </div>

        {/* Preview */}
        <div className="bg-surface border border-gray-200 rounded-xl overflow-hidden xl:sticky xl:top-6">
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-200 bg-gray-50">
            <div className="min-w-0">
              <p className="text-xs text-gray-500">プレビュー（見本の名前で表示しています）</p>
              <p className="text-sm font-medium text-gray-900 truncate" title={preview.subject}>
                件名: {renderTemplateString(draft.subject, vars) || '（件名なし）'}
              </p>
            </div>
            <div className="flex rounded-md border border-gray-200 overflow-hidden shrink-0 ml-3">
              {(['html', 'text'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setPreviewMode(m)}
                  className={`px-2.5 py-1 text-xs ${
                    previewMode === m ? 'bg-indigo-600 text-white' : 'bg-surface text-gray-600 hover:bg-gray-100'
                  }`}
                >
                  {m === 'html' ? '見た目' : 'テキスト版'}
                </button>
              ))}
            </div>
          </div>
          {previewMode === 'html' ? (
            <iframe
              title="メールプレビュー"
              srcDoc={preview.html}
              sandbox=""
              className="w-full h-[720px] bg-gray-100"
            />
          ) : (
            <pre className="p-4 text-xs text-gray-800 whitespace-pre-wrap font-mono h-[720px] overflow-auto">{preview.text}</pre>
          )}
        </div>
      </div>
    </div>
  )
}
