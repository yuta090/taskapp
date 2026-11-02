import type { DefaultReactSuggestionItem } from '@blocknote/react'
import { ja as jaLocale } from '@blocknote/core/locales'

/**
 * Wiki の背景色。「/」メニューから、いまの行の背景色を選べるようにする（Notion の「/赤 背景」と
 * 同じ・ユーザー要望 2026-10-30）。色の名前は BlockNote の日本語辞書から取り、
 * 「色」メニューの表記と揃える。色そのものは `globals.css` の `--bn-colors-highlights-*`。
 */
const COLOR_NAMES = jaLocale.color_picker.colors

/** 並びは Notion と同じ（「色」メニューの並びとは別）。読みは「/」で探すため */
export const BLOCK_COLORS = [
  { value: 'gray', reading: ['gure', 'ぐれー', 'グレー', '灰色', 'haiiro'] },
  { value: 'brown', reading: ['chairo', 'ちゃいろ', '茶色', '茶'] },
  { value: 'orange', reading: ['orenji', 'おれんじ', 'オレンジ', '橙'] },
  { value: 'yellow', reading: ['kiiro', 'きいろ', '黄色', '黄'] },
  { value: 'green', reading: ['midori', 'みどり', '緑'] },
  { value: 'blue', reading: ['ao', 'あお', '青'] },
  { value: 'purple', reading: ['murasaki', 'むらさき', '紫'] },
  { value: 'pink', reading: ['pinku', 'ぴんく', 'ピンク'] },
  { value: 'red', reading: ['aka', 'あか', '赤'] },
] as const

const BACKGROUND_ALIASES = ['bg', 'background', 'color', 'haikei', 'はいけい', '背景', '背景色', 'iro', 'いろ', '色']

type ColorEditor = {
  getTextCursorPosition: () => { block: { id: string; type: string } }
  updateBlock: (id: string, update: { props: { backgroundColor: string } }) => unknown
  schema: { blockSchema: Record<string, { propSchema: Record<string, unknown> }> }
}

export type BackgroundColorSlashItem = DefaultReactSuggestionItem & { key: string }

function setBackground(editor: ColorEditor, color: string) {
  const { block } = editor.getTextCursorPosition()
  // 背景色を持たないブロック（区切り線・目次など）では何もしない
  if (!('backgroundColor' in (editor.schema.blockSchema[block.type]?.propSchema ?? {}))) return
  editor.updateBlock(block.id, { props: { backgroundColor: color } })
}

export function buildBackgroundColorSlashItems(editor: unknown): BackgroundColorSlashItem[] {
  const e = editor as ColorEditor
  const group = jaLocale.color_picker.background_title
  return [
    ...BLOCK_COLORS.map(({ value, reading }) => ({
      key: `bg_${value}`,
      title: `背景：${COLOR_NAMES[value]}`,
      aliases: [...BACKGROUND_ALIASES, value, ...reading],
      group,
      icon: <span className="wiki-bg-swatch" data-background-color={value} aria-hidden />,
      onItemClick: () => setBackground(e, value),
    })),
    {
      key: 'bg_default',
      title: '背景を外す',
      aliases: [...BACKGROUND_ALIASES, 'default', 'none', 'clear', 'なし', 'はずす', '外す'],
      group,
      icon: <span className="wiki-bg-swatch" aria-hidden />,
      onItemClick: () => setBackground(e, 'default'),
    },
  ]
}
