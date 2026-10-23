/**
 * Wiki ページの読み取り（react-query）。キーに userId と orgId を入れる
 * （組織を切り替えたとき・別の人がログインしたときに、前のデータを出さないため）。
 *
 * orgId は、開いたタスクの組織を画面へ渡してもらう（アクティブな組織と別の組織のタスクもあるため）。
 * 渡されなければ、いまアクティブな組織を使う。
 *
 * 本文つきの 'wikiPage' は端末に書かない（メモリだけ。src/lib/persistPolicy.ts）。
 * 題名だけの 'wikiTitle' と、本文を持たないページ一覧の 'wikiPages'（複数形）は軽いので端末に書いてよい。
 */
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo } from 'react'
import type { WikiPage as WikiListPage } from '@/types/database'
import { fetchWikiPage, fetchWikiTitle } from '~/api/wiki'
import { fetchWikiPages } from '~/api/wikiPages'
import { parseWikiBody } from '~/lib/wikiBody'
import { useReadyContext } from './useSession'

export const wikiKeys = {
  page: (userId: string, orgId: string, pageId: string) => ['wikiPage', userId, orgId, pageId] as const,
  list: (userId: string, orgId: string, spaceId: string) => ['wikiPages', userId, orgId, spaceId] as const,
  title: (userId: string, orgId: string, pageId: string) => ['wikiTitle', userId, orgId, pageId] as const,
}

/** 画面（useWikiPage）と、押す前の先読み（usePrefetchWikiPage）で同じ読み方を使う */
function wikiPageOptions(userId: string, orgId: string, pageId: string) {
  return {
    queryKey: wikiKeys.page(userId, orgId, pageId),
    queryFn: () => fetchWikiPage(orgId, pageId),
  }
}

/** 手元に前回の本文があれば、通信を待たずにそれを先に出す */
export function useWikiPage(pageId: string | null | undefined, orgId?: string | null) {
  const ctx = useReadyContext()
  const org = orgId || ctx?.orgId || ''
  return useQuery({
    ...wikiPageOptions(ctx?.userId ?? '', org, pageId ?? ''),
    enabled: !!ctx && !!org && !!pageId,
  })
}

/** 資料リンクの行に出す題名。本文は読まない */
export function useWikiTitle(pageId: string | null | undefined, orgId?: string | null) {
  const ctx = useReadyContext()
  const org = orgId || ctx?.orgId || ''
  return useQuery({
    queryKey: wikiKeys.title(ctx?.userId ?? '', org, pageId ?? ''),
    queryFn: () => fetchWikiTitle(org, pageId as string),
    enabled: !!ctx && !!org && !!pageId,
  })
}

/** 押した瞬間に読み始める（遷移するころには手元に来ている）。失敗は画面を開いたときに読み直すので無視する */
export function usePrefetchWikiPage() {
  const ctx = useReadyContext()
  const queryClient = useQueryClient()
  return (pageId: string, orgId?: string | null) => {
    const org = orgId || ctx?.orgId
    if (!ctx || !org) return
    void queryClient.prefetchQuery(wikiPageOptions(ctx.userId, org, pageId))
  }
}

function wikiPagesOptions(userId: string, orgId: string, spaceId: string) {
  return {
    queryKey: wikiKeys.list(userId, orgId, spaceId),
    queryFn: (): Promise<WikiListPage[]> => fetchWikiPages(orgId, spaceId),
  }
}

/** プロジェクトの Wiki 一覧（本文なし）。手元に前回の一覧があれば、通信を待たずにそれを先に出す */
export function useWikiPages(spaceId: string) {
  const ctx = useReadyContext()
  return useQuery({
    ...wikiPagesOptions(ctx?.userId ?? '', ctx?.orgId ?? '', spaceId),
    enabled: !!ctx && !!spaceId,
  })
}

/** 「Wiki」ボタンを押した瞬間に一覧を読み始める。失敗は画面を開いたときに読み直すので無視する */
export function usePrefetchWikiPages() {
  const ctx = useReadyContext()
  const queryClient = useQueryClient()
  return (spaceId: string) => {
    if (!ctx || !spaceId) return
    void queryClient.prefetchQuery(wikiPagesOptions(ctx.userId, ctx.orgId, spaceId))
  }
}

/** 同じ本文を描き直すたびに JSON を読み直さない */
export function useParsedWikiBody(body: string | null | undefined) {
  return useMemo(() => parseWikiBody(body ?? null), [body])
}
