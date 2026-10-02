import { formatDueDays } from '@/lib/dashboard/followUps'
import type { OverdueItem, OverdueKind } from '@/lib/dashboard/overdue'
import type { Task } from '@/types/database'
import { router, useLocalSearchParams } from 'expo-router'
import { useMemo, useState, type ReactNode } from 'react'
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native'
import { ErrorRetry, Loading } from '~/components/ui'
import { useMilestones } from '~/hooks/dashboardQueries'
import { useMeetings, usePrefetchMeetingMinutes } from '~/hooks/meetingQueries'
import { useSpaceTasks } from '~/hooks/queries'
import { useJstToday } from '~/hooks/useJstToday'
import { buildDashboard } from '~/lib/dashboardView'
import { formatMeetingDate } from '~/lib/meetingList'
import { useColors, type Colors } from '~/theme/colors'

/** 各セクションに出す最大の行数。残りは「ほか N 件」の文字だけ（v1 は展開しない） */
const SECTION_ROWS = 5

/** 期限切れの見出しと並び（Web の OverdueSection と同じ） */
const OVERDUE_GROUPS: readonly { kind: OverdueKind; label: string }[] = [
  { kind: 'review', label: '承認待ち' },
  { kind: 'client', label: 'クライアント確認待ち' },
  { kind: 'task', label: 'タスク' },
]

const NO_TASKS: Task[] = []

