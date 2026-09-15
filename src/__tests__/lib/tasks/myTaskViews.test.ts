import { describe, it, expect } from 'vitest'
import type { Milestone, Space, Task } from '@/types/database'
import {
  DEFAULT_MY_TASK_VIEW,
  buildMyTaskSections,
  dueBucketOf,
  filterMyTasks,
  parseMyTaskViewState,
  sortMyTasks,
} from '@/lib/tasks/myTaskViews'

/**
 * マイタスクの表示の切り替え（タブ・まとめ方・ボール・未読コメント）の中身。
 * 画面から切り離した関数なので、週の区切り・月末・前の形の保存といった境界はここで確かめる。
 */

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 't1',
    org_id: 'o1',
    space_id: 's1',
    milestone_id: null,
    parent_task_id: null,
    title: 'タスク',
    description: null,
    status: 'todo',
    priority: null,
    assignee_id: 'u1',
    start_date: null,
    due_date: null,
    ball: 'internal',
    origin: 'internal',
    type: 'task',
    spec_path: null,
    wiki_page_id: null,
    decision_state: null,
    client_scope: 'internal',
    actual_hours: null,
    estimated_cost: null,
    estimate_status: 'none',
    completed_at: null,
    is_sample: false,
    due_authority_connection_id: null,
    short_id: null,
    created_at: '2026-09-01T00:00:00',
    updated_at: '2026-09-01T00:00:00',
    ...overrides,
  } as Task
}

function makeSpace(id: string, name: string): Space {
  return { id, name, org_id: 'o1' } as unknown as Space
}

function makeMilestone(overrides: Partial<Milestone> = {}): Milestone {
  return {
    id: 'm1',
    org_id: 'o1',
    space_id: 's1',
    name: 'マイルストーン',
    start_date: null,
    due_date: null,
    order_key: 0,
    completed_at: null,
    created_at: '2026-09-01T00:00:00',
    updated_at: '2026-09-01T00:00:00',
    ...overrides,
  }
}

const ids = (tasks: Task[]) => tasks.map((t) => t.id)
const noUnread = () => 0

describe('parseMyTaskViewState — 端末に保存した表示の設定を読む', () => {
  it('保存が無ければ既定（アクティブ・期限別・ボールはすべて）', () => {
    expect(parseMyTaskViewState(null)).toEqual(DEFAULT_MY_TASK_VIEW)
    expect(DEFAULT_MY_TASK_VIEW).toMatchObject({
      tab: 'active',
      groupBy: 'due',
      ball: 'all',
      spaceId: null,
      unreadOnly: false,
    })
  })

  it('前の形の保存（status / showCompleted）は使わず、並び替えとプロジェクトだけ引き継ぐ', () => {
    expect(
      parseMyTaskViewState({ status: 'in_review', showCompleted: true, spaceId: 's1', sortField: 'title', sortOrder: 'desc' })
    ).toEqual({ ...DEFAULT_MY_TASK_VIEW, spaceId: 's1', sortField: 'title', sortOrder: 'desc' })
  })

  it('知らない値・型の違う値は既定に置き換える', () => {
    expect(
      parseMyTaskViewState({
        tab: 'client_wait',
        groupBy: 1,
        ball: 'client',
        spaceId: 42,
        unreadOnly: 'yes',
        sortField: 'assignee',
        sortOrder: 'up',
      })
    ).toEqual(DEFAULT_MY_TASK_VIEW)
    expect(parseMyTaskViewState('壊れた値')).toEqual(DEFAULT_MY_TASK_VIEW)
  })

  it('正しい値はそのまま使う', () => {
    const view = {
      tab: 'done',
      groupBy: 'status',
      ball: 'external',
      spaceId: 's2',
      unreadOnly: true,
      sortField: 'priority',
      sortOrder: 'desc',
    } as const
    expect(parseMyTaskViewState(view)).toEqual(view)
  })
})

