'use client'

import { useState, useEffect, useMemo, type ChangeEvent } from 'react'
import { X, Trash, Clock, Tag, PencilSimple, Check, FilePdf } from '@phosphor-icons/react'
import { toast } from 'sonner'
import type { Milestone, WikiPage } from '@/types/database'
import type { WikiPageVersionSummary } from '@/lib/hooks/useWikiPages'
import { descendantIds } from '@/lib/wiki/listView'
import { useConfirmDialog } from '@/components/shared/ConfirmDialog'
import {
  hasChangedSinceDecision,
  latestDecisionVersion,
  versionKindLabel,
} from '@/lib/wiki/decisionVersions'

const SPEC_TAG = '仕様書'

export interface WikiPageUpdates {
  title?: string
  tags?: string[]
  parent_page_id?: string | null
  milestone_id?: string | null
  pinned_at?: string | null
}

interface WikiPageInspectorProps {
  page: WikiPage
  onClose: () => void
  onUpdate?: (updates: WikiPageUpdates) => Promise<void>
  onDelete?: () => Promise<void>
  onFetchVersions?: (pageId: string) => Promise<WikiPageVersionSummary[]>
  onRestoreVersion?: (version: WikiPageVersionSummary) => void
  /** 親ページ候補・循環候補の除外に使う同一スペースの全ページ。省略時は「整理」の親ページ欄を出さない。 */
  allPages?: WikiPage[]
  /** 紐づけ候補のマイルストーン。省略時は「整理」のマイルストーン欄を出さない。 */
  milestones?: Milestone[]
  /** タスクからの参照で付いているマイルストーン（読み取り専用表示・PR4）。空/省略なら出さない。 */
  taskLinkedMilestones?: Milestone[]
}

