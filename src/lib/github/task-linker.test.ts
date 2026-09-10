import { describe, it, expect, vi, beforeEach } from 'vitest'
import { linkIssueToTasks } from './task-linker'

/**
 * linkIssueToTasks — Issue のタイトル・本文から TP-番号を拾い、その space が
 * このリポジトリと紐づいている（space_github_repos）タスクだけへ auto で紐づける
 * （GITHUB_ISSUES_LINK_SPEC.md §7.2・§9 PR1）。
 *
 * 紐づけの insert は「1回の依頼につき1つの文」にする（migration 20260911002110 の
 * task_id 順ロックの前提。行ごとに別の insert を投げない）。
 */

const ORG_ID = 'org-1'
const REPO_ID = 'repo-row-1'
const ISSUE_ID = 'issue-row-1'

type TaskRow = { id: string; space_id: string }

let tasksByShortId: Record<number, TaskRow | null>
let spaceReposBySpace: Record<string, boolean>
let upsertError: { code?: string; message: string } | null

const upsertMock = vi.fn((_rows: unknown[], _opts: unknown) => Promise.resolve({ error: upsertError }))

function makeSupabase() {
  return {
    from: vi.fn((table: string) => {
      if (table === 'tasks') {
        return {
          select: () => ({
            eq: () => ({
              eq: (_col: string, shortId: number) => ({
                single: () => Promise.resolve({ data: tasksByShortId[shortId] ?? null, error: null }),
              }),
            }),
          }),
        }
      }
      if (table === 'space_github_repos') {
        return {
          select: () => ({
            eq: (_col: string, spaceId: string) => ({
              eq: () => ({
                single: () =>
                  Promise.resolve(
                    spaceReposBySpace[spaceId]
                      ? { data: { id: 'space-repo-1' }, error: null }
                      : { data: null, error: null }
                  ),
              }),
            }),
          }),
        }
      }
      if (table === 'task_github_issue_links') {
        return { upsert: upsertMock }
      }
      return {}
    }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any
}

beforeEach(() => {
  tasksByShortId = {}
  spaceReposBySpace = {}
  upsertError = null
  upsertMock.mockClear()
})

describe('linkIssueToTasks', () => {
  it('TP-番号が本文になければ何もしない（upsert は呼ばれない）', async () => {
    const supabase = makeSupabase()

    const result = await linkIssueToTasks(supabase, ORG_ID, REPO_ID, ISSUE_ID, 'ログインできない', null)

    expect(result.linkedTasks).toEqual([])
    expect(upsertMock).not.toHaveBeenCalled()
  })

  it('space が repo と紐づいていれば、1回の upsert で auto 紐づけを入れる', async () => {
    tasksByShortId[42] = { id: 'task-42', space_id: 'space-1' }
    spaceReposBySpace['space-1'] = true
    const supabase = makeSupabase()

    const result = await linkIssueToTasks(supabase, ORG_ID, REPO_ID, ISSUE_ID, 'TP-42 のバグ', null)

    expect(result.linkedTasks).toEqual(['TP-42'])
    expect(upsertMock).toHaveBeenCalledTimes(1)
    expect(upsertMock).toHaveBeenCalledWith(
      [{ org_id: ORG_ID, task_id: 'task-42', github_issue_id: ISSUE_ID, link_type: 'auto' }],
      expect.objectContaining({ onConflict: 'task_id,github_issue_id', ignoreDuplicates: true })
    )
  })

  it('space が repo と紐づいていなければ紐づけない（upsert は呼ばれない）', async () => {
    tasksByShortId[42] = { id: 'task-42', space_id: 'space-1' }
    spaceReposBySpace['space-1'] = false
    const supabase = makeSupabase()

    const result = await linkIssueToTasks(supabase, ORG_ID, REPO_ID, ISSUE_ID, 'TP-42 のバグ', null)

    expect(result.linkedTasks).toEqual([])
    expect(upsertMock).not.toHaveBeenCalled()
  })

  it('該当タスクが見つからなければ紐づけない', async () => {
    tasksByShortId[999] = null
    const supabase = makeSupabase()

    const result = await linkIssueToTasks(supabase, ORG_ID, REPO_ID, ISSUE_ID, 'TP-999 の件', null)

    expect(result.linkedTasks).toEqual([])
    expect(upsertMock).not.toHaveBeenCalled()
  })

  it('複数タスクが対象でも upsert は1回だけ（1つの文）呼ばれる', async () => {
    tasksByShortId[1] = { id: 'task-1', space_id: 'space-1' }
    tasksByShortId[2] = { id: 'task-2', space_id: 'space-2' }
    spaceReposBySpace['space-1'] = true
    spaceReposBySpace['space-2'] = true
    const supabase = makeSupabase()

    const result = await linkIssueToTasks(
      supabase,
      ORG_ID,
      REPO_ID,
      ISSUE_ID,
      'TP-1 と TP-2 をまとめて対応',
      null
    )

    expect(result.linkedTasks.sort()).toEqual(['TP-1', 'TP-2'])
    expect(upsertMock).toHaveBeenCalledTimes(1)
    const [rows] = upsertMock.mock.calls[0]
    expect(rows).toHaveLength(2)
  })

  it('upsert が失敗したら空を返す', async () => {
    tasksByShortId[42] = { id: 'task-42', space_id: 'space-1' }
    spaceReposBySpace['space-1'] = true
    upsertError = { message: 'boom' }
    const supabase = makeSupabase()

    const result = await linkIssueToTasks(supabase, ORG_ID, REPO_ID, ISSUE_ID, 'TP-42 のバグ', null)

    expect(result.linkedTasks).toEqual([])
  })
})