describe('filterMyTasks — タブ', () => {
  const tasks = [
    makeTask({ id: 'backlog', status: 'backlog' }),
    makeTask({ id: 'todo', status: 'todo' }),
    makeTask({ id: 'progress', status: 'in_progress' }),
    makeTask({ id: 'review', status: 'in_review' }),
    makeTask({ id: 'considering', status: 'considering' }),
    makeTask({ id: 'done', status: 'done' }),
  ]

  it('アクティブ: 未着手と完了を外す', () => {
    expect(ids(filterMyTasks(tasks, { ...DEFAULT_MY_TASK_VIEW, tab: 'active' }, noUnread))).toEqual([
      'todo',
      'progress',
      'review',
      'considering',
    ])
  })

  it('未着手: 未着手だけ（以前はどの設定にしても出なかった）', () => {
    expect(ids(filterMyTasks(tasks, { ...DEFAULT_MY_TASK_VIEW, tab: 'backlog' }, noUnread))).toEqual(['backlog'])
  })

  it('完了: 完了だけ', () => {
    expect(ids(filterMyTasks(tasks, { ...DEFAULT_MY_TASK_VIEW, tab: 'done' }, noUnread))).toEqual(['done'])
  })

  it('すべて: 全部', () => {
    expect(ids(filterMyTasks(tasks, { ...DEFAULT_MY_TASK_VIEW, tab: 'all' }, noUnread))).toEqual(ids(tasks))
  })
})

describe('filterMyTasks — ボール・プロジェクト・未読コメント', () => {
  const tasks = [
    makeTask({ id: 'mine', ball: 'internal', space_id: 's1' }),
    makeTask({ id: 'client', ball: 'client', space_id: 's1' }),
    makeTask({ id: 'vendor', ball: 'vendor', space_id: 's2' }),
  ]

  it('社内: ボールが社内にあるものだけ', () => {
    expect(ids(filterMyTasks(tasks, { ...DEFAULT_MY_TASK_VIEW, ball: 'internal' }, noUnread))).toEqual(['mine'])
  })

  it('外部: ボールが社内以外（クライアント・ベンダー・代理店）にあるもの', () => {
    expect(ids(filterMyTasks(tasks, { ...DEFAULT_MY_TASK_VIEW, ball: 'external' }, noUnread))).toEqual([
      'client',
      'vendor',
    ])
  })

  it('プロジェクトで絞る', () => {
    expect(ids(filterMyTasks(tasks, { ...DEFAULT_MY_TASK_VIEW, spaceId: 's2' }, noUnread))).toEqual(['vendor'])
  })

  it('未読コメントがあるものだけ', () => {
    const unreadCountOf = (taskId: string) => (taskId === 'client' ? 2 : 0)
    expect(ids(filterMyTasks(tasks, { ...DEFAULT_MY_TASK_VIEW, unreadOnly: true }, unreadCountOf))).toEqual(['client'])
  })
})

describe('sortMyTasks', () => {
  const tasks = [
    makeTask({ id: 'none', due_date: null, priority: null, title: 'う' }),
    makeTask({ id: 'late', due_date: '2026-09-30', priority: 3, title: 'い' }),
    makeTask({ id: 'early', due_date: '2026-09-10', priority: 1, title: 'あ' }),
  ]

  it('期限の昇順。期限なしは最後', () => {
    expect(ids(sortMyTasks(tasks, 'due_date', 'asc'))).toEqual(['early', 'late', 'none'])
  })

  it('期限の降順でも、期限なしは最後', () => {
    expect(ids(sortMyTasks(tasks, 'due_date', 'desc'))).toEqual(['late', 'early', 'none'])
  })

  it('優先度の昇順（1=緊急が先）。優先度なしは最後', () => {
    expect(ids(sortMyTasks(tasks, 'priority', 'asc'))).toEqual(['early', 'late', 'none'])
  })

  it('タイトル順', () => {
    expect(ids(sortMyTasks(tasks, 'title', 'asc'))).toEqual(['early', 'late', 'none'])
  })

  it('渡した配列そのものは並べ替えない', () => {
    const before = ids(tasks)
    sortMyTasks(tasks, 'due_date', 'asc')
    expect(ids(tasks)).toEqual(before)
  })
})

