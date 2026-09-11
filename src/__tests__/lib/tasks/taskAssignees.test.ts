import { describe, it, expect } from 'vitest'
import {
  taskAssigneeKey,
  buildAssigneeOptions,
  groupTasksByAssignee,
  UNASSIGNED_LABEL,
} from '@/lib/tasks/taskAssignees'

/**
 * 担当者の絞り込み・担当者別の表示が「未割り当て」しか出なかった問題の対策。
 * 以前は選択肢を task_owners（ボールを持っている人）から作っていて、担当者（assignee_id）と
 * 別の名簿を見ていた。招待中の人が担当のタスクは「未割り当て」に紛れていた。
 */

const getMemberName = (id: string) => `${id.slice(0, 8)}...`

describe('taskAssigneeKey', () => {
  it('本人が担当なら、その人の id', () => {
    expect(taskAssigneeKey({ assignee_id: 'u1', assignee_invite_id: null })).toBe('u1')
  })

  it('招待中の人が担当なら、招待の id', () => {
    expect(taskAssigneeKey({ assignee_id: null, assignee_invite_id: 'inv1' })).toBe('inv1')
  })

  it('だれも担当していなければ null', () => {
    expect(taskAssigneeKey({ assignee_id: null })).toBeNull()
    expect(taskAssigneeKey({ assignee_id: null, assignee_invite_id: null })).toBeNull()
  })
})

describe('buildAssigneeOptions', () => {
  const members = [
    { id: 'c1', displayName: '顧客 花子', role: 'client' },
    { id: 'u1', displayName: '高橋', role: 'admin' },
    { id: 'u2', displayName: '佐藤', role: 'editor' },
  ]

  it('タスクを持っていない人も含め、プロジェクトの参加者を全員並べる（社内→外部の順）', () => {
    const options = buildAssigneeOptions({ members, pendingInvites: [], tasks: [], getMemberName })
    expect(options).toEqual([
      { id: 'u1', label: '高橋', side: 'internal' },
      { id: 'u2', label: '佐藤', side: 'internal' },
      { id: 'c1', label: '顧客 花子', side: 'client' },
    ])
  })

  it('ボールを持っていなくても（task_owners が空でも）担当者は選べる', () => {
    const options = buildAssigneeOptions({
      members,
      pendingInvites: [],
      tasks: [{ assignee_id: 'u2', assignee_invite_id: null }],
      getMemberName,
    })
    expect(options.map((o) => o.id)).toContain('u2')
  })

  it('招待中の人は、タスクの担当になっているときだけ並べる', () => {
    const options = buildAssigneeOptions({
      members: [],
      pendingInvites: [
        { id: 'inv1', label: '山田（招待中）', role: 'editor' },
        { id: 'inv2', label: '鈴木（招待中）', role: 'client' },
      ],
      tasks: [{ assignee_id: null, assignee_invite_id: 'inv1' }],
      getMemberName,
    })
    expect(options).toEqual([{ id: 'inv1', label: '山田（招待中）', side: 'internal' }])
  })

  it('外部の人の招待は「外部」として並べる', () => {
    const options = buildAssigneeOptions({
      members: [],
      pendingInvites: [{ id: 'inv2', label: '鈴木（招待中）', role: 'client' }],
      tasks: [{ assignee_id: null, assignee_invite_id: 'inv2' }],
      getMemberName,
    })
    expect(options).toEqual([{ id: 'inv2', label: '鈴木（招待中）', side: 'client' }])
  })

  it('名簿に無い担当者（抜けた人・権限で見えない招待）も、選べるように残す', () => {
    const options = buildAssigneeOptions({
      members: [],
      pendingInvites: [],
      tasks: [
        { assignee_id: 'gone-user-id', assignee_invite_id: null },
        { assignee_id: null, assignee_invite_id: 'hidden-invite' },
      ],
      getMemberName,
    })
    expect(options).toEqual([
      { id: 'gone-user-id', label: 'gone-use...', side: 'internal' },
      { id: 'hidden-invite', label: '招待中', side: 'internal' },
    ])
  })

  it('名前の分からない招待中の担当者が複数いるときは、番号で見分けられるようにする', () => {
    const options = buildAssigneeOptions({
      members: [],
      pendingInvites: [],
      tasks: [
        { assignee_id: null, assignee_invite_id: 'x1' },
        { assignee_id: null, assignee_invite_id: 'x2' },
        { assignee_id: null, assignee_invite_id: 'x1' },
      ],
      getMemberName,
    })
    expect(options).toEqual([
      { id: 'x1', label: '招待中（1）', side: 'internal' },
      { id: 'x2', label: '招待中（2）', side: 'internal' },
    ])
  })

  it('同じ人は1回だけ並べる', () => {
    const options = buildAssigneeOptions({
      members,
      pendingInvites: [],
      tasks: [
        { assignee_id: 'u1', assignee_invite_id: null },
        { assignee_id: 'u1', assignee_invite_id: null },
        { assignee_id: 'gone', assignee_invite_id: null },
        { assignee_id: 'gone', assignee_invite_id: null },
      ],
      getMemberName,
    })
    expect(options.map((o) => o.id)).toEqual(['u1', 'u2', 'c1', 'gone'])
  })
})

describe('groupTasksByAssignee', () => {
  it('担当者ごとにまとめ、名前順に並べ、未割り当ては最後にする', () => {
    const tasks = [
      { id: 'a', assignee_id: 'u2', assignee_invite_id: null },
      { id: 'b', assignee_id: null, assignee_invite_id: null },
      { id: 'c', assignee_id: 'u1', assignee_invite_id: null },
      { id: 'd', assignee_id: null, assignee_invite_id: 'inv1' },
      { id: 'e', assignee_id: 'u1', assignee_invite_id: null },
    ]
    const labels = new Map([
      ['u1', 'あべ'],
      ['u2', 'いとう'],
      ['inv1', 'うえだ（招待中）'],
    ])
    const groups = groupTasksByAssignee(tasks, (key) => labels.get(key) ?? key)
    expect(groups.map((g) => [g.key, g.label, g.tasks.map((t) => t.id)])).toEqual([
      ['u1', 'あべ', ['c', 'e']],
      ['u2', 'いとう', ['a']],
      ['inv1', 'うえだ（招待中）', ['d']],
      [null, UNASSIGNED_LABEL, ['b']],
    ])
  })

  it('だれにも担当がいなければ「未割り当て」の1グループだけ', () => {
    const groups = groupTasksByAssignee(
      [{ id: 'a', assignee_id: null, assignee_invite_id: null }],
      (key) => key
    )
    expect(groups).toEqual([{ key: null, label: UNASSIGNED_LABEL, tasks: [{ id: 'a', assignee_id: null, assignee_invite_id: null }] }])
  })
})
