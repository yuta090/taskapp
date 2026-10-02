/**
 * 会議の状態バッジ。Web の MeetingRow と同じ分け方（進行中=緑・終了=灰・予定=青）を、既存の色トークンで表す。
 */
import type { MeetingStatus } from '@/types/database'
import { StyleSheet, Text, View } from 'react-native'
import { meetingStatusLabel } from '~/lib/meetingList'
import { useColors } from '~/theme/colors'

export function MeetingStatusBadge({ status }: { status: MeetingStatus }) {
  const c = useColors()
  const color = status === 'in_progress' ? c.success : status === 'ended' ? c.textSecondary : c.primary
  return (
    <View style={[styles.badge, { backgroundColor: c.chip, borderColor: status === 'ended' ? c.chip : color }]}>
      <Text style={[styles.label, { color }]}>{meetingStatusLabel(status)}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  badge: { alignSelf: 'flex-start', borderRadius: 999, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 2 },
  label: { fontSize: 12, fontWeight: '500' },
})
