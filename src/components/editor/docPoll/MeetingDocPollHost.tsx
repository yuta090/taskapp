'use client'

import { useMemo, type ReactNode } from 'react'
import { useSpaceMembers } from '@/lib/hooks/useSpaceMembers'
import { useCurrentUser } from '@/lib/hooks/useCurrentUser'
import { DocPollHost, type DocPollEditorLike } from './DocPollHost'

/**
 * 議事録の投票ブロックに配るもの（会議・ログイン中の人・名前の引き方）を用意して DocPollHost に渡す。
 * 議事録の画面は階層が深く、上から名前の引き方を渡すと受け渡しの行が増えるので、ここで引く
 * （メンバー一覧は同じ space の画面が共有するキャッシュなので、読み込みは増えない）。
 */
export function MeetingDocPollHost({
  editor,
  meetingId,
  spaceId,
  editable,
  children,
}: {
  editor: DocPollEditorLike
  meetingId: string
  spaceId: string
  editable: boolean
  children: ReactNode
}) {
  const { members } = useSpaceMembers(spaceId)
  const { user } = useCurrentUser()
  const nameOf = useMemo(() => {
    const byId = new Map(members.map((m) => [m.id, m.displayName]))
    return (userId: string) => byId.get(userId) || '（メンバー外の人）'
  }, [members])
  const source = useMemo(() => ({ meetingId }), [meetingId])
  return (
    <DocPollHost editor={editor} source={source} currentUserId={user?.id ?? null} nameOf={nameOf} editable={editable}>
      {children}
    </DocPollHost>
  )
}
