import { DEFAULT_QUICK_FILTER, type QuickFilterKey } from '@/lib/tasks/quickFilters'
import type { Task } from '@/types/database'
import { FlashList } from '@shopify/flash-list'
import { router, Stack, useLocalSearchParams } from 'expo-router'
import { useMemo, useState } from 'react'
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native'
import { TaskRow } from '~/components/TaskRow'
import { EmptyState, ErrorRetry, Loading } from '~/components/ui'
import { useSpaces, useSpaceTasks } from '~/hooks/queries'
import { useJstToday } from '~/hooks/useJstToday'
import { buildProjectTaskList, PROJECT_TASK_FILTERS } from '~/lib/projectTaskList'
import { useColors } from '~/theme/colors'

/** プロジェクトのタスク。スマホは読む・開くが中心（作成・編集は Web） */
export default function ProjectTasksScreen() {
  const c = useColors()
  const { spaceId } = useLocalSearchParams<{ spaceId: string }>()
  const [filter, setFilter] = useState<QuickFilterKey>(DEFAULT_QUICK_FILTER)
  const spaces = useSpaces()
  const tasks = useSpaceTasks(spaceId)
  const today = useJstToday()

  const spaceName = spaces.data?.find((s) => s.id === spaceId)?.name
  const items = useMemo(() => (tasks.data ? buildProjectTaskList(tasks.data, filter, today) : []), [tasks.data, filter, today])

  const body = (() => {
    // 前回の取り置きがあればそれを先に出す（isPending は手元に何も無いときだけ）
    if (tasks.isPending) return <Loading />
    if (tasks.isError && !tasks.data) return <ErrorRetry message="タスクを読み込めませんでした" onRetry={() => tasks.refetch()} />
    if (items.length === 0) return <EmptyState message="該当するタスクはありません" />
    return (
      <FlashList<Task>
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
      <Stack.Screen options={{ title: spaceName ?? 'プロジェクト' }} />
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
  filters: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingVertical: 12 },
  filter: { borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
  filterLabel: { fontSize: 13, fontWeight: '500' },
  count: { fontSize: 13, paddingHorizontal: 16, paddingBottom: 6 },
  list: { flex: 1 },
})
