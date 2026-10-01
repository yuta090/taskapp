/**
 * Wiki ページの読み取り（react-query）。キーに userId と orgId を入れる
 * （組織を切り替えたとき・別の人がログインしたときに、前のデータを出さないため）。
 */
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo } from 'react'
import { fetchWikiPage } from '~/api/wiki'
import { parseWikiBody } from '~/lib/wikiBody'
import { useReadyContext } from './useSession'

export const wikiKeys = {
  page: (userId: string, orgId: string, pageId: string) => ['wikiPage', userId, orgId, pageId] as const,
}

/** 画面（useWikiPage）と、押す前の先読み（usePrefetchWikiPage）で同じ読み方を使う */
function wikiPageOptions(userId: string, orgId: string, pageId: string) {
  return {
    queryKey: wikiKeys.page(userId, orgId, pageId),
    queryFn: () => fetchWikiPage(orgId, pageId),
  }
}

/** 手元に前回の本文があれば、通信を待たずにそれを先に出す */
export function useWikiPage(pageId: string | null | undefined) {
  const ctx = useReadyContext()
  return useQuery({
    ...wikiPageOptions(ctx?.userId ?? '', ctx?.orgId ?? '', pageId ?? ''),
    enabled: !!ctx && !!pageId,
  })
}

/** 押した瞬間に読み始める（遷移するころには手元に来ている）。失敗は画面を開いたときに読み直すので無視する */
export function usePrefetchWikiPage() {
  const ctx = useReadyContext()
  const queryClient = useQueryClient()
  return (pageId: string) => {
    if (!ctx) return
    void queryClient.prefetchQuery(wikiPageOptions(ctx.userId, ctx.orgId, pageId))
  }
}

/** 同じ本文を描き直すたびに JSON を読み直さない */
export function useParsedWikiBody(body: string | null | undefined) {
  return useMemo(() => parseWikiBody(body ?? null), [body])
}
