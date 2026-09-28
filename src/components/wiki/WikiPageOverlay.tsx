'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowSquareOut, X } from '@phosphor-icons/react'
import { WikiBodyEditor } from '@/components/wiki/WikiBodyEditor'
import { useWikiPageDetail } from '@/lib/hooks/useWikiPageDetail'
import { useWikiPages } from '@/lib/hooks/useWikiPages'
import { useSpaceMembers } from '@/lib/hooks/useSpaceMembers'
import { useCurrentUser } from '@/lib/hooks/useCurrentUser'
import { noteAuthorNameOf } from '@/lib/minutes/noteStamp'
import { buildWikiPageHref } from '@/lib/navigation/appLinks'
import { shouldCloseOverlayOnEscape } from '@/components/wiki/overlayEscape'
import { SAVING } from '@/lib/design/tokens'
import { useWikiBodySave, WIKI_CONFLICT_MESSAGE, WIKI_PAGE_DELETED_MESSAGE } from '@/lib/wiki/useWikiBodySave'

interface WikiPageOverlayProps {
  orgId: string
  spaceId: string
  pageId: string
  /** 書けるか（その space の編集者）。false なら読むだけ */
  canEdit?: boolean
  onClose: () => void
  /**
   * 「Wikiで開く」を押したとき。渡すと画面の移動を任せる（議事録の書きかけを確定させてから
   * 移るため）。渡さなければ普通のリンクとして移る
   */
  onOpenPage?: (href: string) => void
}

/**
 * 議事録の上に Wiki のページを重ねて読み書きする。会議中に資料を開くたびに画面が移らないようにする。
 *
 * **UIルールの例外（オーバーレイ）**: 詳細は右パネルで本文を縮めて並べるのが原則だが、Wiki の
 * 資料は右パネル(400px)では読みにくい、というユーザー判断で重ねて広く出す（2026-09-26）。
 * 閉じれば議事録はそのままの位置で出てくる。
 *
 * 保存・同時に書いたときの競合・削除の検知は Wiki 画面と同じ useWikiBodySave を使う
 * （作り直すと、Wiki 画面で塞いだ「黙って消える」穴がここで開くため）。
 * 閉じる・「Wikiで開く」・別のページへ切り替える前に書きかけを保存しきる。
 */
