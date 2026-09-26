'use client'

import { useEffect, useRef } from 'react'
import { ArrowSquareOut, X } from '@phosphor-icons/react'
import { WikiEditorDynamic } from '@/components/wiki/WikiEditorDynamic'
import { useWikiPageDetail } from '@/lib/hooks/useWikiPageDetail'
import { buildWikiPageHref } from '@/lib/navigation/appLinks'

interface WikiPageOverlayProps {
  orgId: string
  spaceId: string
  pageId: string
  onClose: () => void
  /**
   * 「Wikiで開く」を押したとき。渡すと画面の移動を任せる（議事録の書きかけを確定させてから
   * 移るため）。渡さなければ普通のリンクとして移る
   */
  onOpenPage?: (href: string) => void
}

/**
 * 議事録の上に Wiki のページを重ねて読む。会議中に資料を開くたびに画面が移らないようにする。
 *
 * **UIルールの例外（オーバーレイ）**: 詳細は右パネルで本文を縮めて並べるのが原則だが、Wiki の
 * 資料は右パネル(400px)では読みにくい、というユーザー判断で重ねて広く出す（2026-09-26）。
 * 閉じれば議事録はそのままの位置で出てくる。
 *
 * この段階では読むだけ。直すときは「Wikiで開く」で Wiki 画面へ移る。
 */
export function WikiPageOverlay({ orgId, spaceId, pageId, onClose, onOpenPage }: WikiPageOverlayProps) {
  const { page, loading } = useWikiPageDetail(orgId, pageId)
  const href = buildWikiPageHref(orgId, spaceId, pageId)
  const closeRef = useRef<HTMLButtonElement>(null)
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  // 開いたら×にフォーカスを置く（キーボードでもすぐ閉じられるように）
  useEffect(() => {
    closeRef.current?.focus()
  }, [pageId])

  // Esc で閉じる。window の capture で先に受け取り、議事録の「全画面を抜ける」Esc
  // （document で聞いていて、defaultPrevented なら何もしない）まで届かせない。
  // 日本語の変換を確定する Esc では閉じない
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.isComposing || e.defaultPrevented) return
      e.preventDefault()
      onCloseRef.current()
    }
    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [])

  const title = page?.title || 'Wiki'

  return (
    <div className="fixed inset-0 z-40 flex justify-end" data-testid="wiki-overlay">
      <div
        className="absolute inset-0 bg-gray-900/30"
        data-testid="wiki-overlay-backdrop"
        aria-hidden="true"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="relative flex flex-col h-full w-full md:w-[85vw] md:max-w-[1200px] bg-surface shadow-xl"
      >
        <header className="flex items-center gap-2 h-12 px-4 border-b border-gray-100 flex-shrink-0">
          <h2 className="flex-1 min-w-0 truncate text-sm font-semibold text-gray-900">{title}</h2>
          <a
            href={href}
            onClick={(e) => {
              // Cmd / Ctrl などを押しながらなら、ブラウザに任せて新しいタブで開く
              if (!onOpenPage || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
              e.preventDefault()
              onOpenPage(href)
            }}
            className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs text-gray-600 hover:bg-gray-100"
            data-testid="wiki-overlay-open-page"
          >
            <ArrowSquareOut className="text-sm" />
            Wikiで開く
          </a>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="閉じる"
            className="p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600"
            data-testid="wiki-overlay-close"
          >
            <X className="text-lg" />
          </button>
        </header>
        <div className="flex-1 min-h-0 overflow-y-auto px-6 py-6 md:px-12">
          {page ? (
            <WikiEditorDynamic
              key={`${page.id}-${page.updated_at}`}
              initialContent={page.body || undefined}
              editable={false}
              orgId={orgId}
              spaceId={spaceId}
              currentPageId={page.id}
            />
          ) : (
            <p className="text-sm text-gray-500">
              {loading ? '読み込み中…' : 'このページは見つかりませんでした（削除された可能性があります）'}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