describe('dueBucketOf — 期限の見出しの振り分け', () => {
  // 2026-09-16 は水曜日
  const wednesday = '2026-09-16'

  it.each([
    ['2026-09-15', 'overdue'],
    ['2026-09-16', 'today'],
    ['2026-09-17', 'tomorrow'],
    ['2026-09-18', 'this_week'],
    ['2026-09-20', 'this_week'], // 日曜日までが今週
    ['2026-09-21', 'later'], // 翌週の月曜日
  ] as const)('今日が水曜日のとき、期限 %s は %s', (due, bucket) => {
    expect(dueBucketOf(makeTask({ due_date: due }), wednesday)).toBe(bucket)
  })

  it('期限なしは no_date、完了は期限に関係なく done', () => {
    expect(dueBucketOf(makeTask({ due_date: null }), wednesday)).toBe('no_date')
    expect(dueBucketOf(makeTask({ status: 'done', due_date: '2026-09-01' }), wednesday)).toBe('done')
    expect(dueBucketOf(makeTask({ status: 'done', due_date: null }), wednesday)).toBe('done')
  })

  it('今日が日曜日なら、明日（月曜日）は「明日」、火曜日は「来週以降」', () => {
    const sunday = '2026-09-20'
    expect(dueBucketOf(makeTask({ due_date: '2026-09-21' }), sunday)).toBe('tomorrow')
    expect(dueBucketOf(makeTask({ due_date: '2026-09-22' }), sunday)).toBe('later')
  })

  it('今日が土曜日なら、明日（日曜日）は「明日」、月曜日は「来週以降」', () => {
    const saturday = '2026-09-19'
    expect(dueBucketOf(makeTask({ due_date: '2026-09-20' }), saturday)).toBe('tomorrow')
    expect(dueBucketOf(makeTask({ due_date: '2026-09-21' }), saturday)).toBe('later')
  })

  it('月末をまたいでも数え間違えない', () => {
    const endOfMonth = '2026-09-30' // 水曜日
    expect(dueBucketOf(makeTask({ due_date: '2026-10-01' }), endOfMonth)).toBe('tomorrow')
    expect(dueBucketOf(makeTask({ due_date: '2026-10-04' }), endOfMonth)).toBe('this_week')
    expect(dueBucketOf(makeTask({ due_date: '2026-10-05' }), endOfMonth)).toBe('later')
  })

  it('期限が日時の形で入っていても、日付の部分で振り分ける', () => {
    expect(dueBucketOf(makeTask({ due_date: '2026-09-16T23:30:00' }), wednesday)).toBe('today')
  })
})

describe('buildMyTaskSections — 期限別', () => {
  const today = '2026-09-16'
  const ctx = { spaces: [], milestones: [], today }

  it('期限切れ→今日→来週以降→期限なし→完了の順に並べ、空の見出しは出さない。見出しの中は渡した順を保つ', () => {
    const tasks = [
      makeTask({ id: 'none', due_date: null }),
      makeTask({ id: 'done', status: 'done', due_date: '2026-09-01' }),
      makeTask({ id: 'later', due_date: '2026-10-01' }),
      makeTask({ id: 'today2', due_date: '2026-09-16' }),
      makeTask({ id: 'over', due_date: '2026-09-02' }),
      makeTask({ id: 'today1', due_date: '2026-09-16' }),
    ]
    const sections = buildMyTaskSections(tasks, 'due', ctx)

    expect(sections).toHaveLength(1)
    expect(sections[0].label).toBeNull()
    expect(sections[0].groups.map((g) => [g.label, ids(g.tasks)])).toEqual([
      ['期限切れ', ['over']],
      ['今日', ['today2', 'today1']],
      ['来週以降', ['later']],
      ['期限なし', ['none']],
      ['完了', ['done']],
    ])
    expect(sections[0].groups[0].tone).toBe('danger')
    expect(sections[0].groups[1].tone).toBe('default')
  })

  it('明日と今週の見出し', () => {
    const tasks = [
      makeTask({ id: 'week', due_date: '2026-09-19' }),
      makeTask({ id: 'tomorrow', due_date: '2026-09-17' }),
    ]
    expect(buildMyTaskSections(tasks, 'due', ctx)[0].groups.map((g) => g.label)).toEqual(['明日', '今週'])
  })

  it('タスクが無ければ何も返さない', () => {
    expect(buildMyTaskSections([], 'due', ctx)).toEqual([])
    expect(buildMyTaskSections([], 'status', ctx)).toEqual([])
  })
})

