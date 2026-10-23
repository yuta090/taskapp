import { useLocalSearchParams } from 'expo-router'
import { useMemo } from 'react'
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native'
import { MeetingStatusBadge } from '~/components/MeetingStatusBadge'
import { WikiBody } from '~/components/WikiBody'
import { EmptyState, ErrorRetry, Loading } from '~/components/ui'
import { useMeetingFromList, useMeetingMinutes } from '~/hooks/meetingQueries'
import { formatMeetingDate } from '~/lib/meetingList'
import { parseMinutesBody } from '~/lib/minutesBody'
import { useColors } from '~/theme/colors'

/**
 * 議事録。スマホは読むだけ（書く・開始/終了・タスク化は Web）。
 * 題名・日時・状態は一覧が持っている行で先に出し、本文だけ後から出す。
 */
export default function MeetingMinutesScreen() {
  const c = useColors()
  const { meetingId } = useLocalSearchParams<{ meetingId: string }>()
  const detail = useMeetingMinutes(meetingId)
  const fromList = useMeetingFromList(meetingId)
  // 読み終えて無かった（削除された・見る権限がない）なら、一覧の古い行は使わない
  const meeting = detail.data ?? (detail.isSuccess ? null : fromList)
  const blocks = useMemo(() => parseMinutesBody(detail.data?.minutes_md ?? null), [detail.data?.minutes_md])

  // 全画面の Loading は、手元に何も無いときだけ
  if (!meeting) {
    if (detail.isPending) return <Loading />
    if (detail.isError) return <ErrorRetry message="議事録を読み込めませんでした" onRetry={() => detail.refetch()} />
    return <EmptyState message="この会議を開けませんでした。削除されたか、見る権限がない可能性があります。" />
  }

  const date = formatMeetingDate(meeting.held_at ?? meeting.created_at)
  const bodyArea = (() => {
    if (detail.data) {
      return blocks.length === 0 ? (
        <Text style={[styles.empty, { color: c.textMuted }]}>議事録はまだありません（Web で書けます）</Text>
      ) : (
        <WikiBody blocks={blocks} />
      )
    }
    // 本文はまだ手元に無い。場所だけ小さく読み込み表示にする
    if (detail.isError) {
      return (
        <Pressable accessibilityRole="button" onPress={() => detail.refetch()} style={styles.retry}>
          <Text style={{ color: c.primary, fontSize: 14 }}>本文を読み込めませんでした。もう一度読み込む</Text>
        </Pressable>
      )
    }
    return (
      <View style={styles.bodyLoading}>
        <ActivityIndicator color={c.textMuted} />
      </View>
    )
  })()

  return (
    <ScrollView
      style={{ backgroundColor: c.background }}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={detail.isRefetching} onRefresh={() => detail.refetch()} />}>
      <Text selectable style={[styles.title, { color: c.text }]}>
        {meeting.title}
      </Text>
      <View style={styles.meta}>
        {date ? <Text style={[styles.metaText, { color: c.textMuted }]}>{date}</Text> : null}
        <MeetingStatusBadge status={meeting.status} />
      </View>
      {bodyArea}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  content: { padding: 16, paddingBottom: 48 },
  title: { fontSize: 22, fontWeight: '700', lineHeight: 30 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 6, marginBottom: 16 },
  metaText: { fontSize: 13 },
  empty: { fontSize: 14, paddingVertical: 24 },
  bodyLoading: { paddingVertical: 24, alignItems: 'center' },
  retry: { minHeight: 44, justifyContent: 'center', paddingVertical: 12 },
})