export function WikiPageInspector({
  page,
  onClose,
  onUpdate,
  onDelete,
  onFetchVersions,
  onRestoreVersion,
  allPages = [],
  milestones = [],
  taskLinkedMilestones = [],
}: WikiPageInspectorProps) {
  const [isEditingTitle, setIsEditingTitle] = useState(false)
  const [editTitle, setEditTitle] = useState(page.title)
  const [isDeleting, setIsDeleting] = useState(false)
  const { confirm, ConfirmDialog, closeConfirm } = useConfirmDialog()
  const [versions, setVersions] = useState<WikiPageVersionSummary[]>([])
  /**
   * 確定した時点の控えと、そのあと本文が変わったか。版を読んだときにしか分からないので、
   * バージョン履歴を開いたときだけ出す（毎回取りに行くと、パネルを開くたびに1往復増える）。
   *
   * 判定に `page.updated_at` は使わない。理由が2つある（page-perf レビュー指摘）:
   *   - 本文の自動保存では `page`(activePage) が差し替わらないので、いちばん出したい
   *     「確定したあとに本文を直した」場面で出ない。
   *   - ピン留めやタグを変えただけでも `updated_at` はトリガーで進むので、本文が
   *     変わっていないのに出てしまう。
   * 版は本文を保存するたびに必ず1行積まれるので、同じ列どうしを比べるほうが正しい。
   */
  const lastDecision = useMemo(() => latestDecisionVersion(versions), [versions])
  const latestVersionAt = useMemo(
    () => versions.reduce<string | null>((a, v) => (a === null || v.created_at > a ? v.created_at : a), null),
    [versions]
  )
  const changedSinceDecision = useMemo(
    () => hasChangedSinceDecision(latestVersionAt, lastDecision),
    [latestVersionAt, lastDecision]
  )
  const [showVersions, setShowVersions] = useState(false)
  const [loadingVersions, setLoadingVersions] = useState(false)
  const [tagInput, setTagInput] = useState('')
  const [organizeError, setOrganizeError] = useState<string | null>(null)

  // Reset state when page changes — intentional state sync from props
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional state reset when page changes
    setEditTitle(page.title)
    setIsEditingTitle(false)
    setIsDeleting(false)
    setShowVersions(false)
    setVersions([])
    setOrganizeError(null)
    // 見ている対象が変わったら、出しっぱなしの削除の確認も取り下げる。残すと、
    // 前のページ名のまま出ている確認で「削除する」を押せてしまう。
    closeConfirm()
  }, [page.id, page.title, closeConfirm])

  const handleSaveTitle = async () => {
    if (!onUpdate || !editTitle.trim() || editTitle === page.title) {
      setIsEditingTitle(false)
      setEditTitle(page.title)
      return
    }
    try {
      await onUpdate({ title: editTitle.trim() })
      setIsEditingTitle(false)
    } catch {
      setEditTitle(page.title)
      setIsEditingTitle(false)
    }
  }

  const handleDelete = async () => {
    if (!onDelete || isDeleting) return
    const ok = await confirm({
      title: 'ページを削除',
      message: `「${page.title}」を削除しますか？この操作は取り消せません。`,
      confirmLabel: '削除する',
      variant: 'danger',
    })
    if (!ok) return
    setIsDeleting(true)
    try {
      await onDelete()
    } catch {
      setIsDeleting(false)
    }
  }

  const handleAddTag = async () => {
    const tag = tagInput.trim()
    if (!tag || !onUpdate || page.tags.includes(tag)) {
      setTagInput('')
      return
    }
    try {
      await onUpdate({ tags: [...page.tags, tag] })
    } catch {
      // Error handled by hook
    }
    setTagInput('')
  }

  const handleRemoveTag = async (tagToRemove: string) => {
    if (!onUpdate) return
    try {
      await onUpdate({ tags: page.tags.filter(t => t !== tagToRemove) })
    } catch {
      // Error handled by hook
    }
  }

  // 「仕様書として扱う」スイッチ。タグ配列の '仕様書' の有無で表す（決定フローが有効になる条件は
  // useTasks.ts の specChangesForWikiLink 側）。ON/OFF どちらも他のタグ・順序はそのまま残す。
  const isSpec = page.tags.includes(SPEC_TAG)

  const handleToggleSpec = async () => {
    if (!onUpdate) return
    const nextTags = isSpec ? page.tags.filter(t => t !== SPEC_TAG) : [...page.tags, SPEC_TAG]
    try {
      await onUpdate({ tags: nextTags })
    } catch {
      toast.error('仕様書の設定を変更できませんでした')
    }
  }

  // 「整理」セクション: 即時保存（保存ボタン無し）。失敗したら onUpdate 側（updatePage）が
  // 楽観更新をロールバックするため、value は page prop に戻ったままになる。ここでは
  // 一行のエラーメッセージだけ出す。
  const handleTogglePinned = async () => {
    if (!onUpdate) return
    setOrganizeError(null)
    try {
      await onUpdate({ pinned_at: page.pinned_at != null ? null : new Date().toISOString() /* DB に渡す値。表示計算ではない */ })
    } catch {
      setOrganizeError('固定状態を変更できませんでした')
    }
  }

  const handleParentChange = async (e: ChangeEvent<HTMLSelectElement>) => {
    if (!onUpdate) return
    setOrganizeError(null)
    try {
      await onUpdate({ parent_page_id: e.target.value || null })
    } catch {
      setOrganizeError('同じスペースのページだけ選べます')
    }
  }

  const handleMilestoneChange = async (e: ChangeEvent<HTMLSelectElement>) => {
    if (!onUpdate) return
    setOrganizeError(null)
    try {
      await onUpdate({ milestone_id: e.target.value || null })
    } catch {
      setOrganizeError('同じスペースのマイルストーンだけ選べます')
    }
  }

  // PDF はブラウザの印刷を借りて作る（PDF を組み立てる部品は入れていない）。紙に載せるのを
  // ページ名と本文だけに絞る指定は globals.css の @media print 側にあり、画面に置いた
  // data-print-root / data-print-hide の印を見ている（WikiPageClient.tsx）。
  //
  // 出さないと決めた2か所（2026-09-18・ユーザー判断。増やすならここを更新する）:
  //  - 全画面表示の間はこのパネルごと閉じるのでボタンも出ない。Ctrl+P / Cmd+P は効き、
  //    紙に載る中身は同じなので、全画面のバーにはボタンを並べない
  //  - 相手先ポータル（PortalWikiClient）にはこのパネルが無いので付けていない。
  //    社内アプリに相手先として入っている人には出る
  const handlePrintPdf = () => {
    window.print()
  }

  const handleToggleVersions = async () => {
    if (showVersions) {
      setShowVersions(false)
      return
    }
    if (onFetchVersions) {
      setLoadingVersions(true)
      try {
        const v = await onFetchVersions(page.id)
        setVersions(v)
      } catch {
        setVersions([])
      }
      setLoadingVersions(false)
    }
    setShowVersions(true)
  }

  // 自分自身・自分の子孫は親ページに選べない（循環防止）。
  const parentOptions = useMemo(() => {
    const excluded = descendantIds(allPages, page.id)
    return allPages.filter(p => p.id !== page.id && !excluded.has(p.id))
  }, [allPages, page.id])

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleString('ja-JP', {
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  return (
    <div className="h-full flex flex-col bg-surface">
      {ConfirmDialog}
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
        <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">ページ情報</span>
        <div className="flex items-center gap-1">
          {onDelete && (
            <button
              onClick={handleDelete}
              disabled={isDeleting}
              className="p-1.5 rounded transition-colors text-gray-400 hover:text-red-500 hover:bg-gray-100 disabled:opacity-50"
              aria-label="ページを削除"
              title="削除"
            >
              <Trash className="text-base" />
            </button>
          )}
          <button
            onClick={onClose}
            className="p-1.5 rounded text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
          >
            <X className="text-base" />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-5">
        {/* Title */}
        <div>
          <label className="text-xs font-medium text-gray-500 mb-1 block">タイトル</label>
          {isEditingTitle ? (
            <div className="flex items-center gap-1">
              <input
                type="text"
                value={editTitle}
                onChange={e => setEditTitle(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') handleSaveTitle()
                  if (e.key === 'Escape') {
                    setIsEditingTitle(false)
                    setEditTitle(page.title)
                  }
                }}
                className="flex-1 px-2 py-1 text-sm border border-indigo-300 rounded focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                autoFocus
              />
              <button onClick={handleSaveTitle} className="p-1 text-indigo-ink hover:bg-indigo-50 rounded">
                <Check className="text-sm" />
              </button>
            </div>
          ) : (
            <button
              onClick={() => setIsEditingTitle(true)}
              className="w-full text-left flex items-center gap-1 group"
            >
              <span className="text-sm font-medium text-gray-900 truncate">{page.title}</span>
              <PencilSimple className="text-xs text-gray-400 opacity-0 group-hover:opacity-100 transition-opacity" />
            </button>
          )}
        </div>

        {/* PDFで保存。読むだけの人にも出す（控えを持ち帰れるように） */}
        <div className="space-y-1.5">
          <button
            type="button"
            onClick={handlePrintPdf}
            data-testid="wiki-print-pdf"
            className="w-full flex items-center justify-center gap-1.5 px-3 py-2 text-sm font-medium text-gray-700 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
          >
            <FilePdf className="text-base" />
            PDFで保存
          </button>
          <p className="text-[10px] text-gray-400">印刷の画面が開きます。保存先で「PDF」を選んでください</p>
        </div>

        {/* Spec switch: タグの '仕様書' をトグルで表す */}
        {onUpdate ? (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between px-3 py-2 border border-gray-200 rounded-lg bg-surface">
              <span className="text-sm text-gray-700">仕様書として扱う</span>
              <button
                type="button"
                role="switch"
                aria-checked={isSpec}
                aria-label="仕様書として扱う"
                onClick={handleToggleSpec}
                data-testid="wiki-spec-switch"
                className={`relative w-11 h-6 rounded-full transition-colors flex-shrink-0 ${
                  isSpec ? 'bg-indigo-600' : 'bg-gray-300'
                }`}
              >
                <span
                  className={`absolute top-0.5 left-0.5 w-5 h-5 bg-surface rounded-full shadow transition-transform ${
                    isSpec ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>
            <p className="text-[10px] text-gray-400">タスクに紐づけると「検討中→決定」で管理します</p>
          </div>
        ) : (
          isSpec && (
            <span
              data-testid="wiki-spec-badge"
              className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium bg-gray-100 text-gray-600"
            >
              仕様書
            </span>
          )
        )}

        {/* Tags */}
        <div>
          <label className="text-xs font-medium text-gray-500 mb-1 flex items-center gap-1">
            <Tag className="text-xs" />
            タグ
          </label>
          <div className="flex flex-wrap gap-1.5 mb-2">
            {page.tags.filter(tag => tag !== SPEC_TAG).map(tag => (
              <span
                key={tag}
                className="inline-flex items-center gap-1 px-2 py-0.5 text-xs bg-gray-100 text-gray-700 rounded group"
              >
                {tag}
                <button
                  onClick={() => handleRemoveTag(tag)}
                  className="text-gray-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <X className="text-[10px]" />
                </button>
              </span>
            ))}
          </div>
          <div className="flex items-center gap-1">
            <input
              type="text"
              value={tagInput}
              onChange={e => setTagInput(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') handleAddTag()
              }}
              placeholder="タグを追加..."
              className="flex-1 px-2 py-1 text-xs border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-indigo-500/20"
            />
          </div>
        </div>

        {/* Organize: pin / parent page / milestone — PR2 構造 */}
        <div className="space-y-3">
          <label className="text-xs font-medium text-gray-500 block">整理</label>

          <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
            <input
              type="checkbox"
              checked={page.pinned_at != null}
              onChange={handleTogglePinned}
              aria-label="一覧の先頭に固定"
              className="rounded border-gray-300"
            />
            一覧の先頭に固定
          </label>

          <div>
            <label htmlFor={`wiki-parent-select-${page.id}`} className="text-xs text-gray-500 mb-1 block">
              親ページ
            </label>
            <select
              id={`wiki-parent-select-${page.id}`}
              aria-label="親ページ"
              value={page.parent_page_id ?? ''}
              onChange={handleParentChange}
              className="w-full px-2 py-1.5 text-sm border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-indigo-500/20 bg-surface"
            >
              <option value="">なし</option>
              {parentOptions.map(p => (
                <option key={p.id} value={p.id}>
                  {p.title}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor={`wiki-milestone-select-${page.id}`} className="text-xs text-gray-500 mb-1 block">
              マイルストーン
            </label>
            <select
              id={`wiki-milestone-select-${page.id}`}
              aria-label="マイルストーン"
              value={page.milestone_id ?? ''}
              onChange={handleMilestoneChange}
              className="w-full px-2 py-1.5 text-sm border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-indigo-500/20 bg-surface"
            >
              <option value="">なし</option>
              {milestones.map(m => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </div>

          {taskLinkedMilestones.length > 0 && (
            <p className="text-[10px] text-gray-400">
              タスクからの参照: {taskLinkedMilestones.map(m => m.name).join('・')}
            </p>
          )}

          {organizeError && <p className="text-xs text-red-600">{organizeError}</p>}
        </div>

        {/* Metadata */}
        <div className="space-y-2">
          <label className="text-xs font-medium text-gray-500">メタデータ</label>
          <div className="text-xs text-gray-500 space-y-1">
            <div>作成: {formatDate(page.created_at)}</div>
            <div>更新: {formatDate(page.updated_at)}</div>
          </div>
        </div>

        {/* Version History */}
        <div>
          <button
            onClick={handleToggleVersions}
            className="flex items-center gap-1.5 text-xs font-medium text-gray-500 hover:text-gray-700 transition-colors"
          >
            <Clock className="text-sm" />
            バージョン履歴
            <span className="text-[10px] text-gray-400">{showVersions ? '▼' : '▶'}</span>
          </button>
          {showVersions && (
            <div className="mt-2 space-y-1 max-h-48 overflow-y-auto">
              {loadingVersions ? (
                <div className="text-xs text-gray-400 py-2">読み込み中...</div>
              ) : versions.length === 0 ? (
                <div className="text-xs text-gray-400 py-2">バージョン履歴はありません</div>
              ) : (
                <>
                  {changedSinceDecision && lastDecision && (
                    // amber は「相手先に見える」印に予約されている。警告はこの画面の
                    // 競合帯（WikiPageClient）と同じ orange に合わせる（ダークでも読める）
                    <p
                      data-testid="wiki-changed-since-decision"
                      className="px-2 py-1.5 text-xs rounded bg-orange-50 border border-orange-200 text-orange-ink"
                    >
                      確定したあとに本文が変わっています（最終確定 {formatDate(lastDecision.created_at)}
                      {latestVersionAt !== null && <>／最終更新 {formatDate(latestVersionAt)}</>}）
                    </p>
                  )}
                  {versions.map(version => {
                    const kindLabel = versionKindLabel(version.kind)
                    return (
                      <div
                        key={version.id}
                        className="flex items-center justify-between gap-2 px-2 py-1.5 text-xs rounded hover:bg-gray-50 group"
                      >
                        <span className="flex items-center gap-1.5 min-w-0">
                          <span className="text-gray-600">{formatDate(version.created_at)}</span>
                          {kindLabel && (
                            <span
                              data-testid="wiki-version-kind"
                              className="flex-shrink-0 px-1.5 py-0.5 rounded text-[10px] font-medium bg-indigo-50 text-indigo-ink"
                            >
                              {kindLabel}
                            </span>
                          )}
                        </span>
                        {onRestoreVersion && (
                          <button
                            onClick={() => onRestoreVersion(version)}
                            className="text-indigo-600 opacity-0 group-hover:opacity-100 transition-opacity text-[10px] font-medium flex-shrink-0"
                          >
                            復元
                          </button>
                        )}
                      </div>
                    )
                  })}
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
