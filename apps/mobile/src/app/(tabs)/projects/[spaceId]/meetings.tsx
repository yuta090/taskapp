import type { Meeting } from '@/types/database'
import { FlashList } from '@shopify/flash-list'
import { router, useLocalSearchParams } from 'expo-router'
import { useMemo } from 'react'
import { Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native'
import { MeetingStatusBadge } from '~/components/MeetingStatusBadge'
import { EmptyState, ErrorRetry, Loading } from '~/components/ui'
import { useMeetings, usePrefetchMeetingMinutes } from '~/hooks/meetingQueries'
import { buildMeetingList, formatMeetingDate } from '~/lib/meetingList'
import { useColors } from '~/theme/colors'

/** プロジェクトの会議・議事録の一覧。スマホは読むだけ（作成・編集は Web）。手元に前回の一覧があれば先に出す */
export default function MeetingsScreen() {
  const c = useColors()
  const { spaceId } = useLocalSearchParams<{ spaceId: string }>()
  const meetings = useMeetings(spaceId)
  const prefetch = usePrefetchMeetingMinutes()
  const items = useMemo(() => (meetings.data ? buildMeetingList(meetings.data.meetings) : []), [meetings.data])

  // 全画面の Loading は、手元に何も無いときだけ
  if (meetings.isPending) return <Loading />
  if (meetings.isError && !meetings.data) {
    return <ErrorRetry message="会議を読み込めませんでした" onRetry={() => meetings.refetch()} />
  }
  if (items.length === 0) return <EmptyState message="会議はまだありません（Web で作れます）" />

  return (
    <View style={[styles.screen, { backgroundColor: c.background }]}>
      <FlashList<Meeting>
        data={items}
        keyExtractor={(m) => m.id}
        refreshControl={<RefreshControl refreshing={meetings.isRefetching} onRefresh={() => meetings.refetch()} />}
        renderItem={({ item }) => {
          const date = formatMeetingDate(item.held_at ?? item.created_at)
          return (
            <Pressable
              accessibilityRole="button"
              onPressIn={() => prefetch(item.id)}
              onPress={() =>
                router.push({ pathname: '/projects/[spaceId]/meetings/[meetingId]', params: { spaceId, meetingId: item.id } })
              }
              style={({ pressed }) => [
                styles.row,
                { backgroundColor: pressed ? c.chip : c.surface, borderBottomColor: c.border },
              ]}>
              <View style={styles.rowBody}>
                {date ? <Text style={[styles.date, { color: c.textMuted }]}>{date}</Text> : null}
                <Text numberOfLines={2} style={[styles.title, { color: c.text }]}>
                  {item.title}
                </Text>
              </View>
              <MeetingStatusBadge status={item.status} />
            </Pressable>
          )
        }}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  row: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowBody: { flex: 1, gap: 2 },
  date: { fontSize: 12 },
  title: { fontSize: 16, fontWeight: '500', lineHeight: 22 },
})