/** プロジェクトのダッシュボード。スマホは読むだけ。手元のタスクの取り置きがあれば先に描き、会議・マイルストーンは後から埋める */
export default function DashboardScreen() {
  const c = useColors()
  const { spaceId } = useLocalSearchParams<{ spaceId: string }>()
  const tasks = useSpaceTasks(spaceId)
  const meetings = useMeetings(spaceId)
  const milestones = useMilestones(spaceId)
  const prefetchMinutes = usePrefetchMeetingMinutes()
  const today = useJstToday()
  const [refreshing, setRefreshing] = useState(false)

  const taskData = tasks.data
  const meetingList = meetings.data?.meetings
  const milestoneList = milestones.data
  const dashboard = useMemo(
    () =>
      buildDashboard({
        tasks: taskData?.tasks ?? NO_TASKS,
        reviewStatuses: taskData?.reviewStatuses ?? {},
        meetings: meetingList ?? [],
        milestones: milestoneList ?? [],
        today,
        now: new Date(),
      }),
    [taskData, meetingList, milestoneList, today]
  )

  // 全画面の Loading は、手元にタスクが無いときだけ
  if (tasks.isPending) return <Loading />
  if (tasks.isError && !taskData) return <ErrorRetry message="タスクを読み込めませんでした" onRetry={() => tasks.refetch()} />

  const openTask = (taskId: string) => router.push({ pathname: '/task/[taskId]', params: { taskId } })
  const { kpi, overdueGroups, followUps, upcomingDeadlines, upcomingMeetings } = dashboard

  const onRefresh = async () => {
    setRefreshing(true)
    try {
      await Promise.all([tasks.refetch(), meetings.refetch(), milestones.refetch()])
    } finally {
      setRefreshing(false)
    }
  }

  return (
    <ScrollView
      style={{ backgroundColor: c.background }}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
      <View style={styles.kpiGrid}>
        <KpiCard label="アクティブ" value={kpi.active} />
        <KpiCard label="未着手" value={kpi.backlog} />
        <KpiCard label="レビュー待ち" value={kpi.inReview} />
        <KpiCard label="クライアント確認待ち" value={kpi.clientWait} />
      </View>

      <Section title="期限切れ" count={overdueGroups.total} empty="期限切れのものはありません">
        {OVERDUE_GROUPS.filter((g) => overdueGroups[g.kind].length > 0).map((g) => {
          const items: OverdueItem[] = overdueGroups[g.kind]
          return (
            <View key={g.kind} style={styles.group}>
              <Text style={[styles.groupLabel, { color: c.textSecondary }]}>
                {g.label} {items.length}件
              </Text>
              {items.slice(0, SECTION_ROWS).map((item) => (
                <TaskLine
                  key={item.task.id}
                  title={item.task.title}
                  right={`${item.daysOverdue}日超過`}
                  rightColor={c.danger}
                  onPress={() => openTask(item.task.id)}
                />
              ))}
              <More rest={items.length - SECTION_ROWS} />
            </View>
          )
        })}
      </Section>

      <Section title="クライアント確認が必要" count={followUps.length} empty="現在フォローが必要なタスクはありません">
        {followUps.slice(0, SECTION_ROWS).map((item) => {
          const urgent = item.level === 'urgent'
          return (
            <TaskLine
              key={item.task.id}
              title={item.task.title}
              // 要フォロー（期限切れ・長く待っている）は赤の帯で強調。そろそろ確認は相手先に見える色（amber）
              accent={urgent ? c.danger : c.clientVisible}
              right={`${formatDueDays(item.dueDaysLeft)}・${item.staleDays}日待ち`}
              rightColor={urgent ? c.danger : c.textSecondary}
              onPress={() => openTask(item.task.id)}
            />
          )
        })}
        <More rest={followUps.length - SECTION_ROWS} />
      </Section>

      <Section title="期限が近いタスク" count={upcomingDeadlines.length} empty="直近1週間に期限のタスクはありません">
        {upcomingDeadlines.slice(0, SECTION_ROWS).map(({ task, daysLeft }) => (
          <TaskLine
            key={task.id}
            title={task.title}
            right={formatDueDays(daysLeft)}
            rightColor={daysLeft < 0 ? c.danger : daysLeft <= 2 ? c.text : c.success}
            onPress={() => openTask(task.id)}
          />
        ))}
        <More rest={upcomingDeadlines.length - SECTION_ROWS} />
      </Section>

      <Section
        title="直近の予定"
        count={upcomingMeetings.length}
        empty="予定された会議はありません"
        status={sectionStatus(meetings)}>
        {upcomingMeetings.map((m) => (
          <Pressable
            key={m.id}
            accessibilityRole="button"
            onPressIn={() => prefetchMinutes(m.id)}
            onPress={() =>
              router.push({ pathname: '/projects/[spaceId]/meetings/[meetingId]', params: { spaceId, meetingId: m.id } })
            }
            style={({ pressed }) => [styles.line, pressed && { backgroundColor: c.chip }]}>
            <Text style={[styles.lineMeta, { color: c.textSecondary }]}>{formatMeetingDate(m.held_at)}</Text>
            <Text numberOfLines={2} style={[styles.lineTitle, { color: c.text }]}>
              {m.title}
            </Text>
          </Pressable>
        ))}
      </Section>

      <Section
        title="マイルストーン進捗"
        count={dashboard.milestones.length}
        empty="マイルストーンがありません"
        status={sectionStatus(milestones)}>
        {dashboard.milestones.slice(0, SECTION_ROWS).map((p) => (
          <View key={p.milestone.id} style={styles.milestone}>
            <View style={styles.milestoneHead}>
              <Text numberOfLines={1} style={[styles.milestoneName, { color: c.text }]}>
                {p.milestone.name}
              </Text>
              {p.daysLeft !== null ? (
                <Text style={[styles.lineMeta, { color: p.daysLeft < 0 ? c.danger : c.textSecondary }]}>
                  {formatDueDays(p.daysLeft)}
                </Text>
              ) : null}
            </View>
            <View style={styles.barRow}>
              <View style={[styles.barTrack, { backgroundColor: c.chip }]}>
                <View style={[styles.barFill, { backgroundColor: c.primary, width: `${p.pct}%` }]} />
              </View>
              <Text style={[styles.lineMeta, styles.barCount, { color: c.textSecondary }]}>
                {p.done}/{p.total}
              </Text>
            </View>
          </View>
        ))}
        <More rest={dashboard.milestones.length - SECTION_ROWS} />
      </Section>
    </ScrollView>
  )
}

