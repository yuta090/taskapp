import type { MyTaskBallFilter } from '@/lib/tasks/myTaskViews'
import { FlashList } from '@shopify/flash-list'
import { router } from 'expo-router'
import { useMemo, useState } from 'react'
import { Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { TaskRow } from '~/components/TaskRow'
import { EmptyState, ErrorRetry, Loading } from '~/components/ui'
import { useMyTasks, usePendingReviewTaskIds } from '~/hooks/queries'
import { useJstToday } from '~/hooks/useJstToday'
import { useSession } from '~/hooks/useSession'
import { buildMyTaskListItems, type MyTaskListItem } from '~/lib/myTaskList'
import { useColors } from '~/theme/colors'

const BALL_FILTERS: { value: MyTaskBallFilter; label: string }[] = [
  { value: 'all', label: 'すべて' },
  { value: 'internal', label: '自分たちの番' },
  { value: 'external', label: '相手先の番' },
]

export default function MyTasksScreen() {
  const c = useColors()
  const { activeOrg, orgsLoading, orgsError, refetchOrgs } = useSession()
  const [ball, setBall] = useState<MyTaskBallFilter>('all')
  const tasks = useMyTasks()
  const pending = usePendingReviewTaskIds()

  const today = useJstToday()
  const items = useMemo(() => {
    if (!tasks.data) return []
    return buildMyTaskListItems(tasks.data, { ball }, today, pending.data ?? new Set())
  }, [tasks.data, ball, pending.data, today])

  const body = (() => {
    if (orgsError) return <ErrorRetry message="組織を読み込めませんでした" onRetry={refetchOrgs} />
    if (!activeOrg && !orgsLoading) return <EmptyState message="所属している組織がありません" />
    // 前回の取り置きがあればそれを先に出す（isPending は取り置きも無いときだけ）
    if (tasks.isPending) return <Loading />
    if (tasks.isError && !tasks.data) return <ErrorRetry message="タスクを読み込めませんでした" onRetry={() => tasks.refetch()} />
    if (items.length === 0) return <EmptyState message="いま手を付けるタスクはありません" />
    return (
      <FlashList<MyTaskListItem>
        data={items}
        keyExtractor={(item) => item.key}
        getItemType={(item) => item.kind}
        refreshControl={
          <RefreshControl refreshing={tasks.isRefetching} onRefresh={() => Promise.all([tasks.refetch(), pending.refetch()])} />
        }
        renderItem={({ item }) =>
          item.kind === 'header' ? (
            <View style={[styles.header, { backgroundColor: c.background }]}>
              <Text style={[styles.headerLabel, { color: item.tone === 'danger' ? c.danger : c.textSecondary }]}>
                {item.label}
              </Text>
              <Text style={[styles.headerCount, { color: c.textMuted }]}>{item.count}</Text>
            </View>
          ) : (
            <TaskRow
              task={item.task}
              spaceName={item.spaceName}
              awaitingMyApproval={item.awaitingMyApproval}
              onPress={() => router.push({ pathname: '/task/[taskId]', params: { taskId: item.task.id } })}
            />
          )
        }
      />
    )
  })()

  return (
    <SafeAreaView edges={['top']} style={[styles.safe, { backgroundColor: c.background }]}>
      <View style={styles.titleRow}>
        <Text style={[styles.title, { color: c.text }]}>マイタスク</Text>
        {activeOrg ? <Text style={[styles.org, { color: c.textMuted }]}>{activeOrg.orgName}</Text> : null}
      </View>
      <View style={styles.filters}>
        {BALL_FILTERS.map((f) => {
          const selected = f.value === ball
          return (
            <Pressable
              key={f.value}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              onPress={() => setBall(f.value)}
              style={[styles.filter, { backgroundColor: selected ? c.primary : c.chip }]}>
              <Text style={[styles.filterLabel, { color: selected ? c.onPrimary : c.textSecondary }]}>{f.label}</Text>
            </Pressable>
          )
        })}
      </View>
      <View style={styles.list}>{body}</View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  titleRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 8 },
  title: { fontSize: 28, fontWeight: '700' },
  org: { fontSize: 13 },
  filters: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingVertical: 12 },
  filter: { borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
  filterLabel: { fontSize: 13, fontWeight: '500' },
  list: { flex: 1 },
  header: { flexDirection: 'row', gap: 6, paddingHorizontal: 16, paddingTop: 16, paddingBottom: 6 },
  headerLabel: { fontSize: 13, fontWeight: '600' },
  headerCount: { fontSize: 13 },
})
