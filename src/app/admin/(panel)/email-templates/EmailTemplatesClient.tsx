'use client'

import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowCounterClockwise, FloppyDisk, Envelope, CaretDown, CaretRight } from '@phosphor-icons/react'
import {
  TEMPLATE_FIELD_LABELS,
  TEMPLATE_LIMITS,
  placeholderToken,
  renderTemplateString,
  sampleVars,
  validateTemplateFields,
  type RenderedEmail,
  type TemplateFieldKey,
  type TemplateFields,
} from '@/lib/email/templates/core'
import {
  EMAIL_TEMPLATE_DEFS,
  EMAIL_TEMPLATE_FAMILIES,
  NON_EDITABLE_EMAILS,
  getEmailTemplateDef,
  type EmailTemplateDef,
} from '@/lib/email/templates/registry'
import type { EmailTemplateRow } from '@/lib/email/templates/loadEmailTemplate'

const FIELD_DEFS: Array<{ key: TemplateFieldKey; hint: string; multiline: boolean }> = [
  { key: 'subject', hint: 'メールの件名', multiline: false },
  { key: 'heading', hint: 'メール本文の一番上に大きく出る言葉', multiline: false },
  { key: 'body', hint: '空行を入れると段落が分かれます', multiline: true },
  { key: 'cta_label', hint: 'メールの中のボタンに表示する言葉', multiline: false },
  { key: 'note', hint: '空でもかまいません', multiline: false },
]

function fieldsEqual(a: TemplateFields, b: TemplateFields): boolean {
  return (Object.keys(a) as TemplateFieldKey[]).every((k) => a[k] === b[k])
}

/** カテゴリ → テンプレート一覧（テンプレートが1つも無いカテゴリは出さない） */
const CATALOG = EMAIL_TEMPLATE_FAMILIES.map((family) => ({
  family,
  defs: EMAIL_TEMPLATE_DEFS.filter((d) => d.family === family.id),
})).filter((g) => g.defs.length > 0)

interface Props {
  initialRows: Record<string, EmailTemplateRow>
  appName: string
}

const EMPTY_PREVIEW: RenderedEmail = { subject: '', html: '', text: '' }

/**
 * server 側プレビュー。input が変わるたびに POST し、古い応答は捨てる（AbortController）。
 * input が null のとき（ブラウザで描けるテンプレ）は何もしない。
 */
function useServerPreview(input: { draft: TemplateFields; activeKey: string } | null) {
  const [state, setState] = useState<{ rendered: RenderedEmail | null; loading: boolean; error: string | null }>({
    rendered: null,
    loading: false,
    error: null,
  })
  useEffect(() => {
    if (!input) return
    const controller = new AbortController()
    let alive = true
    fetch('/api/admin/email-templates/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: input.activeKey, fields: input.draft }),
      signal: controller.signal,
    })
      .then(async (res) => {
        const json = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(json.error || 'プレビューを作れませんでした')
        if (alive) setState({ rendered: json as RenderedEmail, loading: false, error: null })
      })
      .catch((e: unknown) => {
        if (!alive || (e instanceof DOMException && e.name === 'AbortError')) return
        setState((prev) => ({ ...prev, loading: false, error: e instanceof Error ? e.message : 'プレビューを作れませんでした' }))
      })
    return () => {
      alive = false
      controller.abort()
    }
  }, [input])
  return state
}

