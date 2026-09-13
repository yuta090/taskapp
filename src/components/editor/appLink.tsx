'use client'

import { BookOpen, Checks, Notebook, Paperclip } from '@phosphor-icons/react'
import type { AppLink, AppLinkKind } from '@/lib/navigation/appLinks'

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
 * 「/」メニューに出す項目。**種類ごとに1つずつ**出して、そのままその種類のピッカーを開く。
 *
 * まとめて1項目にしていたが、「タスクを貼りたい」と分かっているときに一度パネルを開いて
 * 種類を選び直す手間があった。日本語でも英語でも引けるよう、別名を両方入れておく
 * （BlockNote の絞り込みは title と aliases への部分一致・大文字小文字は無視）。
 */
export function buildInsertLinkMenuItems(open: (kind: AppLinkKind) => void) {
  const common = ['link', 'リンク', 'insert', '挿入']
  return [
    {
      kind: 'task' as const,
      key: 'insert_link_task',
      title: 'タスクへのリンク',
      subtext: 'このプロジェクトのタスクを選んで貼る',
      aliases: ['task', 'タスク', 'todo', 'tp', ...common],
      icon: <Checks size={18} />,
    },
    {
      kind: 'file' as const,
      key: 'insert_link_file',
      title: 'ファイルへのリンク',
      subtext: 'アップロード済みのファイルを選んで貼る',
      aliases: ['file', 'ファイル', 'attachment', '添付', ...common],
      icon: <Paperclip size={18} />,
    },
    {
      kind: 'wiki' as const,
      key: 'insert_link_wiki',
      title: 'Wikiページへのリンク',
      subtext: 'Wiki のページを選んで貼る',
      aliases: ['wiki', 'ウィキ', 'page', 'ページ', '仕様書', ...common],
      icon: <BookOpen size={18} />,
    },
    {
      kind: 'meeting' as const,
      key: 'insert_link_meeting',
      title: '議事録へのリンク',
      subtext: '会議の議事録を選んで貼る',
      aliases: ['meeting', 'minutes', '議事録', '会議', 'ミーティング', ...common],
      icon: <Notebook size={18} />,
    },
  ].map(({ kind, ...item }) => ({
    ...item,
    group: 'このプロジェクトの物',
    onItemClick: () => open(kind),
  }))
}
