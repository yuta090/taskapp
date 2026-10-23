/**
 * タスク詳細の「社内承認」。依頼する・状況を見る・取り消す。
 * Web の TaskReviewSection（src/components/review/TaskReviewSection.tsx）と同じ内容。
 * 承認する・差し戻す（承認される側）は、タスク詳細の既存の操作で行う。
 */
import { useMemo, useState } from 'react'
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native'
import { isReviewApproverRole } from '@/lib/roles/spaceRoles'
import type { Task } from '@/types/database'
import { Button } from '~/components/ui'
import { useDefaultReviewerIds, useCancelReview, useOpenReview, useSpaceMembers, useTaskReview } from '~/hooks/reviewQueries'
import { useSession } from '~/hooks/useSession'
import {
  approvalStateLabel,
  canCancelReview,
  isSpaceAdminMember,
  memberDisplayName,
  resolveSelection,
  reviewRequestMode,
  reviewStatusLabel,
  selectableReviewers,
  toggleReviewer,
} from '~/lib/reviewers'
import { useColors, type Colors } from '~/theme/colors'

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : ''
}

function statusColor(c: Colors, status: string): string {
  if (status === 'approved') return c.success
  if (status === 'changes_requested') return c.danger
  return c.primary
}

function stateColor(c: Colors, state: string): string {
  if (state === 'approved') return c.success
  if (state === 'blocked') return c.danger
  return c.textMuted
}