export default function EmailTemplatesClient({ initialRows, appName }: Props) {
  const [rows, setRows] = useState(initialRows)
  const [activeKey, setActiveKey] = useState<string>(EMAIL_TEMPLATE_DEFS[0].key)
  const [drafts, setDrafts] = useState<Record<string, TemplateFields>>(() =>
    Object.fromEntries(EMAIL_TEMPLATE_DEFS.map((d) => [d.key, { ...initialRows[d.key].fields }])),
  )
  const [saving, setSaving] = useState(false)
  // 通知は保存対象のテンプレに紐づける（通信中に別テンプレへ切り替えても、そちらに出さない）
  const [notice, setNotice] = useState<{ key: string; kind: 'ok' | 'error'; text: string } | null>(null)
  const [previewMode, setPreviewMode] = useState<'html' | 'text'>('html')
  const [showNonEditable, setShowNonEditable] = useState(false)

  // 差し込み語チップを押したとき、最後に触った入力欄のカーソル位置に入れる
  const inputRefs = useRef<Partial<Record<TemplateFieldKey, HTMLInputElement | HTMLTextAreaElement | null>>>({})
  const [lastFocused, setLastFocused] = useState<TemplateFieldKey>('body')

  const def = getEmailTemplateDef(activeKey) as EmailTemplateDef
  const row = rows[activeKey]
  const draft = drafts[activeKey]
  const family = EMAIL_TEMPLATE_FAMILIES.find((f) => f.id === def.family)
  const allowedNames = useMemo(() => def.placeholders.map((p) => p.name), [def])
  const previewVars = useMemo(() => ({ ...sampleVars(def.placeholders), サービス名: appName }), [def, appName])

  const dirty = !fieldsEqual(draft, row.fields)
  const isDefaultDraft = fieldsEqual(draft, def.defaults)
  const validation = useMemo(() => validateTemplateFields(draft, allowedNames), [draft, allowedNames])

  // プレビュー(iframe srcDoc)は値が変わるたびに文書を丸ごと作り直すので、
  // 打鍵中は前の値を保ち(useDeferredValue)、入力が落ち着いてから描き直す。
  // draft と activeKey を1つに束ねて遅延させる（別々だとテンプレ切替の一瞬だけ色と文面がズレる）
  const previewInput = useMemo(() => ({ draft, activeKey }), [draft, activeKey])
  const deferredInput = useDeferredValue(previewInput)
  const deferredDef = getEmailTemplateDef(deferredInput.activeKey) as EmailTemplateDef
  const localPreview = useMemo<RenderedEmail | null>(() => {
    if (!deferredDef.renderPreview) return null
    const f = deferredInput.draft
    // 入力途中でも常にプレビューは出す（検証NGでもそのまま描く）
    return deferredDef.renderPreview({ ...f, cta_label: f.cta_label || ' ' }, appName)
  }, [deferredInput, deferredDef, appName])
  // React Email 製（承認依頼・滞留リマインド）はブラウザで描けないので server に描いてもらう
  const serverPreview = useServerPreview(deferredDef.renderPreview ? null : deferredInput)
  const preview: RenderedEmail = localPreview ?? serverPreview.rendered ?? EMPTY_PREVIEW

  const selectTemplate = useCallback((key: string) => {
    setActiveKey(key)
    setNotice(null)
  }, [])

  const updateField = useCallback(
    (key: TemplateFieldKey, value: string) => {
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
        updateField(target, current.slice(0, start) + token + current.slice(end))
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

  const applyResult = useCallback((key: string, result: { fields: TemplateFields; isCustom: boolean; updatedAt: string | null }) => {
    setRows((prev) => ({ ...prev, [key]: { key, ...result } }))
    setDrafts((prev) => ({ ...prev, [key]: { ...result.fields } }))
  }, [])

  const callApi = useCallback(
    async (payload: Record<string, unknown>, okText: string, failText: string) => {
      if (saving) return
      const key = activeKey
      setSaving(true)
      setNotice(null)
      try {
        const res = await fetch('/api/admin/email-templates', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key, ...payload }),
        })
        const json = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(json.error || failText)
        if (!json?.fields) throw new Error('保存結果を受け取れませんでした')
        applyResult(key, json)
        setNotice({ key, kind: 'ok', text: okText })
      } catch (e: unknown) {
        setNotice({ key, kind: 'error', text: e instanceof Error ? e.message : failText })
      } finally {
        setSaving(false)
      }
    },
    [activeKey, saving, applyResult],
  )

  const handleSave = useCallback(() => {
    if (!validation.ok) return
    void callApi({ fields: validation.fields }, '保存しました。次に送るメールから、この文面が使われます。', '保存に失敗しました')
  }, [validation, callApi])

  const handleReset = useCallback(() => {
    if (!confirm('この文面を最初の状態（既定の文面）に戻しますか？')) return
    void callApi({ reset: true }, '既定の文面に戻しました。', '既定に戻せませんでした')
  }, [callApi])

  const inputClass =
    'w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-surface text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent'

  return (
    <div className="p-6">
      <div className="mb-5">
        <h1 className="text-lg font-bold text-gray-900">メール文面</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          左の一覧からメールを選んで文面を編集します。保存すると、次に送るメールから新しい文面が使われます。
        </p>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[15rem_minmax(0,1fr)_minmax(0,1fr)] gap-5 items-start">
        {/* Catalog */}
        <nav className="bg-surface border border-gray-200 rounded-xl p-2 xl:sticky xl:top-6" aria-label="メールの種類">
          {CATALOG.map(({ family: f, defs }) => (
            <div key={f.id} className="mb-2 last:mb-0">
              <div className="px-3 pt-2 pb-1 text-[10px] font-semibold text-gray-400 uppercase tracking-wide" title={f.description}>
                {f.label}
              </div>
              {defs.map((d) => {
                const active = d.key === activeKey
                const custom = rows[d.key].isCustom
                const unsaved = !fieldsEqual(drafts[d.key], rows[d.key].fields)
                return (
                  <button
                    key={d.key}
                    type="button"
                    onClick={() => selectTemplate(d.key)}
                    aria-current={active ? 'true' : undefined}
                    className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-left transition-colors mb-0.5 ${
                      active ? 'bg-indigo-50 text-indigo-700 font-medium' : 'text-gray-700 hover:bg-gray-100'
                    }`}
                  >
                    <Envelope size={16} weight={active ? 'fill' : 'regular'} className="shrink-0" />
                    <span className="flex-1 truncate">{d.label}</span>
                    {unsaved ? (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-600 shrink-0">未保存</span>
                    ) : custom ? (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-600 shrink-0">編集済み</span>
                    ) : null}
                  </button>
                )
              })}
            </div>
          ))}

          <div className="mt-3 pt-2 border-t border-gray-100">
            <button
              type="button"
              onClick={() => setShowNonEditable((v) => !v)}
              className="w-full flex items-center gap-1.5 px-3 py-1.5 text-xs text-gray-500 hover:text-gray-700"
            >
              {showNonEditable ? <CaretDown size={12} /> : <CaretRight size={12} />}
              ここでは編集しないメール
            </button>
            {showNonEditable && (
              <ul className="px-3 pb-2 space-y-1.5">
                {NON_EDITABLE_EMAILS.map((m) => (
                  <li key={m.label} className="text-[11px] leading-snug text-gray-500">
                    <span className="text-gray-700">{m.label}</span>
                    <br />
                    {m.reason}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </nav>

        {/* Editor */}
        <div className="bg-surface border border-gray-200 rounded-xl p-5">
          <div className="mb-4">
            <p className="text-[11px] text-gray-400">{family?.label}</p>
            <h2 className="text-sm font-semibold text-gray-900">{def.label}</h2>
            <p className="text-xs text-gray-500 mt-0.5">{def.description}</p>
            <p className="text-xs text-gray-400 mt-1">
              {row.isCustom
                ? `編集済みの文面（最終更新: ${row.updatedAt ? new Date(row.updatedAt).toLocaleString('ja-JP') : '-'}）`
                : '既定の文面（まだ編集されていません）'}
            </p>
          </div>

          <div className="mb-4">
            <p className="text-xs font-medium text-gray-600 mb-1.5">
              差し込み語（押すと入力欄に入ります。送るときに実際の名前などに置き換わります）
            </p>
            <div className="flex flex-wrap gap-1.5">
              {def.placeholders.map((p) => (
                <button
                  key={p.name}
                  type="button"
                  onClick={() => insertPlaceholder(placeholderToken(p))}
                  title={`${p.description}（例: ${p.sample}）`}
                  className="px-2 py-1 text-xs font-mono rounded-md border border-gray-200 bg-gray-50 text-gray-700 hover:bg-indigo-50 hover:border-indigo-200 hover:text-indigo-700 transition-colors"
                >
                  {placeholderToken(p)}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-3">
            {FIELD_DEFS.map((fd) => {
              const value = draft[fd.key]
              const limit = TEMPLATE_LIMITS[fd.key]
              const common = {
                value,
                onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => updateField(fd.key, e.target.value),
                onFocus: () => setLastFocused(fd.key),
              }
              return (
                <div key={fd.key}>
                  <div className="flex items-baseline justify-between mb-1">
                    <label className="text-xs font-medium text-gray-600">
                      {TEMPLATE_FIELD_LABELS[fd.key]}
                      {fd.key !== 'note' && <span className="text-red-500 ml-0.5">*</span>}
                    </label>
                    <span className={`text-[10px] ${value.length > limit ? 'text-red-500' : 'text-gray-400'}`}>
                      {value.length}/{limit}
                    </span>
                  </div>
                  {fd.multiline ? (
                    <textarea
                      {...common}
                      ref={(el) => {
                        inputRefs.current[fd.key] = el
                      }}
                      rows={8}
                      className={`${inputClass} resize-y leading-relaxed`}
                    />
                  ) : (
                    <input
                      {...common}
                      ref={(el) => {
                        inputRefs.current[fd.key] = el
                      }}
                      type="text"
                      className={inputClass}
                    />
                  )}
                  <p className="text-[11px] text-gray-400 mt-0.5">{fd.hint}</p>
                </div>
              )
            })}
          </div>

          {!validation.ok && <p className="mt-3 text-xs text-red-600">{validation.error}</p>}
          {notice && notice.key === activeKey && (
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
                件名: {renderTemplateString(draft.subject, previewVars) || '（件名なし）'}
              </p>
              {serverPreview.error && <p className="text-xs text-red-600">{serverPreview.error}</p>}
            </div>
            <div className="flex rounded-md border border-gray-200 overflow-hidden shrink-0 ml-3">
              {(['html', 'text'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setPreviewMode(m)}
                  className={`px-2.5 py-1 text-xs ${previewMode === m ? 'bg-indigo-600 text-white' : 'bg-surface text-gray-600 hover:bg-gray-100'}`}
                >
                  {m === 'html' ? '見た目' : 'テキスト版'}
                </button>
              ))}
            </div>
          </div>
          {previewMode === 'html' ? (
            <iframe title="メールプレビュー" srcDoc={preview.html} sandbox="" className="w-full h-[calc(100vh-11rem)] min-h-[560px] bg-gray-100" />
          ) : (
            <pre className="p-4 text-xs text-gray-800 whitespace-pre-wrap font-mono h-[calc(100vh-11rem)] min-h-[560px] overflow-auto">{preview.text}</pre>
          )}
        </div>
      </div>
    </div>
  )
}
