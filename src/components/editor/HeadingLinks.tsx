'use client'

import { memo, useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { LinkSimple } from '@phosphor-icons/react'
import { toast } from 'sonner'
import {
  buildHeadingClipboard,
  buildHeadingUrl,
  collectHeadingAnchors,
  findHeadingIdByHash,
  type HeadingAnchor,
} from '@/lib/navigation/headingAnchor'
import { writeLinkToClipboard } from '@/lib/navigation/writeLinkToClipboard'

/**
 * 見出しへのリンク（Wiki と議事録の本文で使う）。
 *
 * - 見出しにマウスを乗せると、文字の右にリンクのボタンが出る。押すと
 *   「ページ名 §見出し」と URL をクリップボードに入れる
 * - URL に `#` があれば、本文が描き上がるのを待ってその見出しへ動かし、少しのあいだ色を付ける
 *
 * ボタンは本文（ProseMirror が持つ DOM）の中には入れず、本文の上に重ねた層に置く。
 * 本文の DOM に手を入れると、エディタが「書き換えられた」と受け取って中身を読み直してしまう。
 * 色付けも同じ理由で、属性を変えずにアニメーション（element.animate）で行う。
 */

/** ここで使うエディタの部分だけ（型をまるごと持ち込むと描き直しの型が重い） */
export interface HeadingLinksEditor {
  document: readonly unknown[]
  onChange?: (cb: () => void) => (() => void) | void
}

interface Props {
  editor: HeadingLinksEditor
  /** 本文を包む要素。`position: relative` にしておく（ボタンの位置の基準になる） */
  containerRef: RefObject<HTMLElement | null>
  /** コピーする文字に添えるページ名（Wiki のページ名・会議名） */
  pageTitle: string
}

const BUTTON_SIZE = 20
/** # で開いたとき、本文が描き上がるのを待つ上限 */
const HASH_WAIT_MS = 5000
const HASH_POLL_MS = 100
/** 見出しを目立たせる長さ */
const FLASH_MS = 2400

function headingElement(container: ParentNode, id: string): HTMLElement | null {
  return container.querySelector<HTMLElement>(
    `.bn-block[data-id="${CSS.escape(id)}"] > [data-content-type="heading"]`
  )
}

/** 見出しの文字の終わり（最後の行の右端）。ボタンはその右に置く */
function measure(container: HTMLElement, id: string): { top: number; left: number } | null {
  const el = headingElement(container, id)
  if (!el) return null
  const inline = el.querySelector('.bn-inline-content') ?? el
  const base = container.getBoundingClientRect()
  let rect: DOMRect | null = null
  if (typeof document.createRange === 'function') {
    const range = document.createRange()
    range.selectNodeContents(inline)
    const rects = typeof range.getClientRects === 'function' ? range.getClientRects() : null
    if (rects && rects.length > 0) rect = rects[rects.length - 1]
  }
  if (!rect) rect = inline.getBoundingClientRect()
  return {
    top: rect.top - base.top + (rect.height - BUTTON_SIZE) / 2,
    left: rect.right - base.left + 6,
  }
}

function flash(el: HTMLElement) {
  if (typeof el.animate !== 'function') return
  // 色は中央トークンから読む（ダークでは .dark 側の値になる）。アンバー/オレンジは
  // 「相手先に見える」印の色なので使わない
  const color = getComputedStyle(document.documentElement).getPropertyValue('--color-blue-100').trim()
  if (!color) return
  el.animate(
    [
      { backgroundColor: color, offset: 0 },
      { backgroundColor: color, offset: 0.6 },
      { backgroundColor: 'transparent', offset: 1 },
    ],
    { duration: FLASH_MS, easing: 'ease-out' }
  )
}

type Positions = Record<string, { top: number; left: number }>

function samePositions(a: Positions, b: Positions): boolean {
  const keys = Object.keys(b)
  if (Object.keys(a).length !== keys.length) return false
  return keys.every((k) => a[k] && a[k].top === b[k].top && a[k].left === b[k].left)
}

function sameAnchors(a: readonly HeadingAnchor[], b: readonly HeadingAnchor[]): boolean {
  if (a.length !== b.length) return false
  return a.every((x, i) => x.id === b[i].id && x.anchor === b[i].anchor && x.text === b[i].text)
}

export function HeadingLinks({ editor, containerRef, pageTitle }: Props) {
  const [anchors, setAnchors] = useState<HeadingAnchor[]>(() => collectHeadingAnchors(editor.document))
  const [positions, setPositions] = useState<Positions>({})
  const [hoveredId, setHoveredId] = useState<string | null>(null)

  // 本文が変わるたびに見出しを取り直す（目次ブロックと同じ）。見出しが変わっていなければ
  // 前の配列のまま返し、1文字打つたびにボタンを描き直したり測り直したりしない。
  // 段落を足して見出しが下へずれたときは、枠の高さが変わるので下の ResizeObserver が拾う
  useEffect(() => {
    const off = editor.onChange?.(() => {
      const next = collectHeadingAnchors(editor.document)
      setAnchors((prev) => (sameAnchors(prev, next) ? prev : next))
    })
    return () => {
      if (typeof off === 'function') off()
    }
  }, [editor])

  // ボタンの位置。見出しが変わったとき・枠の大きさが変わったときに測り直す（1フレームにまとめる）。
  // 枠の見張り（ResizeObserver）は1回だけ付け、測るときは最新の見出しを ref から読む
  const anchorsRef = useRef(anchors)
  const measureRef = useRef<() => void>(() => {})
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    let frame = 0
    const run = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const next: Positions = {}
        for (const a of anchorsRef.current) {
          const p = measure(container, a.id)
          if (p) next[a.id] = p
        }
        // 位置が変わっていなければ描き直さない
        setPositions((prev) => (samePositions(prev, next) ? prev : next))
      })
    }
    measureRef.current = run
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(run)
    observer?.observe(container)
    return () => {
      cancelAnimationFrame(frame)
      observer?.disconnect()
      measureRef.current = () => {}
    }
  }, [containerRef])

  useEffect(() => {
    anchorsRef.current = anchors
    measureRef.current()
  }, [anchors])

  // マウスが乗っている見出し。本文の中の要素には手を入れず、枠で拾う
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const onOver = (e: MouseEvent) => {
      const target = e.target as Element | null
      if (!target || typeof target.closest !== 'function') return
      // 自分のボタンに乗ったときはそのまま（見出しから右へ動かしたときに消さない）
      if (target.closest('[data-heading-link]')) return
      const block = target.closest('.bn-block[data-id]')
      const isHeading = block?.querySelector(':scope > [data-content-type="heading"]')
      setHoveredId(isHeading ? block!.getAttribute('data-id') : null)
    }
    const onLeave = () => setHoveredId(null)
    container.addEventListener('mouseover', onOver)
    container.addEventListener('mouseleave', onLeave)
    return () => {
      container.removeEventListener('mouseover', onOver)
      container.removeEventListener('mouseleave', onLeave)
    }
  }, [containerRef])

  // URL の # で見出しへ動く。開いたときと、同じページのまま # が変わったとき
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const tryScroll = (deadline: number) => {
      const container = containerRef.current
      const id = findHeadingIdByHash(collectHeadingAnchors(editor.document), window.location.hash)
      const el = container && id ? headingElement(container, id) : null
      // 隠した枠の中（同時編集の議事録は本文が届くまで隠している）では動かせないので待つ
      if (el && el.getClientRects().length > 0) {
        el.scrollIntoView({ block: 'start' })
        flash(el)
        return
      }
      if (Date.now() < deadline) timer = setTimeout(() => tryScroll(deadline), HASH_POLL_MS)
    }
    const run = () => {
      clearTimeout(timer)
      if (!window.location.hash) return
      tryScroll(Date.now() + HASH_WAIT_MS)
    }
    run()
    window.addEventListener('hashchange', run)
    return () => {
      clearTimeout(timer)
      window.removeEventListener('hashchange', run)
    }
  }, [editor, containerRef])

  const copy = useCallback(
    async (a: HeadingAnchor) => {
      const url = buildHeadingUrl(window.location, a.anchor)
      const ok = await writeLinkToClipboard(buildHeadingClipboard({ pageTitle, headingText: a.text, url }))
      if (ok) toast.success('リンクをコピーしました')
      else toast.error('リンクをコピーできませんでした')
    },
    [pageTitle]
  )

  if (anchors.length === 0) return null

  return (
    // 押すためのものなので紙には載せない
    <div data-print-hide className="pointer-events-none absolute inset-0">
      {anchors.map((a) => (
        <HeadingLinkButton
          key={a.id}
          anchor={a}
          top={positions[a.id]?.top}
          left={positions[a.id]?.left}
          visible={hoveredId === a.id}
          onCopy={copy}
          onHover={setHoveredId}
        />
      ))}
    </div>
  )
}

