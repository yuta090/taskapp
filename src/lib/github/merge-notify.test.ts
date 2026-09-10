import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  resolveMergeNotifyRecipients,
  buildMergeNotifyMessage,
  notifyTasksForMergedPR,
} from './merge-notify'

const ORG_ID = 'org-1'
const SPACE_ID = 'space-1'
const TASK_ID = 'task-1'
const PR_ID = 'pr-1'

const ASSIGNEE = 'user-assignee'
const OWNER_INTERNAL = 'user-owner-internal'
const CLIENT_USER = 'user-client'
const CREATOR = 'user-creator'
const REVIEWER = 'user-reviewer'

describe('resolveMergeNotifyRecipients（宛先の決定・純粋関数）', () => {
  it('担当者と社内責任者の和集合・重複除去を返す', () => {
    const recipients = resolveMergeNotifyRecipients({
      assigneeId: ASSIGNEE,
      internalOwnerIds: [ASSIGNEE, OWNER_INTERNAL],
      createdBy: CREATOR,
      defaultReviewerIds: [],
      internalMemberIds: new Set([ASSIGNEE, OWNER_INTERNAL, CREATOR]),
    })
    expect(new Set(recipients)).toEqual(new Set([ASSIGNEE, OWNER_INTERNAL]))
    expect(recipients.length).toBe(2)
  })

  it('client/vendor（社内メンバーでない）担当者・責任者は除外する', () => {
    const recipients = resolveMergeNotifyRecipients({
      assigneeId: CLIENT_USER,
      internalOwnerIds: [CLIENT_USER],
      createdBy: CREATOR,
      defaultReviewerIds: [],
      internalMemberIds: new Set([CREATOR]), // CLIENT_USER は社内メンバーではない
    })
    // 担当者・責任者が全員社外なので、次の優先度(created_by)に落ちる
    expect(recipients).toEqual([CREATOR])
  })

  it('担当者・責任者が空なら created_by（社内メンバーなら）に落ちる', () => {
    const recipients = resolveMergeNotifyRecipients({
      assigneeId: null,
      internalOwnerIds: [],
      createdBy: CREATOR,
      defaultReviewerIds: [],
      internalMemberIds: new Set([CREATOR]),
    })
    expect(recipients).toEqual([CREATOR])
  })

  it('created_by も社外・空ならデフォルト承認者（社内のみ）に落ちる', () => {
    const recipients = resolveMergeNotifyRecipients({
      assigneeId: null,
      internalOwnerIds: [],
      createdBy: CLIENT_USER,
      defaultReviewerIds: [REVIEWER, CLIENT_USER],
      internalMemberIds: new Set([REVIEWER]),
    })
    expect(recipients).toEqual([REVIEWER])
  })

  it('すべて空・社外なら0人（送らない）', () => {
    const recipients = resolveMergeNotifyRecipients({
      assigneeId: null,
      internalOwnerIds: [],
      createdBy: null,
      defaultReviewerIds: [],
      internalMemberIds: new Set(),
    })
    expect(recipients).toEqual([])
  })
})

describe('buildMergeNotifyMessage（文面の組み立て・純粋関数）', () => {
  it('タイトル・本文・件数を含む', () => {
    const { title, message } = buildMergeNotifyMessage({
      taskTitle: 'ログイン画面の実装',
      repoFullName: 'yuta090/taskapp',
      prNumber: 42,
      prTitle: 'fix: login bug',
      mergedCount: 1,
      totalCount: 3,
    })
    expect(title).toBe('「ログイン画面の実装」の変更（PR）が取り込まれました')
    expect(message).toContain('yuta090/taskapp')
    expect(message).toContain('#42')
    expect(message).toContain('fix: login bug')
    expect(message).toContain('取り込み済み 1 / 全 3')
    expect(message).toContain('ボールを渡してください')
  })
})

// ── 通知処理（偽の Supabase クライアント） ──

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function createFakeSupabase(tables: Record<string, any[]>) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const inserted: Record<string, any[]> = {}
  const updateCalls: Array<{ table: string; values: unknown }> = []

  function makeBuilder(table: string) {
    const data = tables[table] || []
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const filters: Array<(row: any) => boolean> = []
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const builder: any = {}

    builder.select = () => builder
    builder.eq = (col: string, val: unknown) => {
      filters.push((row) => row[col] === val)
      return builder
    }
    builder.in = (col: string, vals: unknown[]) => {
      filters.push((row) => vals.includes(row[col]))
      return builder
    }

    const applyFilters = () => data.filter((row) => filters.every((f) => f(row)))

    builder.single = async () => {
      const matched = applyFilters()
      return matched.length > 0
        ? { data: matched[0], error: null }
        : { data: null, error: { message: 'not found' } }
    }
    builder.maybeSingle = async () => {
      const matched = applyFilters()
      return { data: matched[0] ?? null, error: null }
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    builder.then = (resolve: any) => resolve({ data: applyFilters(), error: null })

    builder.update = (values: unknown) => {
      updateCalls.push({ table, values })
      return builder
    }
    builder.insert = async (rows: unknown) => {
      inserted[table] = (inserted[table] || []).concat(Array.isArray(rows) ? rows : [rows])
      return { data: null, error: null }
    }
    builder.upsert = async (rows: unknown) => {
      inserted[table] = (inserted[table] || []).concat(Array.isArray(rows) ? rows : [rows])
      return { data: null, error: null }
    }

    return builder
  }

  const client = {
    from: vi.fn((table: string) => makeBuilder(table)),
  }

  return { client, inserted, updateCalls }
}