export function TaskReviewSection({ task, canRequest: canRequestProp }: { task: Task; canRequest: boolean }) {
  const c = useColors()
  const { userId } = useSession()
  // タスク詳細を開いた時点で、承認者を選ぶ画面に要るものも裏で読んでおく（押してから待たせない）
  const reviewQuery = useTaskReview(task.id)
  const membersQuery = useSpaceMembers(task.space_id)
  const defaultsQuery = useDefaultReviewerIds(task.space_id)
  const open = useOpenReview()
  const cancel = useCancelReview()

  const [showPicker, setShowPicker] = useState(false)
  // null = まだ触っていない。そのあいだはプロジェクトの既定の承認者をそのまま映す
  const [selectedIds, setSelectedIds] = useState<string[] | null>(null)

  const members = useMemo(() => membersQuery.data ?? [], [membersQuery.data])
  // 依頼できるのは admin / editor（DB も同じ）。メンバーを読めたあとで閲覧者・相手先だと分かれば出さない
  const myRole = members.find((m) => m.id === userId)?.role
  const canRequest = canRequestProp && (members.length === 0 || isReviewApproverRole(myRole))
  const selectable = useMemo(() => selectableReviewers(members, userId), [members, userId])
  const selected = useMemo(
    () => resolveSelection(selectedIds, defaultsQuery.data, selectable.map((m) => m.id)),
    [selectedIds, defaultsQuery.data, selectable]
  )

  const data = reviewQuery.data ?? null
  const review = data && data.review.status !== 'cancelled' ? data.review : null
  const mode = reviewRequestMode(review)
  const loading = reviewQuery.isPending
  // 依頼した直後は id がまだ無い（サーバーが決める）。そのあいだは取り消しを出さない
  const cancellable = !!review && review.id !== '' && canRequest && canCancelReview(review, userId, isSpaceAdminMember(members, userId))

  const startRequest = () => {
    // 再依頼は前回の承認者を選択済みにして開く
    setSelectedIds(mode === 'rerequest' && data ? data.approvals.map((a) => a.reviewer_id) : null)
    setShowPicker(true)
  }

  const submit = () => {
    if (selected.length === 0) return
    // 押したらすぐ「承認待ち」を出す。失敗したら選択を残したまま選択欄に戻す
    setShowPicker(false)
    open.mutate(
      { taskId: task.id, reviewerIds: selected },
      {
        onSuccess: () => setSelectedIds(null),
        onError: (e) => {
          setShowPicker(true)
          Alert.alert('社内承認の依頼に失敗しました', errorText(e))
        },
      }
    )
  }

  const confirmCancel = () => {
    if (!review) return
    Alert.alert('レビューを取り消す', 'この社内承認依頼を取り消しますか？取り消し後は改めて依頼し直せます。', [
      { text: 'やめる', style: 'cancel' },
      {
        text: '取り消す',
        style: 'destructive',
        onPress: () =>
          cancel.mutate(
            { taskId: task.id, reviewId: review.id },
            { onError: (e) => Alert.alert('レビューの取り消しに失敗しました', errorText(e)) }
          ),
      },
    ])
  }

  return (
    <View style={[styles.box, { backgroundColor: c.surface, borderColor: c.border }]}>
      <Text style={[styles.heading, { color: c.textSecondary }]}>社内承認</Text>

      {loading ? (
        // 読み込み前は枠だけ出す（高さを大きく変えない）
        <View style={styles.placeholder} />
      ) : reviewQuery.isError && !data ? (
        <View style={styles.stack}>
          <Text style={[styles.muted, { color: c.textSecondary }]}>社内承認を読み込めませんでした</Text>
          <Button label="もう一度読み込む" variant="secondary" onPress={() => void reviewQuery.refetch()} />
        </View>
      ) : showPicker ? (
        <View style={styles.stack}>
          <Text style={[styles.muted, { color: c.textSecondary }]}>社内承認者を選択</Text>
          <Text style={[styles.note, { color: c.textMuted }]}>クライアントへの確認依頼は、ボールを「相手先」に渡してください</Text>
          {selectable.length === 0 ? (
            <Text style={[styles.muted, { color: c.textMuted }]}>
              {membersQuery.isPending ? '読み込み中…' : '選べるメンバーがいません'}
            </Text>
          ) : (
            <View>
              {selectable.map((m) => {
                const checked = selected.includes(m.id)
                return (
                  <Pressable
                    key={m.id}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked }}
                    onPress={() => setSelectedIds(toggleReviewer(selected, m.id))}
                    style={({ pressed }) => [styles.memberRow, { opacity: pressed ? 0.7 : 1 }]}>
                    <View
                      style={[
                        styles.checkbox,
                        { borderColor: checked ? c.primary : c.border, backgroundColor: checked ? c.primary : c.surface },
                      ]}>
                      {checked ? <Text style={[styles.checkMark, { color: c.onPrimary }]}>✓</Text> : null}
                    </View>
                    <Text style={[styles.memberName, { color: c.text }]} numberOfLines={1}>
                      {m.displayName}
                    </Text>
                  </Pressable>
                )
              })}
            </View>
          )}
          <View style={styles.actions}>
            <View style={styles.actionItem}>
              <Button
                label="キャンセル"
                variant="secondary"
                onPress={() => {
                  setShowPicker(false)
                  setSelectedIds(null)
                }}
              />
            </View>
            <View style={styles.actionItem}>
              <Button label="依頼する" onPress={submit} disabled={selected.length === 0} loading={open.isPending} />
            </View>
          </View>
        </View>
      ) : (
        <View style={styles.stack}>
          {review && data ? (
            <>
              <Text style={[styles.status, { color: statusColor(c, review.status) }]}>{reviewStatusLabel(review.status)}</Text>
              <View>
                {data.approvals.map((a) => (
                  <View key={a.id} style={styles.approvalRow}>
                    <Text style={[styles.memberName, { color: c.text }]} numberOfLines={1}>
                      {memberDisplayName(members, a.reviewer_id)}
                    </Text>
                    <Text style={[styles.state, { color: stateColor(c, a.state) }]}>{approvalStateLabel(a.state)}</Text>
                  </View>
                ))}
              </View>
              {data.approvals
                .filter((a) => a.state === 'blocked' && a.blocked_reason)
                .map((a) => (
                  <View key={a.id} style={[styles.reason, { borderColor: c.danger }]}>
                    <Text style={[styles.note, { color: c.danger }]}>{memberDisplayName(members, a.reviewer_id)}</Text>
                    <Text style={[styles.reasonText, { color: c.text }]}>{a.blocked_reason}</Text>
                  </View>
                ))}
            </>
          ) : null}
          {canRequest && mode ? (
            <Button
              label={mode === 'rerequest' ? '再依頼' : '社内承認を依頼'}
              variant="secondary"
              onPress={startRequest}
            />
          ) : null}
          {cancellable ? (
            <Button label="レビューを取り消す" variant="secondary" onPress={confirmCancel} loading={cancel.isPending} />
          ) : null}
        </View>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  box: { borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, padding: 16, gap: 12 },
  heading: { fontSize: 13, fontWeight: '600' },
  placeholder: { minHeight: 44 },
  stack: { gap: 12 },
  muted: { fontSize: 14 },
  note: { fontSize: 12 },
  status: { fontSize: 15, fontWeight: '600' },
  approvalRow: { minHeight: 36, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  state: { fontSize: 13, fontWeight: '500' },
  reason: { borderWidth: 1, borderRadius: 8, padding: 10, gap: 2 },
  reasonText: { fontSize: 14 },
  memberRow: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 12 },
  memberName: { flex: 1, fontSize: 15 },
  checkbox: { width: 24, height: 24, borderRadius: 6, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  checkMark: { fontSize: 15, fontWeight: '700', lineHeight: 18 },
  actions: { flexDirection: 'row', gap: 12 },
  actionItem: { flex: 1 },
})
