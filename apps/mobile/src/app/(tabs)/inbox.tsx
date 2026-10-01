import { FlashList } from '@shopify/flash-list'
import { router } from 'expo-router'
import { Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { EmptyState, ErrorRetry, Loading } from '~/components/ui'
import { useInbox, useMarkAllRead, useMarkRead } from '~/hooks/queries'
import { inboxDestination, type InboxItem } from '~/lib/inbox'
import { useColors } from '~/theme/colors'

function formatWhen(iso: string): string {
  const d = new Date(iso)
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export default function InboxScreen() {
  const c = useColors()
  const inbox = useInbox()
  const markRead = useMarkRead()
  const markAllRead = useMarkAllRead()
  const hasUnread = inbox.data?.some((n) => n.unread) ?? false

  const open = (item: InboxItem) => {
    if (item.unread) markRead.mutate(item.id)
    const destination = inboxDestination(item)
    if (destination.kind === 'task') {
      router.push({ pathname: '/task/[taskId]', params: { taskId: destination.taskId } })
    } else {
      router.push({ pathname: '/notification/[notificationId]', params: { notificationId: destination.id } })
    }
  }

  const body = (() => {
    if (inbox.isPending) return <Loading />
    if (inbox.isError && !inbox.data) return <ErrorRetry message="通知を読み込めませんでした" onRetry={() => inbox.refetch()} />
    if (!inbox.data || inbox.data.length === 0) return <EmptyState message="通知はありません" />
    return (
      <FlashList<InboxItem>
        data={inbox.data}
        keyExtractor={(item) => item.id}
        refreshControl={<RefreshControl refreshing={inbox.isRefetching} onRefresh={() => inbox.refetch()} />}
        renderItem={({ item }) => (
          <Pressable
            accessibilityRole="button"
            onPress={() => open(item)}
            style={({ pressed }) => [styles.row, { backgroundColor: pressed ? c.chip : c.surface, borderColor: c.border }]}>
            <View style={[styles.dot, { backgroundColor: item.unread ? c.unreadDot : 'transparent' }]} />
            <View style={styles.main}>
              <Text style={[styles.title, { color: c.text, fontWeight: item.unread ? '600' : '400' }]} numberOfLines={2}>
                {item.title}
              </Text>
              {item.body ? (
                <Text style={[styles.body, { color: c.textSecondary }]} numberOfLines={2}>
                  {item.body}
                </Text>
              ) : null}
              <Text style={[styles.meta, { color: c.textMuted }]}>
                {[item.spaceName, formatWhen(item.createdAt), item.needsAction ? '対応待ち' : null].filter(Boolean).join(' ・ ')}
              </Text>
            </View>
          </Pressable>
        )}
      />
    )
  })()

  return (
    <SafeAreaView edges={['top']} style={[styles.safe, { backgroundColor: c.background }]}>
      <View style={styles.titleRow}>
        <Text style={[styles.titleText, { color: c.text }]}>受信トレイ</Text>
        {hasUnread ? (
          <Pressable accessibilityRole="button" onPress={() => markAllRead.mutate()} hitSlop={8}>
            <Text style={[styles.action, { color: c.primary }]}>すべて既読</Text>
          </Pressable>
        ) : null}
      </View>
      <View style={styles.list}>{body}</View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 12,
  },
  titleText: { fontSize: 28, fontWeight: '700' },
  action: { fontSize: 15, fontWeight: '500' },
  list: { flex: 1 },
  row: { flexDirection: 'row', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, gap: 10 },
  dot: { width: 8, height: 8, borderRadius: 4, marginTop: 6 },
  main: { flex: 1, gap: 3 },
  title: { fontSize: 15 },
  body: { fontSize: 13 },
  meta: { fontSize: 12 },
})
