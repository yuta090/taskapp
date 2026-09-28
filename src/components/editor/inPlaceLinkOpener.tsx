'use client'

import { createContext, useContext } from 'react'

/**
 * 本文のアプリ内リンクを「画面を移らずにその場で開く」受け口。
 * 引き受けたら true を返す（そのときリンクは画面を移らない）。false なら今までどおり移る。
 *
 * 議事録画面が用意する。会議中に資料を開くたびにページが切り替わらないようにするため
 * （タスクは右パネル、Wiki はオーバーレイで開く）。用意していない画面では何も変わらない。
 */
export type InPlaceLinkOpener = (href: string) => boolean

const InPlaceLinkOpenerContext = createContext<InPlaceLinkOpener | null>(null)

export const InPlaceLinkOpenerProvider = InPlaceLinkOpenerContext.Provider

export function useInPlaceLinkOpener(): InPlaceLinkOpener | null {
  return useContext(InPlaceLinkOpenerContext)
}
