/**
 * 会議・議事録の読み取り（react-query）。キーに userId と orgId を入れる
 * （組織を切り替えたとき・別の人がログインしたときに、前のデータを出さないため）。
 *
 * 本文つきの 'meetingMinutes' は端末に書かない（メモリだけ。src/lib/persistPolicy.ts）。
 * 一覧（'meetings'）は本文を持たないので端末に書いてよい。
 * 詳細の画面は、一覧が持っている行（題名・日時・状態）で先に描き、本文だけ後から出す。
 */
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { Meeting } from '@/types/database'
import { fetchMeetingMinutes, fetchMeetings, type SpaceMeetingsData } from '~/api/meetings'
import { useReadyContext } from './useSession'

export const meetingKeys = {
  list: (userId: string, orgId: string, spaceId: string) => ['meetings', userId, orgId, spaceId] as const,
  minutes: (userId: string, orgId: string, meetingId: string) => ['meetingMinutes', userId, orgId, meetingId] as const,
}

function meetingsOptions(userId: string, orgId: string, spaceId: string) {
  return {
    queryKey: meetingKeys.list(userId, orgId, spaceId),
    queryFn: () => fetchMeetings(spaceId),
  }
}

export function useMeetings(spaceId: string) {
  const ctx = useReadyContext()
  return useQuery({
    ...meetingsOptions(ctx?.userId ?? '', ctx?.orgId ?? '', spaceId),
    enabled: !!ctx && !!spaceId,
  })
}

/** 「議事録」ボタンを押した瞬間に一覧を読み始める。失敗は画面を開いたときに読み直すので無視する */
export function usePrefetchMeetings() {
  const ctx = useReadyContext()
  const queryClient = useQueryClient()
  return (spaceId: string) => {
    if (!ctx || !spaceId) return
    void queryClient.prefetchQuery(meetingsOptions(ctx.userId, ctx.orgId, spaceId))
  }
}

/** 画面（useMeetingMinutes）と、押す前の先読み（usePrefetchMeetingMinutes）で同じ読み方を使う */
function minutesOptions(userId: string, orgId: string, meetingId: string) {
  return {
    queryKey: meetingKeys.minutes(userId, orgId, meetingId),
    queryFn: () => fetchMeetingMinutes(meetingId),
  }
}

export function useMeetingMinutes(meetingId: string) {
  const ctx = useReadyContext()
  return useQuery({
    ...minutesOptions(ctx?.userId ?? '', ctx?.orgId ?? '', meetingId),
    enabled: !!ctx && !!meetingId,
  })
}

/** 行を押した瞬間に読み始める（遷移するころには手元に来ている）。失敗は画面を開いたときに読み直すので無視する */
export function usePrefetchMeetingMinutes() {
  const ctx = useReadyContext()
  const queryClient = useQueryClient()
  return (meetingId: string) => {
    if (!ctx) return
    void queryClient.prefetchQuery(minutesOptions(ctx.userId, ctx.orgId, meetingId))
  }
}

/** 一覧の取り置き（どのプロジェクトのものでも）に、この会議の行があれば返す。詳細を先に描くために使う */
export function useMeetingFromList(meetingId: string): Meeting | undefined {
  const ctx = useReadyContext()
  const queryClient = useQueryClient()
  if (!ctx || !meetingId) return undefined
  for (const [, data] of queryClient.getQueriesData<SpaceMeetingsData>({ queryKey: ['meetings', ctx.userId, ctx.orgId] })) {
    const hit = data?.meetings.find((m) => m.id === meetingId)
    if (hit) return hit
  }
  return undefined
}
