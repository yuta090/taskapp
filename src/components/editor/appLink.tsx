'use client'

import { LinkSimple } from '@phosphor-icons/react'
import type { AppLink } from '@/lib/navigation/appLinks'

/**
 * BlockNote の editor のうち、リンク差し込みに必要な部分だけ。
 * `insertInlineContent` の引数の型はスキーマごとに変わるので、ここでは形だけ合わせて受ける
 */
interface InlineContentInserter {
  insertInlineContent: (...args: never[]) => void
}

/**
 * カーソル位置にアプリの中へのリンクを差し込む。Wiki と議事録で同じ形にする
 * （本文に出す文字はリンクの名前、飛び先は `appLinks.ts` が組み立てた href）。
 */
export function insertAppLink(editor: InlineContentInserter, link: AppLink) {
  // メソッドとして呼ぶ（変数に取り出すと this が外れて何も起きない）
  ;(editor as unknown as { insertInlineContent: (content: unknown) => void }).insertInlineContent([
    { type: 'link', href: link.href, content: link.label },
  ])
}

/**
 * 「/」メニューに出す「リンクを挿入」の項目。押すと本文の下のピッカーが開く。
 * ツールバーのボタンと同じものを開くので、探し方が2通りある状態にする
 * （書いている流れのまま「/」で呼べるのが本命。ボタンは気づきやすさのために残す）。
 */
export function buildInsertLinkMenuItem(open: () => void) {
  return {
    key: 'insert_app_link',
    title: 'リンクを挿入',
    subtext: 'ファイル・Wiki・議事録・タスクへのリンク',
    aliases: ['link', 'リンク', 'ファイル', 'wiki', '議事録', 'タスク'],
    group: 'このプロジェクトの物',
    icon: <LinkSimple size={18} />,
    onItemClick: open,
  }
}