/**
 * 見出し1つ分のボタン。マウスが動くたびに全部を描き直さないよう memo で包む
 * （描き直すのは、見える/隠れるが切り替わった2つだけになる）。
 * 隠れているあいだもキーボードの Tab では止まり、止まったときは見える。
 */
const HeadingLinkButton = memo(function HeadingLinkButton({
  anchor,
  top,
  left,
  visible,
  onCopy,
  onHover,
}: {
  anchor: HeadingAnchor
  top?: number
  left?: number
  visible: boolean
  onCopy: (a: HeadingAnchor) => Promise<void>
  onHover: (id: string) => void
}) {
  const placed = top !== undefined && left !== undefined
  return (
    <button
      type="button"
      data-heading-link
      data-testid="heading-link-copy"
      data-visible={visible ? 'true' : 'false'}
      aria-label="見出しへのリンクをコピー"
      title="見出しへのリンクをコピー"
      onClick={() => void onCopy(anchor)}
      onMouseEnter={() => onHover(anchor.id)}
      style={{ top: top ?? 0, left: left ?? 0 }}
      className={`absolute flex h-5 w-5 items-center justify-center rounded text-gray-400 transition-opacity hover:bg-gray-100 hover:text-gray-700 focus-visible:pointer-events-auto focus-visible:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 ${
        visible && placed ? 'pointer-events-auto opacity-100' : 'opacity-0'
      }`}
    >
      <LinkSimple size={14} weight="bold" />
    </button>
  )
})
