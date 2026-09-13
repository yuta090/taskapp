import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * `/portal/task/[taskId]` — 相手先ポータルのタスク詳細ページ。
 *
 * 開くときの読み込みが「本人確認 → タスク取得 → 見えるかの確認 → コメント取得 →
 * 他プロジェクト取得」の5段直列になっていた。互いの結果を使わない3つの読み込み
 * （タスク・コメント・他プロジェクト一覧）は Promise.all で同時に読み、
 * 「本人確認」「見えるかの確認（メンバーシップ）」という判断が要る2箇所だけ
 * 順番を保つ。
 */

const mockUser = { id: 'client-user-1' }

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

let authResponse: { data: { user: typeof mockUser | null } }
let membershipResponse: { data: { id: string; role: string } | null }
let taskDeferred: Deferred<{ data: unknown; error: unknown }>
let commentsDeferred: Deferred<{ data: unknown; error: unknown }>
let projectsDeferred: Deferred<unknown>
let profilesResponse: { data: Array<{ id: string; display_name: string | null }> }
let callLog: string[]
let membershipEqArgs: unknown[][]

class RedirectSignal extends Error {
  constructor(public destination: string) {
    super('NEXT_REDIRECT')
  }
}
class NotFoundSignal extends Error {
  constructor() {
    super('NEXT_NOT_FOUND')
  }
}

const redirectMock = vi.fn((destination: string) => {
  throw new RedirectSignal(destination)
})
const notFoundMock = vi.fn(() => {
  throw new NotFoundSignal()
})

vi.mock('next/navigation', () => ({
  redirect: (destination: string) => redirectMock(destination),
  notFound: () => notFoundMock(),
}))

const getClientProjectsMock = vi.fn((..._args: unknown[]) => {
  callLog.push('projects-start')
  return projectsDeferred.promise
})
vi.mock('@/lib/portal/getClientProjects', () => ({
  getClientProjects: (...args: unknown[]) => getClientProjectsMock(...args),
}))

vi.mock('@/app/portal/task/[taskId]/PortalTaskDetailClient', () => ({
  PortalTaskDetailClient: (props: { task: { title: string } }) => (
    <div data-testid="portal-task-detail-client">{props.task.title}</div>
  ),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() =>
    Promise.resolve({
      auth: {
        getUser: vi.fn(() => Promise.resolve(authResponse)),
      },
      from: vi.fn((table: string) => {
        if (table === 'tasks') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                single: vi.fn(() => {
                  callLog.push('task-start')
                  return taskDeferred.promise
                }),
              })),
            })),
          }
        }
        if (table === 'task_comments') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() => ({
                  is: vi.fn(() => ({
                    order: vi.fn(() => {
                      callLog.push('comments-start')
                      return commentsDeferred.promise
                    }),
                  })),
                })),
              })),
            })),
          }
        }
        if (table === 'space_memberships') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn((...args: unknown[]) => {
                membershipEqArgs.push(args)
                return {
                  eq: vi.fn((...args2: unknown[]) => {
                    membershipEqArgs.push(args2)
                    return {
                      eq: vi.fn((...args3: unknown[]) => {
                        membershipEqArgs.push(args3)
                        return {
                          single: vi.fn(() => {
                            callLog.push('membership-start')
                            return Promise.resolve(membershipResponse)
                          }),
                        }
                      }),
                    }
                  }),
                }
              }),
            })),
          }
        }
        if (table === 'profiles') {
          return {
            select: vi.fn(() => ({
              in: vi.fn(() => {
                callLog.push('profiles-start')
                return Promise.resolve(profilesResponse)
              }),
            })),
          }
        }
        throw new Error(`Unexpected table: ${table}`)
      }),
    })
  ),
}))

const { default: PortalTaskDetailPage } = await import('@/app/portal/task/[taskId]/page')

function renderPage() {
  return PortalTaskDetailPage({ params: Promise.resolve({ taskId: 'task-1' }) })
}

const taskRow = {
  id: 'task-1',
  title: 'タイトル',
  description: null,
  status: 'todo',
  ball: 'client',
  type: 'task',
  due_date: null,
  spec_path: null,
  decision_state: null,
  created_at: '2026-01-01T00:00:00',
  updated_at: '2026-01-01T00:00:00',
  space_id: 'space-1',
}

