import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { GitHubPullRequestPayload } from './types'

/**
 * handlePullRequestEvent — PR が取り込まれた(closed+merged)ときだけ、
 * つなぎ漏れ拾い(linkPRToTasks)と社内通知(notifyTasksForMergedPR)を実行する。
 * merged=false の close・opened・edited では通知しない（既存の動きを変えない）。
 */

const ORG_ID = 'org-1'
const REPO_ROW_ID = 'repo-row-1'
const PR_ROW_ID = 'pr-row-1'

const linkPRToTasksMock = vi.fn(() => Promise.resolve({ linkedTasks: [] }))
const notifyTasksForMergedPRMock = vi.fn(() => Promise.resolve())

vi.mock('./task-linker', () => ({
  linkPRToTasks: linkPRToTasksMock,
}))

vi.mock('./merge-notify', () => ({
  notifyTasksForMergedPR: notifyTasksForMergedPRMock,
}))

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    from: vi.fn((table: string) => {
      if (table === 'github_installations') {
        return {
          select: () => ({
            eq: () => ({
              single: () => Promise.resolve({ data: { org_id: ORG_ID }, error: null }),
            }),
          }),
        }
      }
      if (table === 'github_repositories') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                single: () => Promise.resolve({ data: { id: REPO_ROW_ID }, error: null }),
              }),
            }),
          }),
        }
      }
      if (table === 'github_pull_requests') {
        return {
          upsert: () => ({
            select: () => ({
              single: () => Promise.resolve({ data: { id: PR_ROW_ID }, error: null }),
            }),
          }),
        }
      }
      return {}
    }),
  })),
}))

function makePayload(overrides: Partial<GitHubPullRequestPayload['pull_request']> & { action?: string }): GitHubPullRequestPayload {
  const { action, ...prOverrides } = overrides
  return {
    action: action ?? 'closed',
    number: 42,
    pull_request: {
      id: 999,
      number: 42,
      title: 'fix: login bug',
      html_url: 'https://github.com/yuta090/taskapp/pull/42',
      state: 'closed',
      merged: false,
      body: null,
      user: { login: 'yuta090', avatar_url: '' },
      head: { ref: 'fix/login' },
      base: {
        ref: 'main',
        repo: { id: 1, name: 'taskapp', full_name: 'yuta090/taskapp', owner: { login: 'yuta090' } },
      },
      additions: 1,
      deletions: 1,
      commits: 1,
      merged_at: null,
      closed_at: '2026-09-10T00:00:00.000Z',
      created_at: '2026-09-01T00:00:00.000Z',
      updated_at: '2026-09-10T00:00:00.000Z',
      ...prOverrides,
    },
    repository: { id: 1, name: 'taskapp', full_name: 'yuta090/taskapp', owner: { login: 'yuta090' } },
    installation: { id: 123 },
  }
}

async function load() {
  vi.resetModules()
  return await import('./handlers')
}

beforeEach(() => {
  vi.clearAllMocks()
  linkPRToTasksMock.mockResolvedValue({ linkedTasks: [] })
  notifyTasksForMergedPRMock.mockResolvedValue(undefined)
})

describe('handlePullRequestEvent', () => {
  it('closed + merged=true: linkPRToTasks と通知処理の両方が呼ばれる', async () => {
    const { handlePullRequestEvent } = await load()
    const payload = makePayload({ merged: true, state: 'closed', merged_at: '2026-09-10T00:00:00.000Z' })

    const result = await handlePullRequestEvent(payload)

    expect(result.success).toBe(true)
    expect(linkPRToTasksMock).toHaveBeenCalledTimes(1)
    expect(linkPRToTasksMock).toHaveBeenCalledWith(
      expect.anything(),
      ORG_ID,
      REPO_ROW_ID,
      PR_ROW_ID,
      'fix: login bug',
      null,
    )
    expect(notifyTasksForMergedPRMock).toHaveBeenCalledTimes(1)
    expect(notifyTasksForMergedPRMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        orgId: ORG_ID,
        prId: PR_ROW_ID,
        prNumber: 42,
        prTitle: 'fix: login bug',
        prUrl: 'https://github.com/yuta090/taskapp/pull/42',
        repoFullName: 'yuta090/taskapp',
      }),
    )
  })

  it('closed + merged=false: 通知処理は呼ばれない（取り込まれずに閉じただけ）', async () => {
    const { handlePullRequestEvent } = await load()
    const payload = makePayload({ merged: false, state: 'closed' })

    await handlePullRequestEvent(payload)

    expect(notifyTasksForMergedPRMock).not.toHaveBeenCalled()
  })

  it('opened: linkPRToTasks は呼ばれるが通知処理は呼ばれない（既存の動きを変えない）', async () => {
    const { handlePullRequestEvent } = await load()
    const payload = makePayload({ action: 'opened', state: 'open', merged: false })

    await handlePullRequestEvent(payload)

    expect(linkPRToTasksMock).toHaveBeenCalledTimes(1)
    expect(notifyTasksForMergedPRMock).not.toHaveBeenCalled()
  })

  it('edited: linkPRToTasks は呼ばれるが通知処理は呼ばれない', async () => {
    const { handlePullRequestEvent } = await load()
    const payload = makePayload({ action: 'edited', state: 'open', merged: false })

    await handlePullRequestEvent(payload)

    expect(linkPRToTasksMock).toHaveBeenCalledTimes(1)
    expect(notifyTasksForMergedPRMock).not.toHaveBeenCalled()
  })
})
