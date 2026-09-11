'use client'

import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { Check, FileText, MagnifyingGlass, Plus, X } from '@phosphor-icons/react'
import { toast } from 'sonner'
import { createWikiPageSearch } from '@/lib/wiki/pageSearch'
import type { WikiPage } from '@/types/database'

type PickerPage = Pick<WikiPage, 'id' | 'title' | 'tags'>

type Option = { kind: 'page'; page: PickerPage } | { kind: 'create'; title: string }

interface WikiPageLinkPickerProps {
  /** 候補にする Wiki ページ（タグの有無は問わない） */
  pages: readonly PickerPage[]
  /** 紐づけ中のページID */
  value: string | null
  /**
   * ページを紐づける。null で外す。page は選んだ（または作った）ページそのもの。
   * 作った直後のページは呼び出し側の一覧にまだ無いので、タグで扱いを決めるときはこちらを見る
   */
  onSelect: (pageId: string | null, page?: PickerPage) => Promise<void> | void
  /** 入力した名前で Wiki ページを作る。作ったページはそのまま紐づける */
  onCreate: (title: string) => Promise<PickerPage>
  /** 一覧を読み込み中か。候補が空に見えるだけなので、同じ名前のページを二重に作らないよう「新しく作る」を出さない */
  loading?: boolean
  /** 一覧を読み込めなかったか。読み込み中と同じ理由で「新しく作る」を出さない */
  loadError?: boolean
  testId?: string
}

const MAX_CANDIDATES = 8

/** 利用者にそのまま見せる文言を持った失敗 */
class PickerFailure extends Error {}

/**
 * 1つの入力欄で「探して紐づける」と「無ければ作って紐づける」を兼ねる。
 * 打つと候補が絞られ、同じ名前のページが無ければ末尾に「新しく作って紐づける」が出る。
 */
