'use client'

import { TaskComments } from '@/components/task/TaskComments'
import { useCurrentUser } from '@/lib/hooks/useCurrentUser'
import { useSpaceMembers } from '@/lib/hooks/useSpaceMembers'

/**
 * 受信トレイの右パネルに出す、コメント・メンション通知のタスクのコメント欄。タスク詳細と同じ欄なので、
 * 画面を移らずに前後のやり取りを読んで返信できる。公開範囲を選べるのはタスク詳細と同じく社内メンバーだけ。
 * 利用者とメンバーの読み込みはコメント通知を開いたときだけにしたいので、NotificationInspector から分けている。
 */
export function InboxCommentThread({
  orgId,
  spaceId,
  taskId,
  replyToCommentId,
}: {
  orgId: string
  spaceId: string
  taskId: string
  replyToCommentId?: string
}) {
  const { user } = useCurrentUser()
  const currentUserId = user?.id || null
  const { internalMembers } = useSpaceMembers(spaceId)
  const isInternalMember = currentUserId ? internalMembers.some((m) => m.id === currentUserId) : false

  return (
    <TaskComments
      orgId={orgId}
      spaceId={spaceId}
      taskId={taskId}
      currentUserId={currentUserId}
      clientOnly={false}
      canSetVisibility={isInternalMember}
      replyToCommentId={replyToCommentId}
    />
  )
}
