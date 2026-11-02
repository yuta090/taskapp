'use client'

import { useEffect, useRef, useState } from 'react'
import { createReactBlockSpec, type DefaultReactSuggestionItem } from '@blocknote/react'
import { createExtension } from '@blocknote/core'
import { CheckCircle, Info, Lightbulb, Prohibit, Warning, type Icon } from '@phosphor-icons/react'

/**
 * Wiki の囲み（callout）。長い文書の中で、読み手に「これは何の情報か」を色で伝える
 * （ユーザー要望・2026-11-02）。9色の背景色は自由に使う色、こちらは**意味で選ぶ色**。
 *
 * - 種類は5つだけ。CLI からは GitHub のアラート（`> [!NOTE]` など）で書く
 *   （`packages/mcp-server/src/lib/wikiBody.ts` が同じ対応で読む）
 * - 題名の行（content）の下に、段落・箇条書きを子として複数持てる
 * - 色は `globals.css` の `--callout-*`（ライト・ダークで別の値）
 */
export const CALLOUT_TYPE = 'callout'

export const CALLOUT_KINDS = [
  { kind: 'note', label: '補足', alert: 'NOTE', use: '前提・背景・用語の説明', icon: Info, reading: ['hosoku', 'ほそく', 'info', 'memo'] },
  { kind: 'tip', label: 'ポイント', alert: 'TIP', use: '読み手がやるとよいこと、コツ', icon: Lightbulb, reading: ['pointo', 'ぽいんと', 'hint', 'コツ'] },
  { kind: 'important', label: '結論', alert: 'IMPORTANT', use: '決まったこと、この節の要点', icon: CheckCircle, reading: ['ketsuron', 'けつろん', '要点', 'youten'] },
  { kind: 'warning', label: '注意', alert: 'WARNING', use: '期限・条件・見落としやすい点', icon: Warning, reading: ['chuui', 'ちゅうい', 'caution'] },
  { kind: 'caution', label: '禁止', alert: 'CAUTION', use: 'やってはいけないこと、取り消せない操作', icon: Prohibit, reading: ['kinshi', 'きんし', 'danger', 'stop'] },
] as const satisfies ReadonlyArray<{ kind: string; label: string; alert: string; use: string; icon: Icon; reading: readonly string[] }>

export type CalloutKind = (typeof CALLOUT_KINDS)[number]['kind']

function kindInfo(kind: unknown) {
  return CALLOUT_KINDS.find((k) => k.kind === kind) ?? CALLOUT_KINDS[0]
}

/**
 * 囲みの見た目。上に種類の名前（押すと種類を変えられる）、その下に題名の行。
 * 子のブロックはこの外（BlockNote の入れ子）に描かれるので、囲みの面は CSS で
 * `.bn-block` ごと塗る（globals.css）。ここは名前と題名の行だけを持つ。
 */
export function CalloutView({
  kind,
  editable,
  onChangeKind,
  contentRef,
}: {
  kind: CalloutKind
  editable: boolean
  onChangeKind: (kind: CalloutKind) => void
  contentRef: (node: HTMLElement | null) => void
}) {
  const info = kindInfo(kind)
  const IconC = info.icon
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  return (
    <div className="wiki-callout" data-callout-kind={info.kind} data-testid="wiki-callout">
      <div ref={wrapRef} contentEditable={false} className="wiki-callout-head relative select-none">
        <button
          type="button"
          className="wiki-callout-label"
          disabled={!editable}
          title={editable ? `${info.use}（押すと種類を変える）` : info.use}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setOpen((v) => !v)}
          data-testid="wiki-callout-label"
        >
          <IconC size={16} weight="fill" aria-hidden />
          <span>{info.label}</span>
        </button>
        {open && (
          <div role="menu" className="wiki-callout-menu" data-testid="wiki-callout-menu">
            {CALLOUT_KINDS.map((k) => {
              const ItemIcon = k.icon
              return (
                <button
                  key={k.kind}
                  type="button"
                  role="menuitemradio"
                  aria-checked={k.kind === info.kind}
                  data-kind-option={k.kind}
                  className="wiki-callout-menu-item"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    setOpen(false)
                    onChangeKind(k.kind)
                  }}
                >
                  <ItemIcon size={16} weight="fill" aria-hidden className="wiki-callout-menu-icon" />
                  <span className="whitespace-nowrap font-medium">{k.label}</span>
                  <span className="text-gray-500">{k.use}</span>
                </button>
              )
            })}
          </div>
        )}
      </div>
      <div className="wiki-callout-body min-w-0" ref={contentRef} />
    </div>
  )
}

const calloutBaseSpec = createReactBlockSpec(
  {
    type: CALLOUT_TYPE,
    propSchema: { kind: { default: 'note' as CalloutKind, values: CALLOUT_KINDS.map((k) => k.kind) } },
    content: 'inline',
  } as const,
  {
    render: (props) => (
      <CalloutView
        kind={props.block.props.kind}
        editable={props.editor.isEditable}
        onChangeKind={(kind) => props.editor.updateBlock(props.block, { props: { kind } })}
        contentRef={props.contentRef}
      />
    ),
  }
)()