export function WikiPageLinkPicker({
  pages,
  value,
  onSelect,
  onCreate,
  loading = false,
  loadError = false,
  testId = 'wiki-page-link-picker',
}: WikiPageLinkPickerProps) {
  const listId = useId()
  // 紐づけ中に、ページ名を押して付け替えの検索欄を開いているか
  const [editing, setEditing] = useState(false)
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const [busy, setBusy] = useState<'create' | 'select' | null>(null)
  // 連打・Enter の二度押しで二重に作らないよう、state の反映を待たずに止める
  const busyRef = useRef(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const currentRef = useRef<HTMLButtonElement>(null)
  // 操作を終えたら、表示が切り替わって出てきた方へフォーカスを移す（入力欄が消えて操作位置が先頭に飛ばないように）
  const refocusRef = useRef(false)
  // こちらからフォーカスを移したときは候補の一覧を開かない
  const skipOpenOnFocusRef = useRef(false)

  const search = useMemo(() => createWikiPageSearch(pages), [pages])
  const { matches, total, exactMatch } = useMemo(() => search(query, MAX_CANDIDATES), [search, query])
  const trimmed = query.trim()
  const canCreate = !loading && !loadError
  const options = useMemo<Option[]>(() => {
    const list: Option[] = matches.map((page) => ({ kind: 'page', page }))
    if (trimmed && !exactMatch && canCreate) list.push({ kind: 'create', title: trimmed })
    return list
  }, [matches, trimmed, exactMatch, canCreate])
  const hiddenCount = total - matches.length
  const emptyMessage = loadError
    ? 'Wikiページの一覧を読み込めませんでした'
    : loading
      ? 'Wikiページの一覧を読み込み中…'
      : 'Wikiページはまだありません。名前を入力すると新しく作れます'

  const current = value ? pages.find((p) => p.id === value) ?? null : null
  const showInput = !value || editing

  useEffect(() => {
    if (!refocusRef.current || busy) return
    refocusRef.current = false
    // 保存を待つ間に利用者がほかの欄へ移っていたら、そちらの入力を奪わない
    // （タスク名などは離れた瞬間に保存されるので、奪うと打ちかけのまま確定してしまう）
    const active = document.activeElement
    const focusIsFree = !active || active === document.body
    if (!focusIsFree && !rootRef.current?.contains(active)) return
    if (showInput) {
      skipOpenOnFocusRef.current = true
      inputRef.current?.focus()
      skipOpenOnFocusRef.current = false
    } else {
      currentRef.current?.focus()
    }
  })

  const close = () => {
    setOpen(false)
    setActiveIndex(0)
  }

  const run = async (kind: 'create' | 'select', action: () => Promise<void>) => {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(kind)
    try {
      await action()
      setQuery('')
      setEditing(false)
    } catch (err) {
      toast.error(err instanceof PickerFailure ? err.message : '紐づけを保存できませんでした')
    } finally {
      // 失敗して入力欄に戻ったときも、候補の一覧が下の欄に重なったまま残らないよう閉じる
      close()
      refocusRef.current = true
      busyRef.current = false
      setBusy(null)
    }
  }

  const choose = (option: Option) => {
    if (option.kind === 'page') {
      void run('select', async () => {
        await onSelect(option.page.id, option.page)
      })
      return
    }
    void run('create', async () => {
      let created: PickerPage
      try {
        created = await onCreate(option.title)
      } catch {
        throw new PickerFailure('Wikiページを作れませんでした')
      }
      try {
        await onSelect(created.id, created)
      } catch {
        // ページは残っているので、次は同じ名前で探せば候補に出る
        throw new PickerFailure('ページは作りましたが、紐づけを保存できませんでした')
      }
    })
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    // 日本語の変換を確定する Enter で候補を選んでしまわないようにする（Safari は keyCode 229 で来る）
    if (e.nativeEvent.isComposing || e.keyCode === 229) return
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        if (!open) {
          setOpen(true)
          return
        }
        setActiveIndex((i) => (options.length ? (i + 1) % options.length : 0))
        return
      case 'ArrowUp':
        e.preventDefault()
        setActiveIndex((i) => (options.length ? (i - 1 + options.length) % options.length : 0))
        return
      case 'Enter': {
        e.preventDefault()
        // 失敗して一覧が閉じたあとなど、閉じているときの Enter はまず一覧を開く
        if (!open) {
          setOpen(true)
          return
        }
        const option = options[activeIndex]
        if (option) choose(option)
        return
      }
      case 'Escape':
        e.preventDefault()
        if (open) {
          close()
        } else if (editing) {
          setEditing(false)
          setQuery('')
        }
        return
    }
  }

  const handleBlur = () => {
    close()
    // 付け替えの途中で外を押したら、紐づけ中の表示に戻す（作成・保存中は結果を待つ）
    if (editing && !busyRef.current) {
      setEditing(false)
      setQuery('')
    }
  }

  if (!showInput) {
    const label = current ? current.title || '（無題）' : loading ? '読み込み中…' : 'Wikiページ'
    return (
      <div
        ref={rootRef}
        data-testid={testId}
        className="flex items-center rounded-lg border border-gray-200 bg-surface"
      >
        <button
          ref={currentRef}
          type="button"
          onClick={() => setEditing(true)}
          data-testid={`${testId}-current`}
          title="押すと別のページに付け替えられます"
          className="flex min-w-0 flex-1 items-center gap-2 rounded-l-lg px-2 py-1.5 text-left text-sm text-gray-700 hover:bg-gray-50"
        >
          <FileText className="shrink-0 text-gray-400" />
          <span className="truncate">{label}</span>
        </button>
        <button
          type="button"
          onClick={() => {
            void run('select', async () => {
              await onSelect(null)
            })
          }}
          disabled={busy !== null}
          aria-label="紐づけを外す"
          title="紐づけを外す"
          data-testid={`${testId}-clear`}
          className="mr-1 shrink-0 rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 disabled:cursor-not-allowed"
        >
          <X />
        </button>
      </div>
    )
  }

  return (
    <div ref={rootRef} data-testid={testId} className="relative">
      <MagnifyingGlass className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" />
      <input
        ref={inputRef}
        type="text"
        role="combobox"
        aria-label="紐づけるWikiページ"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && options[activeIndex] ? `${listId}-${activeIndex}` : undefined}
        aria-busy={busy !== null}
        value={query}
        placeholder="Wikiページを検索、または新しい名前を入力"
        autoFocus={editing}
        readOnly={busy !== null}
        onFocus={() => {
          if (!skipOpenOnFocusRef.current) setOpen(true)
        }}
        onBlur={handleBlur}
        onChange={(e) => {
          setQuery(e.target.value)
          setOpen(true)
          setActiveIndex(0)
        }}
        onKeyDown={handleKeyDown}
        data-testid={`${testId}-input`}
        className="w-full rounded-lg border border-gray-200 bg-surface py-1.5 pl-7 pr-14 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
      {busy && (
        <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs text-gray-400">
          {busy === 'create' ? '作成中…' : '保存中…'}
        </span>
      )}

      {/* 入力欄の aria-controls が常に実在する要素を指すよう、一覧の枠は閉じていても置いておく。
          候補を押す前に入力欄のフォーカスが外れて閉じないよう、mousedown の既定動作を止める */}
      <div
        hidden={!open}
        onMouseDown={(e) => e.preventDefault()}
        className="absolute left-0 right-0 top-full z-20 mt-1 overflow-hidden rounded-lg border border-gray-200 bg-surface shadow-popover"
      >
        <ul
          id={listId}
          role="listbox"
          aria-label="候補のWikiページ"
          className={open && options.length > 0 ? 'max-h-64 overflow-y-auto py-1' : ''}
        >
          {/* 閉じている間は中身を置かない（隠れた候補のページ名が、画面の他の欄の同じ名前と二重に見つからないように） */}
          {open && options.map((option, i) => (
            <li
              key={option.kind === 'page' ? option.page.id : 'create'}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === activeIndex}
              onMouseEnter={() => setActiveIndex(i)}
              onClick={() => choose(option)}
              data-testid={option.kind === 'page' ? `${testId}-option` : `${testId}-create`}
              className={`flex cursor-pointer items-center gap-2 px-2.5 py-1.5 text-sm ${
                i === activeIndex ? 'bg-gray-100' : ''
              } ${option.kind === 'create' && i > 0 ? 'border-t border-gray-100' : ''}`}
            >
              {option.kind === 'page' ? (
                <>
                  <FileText className="shrink-0 text-gray-400" />
                  <span className="truncate text-gray-700">{option.page.title || '（無題）'}</span>
                  {option.page.id === value && <Check className="ml-auto shrink-0 text-gray-500" />}
                </>
              ) : (
                <>
                  <Plus className="shrink-0 text-gray-500" />
                  {/* 長い名前でも「新しく作って紐づける」が切れて読めなくならないよう、末尾を切らずに折り返す */}
                  <span className="min-w-0 break-words text-gray-700">
                    「<span className="font-medium text-gray-900">{option.title}</span>」を新しく作って紐づける
                  </span>
                </>
              )}
            </li>
          ))}
        </ul>
        {open && options.length === 0 && <p className="px-2.5 py-2 text-xs text-gray-400">{emptyMessage}</p>}
        {open && hiddenCount > 0 && (
          <p className="border-t border-gray-100 px-2.5 py-1.5 text-xs text-gray-400">
            {`ほか ${hiddenCount} 件。言葉を足すと絞り込めます`}
          </p>
        )}
      </div>
    </div>
  )
}
