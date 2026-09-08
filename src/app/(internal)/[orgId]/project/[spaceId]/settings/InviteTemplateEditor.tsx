'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { CaretDown, CaretRight, CircleNotch, ArrowCounterClockwise } from '@phosphor-icons/react'
import { toast } from 'sonner'
import { useInviteTemplate } from '@/lib/hooks/useInviteTemplate'
import { isTemplateEdited } from '@/lib/email/templates/inviteOverride'
import {
  TEMPLATE_FIELD_LABELS,
  TEMPLATE_LIMITS,
  placeholderToken,
  type TemplateFieldKey,
  type TemplateFields,
} from '@/lib/email/templates/core'
import { INVITE_PLACEHOLDERS } from '@/lib/email/templates/invite'

/** 招待するときに、送信側へ渡すもの。打鍵のたびに親を描き直さないよう ref 経由で渡す */
export interface InviteTemplateState {
  /** その1通かぎりの文面（触っていなければ null） */
  fields: TemplateFields | null
  /** テンプレートとして保存するか */
  saveAsTemplate: boolean
  /** 保存後に読み直す */
  refresh: () => void
}

interface InviteTemplateEditorProps {
  spaceId: string
  role: 'client' | 'member'
  /** 親が招待を送るときに読む。中身は編集のたびに更新される */
  stateRef: React.MutableRefObject<InviteTemplateState>
  /** 標準の文面に戻すときの確認ダイアログ（親の useConfirmDialog を借りる） */
  confirm: (opts: { title: string; message: string; confirmLabel: string }) => Promise<boolean>
  /** 開いているか。送信のたびに下書きを作り直しても開閉が保たれるよう親が持つ */
  open: boolean
  onToggle: () => void
}

// 常に見せるのは件名と本文。残りは折りたたむ
const ALWAYS_VISIBLE_FIELDS: ReadonlyArray<{ key: TemplateFieldKey; multiline: boolean }> = [
  { key: 'subject', multiline: false },
  { key: 'body', multiline: true },
]
const FOLDED_FIELDS: ReadonlyArray<{ key: TemplateFieldKey; multiline: boolean }> = [
  { key: 'heading', multiline: false },
  { key: 'cta_label', multiline: false },
  { key: 'note', multiline: false },
]

const TEMPLATE_SOURCE_LABEL: Record<string, string> = {
  org: 'この事務所で保存した文面です。',
  platform: '標準の文面です。',
  code: '標準の文面です。',
}

/**
 * 招待メールの文面を、送る前にその場で確認・変更する。
 *
 * 変更は既定でその1通かぎり。「テンプレートとして保存する」を選んだときだけ事務所の文面になる。
 * 下書きをこの中に閉じ込めているのは、1文字打つたびにメンバー一覧まで描き直さないため。
 */
