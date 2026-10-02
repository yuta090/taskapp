/**
 * ダッシュボードの読み取り（react-query）。キーに userId と orgId を入れる
 * （組織を切り替えたとき・別の人がログインしたときに、前のデータを出さないため）。
 *
 * タスクと会議は、プロジェクトのタスク画面・会議の画面と同じ取り置き（useSpaceTasks・useMeetings）を使う。
 * ここで新しく読むのはマイルストーンだけ。軽い一覧なので端末に書いてよい（src/lib/persistPolicy.ts は変えない）。
 */
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchMilestones } from '~/api/milestones'
import { usePrefetchMeetings } from './meetingQueries'
import { usePrefetchSpaceTasks } from './queries'
import { useReadyContext } from './useSession'

export const milestoneKeys = {
  list: (userId: string, orgId: string, spaceId: string) => ['milestones', userId, orgId, spaceId] as const,
}

function milestonesOptions(userId: string, orgId: string, spaceId: string) {
  return {
    queryKey: milestoneKeys.list(userId, orgId, spaceId),
    queryFn: () => fetchMilestones(spaceId),
  }
}

export function useMilestones(spaceId: string) {
  const ctx = useReadyContext()
  return useQuery({
    ...milestonesOptions(ctx?.userId ?? '', ctx?.orgId ?? '', spaceId),
    enabled: !!ctx && !!spaceId,
  })
}

/** 「ダッシュボード」を押した瞬間に、タスク・マイルストーン・会議の一覧を読み始める。失敗は画面を開いたときに読み直すので無視する */
export function usePrefetchDashboard() {
  const ctx = useReadyContext()
  const queryClient = useQueryClient()
  const prefetchTasks = usePrefetchSpaceTasks()
  const prefetchMeetings = usePrefetchMeetings()
  return (spaceId: string) => {
    if (!ctx || !spaceId) return
    prefetchTasks(spaceId)
    prefetchMeetings(spaceId)
    void queryClient.prefetchQuery(milestonesOptions(ctx.userId, ctx.orgId, spaceId))
  }
}
