import { formatTaskNumber } from '@/lib/tasks/taskNumber'
import type { CommentVisibility, TaskStatus } from '@/types/database'
import { Stack, useLocalSearchParams } from 'expo-router'
import { useState } from 'react'
import { Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { formatDue } from '~/components/TaskRow'
import { Button, Chip, EmptyState, ErrorRetry, Loading } from '~/components/ui'
import {
  useAddComment,
  useApproveReview,
  useComments,
  usePendingReviewTaskIds,
  useTakeBall,
  useTaskDetail,
  useUpdateStatus,
} from '~/hooks/queries'
import { completionBlocker, STATUS_CHOICES } from '~/lib/taskRules'
import { useColors } from '~/theme/colors'

/**
 * タスクの詳細。スマホでやることにしぼる: 状態を変える・ボールを自分たちに戻す・承認する・コメントする。
 * 変えたら即保存（保存ボタンなし）。それ以外の編集は Web で行う。
 */
export default function TaskDetailScreen() {
  const c = useColors()
  const { taskId } = useLocalSearchParams<{ taskId: string }>()
  const detail = useTaskDetail(taskId)
  const task = detail.data?.task
  const comments = useComments(task)
  const pending = usePendingReviewTaskIds()
  const updateStatus = useUpdateStatus()
  const takeBall = useTakeBall()
  const approve = useApproveReview()
  const addComment = useAddComment(task)
  const [draft, setDraft] = useState('')
  const [visibility, setVisibility] = useState<CommentVisibility>('internal')

  if (detail.isPending) return <Loading />
  if (detail.isError && !detail.data) return <ErrorRetry message="タスクを読み込めませんでした" onRetry={() => detail.refetch()} />
  if (!task) return <EmptyState message="このタスクを開けませんでした。削除されたか、見る権限がない可能性があります。" />

  const reviewStatus = detail.data?.reviewStatus
  const awaitingMyApproval = pending.data?.has(task.id) ?? false
  const due = formatDue(task.due_date)

  const onChangeStatus = (status: TaskStatus) => {
    if (status === task.status) return
    if (status === 'done') {
      const blocker = completionBlocker(reviewStatus, task)
      if (blocker) {
        Alert.alert('完了にできません', blocker)
        return
      }
    }
    updateStatus.mutate(
      { taskId: task.id, status },
      { onError: (e) => Alert.alert('変更できませんでした', e instanceof Error ? e.message : '') }
    )
  }

  const onTakeBall = () =>
    takeBall.mutate(task.id, { onError: (e) => Alert.alert('ボールを戻せませんでした', e instanceof Error ? e.message : '') })

  const onApprove = () =>
    approve.mutate(task.id, {
      onSuccess: (result) => {
        if (result.taskCompleted) Alert.alert('承認しました', '承認がそろったので、タスクは完了になりました')
      },
      onError: (e) => Alert.alert('承認できませんでした', e instanceof Error ? e.message : ''),
    })

  const onSend = () => {
    const body = draft.trim()
    if (!body) return
    addComment.mutate(
      { body, visibility },
      {
        onSuccess: () => setDraft(''),
        onError: (e) => Alert.alert('送信できませんでした', e instanceof Error ? e.message : ''),
      }
    )
  }

  const shownStatus = updateStatus.isPending ? updateStatus.variables?.status : task.status
  const clientVisible = visibility === 'client'

  return (
    <KeyboardAvoidingView
      style={[styles.flex, { backgroundColor: c.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 100 : 0}>
      <Stack.Screen options={{ title: formatTaskNumber(task.short_id) ?? 'タスク' }} />
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={[styles.title, { color: c.text }]}>{task.title}</Text>
        <View style={styles.metaRow}>
          {detail.data?.spaceName ? <Chip label={detail.data.spaceName} /> : null}
          {due ? <Chip label={`期限 ${due}`} /> : null}
          {task.ball !== 'internal' ? <Chip label="相手先の番" tone="client" /> : <Chip label="自分たちの番" />}
        </View>

        {awaitingMyApproval ? (
          <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.primary }]}>
            <Text style={[styles.cardTitle, { color: c.text }]}>社内承認を依頼されています</Text>
            <Button label="承認する" onPress={onApprove} loading={approve.isPending} />
            <Text style={[styles.hint, { color: c.textMuted }]}>差し戻しは Web で理由を書いて行います</Text>
          </View>
        ) : null}

        <Text style={[styles.sectionLabel, { color: c.textMuted }]}>状態</Text>
        <View style={styles.statusRow}>
          {STATUS_CHOICES.map((choice) => {
            const selected = choice.value === shownStatus
            return (
              <Pressable
                key={choice.value}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                onPress={() => onChangeStatus(choice.value)}
                style={[styles.status, { backgroundColor: selected ? c.primary : c.chip }]}>
                <Text style={[styles.statusLabel, { color: selected ? c.onPrimary : c.textSecondary }]}>{choice.label}</Text>
              </Pressable>
            )
          })}
        </View>
        {task.status === 'in_review' || task.status === 'considering' ? (
          <Text style={[styles.hint, { color: c.textMuted }]}>
            いまは「{task.status === 'in_review' ? '社内承認中' : '検討中'}」です
          </Text>
        ) : null}

        {task.ball !== 'internal' ? (
          <View style={styles.block}>
            <Button label="ボールを自分たちに戻す" variant="secondary" onPress={onTakeBall} loading={takeBall.isPending} />
            <Text style={[styles.hint, { color: c.textMuted }]}>相手先にボールを渡すのは、いまは Web で行います</Text>
          </View>
        ) : null}

        {task.description ? (
          <View style={styles.block}>
            <Text style={[styles.sectionLabel, { color: c.textMuted }]}>説明</Text>
            <Text style={[styles.description, { color: c.text }]}>{task.description}</Text>
          </View>
        ) : null}

        <Text style={[styles.sectionLabel, { color: c.textMuted }]}>コメント</Text>
        {comments.isPending ? (
          <Text style={[styles.hint, { color: c.textMuted }]}>読み込み中…</Text>
        ) : (comments.data ?? []).length === 0 ? (
          <Text style={[styles.hint, { color: c.textMuted }]}>まだコメントはありません</Text>
        ) : (
          comments.data!.map((comment) => (
            <View
              key={comment.id}
              style={[
                styles.comment,
                { backgroundColor: c.surface, borderColor: comment.visibility === 'client' ? c.clientVisible : c.border },
              ]}>
              <Text style={[styles.commentAuthor, { color: c.textSecondary }]}>
                {comment.authorName}
                {comment.visibility === 'client' ? '（相手先にも見える）' : ''}
              </Text>
              <Text style={[styles.commentBody, { color: c.text }]}>{comment.body}</Text>
            </View>
          ))
        )}
      </ScrollView>

      <View style={[styles.composer, { backgroundColor: c.surface, borderColor: c.border }]}>
        <Pressable
          accessibilityRole="switch"
          accessibilityState={{ checked: clientVisible }}
          onPress={() => setVisibility(clientVisible ? 'internal' : 'client')}
          style={[styles.visibility, { borderColor: clientVisible ? c.clientVisible : c.border }]}>
          <Text style={[styles.visibilityLabel, { color: clientVisible ? c.clientVisible : c.textSecondary }]}>
            {clientVisible ? '相手先にも見える' : '社内だけ'}
          </Text>
        </Pressable>
        <TextInput
          value={draft}
          onChangeText={setDraft}
          placeholder="コメントを書く"
          placeholderTextColor={c.textMuted}
          multiline
          style={[styles.input, { color: c.text, borderColor: c.border }]}
        />
        <Pressable accessibilityRole="button" onPress={onSend} disabled={!draft.trim() || addComment.isPending} hitSlop={8}>
          <Text style={[styles.send, { color: draft.trim() ? c.primary : c.textMuted }]}>送信</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: { padding: 16, gap: 12, paddingBottom: 32 },
  title: { fontSize: 20, fontWeight: '700' },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  card: { borderRadius: 12, borderWidth: 1, padding: 16, gap: 10 },
  cardTitle: { fontSize: 15, fontWeight: '600' },
  sectionLabel: { fontSize: 13, fontWeight: '600', marginTop: 8 },
  statusRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  status: { borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8 },
  statusLabel: { fontSize: 14, fontWeight: '500' },
  block: { gap: 6 },
  hint: { fontSize: 12 },
  description: { fontSize: 15, lineHeight: 22 },
  comment: { borderRadius: 10, borderWidth: StyleSheet.hairlineWidth, padding: 12, gap: 4 },
  commentAuthor: { fontSize: 12, fontWeight: '500' },
  commentBody: { fontSize: 15, lineHeight: 21 },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  visibility: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 6 },
  visibilityLabel: { fontSize: 12, fontWeight: '500' },
  input: { flex: 1, maxHeight: 120, minHeight: 36, borderWidth: StyleSheet.hairlineWidth, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, fontSize: 15 },
  send: { fontSize: 15, fontWeight: '600', paddingBottom: 8 },
})
