import * as WebBrowser from 'expo-web-browser'
import { router, useLocalSearchParams } from 'expo-router'
import { ScrollView, StyleSheet, Text, View } from 'react-native'
import { WEB_BASE_URL } from '~/api/webApi'
import { Button, Chip, EmptyState, Loading } from '~/components/ui'
import { useInbox } from '~/hooks/queries'
import { useColors } from '~/theme/colors'

function formatWhen(iso: string): string {
  const d = new Date(iso)
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/**
 * 通知の全文を出す。タスクに結びつかない通知（会議のリマインド・招待の承諾など）をタップしたときの行き先。
 * すでに受信トレイ（useInbox）が持っている一覧から探すだけで、通信はしない。
 */
export default function NotificationDetailScreen() {
  const c = useColors()
  const { notificationId } = useLocalSearchParams<{ notificationId: string }>()
  const inbox = useInbox()

  if (inbox.isPending) return <Loading />
  const item = inbox.data?.find((n) => n.id === notificationId)
  if (!item) return <EmptyState message="この通知は見つかりませんでした" />
  const taskId = item.taskId
  const webPath = item.webPath

  return (
    <ScrollView contentContainerStyle={[styles.container, { backgroundColor: c.background }]}>
      <Text style={[styles.title, { color: c.text }]}>{item.title}</Text>
      <View style={styles.metaRow}>
        {item.spaceName ? <Chip label={item.spaceName} /> : null}
        <Chip label={formatWhen(item.createdAt)} />
        {item.needsAction ? <Chip label="対応待ち" tone="primary" /> : null}
      </View>
      {item.body ? <Text style={[styles.body, { color: c.text }]}>{item.body}</Text> : null}

      <View style={styles.actions}>
        {taskId ? (
          <Button label="タスクを開く" onPress={() => router.push({ pathname: '/task/[taskId]', params: { taskId } })} />
        ) : null}
        {webPath ? (
          <Button label="Web で開く" variant="secondary" onPress={() => WebBrowser.openBrowserAsync(`${WEB_BASE_URL}${webPath}`)} />
        ) : null}
      </View>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container: { flexGrow: 1, padding: 16, gap: 12 },
  title: { fontSize: 20, fontWeight: '700' },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  body: { fontSize: 15, lineHeight: 22 },
  actions: { gap: 8, marginTop: 8 },
})