describe('buildMyTaskSections — プロジェクト別', () => {
  it('プロジェクト名の順に、その中をマイルストーンの期限順で分け、マイルストーン未設定は最後', () => {
    const spaces = [makeSpace('s2', 'B案件'), makeSpace('s1', 'A案件')]
    const milestones = [
      makeMilestone({ id: 'm-late', space_id: 's1', name: '納品', due_date: '2026-10-31', order_key: 1 }),
      makeMilestone({ id: 'm-early', space_id: 's1', name: '設計', due_date: '2026-09-30', order_key: 2 }),
    ]
    const tasks = [
      makeTask({ id: 'b1', space_id: 's2' }),
      makeTask({ id: 'a-none', space_id: 's1' }),
      makeTask({ id: 'a-late', space_id: 's1', milestone_id: 'm-late' }),
      makeTask({ id: 'a-early', space_id: 's1', milestone_id: 'm-early' }),
      // 削除済みなど、一覧に無いマイルストーンを指すタスクは「未設定」にまとめる
      makeTask({ id: 'a-gone', space_id: 's1', milestone_id: 'm-deleted' }),
      makeTask({ id: 'unknown-space', space_id: 's9' }),
    ]
    const sections = buildMyTaskSections(tasks, 'project', { spaces, milestones, today: '2026-09-16' })

    expect(sections.map((s) => s.label)).toEqual(['A案件', 'B案件', 'プロジェクト未設定'])
    // 見出しのキーは前の形（spaceId:milestoneId）と同じ。畳んだ状態を引き継ぐため
    expect(sections[0].groups.map((g) => [g.key, g.label, g.meta, ids(g.tasks)])).toEqual([
      ['s1:m-early', '設計', '9/30', ['a-early']],
      ['s1:m-late', '納品', '10/31', ['a-late']],
      ['s1:no-milestone', 'マイルストーン未設定', null, ['a-none', 'a-gone']],
    ])
    expect(sections[1].groups.map((g) => g.key)).toEqual(['s2:no-milestone'])
  })
})

describe('buildMyTaskSections — マイルストーン別', () => {
  it('プロジェクトをまたいでマイルストーンの期限順に並べ、補足にプロジェクト名と期限を出す', () => {
    const spaces = [makeSpace('s1', 'A案件'), makeSpace('s2', 'B案件')]
    const milestones = [
      makeMilestone({ id: 'a-m', space_id: 's1', name: '納品', due_date: '2026-10-31' }),
      makeMilestone({ id: 'b-m', space_id: 's2', name: '公開', due_date: '2026-09-20' }),
      makeMilestone({ id: 'b-nodate', space_id: 's2', name: '保守', due_date: null }),
    ]
    const tasks = [
      makeTask({ id: 't-none', space_id: 's1' }),
      makeTask({ id: 't-a', space_id: 's1', milestone_id: 'a-m' }),
      makeTask({ id: 't-nodate', space_id: 's2', milestone_id: 'b-nodate' }),
      makeTask({ id: 't-b', space_id: 's2', milestone_id: 'b-m' }),
    ]
    const sections = buildMyTaskSections(tasks, 'milestone', { spaces, milestones, today: '2026-09-16' })

    expect(sections).toHaveLength(1)
    expect(sections[0].groups.map((g) => [g.key, g.label, g.meta, ids(g.tasks)])).toEqual([
      ['ms:b-m', '公開', 'B案件 · 9/20', ['t-b']],
      ['ms:a-m', '納品', 'A案件 · 10/31', ['t-a']],
      ['ms:b-nodate', '保守', 'B案件', ['t-nodate']],
      ['ms:none', 'マイルストーン未設定', null, ['t-none']],
    ])
  })
})

describe('buildMyTaskSections — ステータス別', () => {
  it('進行中→着手予定→社内承認中→検討中→未着手→完了の順', () => {
    const tasks = [
      makeTask({ id: 'done', status: 'done' }),
      makeTask({ id: 'backlog', status: 'backlog' }),
      makeTask({ id: 'considering', status: 'considering' }),
      makeTask({ id: 'review', status: 'in_review' }),
      makeTask({ id: 'todo', status: 'todo' }),
      makeTask({ id: 'progress', status: 'in_progress' }),
    ]
    const sections = buildMyTaskSections(tasks, 'status', { spaces: [], milestones: [], today: '2026-09-16' })

    expect(sections[0].groups.map((g) => g.label)).toEqual(['進行中', '着手予定', '社内承認中', '検討中', '未着手', '完了'])
  })
})
