import { Extension, type NodeViewRenderer } from '@tiptap/core'
import type { Node as PMNode } from 'prosemirror-model'
import { createExtension, defaultBlockSpecs, defaultProps, getBackgroundColorAttribute } from '@blocknote/core'

/**
 * Wiki の表。BlockNote の既定の表に**ブロック全体の背景色**を足したもの。
 *
 * 既定の表は文字色しか持たないので、行の左の「⠿ → 色を変更」に背景色が出なかった
 * （ユーザー申告・2026-10-30）。セルごとの色は既定のまま（表の端のつまみから付ける）。
 *
 * 表のブロックの props は tiptap の table ノードの属性から読まれるので、型（propSchema）に
 * 足すだけでなく、ノードにも属性を足す。既定の文字色（`TextColorExtension`）と同じやり方。
 */
const tableBackgroundColor = Extension.create({
  name: 'wikiTableBackgroundColor',
  addGlobalAttributes() {
    return [{ types: ['table'], attributes: { backgroundColor: getBackgroundColorAttribute() } }]
  },
})

/** 色の属性を、表を包む `.bn-block-content` に書き直す。既定（default）なら外す */
const COLOR_ATTRS = [
  ['textColor', 'data-text-color'],
  ['backgroundColor', 'data-background-color'],
] as const

function syncColorAttrs(dom: HTMLElement, node: PMNode) {
  for (const [attr, dataAttr] of COLOR_ATTRS) {
    const value = node.attrs[attr]
    if (value && value !== 'default') dom.setAttribute(dataAttr, String(value))
    else dom.removeAttribute(dataAttr)
  }
}

/**
 * 既定の表の描画（prosemirror-tables の TableView）は、属性が変わっても `update` で
 * 包みの要素を描き直さない。色を変えても再読み込みまで画面に出ないので、`update` の
 * あとで色の属性だけ書き直す
 */
const tableNode = defaultBlockSpecs.table.implementation.node.extend({
  addNodeView() {
    const parent = this.parent?.() as NodeViewRenderer | undefined
    if (!parent) return null
    return (props) => {
      const view = parent(props) as unknown as {
        dom: HTMLElement
        update?: (node: PMNode, ...rest: unknown[]) => boolean
      }
      const update = view.update?.bind(view)
      if (update) {
        view.update = (node, ...rest) => {
          const ok = update(node, ...rest)
          if (ok) syncColorAttrs(view.dom, node)
          return ok
        }
      }
      return view as never
    }
  },
})

export const wikiTableSpec = {
  ...defaultBlockSpecs.table,
  config: {
    ...defaultBlockSpecs.table.config,
    propSchema: {
      ...defaultBlockSpecs.table.config.propSchema,
      backgroundColor: defaultProps.backgroundColor,
    },
  },
  implementation: { ...defaultBlockSpecs.table.implementation, node: tableNode },
  extensions: [
    ...(defaultBlockSpecs.table.extensions ?? []),
    createExtension({ key: 'wiki-table-background-color', tiptapExtensions: [tableBackgroundColor] }),
  ],
}
