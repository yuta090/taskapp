import { DEFAULT_QUICK_FILTER, type QuickFilterKey } from '@/lib/tasks/quickFilters'
import type { Task } from '@/types/database'
import { FlashList } from '@shopify/flash-list'
import { router, Stack, useLocalSearchParams } from 'expo-router'
import { useEffect, useMemo, useState } from 'react'
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native'
import { PickerSheet } from '~/components/PickerSheet'
import { TaskRow } from '~/components/TaskRow'
import { EmptyState, ErrorRetry, Loading } from '~/components/ui'
import { usePrefetchMeetings } from '~/hooks/meetingQueries'
import { usePrefetchWikiPages } from '~/hooks/wikiQueries'
import { usePrefetchSpaceTasks, useSpaces, useSpaceTasks } from '~/hooks/queries'
import { useJstToday } from '~/hooks/useJstToday'
import { saveLastProject } from '~/hooks/useLastProject'
import { useReadyContext } from '~/hooks/useSession'
import { buildProjectTaskList, PROJECT_TASK_FILTERS } from '~/lib/projectTaskList'
import { listProjects } from '~/lib/spaceList'
import { useColors } from '~/theme/colors'

/** プロジェクトのタスク。スマホは読む・開くが中心（作成・編集は Web） */
export default function ProjectTasksScreen() {
  const c = useColors()
  const { spaceId } = useLocalSearchParams<{ spaceId: string }>()
  const [filter, setFilter] = useState<QuickFilterKey>(DEFAULT_QUICK_FILTER)
  const spaces = useSpaces()
  const tasks = useSpaceTasks(spaceId)
  const today = useJstToday()
  const ctx = useReadyContext()
  const prefetch = usePrefetchSpaceTasks()
  const prefetchMeetings = usePrefetchMeetings()
  const prefetchWiki = usePrefetchWikiPages()
  const [pickerOpen, setPickerOpen] = useState(false)

  // 開いたとき・切り替えたときに、最後に開いたプロジェクトとして覚える（アプリを開き直したとき開く）
  const userId = ctx?.userId
  const orgId = ctx?.orgId
  const spaceList = spaces.data
  // 一覧が取れていて、その中に無いプロジェクト（アーカイブ・削除・別の組織のもの）は覚えない
  const known = !spaceList || spaceList.some((s) => s.id === spaceId)
  useEffect(() => {
    if (userId && orgId && spaceId && known) void saveLastProject(userId, orgId, spaceId)
  }, [userId, orgId, spaceId, known])
  // 最新の一覧にも無いなら、一覧へ戻す（取り置きにだけ残っていたプロジェクトを開き直したとき）
  const missing = !known && spaces.isSuccess && !spaces.isFetching
  useEffect(() => {
    if (!missing) return
    // 上に会議・議事録・Wiki の画面が乗っていても、一覧まで戻す
    router.dismissTo('/projects')
  }, [missing])

  const spaceName = spaces.data?.find((s) => s.id === spaceId)?.name
  const projects = useMemo(() => (spaces.data ? listProjects(spaces.data) : []), [spaces.data])
  const items = useMemo(() => (tasks.data ? buildProjectTaskList(tasks.data, filter, today) : []), [tasks.data, filter, today])

  const body = (() => {
    // 前回の取り置きがあればそれを先に出す（isPending は手元に何も無いときだけ）
    if (tasks.isPending) return <Loading />
    if (tasks.isError && !tasks.data) return <ErrorRetry message="タスクを読み込めませんでした" onRetry={() => tasks.refetch()} />
    if (items.length === 0) return <EmptyState message="該当するタスクはありません" />
    return (
      <FlashList<Task>
        // プロジェクトを切り替えたとき、前のスクロール位置を持ち越さない
        key={spaceId}
        data={items}
        keyExtractor={(t) => t.id}
        refreshControl={<RefreshControl refreshing={tasks.isRefetching} onRefresh={() => tasks.refetch()} />}
        renderItem={({ item }) => (
          <TaskRow
            task={item}
            spaceName={null}
            awaitingMyApproval={false}
            onPress={() => router.push({ pathname: '/task/[taskId]', params: { taskId: item.id } })}
          />
        )}
      />
    )
  })()

  return (
    <View style={[styles.screen, { backgroundColor: c.background }]}>
      {/* ヘッダーの題名そのものが切り替えボタン（画面に1行足さない）。▾ で押せると分かるようにする */}
      <Stack.Screen
        options={{
          title: spaceName ?? 'プロジェクト',
          headerTitle: () => (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="プロジェクトを切り替える"
              hitSlop={8}
              onPress={() => setPickerOpen(true)}
              style={styles.headerTitle}>
              <Text style={[styles.headerTitleText, { color: c.text }]} numberOfLines={1}>
                {spaceName ?? 'プロジェクト'}
              </Text>
              <Text style={[styles.headerTitleArrow, { color: c.textSecondary }]}>▾</Text>
            </Pressable>
          ),
          // 会議・議事録と Wiki への入り口。画面に行を足さず、ヘッダーの右に並べる
          headerRight: () => (
            <View style={styles.headerActions}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="会議・議事録を開く"
                hitSlop={8}
                onPressIn={() => prefetchMeetings(spaceId)}
                onPress={() => router.push({ pathname: '/projects/[spaceId]/meetings', params: { spaceId } })}
                style={styles.headerAction}>
                <Text maxFontSizeMultiplier={1.3} style={[styles.headerActionText, { color: c.primary }]}>議事録</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Wiki を開く"
                hitSlop={{ top: 8, bottom: 8, right: 8 }}
                onPressIn={() => prefetchWiki(spaceId)}
                onPress={() => router.push({ pathname: '/projects/[spaceId]/wiki', params: { spaceId } })}
                style={styles.headerAction}>
                <Text maxFontSizeMultiplier={1.3} style={[styles.headerActionText, { color: c.primary }]}>Wiki</Text>
              </Pressable>
            </View>
          ),
        }}
      />
      <PickerSheet
        visible={pickerOpen}
        title="プロジェクトを切り替える"
        options={projects.map((p) => ({ key: p.id, label: p.name, selected: p.id === spaceId }))}
        onSelect={(key) => {
          setPickerOpen(false)
          if (key === spaceId) return
          prefetch(key)
          setFilter(DEFAULT_QUICK_FILTER)
          // 同じ画面のまま中身を差し替える（画面は積まない）
          router.setParams({ spaceId: key })
        }}
        onClose={() => setPickerOpen(false)}
      />
      <View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filters}>
          {PROJECT_TASK_FILTERS.map((f) => {
            const selected = f.key === filter
            return (
              <Pressable
                key={f.key}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                onPress={() => setFilter(f.key)}
                style={[styles.filter, { backgroundColor: selected ? c.primary : c.chip }]}>
                <Text style={[styles.filterLabel, { color: selected ? c.onPrimary : c.textSecondary }]}>{f.label}</Text>
              </Pressable>
            )
          })}
        </ScrollView>
      </View>
      {tasks.data ? <Text style={[styles.count, { color: c.textMuted }]}>{items.length}件</Text> : null}
      <View style={styles.list}>{body}</View>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  headerTitle: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44, maxWidth: 190, flexShrink: 1 },
  headerTitleText: { flexShrink: 1, fontSize: 17, fontWeight: '600' },
  headerTitleArrow: { fontSize: 14 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 0 },
  headerAction: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 8 },
  headerActionText: { fontSize: 17 },
  filters: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingVertical: 12 },
  filter: { borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
  filterLabel: { fontSize: 13, fontWeight: '500' },
  count: { fontSize: 13, paddingHorizontal: 16, paddingBottom: 6 },
  list: { flex: 1 },
})