export function WikiPageOverlay({ orgId, spaceId, pageId, canEdit = false, onClose, onOpenPage }: WikiPageOverlayProps) {
  const { page, loading, fetching } = useWikiPageDetail(orgId, pageId)
  // 保存に使う。canEdit は渡さない — 渡すと、ページが無い space では最初のページを作る処理が走る
  const { updatePage, fetchPage } = useWikiPages({ orgId, spaceId, canEdit: false })
  const bodySave = useWikiBodySave({ updatePage, fetchPage })
  const { saveStatus, conflict, pageDeleted, editorReloadToken, setBaseline, flushPendingSave, leavePage } = bodySave
  const href = buildWikiPageHref(orgId, spaceId, pageId)

  // メモの「書いた人」と、投票ブロックの名前（Wiki 画面と同じ引き方）
  const { members } = useSpaceMembers(spaceId)
  const { user: currentUser } = useCurrentUser()
  const noteAuthorName = useMemo(() => noteAuthorNameOf(members, currentUser?.id), [members, currentUser?.id])
  const pollProps = useMemo(() => {
    const byId = new Map(members.map((m) => [m.id, m.displayName]))
    return {
      wikiPageId: pageId,
      currentUserId: currentUser?.id ?? null,
      nameOf: (userId: string) => byId.get(userId) || '（メンバー外の人）',
    }
  }, [members, currentUser?.id, pageId])

  // 読み直し終えた本文だけを保存の基準にする。手元の古い本文（前に開いたとき）を基準に
  // 書かせると、最初の保存で偽の競合になる。基準を置くのはページごとに1回だけ
  // （以後の読み直しで基準を差し替えると、書いた分の保存が黙って上書き扱いになる）
  // エディタは基準を置き終えてから出す（出したエディタの最初の onChange が、基準の無いまま
  // 保存＝楽観ロック無しの上書きにならないように）
  // 一度基準を置いたら、以後の読み直し（fetching）ではエディタを消さない（書いている途中に
  // 消えて出直すと、打った位置が飛ぶ）。基準も差し替えない
  const [baselinePage, setBaselinePage] = useState<{ id: string; body: string | null; updated_at: string } | null>(
    null
  )
  // 別のプロジェクトのページは開かない（この議事録の書ける・書けないが当てはまらない）
  const pageInSpace = page && page.space_id === spaceId ? page : null
  const freshPage = pageInSpace && !fetching ? pageInSpace : null
  useEffect(() => {
    if (!freshPage || baselinePage?.id === freshPage.id) return
    setBaseline(freshPage, { content: true })
    setBaselinePage({ id: freshPage.id, body: freshPage.body, updated_at: freshPage.updated_at })
  }, [freshPage, baselinePage, setBaseline])
  const ready = baselinePage?.id === pageId

  // 閉じられた（別のページへ切り替わった・議事録を離れた）ら、書きかけを保存しきる（leavePage は変わらない）
  useEffect(() => () => leavePage(), [leavePage])

  // 帯の「最新を読み込む」で読み直した本文。エディタを作り直すときはこちらを出す
  // （useWikiPageDetail の手元の本文は、開いたときのまま）
  const [reloaded, setReloaded] = useState<{ body: string | null; updated_at: string } | null>(null)
  const reloadLatest = bodySave.reloadLatest
  const handleReloadLatest = useCallback(async () => {
    await reloadLatest(pageId, (fresh) => setReloaded({ body: fresh.body, updated_at: fresh.updated_at }))
  }, [reloadLatest, pageId])

  /**
   * 閉じる前に書きかけを保存しきる。ほかの人が先に書き換えていたら閉じずに帯を見せる
   * （閉じると控えを取れないまま書きかけが消える）。帯が出たあとは閉じてよい
   */
  // 閉じる処理の途中か（×の連打・Esc の2度押しで、保存の結果を待たずに閉じないため）
  const closingRef = useRef(false)
  const requestClose = useCallback(async () => {
    if (closingRef.current) return
    if (conflict) {
      onClose()
      return
    }
    closingRef.current = true
    try {
      await flushPendingSave()
    } catch {
      return
    } finally {
      closingRef.current = false
    }
    onClose()
  }, [conflict, flushPendingSave, onClose])

  const closeRef = useRef<HTMLButtonElement>(null)
  // 開いたら×にフォーカスを置く（キーボードでもすぐ閉じられるように）
  useEffect(() => {
    closeRef.current?.focus()
  }, [pageId])

  // Esc で閉じる。エディタのメニュー（「/」など）を閉じる Esc・変換の確定は奪わない
  // （見分け方は shouldCloseOverlayOnEscape）。議事録の「全画面を抜ける」Esc は、
  // 重ねている間は議事録側が止めている（MeetingsPageClient）
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!shouldCloseOverlayOnEscape(e)) return
      e.preventDefault()
      void requestClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [requestClose])

  const title = pageInSpace?.title || 'Wiki'

  return (
    <div className="fixed inset-0 z-40 flex justify-end" data-testid="wiki-overlay">
      <div
        className="absolute inset-0 bg-gray-900/30"
        data-testid="wiki-overlay-backdrop"
        aria-hidden="true"
        onClick={() => void requestClose()}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="relative flex flex-col h-full w-full md:w-[85vw] md:max-w-[1200px] bg-surface shadow-xl"
      >
        <header className="flex items-center gap-2 h-12 px-4 border-b border-gray-100 flex-shrink-0">
          <h2 className="flex-1 min-w-0 truncate text-sm font-semibold text-gray-900">{title}</h2>
          {saveStatus === 'saving' && (
            <span className="text-xs text-gray-400 flex items-center gap-1">
              <span className={`w-1.5 h-1.5 ${SAVING.dot} rounded-full animate-pulse`} />
              保存中...
            </span>
          )}
          {saveStatus === 'saved' && <span className="text-xs text-green-500">保存済み</span>}
          <a
            href={href}
            onClick={(e) => {
              // Cmd / Ctrl などを押しながらなら、ブラウザに任せて新しいタブで開く
              if (!onOpenPage || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
              e.preventDefault()
              // 書きかけを保存しきってから移る（保存できなければ移らず帯を見せる）
              void flushPendingSave().then(() => onOpenPage(href), () => {})
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
            onClick={() => void requestClose()}
            aria-label="閉じる"
            className="p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600"
            data-testid="wiki-overlay-close"
          >
            <X className="text-lg" />
          </button>
        </header>
        {/* 競合の帯（Wiki 画面と同じ文面・同じ操作） */}
        {conflict && (
          <div data-testid="wiki-conflict-banner" className="px-6 py-3 bg-orange-50 border-b border-orange-200 flex-shrink-0">
            <p className="text-sm text-orange-ink">{pageDeleted ? WIKI_PAGE_DELETED_MESSAGE : WIKI_CONFLICT_MESSAGE}</p>
            <div className="mt-2 flex items-center gap-3">
              <button
                type="button"
                onClick={() => void bodySave.copyDraft()}
                className="text-xs font-medium text-orange-ink hover:underline underline"
              >
                書きかけをコピー
              </button>
              {!pageDeleted && (
                <button
                  type="button"
                  onClick={() => void handleReloadLatest()}
                  className="text-xs font-medium text-orange-ink hover:underline underline"
                >
                  最新を読み込む
                </button>
              )}
            </div>
          </div>
        )}
        <div className="flex-1 min-h-0 overflow-y-auto px-6 py-6 md:px-12">
          {ready ? (
            // 同時編集（使う組織だけ）も Wiki 画面と同じ部品で受け持つ。ここだけ1人用にすると、
            // 議事録から書いた人だけ Wiki 画面の人と弾き合って競合の帯が出続ける
            <WikiBodyEditor
              key={`${baselinePage.id}-${editorReloadToken}`}
              orgId={orgId}
              spaceId={spaceId}
              pageId={baselinePage.id}
              initialBody={(reloaded ?? baselinePage).body}
              basisUpdatedAt={(reloaded ?? baselinePage).updated_at}
              canEdit={canEdit}
              bodySave={bodySave}
              onRequestReload={handleReloadLatest}
              onBeforeNavigate={flushPendingSave}
              noteAuthorName={noteAuthorName}
              poll={pollProps}
            />
          ) : (
            <p className="text-sm text-gray-500">
              {loading || fetching ? '読み込み中…' : 'このページは見つかりませんでした（削除された可能性があります）'}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