/** 手元に無いまま読み込み中・失敗のとき、その区画だけに出す状態。手元にあれば何も出さない（取り置きで先に描く） */
function sectionStatus(q: { data: unknown; isPending: boolean; isError: boolean }): 'loading' | 'error' | null {
  if (q.data) return null
  if (q.isPending) return 'loading'
  return q.isError ? 'error' : null
}

function KpiCard({ label, value }: { label: string; value: number }) {
  const c = useColors()
  return (
    <View style={[styles.kpiCard, { backgroundColor: c.surface, borderColor: c.border }]}>
      <Text style={[styles.kpiLabel, { color: c.textSecondary }]}>{label}</Text>
      <Text style={[styles.kpiValue, { color: c.text }]}>{value}</Text>
    </View>
  )
}

function Section({
  title,
  count,
  empty,
  status = null,
  children,
}: {
  title: string
  count: number
  empty: string
  status?: 'loading' | 'error' | null
  children: ReactNode
}) {
  const c: Colors = useColors()
  return (
    <View style={[styles.section, { backgroundColor: c.surface, borderColor: c.border }]}>
      <View style={styles.sectionHead}>
        <Text accessibilityRole="header" style={[styles.sectionTitle, { color: c.text }]}>
          {title}
        </Text>
        {count > 0 ? <Text style={[styles.lineMeta, { color: c.textMuted }]}>{count}件</Text> : null}
      </View>
      {status ? (
        <Text style={[styles.empty, { color: c.textMuted }]}>{status === 'loading' ? '読み込み中…' : '読み込めませんでした'}</Text>
      ) : count === 0 ? (
        <Text style={[styles.empty, { color: c.textMuted }]}>{empty}</Text>
      ) : (
        children
      )}
    </View>
  )
}

function TaskLine({
  title,
  right,
  rightColor,
  accent,
  onPress,
}: {
  title: string
  right: string
  rightColor: string
  /** 左端の帯の色。強調したい行だけ付ける */
  accent?: string
  onPress: () => void
}) {
  const c = useColors()
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.line,
        accent ? { borderLeftWidth: 3, borderLeftColor: accent, paddingLeft: 9 } : null,
        pressed && { backgroundColor: c.chip },
      ]}>
      <Text numberOfLines={2} style={[styles.lineTitle, { color: c.text }]}>
        {title}
      </Text>
      <Text style={[styles.lineMeta, { color: rightColor }]}>{right}</Text>
    </Pressable>
  )
}

function More({ rest }: { rest: number }) {
  const c = useColors()
  if (rest <= 0) return null
  return <Text style={[styles.more, { color: c.textMuted }]}>ほか {rest} 件</Text>
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 12 },
  kpiGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  kpiCard: { flexGrow: 1, flexBasis: '45%', borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, padding: 14, gap: 4 },
  kpiLabel: { fontSize: 12 },
  kpiValue: { fontSize: 28, fontWeight: '600' },
  section: { borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, padding: 16, gap: 4 },
  sectionHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 4 },
  sectionTitle: { fontSize: 15, fontWeight: '600' },
  empty: { fontSize: 14, paddingVertical: 4 },
  group: { marginTop: 4 },
  groupLabel: { fontSize: 12, fontWeight: '600', marginBottom: 2 },
  line: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 8,
  },
  lineTitle: { flex: 1, fontSize: 15, lineHeight: 21 },
  lineMeta: { fontSize: 12 },
  more: { fontSize: 12, paddingHorizontal: 12, paddingTop: 4 },
  milestone: { gap: 6, paddingVertical: 6 },
  milestoneHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  milestoneName: { flex: 1, fontSize: 14, fontWeight: '500' },
  barRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  barTrack: { flex: 1, height: 8, borderRadius: 4, overflow: 'hidden' },
  barFill: { height: 8, borderRadius: 4 },
  barCount: { minWidth: 40, textAlign: 'right' },
})
