'use client'

import { useMemo, type ReactNode } from 'react'
import { useSpaceMembers } from '@/lib/hooks/useSpaceMembers'
import { useCurrentUser } from '@/lib/hooks/useCurrentUser'
import { DocPollHost, type DocPollEditorLike } from './DocPollHost'
import { useDocInsertionSync, type InsertionEditorLike } from '@/components/editor/docInsertion/useDocInsertionSync'

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
  applyInsertions = false,
  children,
}: {
  editor: DocPollEditorLike
  meetingId: string
  spaceId: string
  editable: boolean
  /** 相手先の差し込みをこの画面で本文に取り込むか（1つのタブだけ。MinutesEditor の applyInsertions） */
  applyInsertions?: boolean
  children: ReactNode
}) {
  // 相手先が足した行・メモを本文に取り込む（DOC_VOTE_SPEC §5）。投票と同じ合図のチャネルを使う
  useDocInsertionSync({ editor: editor as unknown as InsertionEditorLike, meetingId, enabled: applyInsertions })
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
