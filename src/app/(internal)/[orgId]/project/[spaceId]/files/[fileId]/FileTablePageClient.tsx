'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Table, DownloadSimple, ArrowCounterClockwise, Warning, Copy } from '@phosphor-icons/react'
import { toast } from 'sonner'
import { Breadcrumb, LoadingState } from '@/components/shared'
import { DataTableEditor } from '@/components/table/DataTableEditor'
import { useFiles } from '@/lib/hooks/useFiles'
import { formatFileSize } from '@/lib/files/format'
import { AnnouncementBell } from '@/components/announcement/AnnouncementBell'
import { useFileTable } from '@/lib/hooks/useFileTable'
import { useCanEditSpace } from '@/lib/hooks/useCanEditSpace'
import {
  useSaveFileTable,
  FileTableConflictError,
  FileTableSaveError,
} from '@/lib/hooks/useSaveFileTable'
import { serializeDelimited } from '@/lib/table/serializeDelimited'
import type { Delimiter, TableData } from '@/lib/table/parseDelimited'

/** 入力が止まってから保存するまでの待ち時間。連続で直しても保存は1回にまとまる */
const AUTO_SAVE_DEBOUNCE_MS = 1200
/** 「保存しました」を出しておく時間 */
const SAVED_BADGE_MS = 2000

type SaveState = 'idle' | 'saving' | 'saved'

interface FileTablePageClientProps {
  orgId: string
  spaceId: string
  fileId: string
}

/**
 * ファイル→表のページ。
 * - ファイル名・サイズは一覧(useFiles)のキャッシュから引く(一覧→表の遷移で追加待ちなし)
 * - 中身は useFileTable で取得し、ブラウザ側で表に変換する
 * - 直せる人(社内メンバー)には編集グリッドを出す。直したら少し待って同じファイルへ書き戻す
 * - 開けないとき(大きすぎる・形式違い)は理由と「ダウンロード」の逃げ道を出す
 */
export function FileTablePageClient({ orgId, spaceId, fileId }: FileTablePageClientProps) {
  const basePath = `/${orgId}/project/${spaceId}`
  const { data: files } = useFiles(spaceId)
  const file = files?.find((f) => f.id === fileId)
  const { data, isPending, error, refetch } = useFileTable(fileId)
  const { canEdit } = useCanEditSpace(spaceId, orgId)
  // ベースライン(TasksPageClient)と同じ判定。isLoading は通信停止中(オフライン等)に false になり
  // 「読み込み中でもエラーでも表でもない空画面」になるため使わない
  const isLoading = isPending && !data

  const [saveState, setSaveState] = useState<SaveState>('idle')
  // 読み直すたびに増やし、編集する側(FileTableEditorPane)を作り直す。書きかけの表を
  // 外から差し替える(effect で同期する)形にすると、保存の途中に上書きが挟まって消える
  const [reloadCount, setReloadCount] = useState(0)

  // useCallback で包まない。渡す先(FileTableEditorPane)は memo していないので同じ参照である
  // 利点が無く、包むと React Compiler が「既存の memo 化を引き継げない」として最適化をやめる
  const handleRequestReload = () => {
    setSaveState('idle')
    setReloadCount((n) => n + 1)
    void refetch()
  }

  const downloadHref = `/api/files/${fileId}/download`
  // 版が分からないまま保存すると、誰かの変更を黙って消しかねないので直させない
  const isEditable = canEdit && !!data?.updatedAt

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Header */}
      <header className="h-12 border-b border-gray-100 flex items-center px-5 flex-shrink-0 gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <Table className="text-lg text-gray-500 flex-shrink-0" />
          <Breadcrumb
            items={[
              { label: 'プロジェクト', href: basePath },
              { label: 'ファイル', href: `${basePath}/files` },
              { label: file?.name ?? '表' },
            ]}
          />
        </div>
        <div className="ml-auto flex items-center gap-3 flex-shrink-0 text-xs text-gray-400">
          {/* 保存ボタンは置かない。いま保存されたかどうかだけを小さく伝える */}
          {saveState === 'saving' && <span className="text-gray-500">保存中...</span>}
          {saveState === 'saved' && <span className="text-gray-500">保存しました</span>}
          {file && <span className="hidden sm:inline">{formatFileSize(file.sizeBytes)}</span>}
          {data?.encoding === 'shift_jis' && (
            <span className="hidden sm:inline" title="UTF-8 として読めなかったため Shift_JIS として読み込みました">
              Shift_JIS で読み込み
            </span>
          )}
          <a
            href={downloadHref}
            className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-gray-700 bg-surface border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
          >
            <DownloadSimple className="text-sm" />
            ダウンロード
          </a>
          {/* お知らせベル。ヘッダーの一番右に置く。この目印(data-header-bell)があると、
              AppShell がページ上部に出す「ベルだけの1行」が globals.css の :has() で消える。
              モバイルは AppShell のヘッダーにベルがあるので md 未満では出さない。 */}
          <div data-header-bell className="hidden md:block">
            <AnnouncementBell />
          </div>
        </div>
      </header>

      {/* Body */}
      {isLoading && <LoadingState />}
      {!isLoading && error && (
        <div className="text-center py-16">
          <p className="text-sm text-red-600">{error.message}</p>
          <div className="mt-3 flex items-center justify-center gap-2">
            <button
              type="button"
              onClick={() => void refetch()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-700 bg-surface border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
            >
              <ArrowCounterClockwise className="text-sm" />
              再試行
            </button>
            <a
              href={downloadHref}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-700 bg-surface border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
            >
              <DownloadSimple className="text-sm" />
              保存して手元で開く
            </a>
          </div>
        </div>
      )}
      {!isLoading && !error && data && (
        <>
          {canEdit && !data.updatedAt && (
            <p className="px-5 py-2 text-xs text-amber-600 border-b border-gray-100">
              このファイルの今の状態が分からないため、直せません。ページを読み込み直してください
            </p>
          )}
          {/* 見るだけの人にも同じグリッドを出す。役割が決まるのを待ってから出し分けると、
              先に表が届いたときに読み取り専用のグリッドを一度作って捨てることになり、
              初回の描画を二重に払ううえ、検索語とスクロール位置も消える */}
          <FileTableEditorPane
            key={`${fileId}:${reloadCount}`}
            fileId={fileId}
            spaceId={spaceId}
            editable={isEditable}
            initialTable={data.table}
            initialUpdatedAt={data.updatedAt ?? ''}
            delimiter={data.delimiter}
            onSaveStateChange={setSaveState}
            onRequestReload={handleRequestReload}
          />
        </>
      )}
    </div>
  )
}