function baseTables() {
  return {
    task_github_links: [
      { task_id: TASK_ID, github_pr_id: PR_ID, org_id: ORG_ID, link_type: 'auto' },
    ],
    tasks: [
      {
        id: TASK_ID,
        org_id: ORG_ID,
        space_id: SPACE_ID,
        title: 'ログイン画面の実装',
        status: 'in_review',
        assignee_id: ASSIGNEE as string | null,
        created_by: CREATOR as string | null,
      },
    ],
    task_owners: [{ task_id: TASK_ID, side: 'internal', user_id: OWNER_INTERNAL }],
    org_memberships: [
      { org_id: ORG_ID, user_id: ASSIGNEE, role: 'member' },
      { org_id: ORG_ID, user_id: OWNER_INTERNAL, role: 'member' },
      { org_id: ORG_ID, user_id: CREATOR, role: 'owner' },
      { org_id: ORG_ID, user_id: CLIENT_USER, role: 'client' },
    ],
    spaces: [{ id: SPACE_ID, default_reviewer_ids: [] }],
    github_pull_requests: [{ id: PR_ID, pr_state: 'merged' }],
  }
}

const prInfo = {
  orgId: ORG_ID,
  prId: PR_ID,
  prNumber: 42,
  prTitle: 'fix: login bug',
  prUrl: 'https://github.com/yuta090/taskapp/pull/42',
  repoFullName: 'yuta090/taskapp',
}

describe('notifyTasksForMergedPR（通知処理）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('紐づくタスクの宛先（担当者＋社内責任者）に1行ずつ通知を書く', async () => {
    const { client, inserted, updateCalls } = createFakeSupabase(baseTables())

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await notifyTasksForMergedPR(client as any, prInfo)

    const rows = inserted['notifications'] || []
    expect(rows).toHaveLength(2)
    const recipientIds = rows.map((r) => r.to_user_id).sort()
    expect(recipientIds).toEqual([ASSIGNEE, OWNER_INTERNAL].sort())

    for (const row of rows) {
      expect(row.channel).toBe('in_app')
      expect(row.type).toBe('github_pr_merged')
      expect(row.org_id).toBe(ORG_ID)
      expect(row.space_id).toBe(SPACE_ID)
      expect(row.dedupe_key).toBe(`github_pr_merged:${TASK_ID}:${PR_ID}`)
      expect(row.payload.task_id).toBe(TASK_ID)
      expect(row.payload.pr_url).toBe(prInfo.prUrl)
      expect(row.payload.pr_number).toBe(42)
      expect(row.payload.repo_full_name).toBe('yuta090/taskapp')
      expect(row.payload.title).toContain('ログイン画面の実装')
      expect(row.payload.message).toContain('yuta090/taskapp')
    }

    // タスクを更新していない・ボールを動かしていないこと
    expect(updateCalls).toEqual([])
  })

  it('status が done のタスクには通知しない', async () => {
    const tables = baseTables()
    tables.tasks[0].status = 'done'
    const { client, inserted } = createFakeSupabase(tables)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await notifyTasksForMergedPR(client as any, prInfo)

    expect(inserted['notifications'] || []).toHaveLength(0)
  })

  it('担当者・責任者が社外のみなら created_by に送る', async () => {
    const tables = baseTables()
    tables.tasks[0].assignee_id = CLIENT_USER
    tables.task_owners = [{ task_id: TASK_ID, side: 'internal', user_id: CLIENT_USER }]
    const { client, inserted } = createFakeSupabase(tables)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await notifyTasksForMergedPR(client as any, prInfo)

    const rows = inserted['notifications'] || []
    expect(rows).toHaveLength(1)
    expect(rows[0].to_user_id).toBe(CREATOR)
  })

  it('宛先が誰もいなければ通知を書かない（console.log のみ）', async () => {
    const tables = baseTables()
    tables.tasks[0].assignee_id = null
    tables.tasks[0].created_by = CLIENT_USER
    tables.task_owners = []
    tables.spaces = [{ id: SPACE_ID, default_reviewer_ids: [] }]
    const { client, inserted } = createFakeSupabase(tables)
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await notifyTasksForMergedPR(client as any, prInfo)

    expect(inserted['notifications'] || []).toHaveLength(0)
    expect(logSpy).toHaveBeenCalled()
    logSpy.mockRestore()
  })

  it('通知の失敗が例外として外へ漏れない', async () => {
    const { client } = createFakeSupabase(baseTables())
    client.from = vi.fn(() => {
      throw new Error('boom')
    })
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await expect(notifyTasksForMergedPR(client as any, prInfo)).resolves.toBeUndefined()

    errorSpy.mockRestore()
  })
})
