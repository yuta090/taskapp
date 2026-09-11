/**
 * タスクの「担当者」まわりの共通処理（一覧の名前・絞り込みの選択肢・担当者別の並び）。
 *
 * 担当者は tasks.assignee_id（本人）か tasks.assignee_invite_id（まだ承諾していない招待）の
 * どちらか一方（DB の tasks_single_assignee_chk）。task_owners は「ボールを持っている人」で
 * 担当者とは別物なので、ここでは使わない。以前はそれを担当者の名簿にしていて、ボールの情報が
 * 無いタスクばかりのプロジェクトでは、担当者の選択肢が「未割り当て」だけになっていた。
 */
import type { BallSide } from '@/types/database'

export const UNASSIGNED_LABEL = '未割り当て'
/** 招待の一覧を見る権限が無い人（閲覧者など）には、招待中の担当者の名前が分からない */
export const UNKNOWN_INVITE_LABEL = '招待中'

export interface AssigneeOption {
  /** users.id、または担当者が招待中なら invites.id（どちらも UUID なので混ざらない） */
  id: string
  label: string
  side: BallSide
}

export interface AssignableTask {
  assignee_id: string | null
  assignee_invite_id?: string | null
}

export interface AssigneeGroup<T> {
  /** null = 未割り当て */
  key: string | null
  label: string
  tasks: T[]
}

/** そのタスクの担当者を表す id（本人か招待のどちらか）。だれも担当していなければ null */
export function taskAssigneeKey(task: AssignableTask): string | null {
  return task.assignee_id ?? task.assignee_invite_id ?? null
}

/**
 * 担当者の選択肢を作る。並びは「社内の参加者 → 外部の参加者 → 招待中の担当者 → 名簿に無い担当者」。
 * 参加者はタスクが0件の人も並べる（担当者で絞るとき、名簿から選べないと困る）。
 */
export function buildAssigneeOptions({
  members,
  pendingInvites,
  tasks,
  getMemberName,
}: {
  members: ReadonlyArray<{ id: string; displayName: string; role: string }>
  pendingInvites: ReadonlyArray<{ id: string; label: string; role: string }>
  tasks: ReadonlyArray<AssignableTask>
  getMemberName: (userId: string) => string
}): AssigneeOption[] {
  const options: AssigneeOption[] = []
  const seen = new Set<string>()
  const add = (option: AssigneeOption) => {
    if (seen.has(option.id)) return
    seen.add(option.id)
    options.push(option)
  }

  for (const m of members) {
    if (m.role !== 'client') add({ id: m.id, label: m.displayName, side: 'internal' })
  }
  for (const m of members) {
    if (m.role === 'client') add({ id: m.id, label: m.displayName, side: 'client' })
  }

  // 招待中の人は、担当になっているときだけ（担当の無い招待は、絞り込んでも何も出ない）
  const assignedInviteIds = new Set(tasks.map((t) => t.assignee_invite_id).filter(Boolean))
  for (const invite of pendingInvites) {
    if (assignedInviteIds.has(invite.id)) {
      add({ id: invite.id, label: invite.label, side: invite.role === 'client' ? 'client' : 'internal' })
    }
  }

  // プロジェクトを抜けた人・権限で見えない招待も、タスクが残っている限り選べるようにする
  const unknownInviteIds = new Set<string>()
  for (const t of tasks) {
    if (t.assignee_id) add({ id: t.assignee_id, label: getMemberName(t.assignee_id), side: 'internal' })
    else if (t.assignee_invite_id && !seen.has(t.assignee_invite_id)) unknownInviteIds.add(t.assignee_invite_id)
  }
  // 招待の一覧を見る権限が無い人（閲覧者など）には名前が分からない。複数いたら番号で見分けられるようにする
  Array.from(unknownInviteIds).forEach((id, i) => {
    const label = unknownInviteIds.size === 1 ? UNKNOWN_INVITE_LABEL : `${UNKNOWN_INVITE_LABEL}（${i + 1}）`
    add({ id, label, side: 'internal' })
  })

  return options
}

/** 担当者ごとにまとめる。名前順に並べ、未割り当ては最後。招待中の人のタスクは未割り当てに混ぜない */
export function groupTasksByAssignee<T extends AssignableTask>(
  tasks: readonly T[],
  labelFor: (key: string) => string
): AssigneeGroup<T>[] {
  const byKey = new Map<string, T[]>()
  const unassigned: T[] = []
  for (const task of tasks) {
    const key = taskAssigneeKey(task)
    if (key === null) {
      unassigned.push(task)
      continue
    }
    const list = byKey.get(key)
    if (list) list.push(task)
    else byKey.set(key, [task])
  }

  const groups: AssigneeGroup<T>[] = Array.from(byKey, ([key, groupTasks]) => ({
    key,
    label: labelFor(key),
    tasks: groupTasks,
  }))
  groups.sort((a, b) => a.label.localeCompare(b.label))
  if (unassigned.length > 0) groups.push({ key: null, label: UNASSIGNED_LABEL, tasks: unassigned })
  return groups
}
