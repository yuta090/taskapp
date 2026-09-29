import type { Task } from '@/types/database'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useColors } from '~/theme/colors'
import { Chip } from './ui'

export function formatDue(due: string | null): string | null {
  if (!due) return null
  const [, m, d] = due.slice(0, 10).split('-')
  return `${Number(m)}/${Number(d)}`
}

export function TaskRow({
  task,
  spaceName,
  awaitingMyApproval,
  onPress,
}: {
  task: Task
  spaceName: string | null
  awaitingMyApproval: boolean
  onPress: () => void
}) {
  const c = useColors()
  const due = formatDue(task.due_date)
  const clientBall = task.ball !== 'internal'
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.row, { backgroundColor: pressed ? c.chip : c.surface, borderColor: c.border }]}>
      <View style={styles.main}>
        <Text style={[styles.title, { color: c.text }]} numberOfLines={2}>
          {task.title}
        </Text>
        <View style={styles.meta}>
          {spaceName ? (
            <Text style={[styles.metaText, { color: c.textMuted }]} numberOfLines={1}>
              {spaceName}
            </Text>
          ) : null}
          {due ? <Text style={[styles.metaText, { color: c.textSecondary }]}>期限 {due}</Text> : null}
        </View>
      </View>
      <View style={styles.badges}>
        {awaitingMyApproval ? <Chip label="承認待ち" tone="primary" /> : null}
        {clientBall ? <Chip label="相手先の番" tone="client" /> : null}
      </View>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 8,
  },
  main: { flex: 1, gap: 4 },
  title: { fontSize: 15, fontWeight: '500' },
  meta: { flexDirection: 'row', gap: 8 },
  metaText: { fontSize: 12 },
  badges: { alignItems: 'flex-end', gap: 4 },
})
