'use client'

import { Fragment, type MouseEvent, type ReactNode } from 'react'
import Link from 'next/link'
import { splitTextIntoLinkParts } from '@/lib/navigation/linkifyText'

interface LinkifiedTextProps {
  text: string
  /**
   * 社内のアプリの中で出しているか。
   * 相手先ポータルでは false にする。本文に社内の画面へのリンクが書かれていても、
   * 相手先は開けないので、押せるようにしない（押して弾かれるより、ただの文字のほうがよい）。
   * 外部のサイトへのリンクは、どちらでも押せる。
   */
  inApp?: boolean
  className?: string
}

/**
 * 文字の中の URL を押せるリンクにして出す。
 *
 * タスクの説明文は Markdown ではなくただの文字なので、書いた URL がそのままでは押せなかった。
 * CLI が返す `link` を貼るだけで開けるようにするための部品。
 *
 * 開き方は文書エディタと揃える（`DOC_LINK_SPEC.md`）:
 * アプリの中の画面は同じタブ（戻るで戻れる）、ダウンロードと外部サイトは新しいタブ。
 */
export function LinkifiedText({ text, inApp = true, className }: LinkifiedTextProps) {
  const parts = splitTextIntoLinkParts(text)
  const linkClass = 'text-indigo-ink underline underline-offset-2 hover:text-indigo-700'

  const rendered: ReactNode = parts.map((part, index) => {
        const key = `${index}-${part.kind}`

        // 文字は素のまま返す。<span> で包むと、リンクが1つも無いときに DOM が変わり、
        // 「この段落が whitespace-pre-wrap か」を見ている既存の作り・テストがずれる
        if (part.kind === 'text') return <Fragment key={key}>{part.value}</Fragment>

        // 相手先には社内の画面を開けない。ただの文字のまま出す
        if (!inApp && part.kind !== 'external') return <Fragment key={key}>{part.value}</Fragment>

        // 押した先を開くだけにする。タスクの説明文は囲みを押すと編集に入る作りなので、
        // 伝わると「リンク先へ行きながら編集も開く」ことになる
        const stop = (e: MouseEvent) => e.stopPropagation()

        if (part.kind === 'app') {
          return (
            <Link key={key} href={part.href!} className={linkClass} onClick={stop}>
              {part.value}
            </Link>
          )
        }

        return (
          <a
            key={key}
            href={part.href}
            target="_blank"
            rel="noopener noreferrer"
            className={linkClass}
            onClick={stop}
          >
            {part.value}
          </a>
        )
  })

  // 呼び出し側が見た目を足したいときだけ包む。包まないほうが元の DOM に近い
  return className ? <span className={className}>{rendered}</span> : <>{rendered}</>
}
