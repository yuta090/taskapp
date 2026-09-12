'use client'

import { useCallback, useContext, useMemo } from 'react'
import { ActiveOrgContext } from '@/lib/org/ActiveOrgProvider'
import { useUserSpaces } from '@/lib/hooks/useUserSpaces'
import { canEditSpaceContent, canEditSpaceMoney } from '@/lib/roles/spaceRoles'

export interface UseCanEditSpaceResult {
  /** この space の内容（タスク・ガント・Wiki など）を編集できるか。判定の正本は canEditSpaceContent */
  canEdit: boolean
  /** 価格の枠・代理店設定を操作できるか。判定の正本は canEditSpaceMoney（canEditよりも狭い） */
  canEditMoney: boolean
  /** 判定に必要な情報（自分の所属space一覧・組織一覧）がまだ揃っていない間は true */
  loading: boolean
  /**
   * 役割（canEdit/canEditMoney）が確定したか。ActiveOrgProvider.loading は cookie が
   * あると（所属組織一覧がまだ届いていなくても）早く false になるため、それだけでは
   * 「確定した」と誤認する。orgsStatus も合わせて見る（'unknown' の間は未確定）。
   * 操作ガイド（InternalOnboardingWalkthrough）のように、役割が定まるまで内容を
   * 出し始めたくない（確定前に出すと、あとで手順の数が変わって表示中の内容が
   * すり替わってしまう）呼び出し元向け。
   */
  resolved: boolean
}

/**
 * 画面側で「この space を編集していいか」を判定する唯一の入口。
 * DB 側の書き込み判定（app_can_write_space）と同じ規則を canEditSpaceContent に集約し、
 * ここでは「自分のこの space での役割」と「そのページの組織での役割」を集めて渡すだけにする。
 *
 * 自分の space での役割は、自分の space_memberships の行（useUserSpaces）を正本にする
 * （行が無い＝一覧に載らないだけで、通信の失敗とは区別できる）。
 *
 * 組織の役割は「今選んでいる組織」（activeOrgRole）ではなく、引数で渡された orgId
 * （そのページが属する組織）の役割を使う。呼び出し元の例:
 * TasksPageClient/GanttPageClient/WikiPageClient は URL の orgId、
 * マイタスクの詳細（MyTaskInspector）は task.org_id。
 *
 * 「まだ取れていない」「一度も取れないまま失敗した」「組織の役割が引けない」は、すべて
 * 編集できない側に倒す（分からないときに一瞬でも編集できる状態を見せない）。
 * 一方、前回取れたデータがある状態で裏の取り直しだけ失敗した場合（isLoadingError=false）は
 * 前回取れた役割を使い続ける（DB 側の RLS・トリガーが最後の砦のため、ここで過剰に
 * 読み取り専用へ倒す必要は無い）。
 *
 * 各画面はこれを使って、押しても失敗するだけの編集操作（作成・編集・ドラッグ・ボールの
 * 受け渡し・Wiki編集・見積など）を出し分ける。コメント欄は別（viewer でも書けるため対象外）。
 */
export function useCanEditSpace(spaceId: string | null, orgId: string | null): UseCanEditSpaceResult {
  const { orgs, orgsStatus, loading: orgsLoading } = useContext(ActiveOrgContext)
  const { spaces, isPending, isLoadingError } = useUserSpaces({ includeArchived: true })

  const membership = useMemo(
    () => spaces.find((s) => s.id === spaceId),
    [spaces, spaceId]
  )
  const spaceRole = membership?.role ?? null
  // 行が無い（社内メンバーは editor 扱い）場合、所属組織は自分では分からないため
  // 呼び出し元が渡した orgId（そのページの組織）を使う
  const resolvedOrgId = membership?.orgId ?? orgId ?? null

  const orgRole = useMemo(
    () => orgs.find((o) => o.orgId === resolvedOrgId)?.role ?? null,
    [orgs, resolvedOrgId]
  )

  const loading = !spaceId || isPending || orgsLoading
  // 組織の役割が引けない（まだ orgs が届いていない・そもそも所属していない）ときも「分からない」
  const unknown = loading || isLoadingError || orgRole == null

  const canEdit = !unknown && canEditSpaceContent(spaceRole, orgRole)
  const canEditMoney = !unknown && canEditSpaceMoney(spaceRole, orgRole)

  // orgsStatus:'unknown' は ActiveOrgProvider.loading がまだ true のはずだが、cookie 由来の
  // rawActiveOrgId があると loading だけ早く false に倒れる実装のため、念のため両方見る
  const resolved = !loading && orgsStatus !== 'unknown'

  return { canEdit, canEditMoney, loading, resolved }
}

export interface UseCanEditSpacesResult {
  /**
   * その space を編集できるか。判定の正本は canEditSpaceContent（useCanEditSpace と同じ）。
   * orgId は、その space が自分の所属一覧に無い（行が無い）ときに、所属組織を補うために使う
   * （useCanEditSpace の orgId 引数と同じ役割）。
   */
  canEditSpace: (spaceId: string | null | undefined, orgId?: string | null) => boolean
  loading: boolean
}

/**
 * 複数の space にまたがるタスク一覧（例: マイタスク）で、タスクごとに space の役割が
 * 違う場合に使う。useCanEditSpace(spaceId, orgId) は space ごとにフックを1つ使うため、
 * 件数が可変な一覧では Rules of Hooks に反して使えない。代わりに、自分が所属する
 * space 一覧（useUserSpaces）をまとめて1回だけ取得し、そこから判定する関数を返す。
 *
 * 組織の役割は、その space 自身の orgId（useUserSpaces が持つ）を優先し、
 * 行が無い space では呼び出し側が渡した orgId（例: task.org_id）で補う。
 */
export function useCanEditSpaces(): UseCanEditSpacesResult {
  const { orgs } = useContext(ActiveOrgContext)
  const { spaces, isPending, isLoadingError } = useUserSpaces({ includeArchived: true })

  const spaceById = useMemo(
    () => new Map(spaces.map((s) => [s.id, s])),
    [spaces]
  )
  const orgRoleByOrgId = useMemo(
    () => new Map(orgs.map((o) => [o.orgId, o.role])),
    [orgs]
  )

  const loading = isPending

  const canEditSpace = useCallback(
    (spaceId: string | null | undefined, orgId: string | null = null): boolean => {
      if (!spaceId || loading || isLoadingError) return false
      const membership = spaceById.get(spaceId)
      const resolvedOrgId = membership?.orgId ?? orgId ?? null
      const orgRole = resolvedOrgId ? orgRoleByOrgId.get(resolvedOrgId) ?? null : null
      return canEditSpaceContent(membership?.role ?? null, orgRole)
    },
    [spaceById, orgRoleByOrgId, loading, isLoadingError]
  )

  return { canEditSpace, loading }
}