describe('PortalTaskDetailPage loading order', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    callLog = []
    membershipEqArgs = []
    authResponse = { data: { user: mockUser } }
    membershipResponse = { data: { id: 'membership-1', role: 'client' } }
    taskDeferred = createDeferred()
    commentsDeferred = createDeferred()
    projectsDeferred = createDeferred()
    profilesResponse = { data: [] }
  })

  it('starts the task/comments/projects reads together, without waiting on each other', async () => {
    const renderPromise = renderPage()

    // Wait until each independent read has actually *started*, rather than
    // guessing how many microtask flushes that takes. If the code goes back
    // to being sequential, none of the deferreds below are resolved yet, so
    // a later read that only fires after an earlier one resolves will never
    // show up in callLog and this properly times out (fails) instead of
    // silently passing.
    await vi.waitFor(() => expect(callLog).toContain('task-start'))
    await vi.waitFor(() => expect(callLog).toContain('comments-start'))
    await vi.waitFor(() => expect(callLog).toContain('projects-start'))
    // 見えるかの確認は task の結果（space_id）が要るので、まだ呼ばれていない
    expect(callLog).not.toContain('membership-start')

    taskDeferred.resolve({ data: taskRow, error: null })
    commentsDeferred.resolve({ data: [], error: null })
    projectsDeferred.resolve([{ id: 'space-1', name: 'プロジェクト', orgId: 'org-1' }])

    const result = await renderPromise
    expect(result).toBeTruthy()
    expect(callLog).toContain('membership-start')
    // space_id → user_id → role の順で、正しい値が渡っている
    expect(membershipEqArgs).toEqual([
      ['space_id', taskRow.space_id],
      ['user_id', mockUser.id],
      ['role', 'client'],
    ])
  })

  it('redirects unauthenticated visitors before starting any reads', async () => {
    authResponse = { data: { user: null } }

    await expect(renderPage()).rejects.toBeInstanceOf(RedirectSignal)
    expect(redirectMock).toHaveBeenCalledWith('/login')
    expect(callLog).toEqual([])
  })

  it('returns notFound when the task does not exist, without checking membership', async () => {
    const renderPromise = renderPage()
    await Promise.resolve()
    await Promise.resolve()

    taskDeferred.resolve({ data: null, error: { message: 'not found' } })
    commentsDeferred.resolve({ data: [], error: null })
    projectsDeferred.resolve([])

    await expect(renderPromise).rejects.toBeInstanceOf(NotFoundSignal)
    expect(callLog).not.toContain('membership-start')
  })

  it('returns notFound when the user is not a client member of the task space', async () => {
    membershipResponse = { data: null }
    const renderPromise = renderPage()
    await Promise.resolve()
    await Promise.resolve()

    taskDeferred.resolve({ data: taskRow, error: null })
    commentsDeferred.resolve({ data: [], error: null })
    projectsDeferred.resolve([])

    await expect(renderPromise).rejects.toBeInstanceOf(NotFoundSignal)
    expect(callLog).toContain('membership-start')
  })

  // DB 側で他の人のプロフィールを読める範囲を「一緒に仕事をしている人」に絞る変更が
  // 入っても、コメントの書き手が読めないときにこのページは正しく表示すること
  it('書き手のプロフィールが読めないコメントは、分かる一語で表示する', async () => {
    const renderPromise = renderPage()
    await Promise.resolve()
    await Promise.resolve()

    taskDeferred.resolve({ data: taskRow, error: null })
    commentsDeferred.resolve({
      data: [
        { id: 'c1', body: 'こんにちは', created_at: '2026-01-01T00:00:00', actor_id: 'ghost-1' },
      ],
      error: null,
    })
    projectsDeferred.resolve([])
    // profiles側のRLSで読めない想定(該当行が返らない)
    profilesResponse = { data: [] }

    const result = await renderPromise

    expect((result as { props: { comments: Array<{ author: string }> } }).props.comments).toEqual([
      expect.objectContaining({ author: '（メンバー外）' }),
    ])
  })

  // task_comments→profilesの外部キーが無いため埋め込みは使えない。別問い合わせで
  // 引いたprofilesから正しく名前を突き合わせられること
  it('コメントの書き手の表示名を、別問い合わせで引いたprofilesから突き合わせる', async () => {
    const renderPromise = renderPage()
    await Promise.resolve()
    await Promise.resolve()

    taskDeferred.resolve({ data: taskRow, error: null })
    commentsDeferred.resolve({
      data: [
        { id: 'c1', body: 'こんにちは', created_at: '2026-01-01T00:00:00', actor_id: 'user-1' },
      ],
      error: null,
    })
    projectsDeferred.resolve([])
    profilesResponse = { data: [{ id: 'user-1', display_name: '太郎' }] }

    const result = await renderPromise

    expect((result as { props: { comments: Array<{ author: string }> } }).props.comments).toEqual([
      expect.objectContaining({ author: '太郎' }),
    ])
    expect(callLog).toContain('profiles-start')
  })
})