export function InviteTemplateEditor({ spaceId, role, stateRef, confirm, open, onToggle }: InviteTemplateEditorProps) {
  // null = まだ触っていない。そのあいだは今の文面をそのまま映す。役割で文面が違うので別々に持つ
  const [drafts, setDrafts] = useState<Record<'client' | 'member', TemplateFields | null>>({
    client: null,
    member: null,
  })
  const [saveAsTemplate, setSaveAsTemplate] = useState(false)
  const [showFolded, setShowFolded] = useState(false)
  const [lastFocused, setLastFocused] = useState<TemplateFieldKey>('body')
  const fieldRefs = useRef<Partial<Record<TemplateFieldKey, HTMLInputElement | HTMLTextAreaElement | null>>>({})

  const { template, loading, error, refresh } = useInviteTemplate(spaceId, role, open)
  const baseFields = template?.fields ?? null
  const draftFields = drafts[role] ?? baseFields
  const edited = !!baseFields && !!draftFields && isTemplateEdited(baseFields, draftFields)
  const canSave = template?.canSaveTemplate ?? false

  // 親は招待を送るときにここを読む（描画は起こさない）
  useEffect(() => {
    stateRef.current = {
      fields: draftFields && (edited || (saveAsTemplate && canSave)) ? draftFields : null,
      saveAsTemplate: saveAsTemplate && canSave,
      refresh,
    }
  })

  const updateField = useCallback(
    (key: TemplateFieldKey, value: string) => {
      setDrafts((prev) => {
        const current = prev[role] ?? baseFields
        if (!current) return prev
        return { ...prev, [role]: { ...current, [key]: value } }
      })
    },
    [role, baseFields]
  )

  const resetDraft = useCallback(() => {
    setDrafts((prev) => ({ ...prev, [role]: null }))
  }, [role])

  // 差し込み語のボタン。最後に触っていた入力欄のカーソル位置に入れる
  const insertPlaceholder = useCallback(
    (token: string) => {
      const el = fieldRefs.current[lastFocused]
      const current = draftFields?.[lastFocused] ?? ''
      if (!el) {
        updateField(lastFocused, current + token)
        return
      }
      const start = el.selectionStart ?? current.length
      const end = el.selectionEnd ?? current.length
      updateField(lastFocused, current.slice(0, start) + token + current.slice(end))
      requestAnimationFrame(() => {
        el.focus()
        el.setSelectionRange(start + token.length, start + token.length)
      })
    },
    [lastFocused, draftFields, updateField]
  )

  const handleResetTemplate = useCallback(async () => {
    const ok = await confirm({
      title: '標準の文面に戻す',
      message: 'この事務所で保存した招待メールの文面を消して、標準の文面に戻しますか？',
      confirmLabel: '戻す',
    })
    if (!ok) return
    try {
      const res = await fetch(`/api/invites/template?space_id=${spaceId}&role=${role}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('reset failed')
      setDrafts((prev) => ({ ...prev, [role]: null }))
      refresh()
      toast.success('標準の文面に戻しました')
    } catch {
      toast.error('標準の文面に戻せませんでした')
    }
  }, [confirm, spaceId, role, refresh])

  return (
    <div className="border-t border-gray-100 pt-3">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex items-center gap-1 text-xs text-gray-600 hover:text-gray-900 transition-colors"
      >
        {open ? <CaretDown className="w-3 h-3" /> : <CaretRight className="w-3 h-3" />}
        送るメールの文面を確認・変更する
        {edited && (
          <span className="ml-1 text-[10px] text-indigo-ink bg-indigo-50 px-1.5 py-0.5 rounded">変更中</span>
        )}
      </button>

      {open && (
        <div className="mt-3 space-y-3">
          {loading && (
            <div className="flex items-center gap-2 text-xs text-gray-500">
              <CircleNotch className="w-3 h-3 animate-spin" />
              読み込み中...
            </div>
          )}
          {error && <p className="text-xs text-red-600">{error}</p>}

          {draftFields && (
            <>
              <div className="flex items-start justify-between gap-3">
                <p className="text-[11px] text-gray-500">
                  {TEMPLATE_SOURCE_LABEL[template?.source ?? 'code']}
                  ここでの変更はこの1通だけに使われ、テンプレートは変わりません。
                </p>
                {template?.source === 'org' && canSave && (
                  <button
                    type="button"
                    onClick={() => void handleResetTemplate()}
                    className="text-[11px] text-gray-500 hover:text-gray-700 underline flex-shrink-0"
                  >
                    標準の文面に戻す
                  </button>
                )}
              </div>

              <div>
                <p className="text-[11px] text-gray-500 mb-1">
                  差し込み語（押すと入ります。送るときに実際の名前などに置き換わります）
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {INVITE_PLACEHOLDERS.map((ph) => (
                    <button
                      key={ph.name}
                      type="button"
                      onClick={() => insertPlaceholder(placeholderToken(ph))}
                      title={`${ph.description}（例: ${ph.sample}）`}
                      className="px-2 py-0.5 text-[11px] font-mono rounded border border-gray-200 bg-gray-50 text-gray-700 hover:bg-indigo-50 hover:border-indigo-200 hover:text-indigo-ink transition-colors"
                    >
                      {placeholderToken(ph)}
                    </button>
                  ))}
                </div>
              </div>

              {[...ALWAYS_VISIBLE_FIELDS, ...(showFolded ? FOLDED_FIELDS : [])].map((fd) => {
                const value = draftFields[fd.key]
                const limit = TEMPLATE_LIMITS[fd.key]
                const inputId = `invite-template-${fd.key}`
                const common = {
                  id: inputId,
                  value,
                  onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
                    updateField(fd.key, e.target.value),
                  onFocus: () => setLastFocused(fd.key),
                  className:
                    'mt-1 w-full px-3 py-2 text-sm bg-surface border border-gray-200 rounded-lg text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500',
                }
                return (
                  <div key={fd.key}>
                    <div className="flex items-baseline justify-between">
                      <label htmlFor={inputId} className="text-xs text-gray-500">
                        {TEMPLATE_FIELD_LABELS[fd.key]}
                      </label>
                      <span className={`text-[10px] ${value.length > limit ? 'text-red-600' : 'text-gray-400'}`}>
                        {value.length}/{limit}
                      </span>
                    </div>
                    {fd.multiline ? (
                      <textarea
                        {...common}
                        ref={(el) => {
                          fieldRefs.current[fd.key] = el
                        }}
                        rows={6}
                        className={`${common.className} resize-y leading-relaxed`}
                      />
                    ) : (
                      <input
                        {...common}
                        ref={(el) => {
                          fieldRefs.current[fd.key] = el
                        }}
                        type="text"
                      />
                    )}
                  </div>
                )
              })}

              <button
                type="button"
                onClick={() => setShowFolded((v) => !v)}
                className="flex items-center gap-1 text-[11px] text-gray-500 hover:text-gray-700 transition-colors"
              >
                {showFolded ? <CaretDown className="w-3 h-3" /> : <CaretRight className="w-3 h-3" />}
                見出し・ボタンの文字・補足も変える
              </button>

              <div className="flex items-center justify-between gap-3 border-t border-gray-100 pt-3">
                <div>
                  <label
                    htmlFor="invite-save-template"
                    className="flex items-center gap-1.5 text-xs text-gray-700 cursor-pointer"
                  >
                    <input
                      id="invite-save-template"
                      type="checkbox"
                      checked={saveAsTemplate}
                      disabled={!canSave}
                      onChange={(e) => setSaveAsTemplate(e.target.checked)}
                      className="w-3.5 h-3.5 accent-indigo-600 disabled:cursor-not-allowed"
                    />
                    テンプレートとして保存する
                  </label>
                  <p className="text-[11px] text-gray-500 mt-0.5">
                    {canSave
                      ? 'この事務所のすべてのプロジェクトで、次からこの文面が最初に出ます'
                      : '保存できるのは事務所の管理者だけです（この場だけの変更はできます）'}
                  </p>
                </div>
                {edited && (
                  <button
                    type="button"
                    onClick={resetDraft}
                    className="inline-flex items-center gap-1.5 rounded border border-gray-300 bg-surface px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 transition-colors flex-shrink-0"
                  >
                    <ArrowCounterClockwise className="w-3.5 h-3.5" />
                    元に戻す
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