/** Enter の扱いに要るものだけに絞ったエディタの形（テストから本物をそのまま渡せる）。 */
type CalloutBlock = { id: string; type: string; content?: unknown; children: CalloutBlock[] }
type CalloutEnterEditor = {
  getTextCursorPosition: () => { block: CalloutBlock }
  getParentBlock: (id: string) => CalloutBlock | undefined
  getSelection: () => unknown
  transact: <T>(fn: () => T) => T
  updateBlock: (block: never, update: object) => CalloutBlock
  insertBlocks: (blocks: object[], ref: never, placement: 'before' | 'after') => CalloutBlock[]
  removeBlocks: (blocks: never[]) => unknown
  setTextCursorPosition: (block: never, placement: 'start' | 'end') => void
}

const isEmpty = (b: CalloutBlock) => !Array.isArray(b.content) || b.content.length === 0

/**
 * 囲みの中の Enter（Notion と同じ動き）。
 *
 * - 題名の行で押す → 題名を割らずに、中の先頭に空の行を足してそこへ移る（下に囲みを増やさない）
 * - 中身の無い囲みで押す → 普通の行に戻す（囲みをやめる）
 * - 中の**最後の空の行**で押す → その行を囲みのすぐ下へ出す（囲みから抜ける）
 *
 * 文字を選んでいるときと、それ以外の行では既定の Enter に任せる。
 */
export function enterInCallout(editor: CalloutEnterEditor): boolean {
  if (editor.getSelection()) return false
  const block = editor.getTextCursorPosition().block

  if (block.type === CALLOUT_TYPE) {
    if (isEmpty(block) && block.children.length === 0) {
      editor.updateBlock(block as never, { type: 'paragraph', props: {} })
      return true
    }
    editor.transact(() => {
      const first = block.children[0]
      const body = first
        ? editor.insertBlocks([{ type: 'paragraph' }], first as never, 'before')[0]
        : editor.updateBlock(block as never, { children: [{ type: 'paragraph' }] }).children[0]
      editor.setTextCursorPosition(body as never, 'start')
    })
    return true
  }

  if (block.type !== 'paragraph' || !isEmpty(block) || block.children.length > 0) return false
  const parent = editor.getParentBlock(block.id)
  if (!parent || parent.type !== CALLOUT_TYPE) return false
  if (parent.children[parent.children.length - 1]?.id !== block.id) return false
  editor.transact(() => {
    editor.removeBlocks([block as never])
    const [outside] = editor.insertBlocks([{ type: 'paragraph' }], parent as never, 'after')
    editor.setTextCursorPosition(outside as never, 'start')
  })
  return true
}

export const calloutSpec = {
  ...calloutBaseSpec,
  extensions: [
    ...(calloutBaseSpec.extensions ?? []),
    createExtension({
      key: 'wiki-callout-enter',
      keyboardShortcuts: {
        Enter: ({ editor }) => enterInCallout(editor as unknown as CalloutEnterEditor),
      },
    }),
  ],
}

type CalloutInsertEditor = {
  getTextCursorPosition: () => { block: CalloutBlock }
  updateBlock: (block: never, update: object) => unknown
  insertBlocks: (blocks: object[], ref: never, placement: 'after') => CalloutBlock[]
  setTextCursorPosition: (block: never, placement: 'start' | 'end') => void
}

export type CalloutSlashItem = DefaultReactSuggestionItem & { key: string }

/**
 * 「/」メニューの囲み5種類。空の行ならその行を囲みに、文字のある行ならすぐ下に囲みを足す
 * （BlockNote の既定の項目と同じ振る舞い）
 */
export function buildCalloutSlashItems(editor: unknown): CalloutSlashItem[] {
  const e = editor as CalloutInsertEditor
  return CALLOUT_KINDS.map((k) => {
    const IconC = k.icon
    return {
      key: `callout_${k.kind}`,
      title: k.label,
      subtext: `囲み：${k.use}`,
      aliases: [k.kind, k.alert.toLowerCase(), k.label, ...k.reading, 'callout', 'kakomi', 'かこみ', '囲み'],
      group: '囲み',
      icon: <IconC size={18} weight="fill" />,
      onItemClick: () => {
        const { block } = e.getTextCursorPosition()
        if (isEmpty(block) && block.type === 'paragraph') {
          e.updateBlock(block as never, { type: CALLOUT_TYPE, props: { kind: k.kind } })
          e.setTextCursorPosition(block as never, 'end')
          return
        }
        const [added] = e.insertBlocks([{ type: CALLOUT_TYPE, props: { kind: k.kind } }], block as never, 'after')
        e.setTextCursorPosition(added as never, 'end')
      },
    }
  })
}
