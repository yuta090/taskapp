'use client'

import { useCallback, useMemo } from 'react'
import { useContext } from 'react'
import { ActiveOrgContext } from '@/lib/org/ActiveOrgProvider'
import { useCurrentUser } from '@/lib/hooks/useCurrentUser'
import { useSpaceMembers } from '@/lib/hooks/useSpaceMembers'
import { useUserSpaces } from '@/lib/hooks/useUserSpaces'
import { canEditSpaceContent } from '@/lib/roles/spaceRoles'

export interface UseCanEditSpaceResult {
  /** この space の内容（タスク・ガント・Wiki・見積など）を編集できるか。判定の正本は canEditSpaceContent */
  canEdit: boolean
  /** 判定に必要な情報（自分のspace内役割・組織の役割）がまだ揃っていない間は true */
  loading: boolean
}

/**
 * 画面側で「この space を編集していいか」を判定する唯一の入口。
 * DB 側の書き込み判定（app_can_write_space）と同じ規則を canEditSpaceContent に集約し、
 * ここでは「自分の組織の役割」と「自分のこの space での役割」を集めて渡すだけにする。
 *
 * 各画面はこれを使って、押しても失敗するだけの編集操作（作成・編集・ドラッグ・ボールの
 * 受け渡し・Wiki編集・見積など）を出し分ける。コメント欄は別（viewer でも書けるため対象外）。
 */
export function useCanEditSpace(spaceId: string | null): UseCanEditSpaceResult {
  const { activeOrgRole, loading: orgLoading } = useContext(ActiveOrgContext)
  const { user, loading: userLoading } = useCurrentUser()
  const { members, isPending: membersPending } = useSpaceMembers(spaceId)

  const spaceRole = useMemo(
    () => members.find((m) => m.id === user?.id)?.role ?? null,
    [members, user?.id]
  )

  const loading = !spaceId || orgLoading || userLoading || membersPending

  const canEdit = !loading && canEditSpaceContent(spaceRole, activeOrgRole)

  return { canEdit, loading }
}

export interface UseCanEditSpacesResult {
  /** その space を編集できるか。判定の正本は canEditSpaceContent（useCanEditSpace と同じ） */
  canEditSpace: (spaceId: string | null | undefined) => boolean
  loading: boolean
}

/**
 * 複数の space にまたがるタスク一覧（例: マイタスク）で、タスクごとに space の役割が
 * 違う場合に使う。useCanEditSpace(spaceId) は space ごとにフックを1つ使うため、
 * 件数が可変な一覧では Rules of Hooks に反して使えない。代わりに、自分が所属する
 * space 一覧（useUserSpaces）をまとめて1回だけ取得し、そこから判定する関数を返す。
 *
 * useUserSpaces は space_memberships に行がある space だけを返す。行が無い space
 * （社内メンバーは editor 扱い）は一覧に現れないため、その場合は
 * canEditSpaceContent(null, orgRole) を通す ＝ useCanEditSpace と同じ既定になる。
 */
export function useCanEditSpaces(): UseCanEditSpacesResult {
  const { activeOrgRole } = useContext(ActiveOrgContext)
  const { spaces, loading } = useUserSpaces()

  const roleBySpaceId = useMemo(
    () => new Map(spaces.map((s) => [s.id, s.role])),
    [spaces]
  )

  const canEditSpace = useCallback(
    (spaceId: string | null | undefined): boolean => {
      if (!spaceId || loading) return false
      return canEditSpaceContent(roleBySpaceId.get(spaceId) ?? null, activeOrgRole)
    },
    [roleBySpaceId, activeOrgRole, loading]
  )

  return { canEditSpace, loading }
}