interface FileTableEditorPaneProps {
  fileId: string
  spaceId: string
  /** false なら見るだけ(閲覧者・相手先、または版が分からないとき)。保存は動かない */
  editable: boolean
  initialTable: TableData
  /** 見るだけのときは空文字。保存しないので使われない */
  initialUpdatedAt: string
  delimiter: Delimiter
  onSaveStateChange: (state: SaveState) => void
  onRequestReload: () => void
}

/**
 * 表を直して、同じファイルへ書き戻す部分。
 *
 * 保存の型は議事録(MinutesDocumentView)に合わせている:
 * - 入力が止まってから保存(デバウンス)。保存は同時に1本だけで、通信中に来た分は
 *   最後の1つだけ積んで、終わってから送る
 * - 保存のたびに基準の版を差し替える。ズレていたら(409)帯を出し、**以後の自動保存を止める**。
 *   黙って上書きするより、書きかけを取り出せるほうが被害が小さい
 */
function FileTableEditorPane({
  fileId,
  spaceId,
  editable,
  initialTable,
  initialUpdatedAt,
  delimiter,
  onSaveStateChange,
  onRequestReload,
}: FileTableEditorPaneProps) {
  const [table, setTable] = useState(initialTable)
  const [conflict, setConflict] = useState(false)
  const { saveTable } = useSaveFileTable()

  const baseUpdatedAtRef = useRef(initialUpdatedAt)
  const conflictRef = useRef(false)
  const savingRef = useRef(false)
  /** 通信中に来た分。最後の1つだけ残す */
  const pendingRef = useRef<TableData | null>(null)
  /** まだ保存できていない中身(画面を離れるときの取りこぼし防止) */
  const dirtyRef = useRef<TableData | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const savedBadgeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** 書きかけをコピーするときに使う、いま画面に出ている表 */
  const tableRef = useRef(initialTable)
  /**
   * 保存を自分自身から呼び戻すための入れ口。runSave の中で runSave を直に呼ぶと
   * 「宣言前の変数」になるため、ref 越しに呼ぶ(議事録の scheduleSaveRef と同じ形)
   */
  const runSaveRef = useRef<((next: TableData) => Promise<void>) | null>(null)

  const onSaveStateChangeRef = useRef(onSaveStateChange)
  // 描画の最中に ref を書き換えない。保存の状態を伝えるのは必ず非同期の後なので、
  // 描画が終わってから差し替えれば間に合う
  useEffect(() => {
    onSaveStateChangeRef.current = onSaveStateChange
  }, [onSaveStateChange])
  const setSaveState = useCallback((state: SaveState) => onSaveStateChangeRef.current(state), [])

  const runSave = useCallback(
    async (next: TableData): Promise<void> => {
      savingRef.current = true
      setSaveState('saving')

      try {
        const { updatedAt } = await saveTable({
          fileId,
          spaceId,
          table: next,
          delimiter,
          baseUpdatedAt: baseUpdatedAtRef.current,
        })
        baseUpdatedAtRef.current = updatedAt
        if (dirtyRef.current === next) dirtyRef.current = null
        setSaveState('saved')
        if (savedBadgeTimerRef.current) clearTimeout(savedBadgeTimerRef.current)
        savedBadgeTimerRef.current = setTimeout(() => setSaveState('idle'), SAVED_BADGE_MS)
      } catch (err) {
        if (err instanceof FileTableConflictError) {
          conflictRef.current = true
          setConflict(true)
        } else {
          // 保存に失敗したが版だけ進んでいることがある。次のやり直しが必ず競合しないよう、
          // 返ってきた版を基準に取り込んでおく
          if (err instanceof FileTableSaveError && err.updatedAt) {
            baseUpdatedAtRef.current = err.updatedAt
          }
          toast.error(err instanceof Error ? err.message : '表を保存できませんでした')
        }
        setSaveState('idle')
      }

      savingRef.current = false

      const queued = pendingRef.current
      pendingRef.current = null
      if (queued && !conflictRef.current) {
        await runSaveRef.current?.(queued)
      }
    },
    [delimiter, fileId, saveTable, setSaveState, spaceId]
  )

  // こちらも描画の最中には書き換えない。保存が走るのは早くてもデバウンス(1.2秒)の後
  useEffect(() => {
    runSaveRef.current = runSave
  }, [runSave])

  const scheduleSave = useCallback((next: TableData) => {
    if (!editable || conflictRef.current) return
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      timerRef.current = null
      if (savingRef.current) {
        pendingRef.current = next
        return
      }
      void runSaveRef.current?.(next)
    }, AUTO_SAVE_DEBOUNCE_MS)
  }, [editable])

  const handleChange = useCallback(
    (next: TableData) => {
      tableRef.current = next
      dirtyRef.current = next
      setTable(next)
      scheduleSave(next)
    },
    [scheduleSave]
  )

  // 画面を離れるとき、待ち時間の途中だった分を送っておく(押した操作が消えないように)
  useEffect(() => {
    return () => {
      if (savedBadgeTimerRef.current) clearTimeout(savedBadgeTimerRef.current)
      if (timerRef.current) clearTimeout(timerRef.current)
      const unsaved = dirtyRef.current
      if (unsaved && !conflictRef.current && !savingRef.current) {
        void runSaveRef.current?.(unsaved)
      }
    }
  }, [])

  const handleCopyDraft = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(serializeDelimited(tableRef.current, delimiter))
      toast.success('直した表をコピーしました。貼り付けて保存できます')
    } catch {
      toast.error('コピーできませんでした')
    }
  }, [delimiter])

  return (
    <>
      {conflict && (
        <div className="flex items-center gap-3 flex-wrap px-5 py-2 border-b border-amber-200 bg-amber-50 flex-shrink-0">
          <Warning className="text-amber-600 flex-shrink-0" weight="fill" />
          <p className="text-xs text-amber-700 min-w-0">
            このファイルは、別の場所で更新されています。上書きしないよう自動保存を止めました
          </p>
          <div className="ml-auto flex items-center gap-2 flex-shrink-0">
            <button
              type="button"
              onClick={() => void handleCopyDraft()}
              className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-gray-700 bg-surface border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
            >
              <Copy className="text-sm" />
              書きかけをコピー
            </button>
            <button
              type="button"
              onClick={onRequestReload}
              className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-white bg-amber-600 rounded-lg hover:bg-amber-700 transition-colors"
            >
              <ArrowCounterClockwise className="text-sm" />
              最新を読み込む
            </button>
          </div>
        </div>
      )}
      <DataTableEditor data={table} onChange={handleChange} editable={editable} />
    </>
  )
}
