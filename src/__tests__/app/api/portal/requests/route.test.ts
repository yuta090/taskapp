import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * Regression tests for the audit-log/Slack-notify fire-and-forget fix:
 * an un-awaited write can be cut off once the response is sent (observed in
 * production: audit_logs stayed empty for portal requests). Both side effects
 * must be handed to next/server's after() so they run to completion even
 * after the response goes out.
 *
 * The mock only queues the callback (it does NOT run it immediately) so tests
 * can assert that side effects have not run yet at response time, and only
 * happen once the queued after() tasks are actually drained — a mock that
 * auto-invokes would pass even if the code called createAuditLog directly
 * instead of through after().
 */
const afterTasks: Array<() => unknown> = []
const mockAfter = vi.fn((task: () => unknown) => {
  afterTasks.push(task)
})
vi.mock('next/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/server')>()
  return { ...actual, after: (task: () => unknown) => mockAfter(task) }
})
/** Runs and clears every after() task queued so far, in the order they were registered. */
async function runAfterTasks() {
  const tasks = afterTasks.splice(0, afterTasks.length)
  for (const task of tasks) await task()
}

/** Builds a minimal (unsigned) JWT carrying only the claims checkAal2 reads. */
function jwt(payload: Record<string, unknown>) {
  const b64 = (s: string) => Buffer.from(s).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
  return `${b64('{"alg":"HS256"}')}.${b64(JSON.stringify(payload))}.sig`
}

// Mock data
const mockUser = { id: 'client-user-123' }
const mockMembership = {
  space_id: 'space-001',
  spaces: { id: 'space-001', org_id: 'org-001' },
}
const mockCreatedTask = { id: 'task-new-001' }

let authResponse: { data: { user: (typeof mockUser & { factors?: Array<{ status: string }> }) | null } }
/** JWT access token used by the session's getSession() (drives the aal claim). */
let sessionAccessToken: string | null = null
/** Rows returned by the space_memberships query (0, 1, or many — used to test S6-style multi-project accounts). */
let membershipsResponse: { data: (typeof mockMembership)[] | null; error: null | { message: string } }
/** The space_id each `.eq('space_id', ...)` call was made with, if any — asserts the request is scoped to the requested project. */
let membershipSpaceIdFilters: string[]
let spacesResponse: { data: { portal_visible_sections: unknown } | null; error: null | { message: string } }
/** The space_id each portal_visible_sections lookup (`spaces.eq('id', ...)`) was made with. */
let spacesIdFilters: string[]
let insertResponse: { data: typeof mockCreatedTask | null; error: null | { message: string } }
let insertCallArgs: Record<string, unknown> | undefined

// Mock audit log
vi.mock('@/lib/audit', () => ({
  createAuditLog: vi.fn(() => Promise.resolve()),
  generateAuditSummary: vi.fn(() => 'summary'),
}))

// Session client: only used to confirm who is acting (client membership +
// space) and whether the requests section is enabled — never to write.
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() => {
    return Promise.resolve({
      auth: {
        getUser: vi.fn(() => Promise.resolve(authResponse)),
        // 二要素認証ガード(mfaGuardResponse)が読む。既定は未登録相当（factors無し）。
        getSession: vi.fn(() =>
          Promise.resolve({
            data: { session: sessionAccessToken ? { access_token: sessionAccessToken } : null },
          })
        ),
      },
      from: vi.fn((table: string) => {
        if (table === 'space_memberships') {
          return {
            select: vi.fn(() => {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const builder: any = {}
              builder.eq = vi.fn((col: string, val: string) => {
                if (col === 'space_id') membershipSpaceIdFilters.push(val)
                return builder
              })
              builder.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
                Promise.resolve(membershipsResponse).then(resolve, reject)
              return builder
            }),
          }
        }
        if (table === 'spaces') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn((col: string, val: string) => {
                if (col === 'id') spacesIdFilters.push(val)
                return { single: vi.fn(() => Promise.resolve(spacesResponse)) }
              }),
            })),
          }
        }
        throw new Error(`Unexpected table on session client: ${table}`)
      }),
    })
  }),
}))

// Server-side (service role) client: performs the actual task creation, only
// after confirmation on the session client has passed.
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => ({
    from: vi.fn((table: string) => {
      if (table === 'tasks') {
        return {
          insert: vi.fn((args: Record<string, unknown>) => {
            insertCallArgs = args
            return {
              select: vi.fn(() => ({
                single: vi.fn(() => Promise.resolve(insertResponse)),
              })),
            }
          }),
        }
      }
      throw new Error(`Unexpected table on admin client: ${table}`)
    }),
  })),
}))

const { createAuditLog: createAuditLogMock } = await import('@/lib/audit')
const { POST } = await import('@/app/api/portal/requests/route')

function createRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest(new URL('/api/portal/requests', 'http://localhost:3000'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'user-agent': 'TestBrowser/1.0' },
    body: JSON.stringify(body),
  })
}

describe('POST /api/portal/requests', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    afterTasks.length = 0
    authResponse = { data: { user: mockUser } }
    sessionAccessToken = null
    membershipsResponse = { data: [mockMembership], error: null }
    membershipSpaceIdFilters = []
    spacesIdFilters = []
    spacesResponse = { data: { portal_visible_sections: null }, error: null }
    insertResponse = { data: mockCreatedTask, error: null }
    insertCallArgs = undefined
  })

  // --- Authentication ---

  it('should return 401 when not authenticated', async () => {
    authResponse = { data: { user: null } }
    const response = await POST(createRequest({ title: 'Test', category: 'feature', description: 'test' }))
    expect(response.status).toBe(401)
  })

  it('should return 403 when user has no client membership', async () => {
    membershipsResponse = { data: [], error: null }
    const response = await POST(createRequest({ title: 'Test', category: 'feature', description: 'test' }))
    expect(response.status).toBe(403)
  })

  // vendor（外部の協力会社アカウント）は相手先ではないため、リクエスト送信の
  // 起動元にはなれない。membership の検索が role='client' に絞られているので、
  // vendor では該当行が見つからず 403 になる。
  it('should return 403 for a vendor account (not a client membership)', async () => {
    membershipsResponse = { data: [], error: null }
    const response = await POST(createRequest({ title: 'Test', category: 'feature', description: 'test' }))
    expect(response.status).toBe(403)
    expect(insertCallArgs).toBeUndefined()
  })

  // --- Validation: common fields ---

  it('should return 400 when title is empty', async () => {
    const response = await POST(createRequest({ title: '', category: 'feature', description: 'test' }))
    const data = await response.json()
    expect(response.status).toBe(400)
    expect(data.error).toContain('タイトル')
  })

  it('should return 400 when title is missing', async () => {
    const response = await POST(createRequest({ category: 'feature', description: 'test' }))
    expect(response.status).toBe(400)
  })

  it('should return 400 when category is invalid', async () => {
    const response = await POST(createRequest({ title: 'Test', category: 'invalid', description: 'test' }))
    const data = await response.json()
    expect(response.status).toBe(400)
    expect(data.error).toContain('カテゴリ')
  })

  // --- Feature request ---

  it('should create a feature request successfully', async () => {
    const response = await POST(createRequest({
      title: 'CSV出力機能がほしい',
      category: 'feature',
      description: '月次報告用にCSVダウンロードしたい',
    }))
    const data = await response.json()
    expect(response.status).toBe(200)
    expect(data.success).toBe(true)
    expect(data.taskId).toBe('task-new-001')
  })

  it('should return 400 when feature request has no description', async () => {
    const response = await POST(createRequest({
      title: 'CSV出力機能がほしい',
      category: 'feature',
    }))
    const data = await response.json()
    expect(response.status).toBe(400)
    expect(data.error).toContain('機能の内容')
  })

  // --- Question ---

  it('should create a question successfully', async () => {
    const response = await POST(createRequest({
      title: '担当者の追加方法',
      category: 'question',
      description: 'クライアント側で担当者を追加できますか？',
    }))
    const data = await response.json()
    expect(response.status).toBe(200)
    expect(data.success).toBe(true)
  })

  it('should return 400 when question has no description', async () => {
    const response = await POST(createRequest({
      title: '担当者の追加方法',
      category: 'question',
    }))
    const data = await response.json()
    expect(response.status).toBe(400)
    expect(data.error).toContain('質問内容')
  })

  // --- Bug report ---

  it('should create a bug report with all required fields', async () => {
    const response = await POST(createRequest({
      title: 'ログイン画面でボタンが反応しない',
      category: 'bug',
      bugDetails: {
        screen: 'ログイン画面',
        steps: '1. メールアドレスを入力\n2. パスワードを入力\n3. ログインボタンを押す',
        actual: 'ボタンを押しても何も起きない',
        expected: 'ダッシュボードに遷移する',
        frequency: 'every_time',
      },
    }))
    const data = await response.json()
    expect(response.status).toBe(200)
    expect(data.success).toBe(true)
    expect(data.taskId).toBe('task-new-001')
  })

  it('should return 400 when bug report has no bugDetails', async () => {
    const response = await POST(createRequest({
      title: 'ボタンが動かない',
      category: 'bug',
    }))
    const data = await response.json()
    expect(response.status).toBe(400)
    expect(data.error).toContain('バグの詳細')
  })

  it('should return 400 when bug report screen is empty', async () => {
    const response = await POST(createRequest({
      title: 'ボタンが動かない',
      category: 'bug',
      bugDetails: {
        screen: '',
        steps: '手順',
        actual: '実際',
        expected: '期待',
        frequency: 'every_time',
      },
    }))
    const data = await response.json()
    expect(response.status).toBe(400)
    expect(data.error).toContain('発生した画面')
  })

  it('should return 400 when bug report steps is empty', async () => {
    const response = await POST(createRequest({
      title: 'ボタンが動かない',
      category: 'bug',
      bugDetails: {
        screen: 'ログイン',
        steps: '',
        actual: '実際',
        expected: '期待',
        frequency: 'every_time',
      },
    }))
    const data = await response.json()
    expect(response.status).toBe(400)
    expect(data.error).toContain('再現手順')
  })

  it('should return 400 when bug report actual is empty', async () => {
    const response = await POST(createRequest({
      title: 'ボタンが動かない',
      category: 'bug',
      bugDetails: {
        screen: 'ログイン',
        steps: '手順',
        actual: '',
        expected: '期待',
        frequency: 'every_time',
      },
    }))
    const data = await response.json()
    expect(response.status).toBe(400)
    expect(data.error).toContain('実際に起きたこと')
  })

  it('should return 400 when bug report expected is empty', async () => {
    const response = await POST(createRequest({
      title: 'ボタンが動かない',
      category: 'bug',
      bugDetails: {
        screen: 'ログイン',
        steps: '手順',
        actual: '実際',
        expected: '',
        frequency: 'every_time',
      },
    }))
    const data = await response.json()
    expect(response.status).toBe(400)
    expect(data.error).toContain('期待する動作')
  })

  it('should return 400 when bug report frequency is invalid', async () => {
    const response = await POST(createRequest({
      title: 'ボタンが動かない',
      category: 'bug',
      bugDetails: {
        screen: 'ログイン',
        steps: '手順',
        actual: '実際',
        expected: '期待',
        frequency: 'invalid',
      },
    }))
    const data = await response.json()
    expect(response.status).toBe(400)
    expect(data.error).toContain('発生頻度')
  })

  it('should include optional note in bug report', async () => {
    const response = await POST(createRequest({
      title: '表示崩れ',
      category: 'bug',
      description: 'Safariでのみ発生する模様',
      bugDetails: {
        screen: 'ダッシュボード',
        steps: '1. ダッシュボードを開く',
        actual: 'レイアウトが崩れる',
        expected: '正常に表示される',
        frequency: 'sometimes',
      },
    }))
    const data = await response.json()
    expect(response.status).toBe(200)
    expect(data.success).toBe(true)
  })

  // --- Error handling ---

  it('should return 500 when task insert fails', async () => {
    insertResponse = { data: null, error: { message: 'DB error' } }
    const response = await POST(createRequest({
      title: 'CSV出力',
      category: 'feature',
      description: '内容',
    }))
    const data = await response.json()
    expect(response.status).toBe(500)
    expect(data.error).toContain('リクエストの送信に失敗')
  })

  // --- Regression: created_by NOT NULL constraint (23502) ---
  // POST /api/portal/requests previously omitted `created_by` on the tasks
  // INSERT, which violates the NOT NULL constraint on `tasks.created_by`
  // and causes a 500 that silently drops the client's submitted request.
  it('should set created_by to the authenticated user id on task insert', async () => {
    const response = await POST(createRequest({
      title: 'CSV出力機能がほしい',
      category: 'feature',
      description: '月次報告用にCSVダウンロードしたい',
    }))
    expect(response.status).toBe(200)
    expect(insertCallArgs).toBeDefined()
    expect(insertCallArgs?.created_by).toBe(mockUser.id)
  })

  // --- Regression: tasks_status_check constraint (23514) ---
  // The tasks table only allows backlog/todo/in_progress/in_review/done/
  // considering; inserting status='open' violates the CHECK constraint and
  // 500s, silently dropping the client's request.
  it('should insert a status allowed by the tasks_status_check constraint', async () => {
    const allowed = ['backlog', 'todo', 'in_progress', 'in_review', 'done', 'considering']
    const response = await POST(createRequest({
      title: 'CSV出力機能がほしい',
      category: 'feature',
      description: '月次報告用にCSVダウンロードしたい',
    }))
    expect(response.status).toBe(200)
    expect(allowed).toContain(insertCallArgs?.status)
  })

  // --- Confirm on session, write on server ---

  it('writes the new task through the server-side client, with space_id fixed to the confirmed membership', async () => {
    const response = await POST(createRequest({
      title: 'CSV出力機能がほしい',
      category: 'feature',
      description: '月次報告用にCSVダウンロードしたい',
    }))
    expect(response.status).toBe(200)
    expect(insertCallArgs).toMatchObject({
      space_id: mockMembership.space_id,
      org_id: mockMembership.spaces.org_id,
      origin: 'client',
      ball: 'internal',
      client_scope: 'deliverable',
    })
  })

  it('never reaches the server-side write when the user has no client membership', async () => {
    membershipsResponse = { data: [], error: null }
    const response = await POST(createRequest({ title: 'Test', category: 'feature', description: 'test' }))
    expect(response.status).toBe(403)
    expect(insertCallArgs).toBeUndefined()
  })

  it('二要素認証が登録済み×コード未入力(aal1)なら止め、admin の書き込みは0回', async () => {
    authResponse = { data: { user: { ...mockUser, factors: [{ status: 'verified' }] } } }
    sessionAccessToken = jwt({ aal: 'aal1' })

    const response = await POST(createRequest({ title: 'Test', category: 'feature', description: 'test' }))

    expect(response.status).toBe(403)
    expect(insertCallArgs).toBeUndefined()
  })

  it('リクエスト送信の表示区分が無効なときは INSERT しない', async () => {
    spacesResponse = { data: { portal_visible_sections: { requests: false } }, error: null }

    const response = await POST(createRequest({ title: 'Test', category: 'feature', description: 'test' }))
    const data = await response.json()

    expect(response.status).toBe(403)
    expect(data.error).toContain('無効')
    expect(insertCallArgs).toBeUndefined()
  })

  it('表示区分の読み取りに失敗したときも、フェイルクローズで INSERT しない', async () => {
    spacesResponse = { data: null, error: { message: 'db error' } }

    const response = await POST(createRequest({ title: 'Test', category: 'feature', description: 'test' }))

    expect(response.status).toBe(403)
    expect(insertCallArgs).toBeUndefined()
  })

  it('body に space_id/org_id/ball/client_scope/created_by を混ぜても、確認済みの値で上書きする', async () => {
    const response = await POST(createRequest({
      title: 'CSV出力機能がほしい',
      category: 'feature',
      description: '月次報告用にCSVダウンロードしたい',
      space_id: 'attacker-space',
      org_id: 'attacker-org',
      ball: 'client',
      client_scope: 'internal',
      created_by: 'someone-else',
    }))

    expect(response.status).toBe(200)
    expect(insertCallArgs).toMatchObject({
      space_id: mockMembership.space_id,
      org_id: mockMembership.spaces.org_id,
      ball: 'internal',
      client_scope: 'deliverable',
      created_by: mockUser.id,
    })
  })

  // --- Regression: creating in the project the screen was actually showing ---
  // Previously the membership lookup ignored which project the screen showed
  // and always used an unordered `.limit(1)`, so a client with more than one
  // project could have the request land on the wrong one.
  describe('画面が見ていたプロジェクト(spaceId)を尊重する', () => {
    const OTHER_SPACE_ID = '11111111-1111-1111-1111-111111111111'
    const FOREIGN_SPACE_ID = '22222222-2222-2222-2222-222222222222'
    const otherMembership = {
      space_id: OTHER_SPACE_ID,
      spaces: { id: OTHER_SPACE_ID, org_id: 'org-002' },
    }

    it('spaceId を指定すると、その space への client membership を確認したうえでそこに作る', async () => {
      membershipsResponse = { data: [otherMembership], error: null }

      const response = await POST(createRequest({
        title: 'CSV出力機能がほしい',
        category: 'feature',
        description: '月次報告用にCSVダウンロードしたい',
        spaceId: OTHER_SPACE_ID,
      }))

      expect(response.status).toBe(200)
      expect(membershipSpaceIdFilters).toContain(OTHER_SPACE_ID)
      expect(insertCallArgs).toMatchObject({
        space_id: OTHER_SPACE_ID,
        org_id: 'org-002',
      })
    })

    it('所属していない space を spaceId に指定すると 403 で、INSERT は0回', async () => {
      membershipsResponse = { data: [], error: null }

      const response = await POST(createRequest({
        title: 'CSV出力機能がほしい',
        category: 'feature',
        description: '月次報告用にCSVダウンロードしたい',
        spaceId: FOREIGN_SPACE_ID,
      }))
      const data = await response.json()

      expect(response.status).toBe(403)
      expect(data.error).toContain('アクセス権限')
      expect(insertCallArgs).toBeUndefined()
      expect(mockAfter).not.toHaveBeenCalled()
    })

    // Postgres の space_id 列は uuid 型なので、形が違う値をそのまま渡すと
    // クエリが uuid のパースエラーで落ちて 500 になってしまう。API 側で
    // 事前に形を確かめ、明確な 400 として弾く。
    it('spaceId が文字列でなければ 400 で、membership クエリは投げない', async () => {
      const response = await POST(createRequest({
        title: 'CSV出力機能がほしい',
        category: 'feature',
        description: '月次報告用にCSVダウンロードしたい',
        spaceId: 12345,
      }))
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toBeTruthy()
      expect(membershipSpaceIdFilters).toHaveLength(0)
      expect(insertCallArgs).toBeUndefined()
      expect(mockAfter).not.toHaveBeenCalled()
    })

    it('spaceId が UUID の形でなければ 400 で、membership クエリは投げない', async () => {
      const response = await POST(createRequest({
        title: 'CSV出力機能がほしい',
        category: 'feature',
        description: '月次報告用にCSVダウンロードしたい',
        spaceId: 'not-a-uuid',
      }))
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toBeTruthy()
      expect(membershipSpaceIdFilters).toHaveLength(0)
      expect(insertCallArgs).toBeUndefined()
      expect(mockAfter).not.toHaveBeenCalled()
    })

    it('spaceId を指定せず、複数の client membership に属している場合は 400 で、INSERT は0回', async () => {
      membershipsResponse = { data: [mockMembership, otherMembership], error: null }

      const response = await POST(createRequest({
        title: 'CSV出力機能がほしい',
        category: 'feature',
        description: '月次報告用にCSVダウンロードしたい',
      }))
      const data = await response.json()

      expect(response.status).toBe(400)
      // シートにプロジェクトを選ぶ場所が無いので、打つ手がある文言（再読み込みして
      // 再送信）にする。「対象のプロジェクトを指定してください」は選択肢が無く詰む。
      expect(data.error).toContain('再読み込み')
      expect(insertCallArgs).toBeUndefined()
      expect(mockAfter).not.toHaveBeenCalled()
    })

    it('spaceId を指定せず、client membership が1件だけならこれまでどおりそこに作る', async () => {
      const response = await POST(createRequest({
        title: 'CSV出力機能がほしい',
        category: 'feature',
        description: '月次報告用にCSVダウンロードしたい',
      }))

      expect(response.status).toBe(200)
      expect(insertCallArgs).toMatchObject({
        space_id: mockMembership.space_id,
        org_id: mockMembership.spaces.org_id,
      })
    })

    // 表示区分（portal_visible_sections）の確認は、確認済みの membership が
    // 指すプロジェクト（= 指定した spaceId）について行う。別のプロジェクトの
    // 設定を見てしまうと、無効化されているはずのプロジェクトでも作成できてしまう。
    it('表示区分の確認は、指定した spaceId について行う', async () => {
      membershipsResponse = { data: [otherMembership], error: null }
      spacesResponse = { data: { portal_visible_sections: { requests: false } }, error: null }

      const response = await POST(createRequest({
        title: 'CSV出力機能がほしい',
        category: 'feature',
        description: '月次報告用にCSVダウンロードしたい',
        spaceId: OTHER_SPACE_ID,
      }))
      const data = await response.json()

      expect(response.status).toBe(403)
      expect(data.error).toContain('無効')
      expect(spacesIdFilters).toEqual([OTHER_SPACE_ID])
      expect(insertCallArgs).toBeUndefined()
      expect(mockAfter).not.toHaveBeenCalled()
    })
  })

  // 監査ログ・Slack通知は応答を返したあとも確実に実行されるよう after() に回す
  // （await しない書き込みは Vercel 上で応答送出後に打ち切られることがある —
  // 本番で「依頼を作っても audit_logs が0件」という形で確認された不具合の回帰テスト）。
  it('応答時点ではまだ実行されず、after() のタスクを実行して初めて監査ログが記録される', async () => {
    const response = await POST(createRequest({
      title: 'CSV出力機能がほしい',
      category: 'feature',
      description: '月次報告用にCSVダウンロードしたい',
    }))

    expect(response.status).toBe(200)
    // 応答が返った時点では、まだキューに積まれているだけで実行されていない
    // （直接 createAuditLog を呼ぶ実装に戻っても検知できるよう、ここで確認する）。
    expect(mockAfter).toHaveBeenCalledTimes(2)
    expect(createAuditLogMock).not.toHaveBeenCalled()

    await runAfterTasks()

    expect(createAuditLogMock).toHaveBeenCalledTimes(1)
    expect(createAuditLogMock).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: mockMembership.spaces.org_id,
        spaceId: mockMembership.space_id,
        actorId: mockUser.id,
        eventType: 'task.created',
      })
    )
  })

  // 403/400 で終わる経路（membership なし・表示区分オフ・space未指定で複数所属）は
  // タスクを作っていないので、after() の副作用も一切登録してはいけない。
  it('membership が無く 403 のときは after() を呼ばない', async () => {
    membershipsResponse = { data: [], error: null }

    const response = await POST(createRequest({ title: 'Test', category: 'feature', description: 'test' }))

    expect(response.status).toBe(403)
    expect(mockAfter).not.toHaveBeenCalled()
  })

  it('spaceId 未指定で複数所属のため 400 のときは after() を呼ばない', async () => {
    const otherMembership = { space_id: 'space-002', spaces: { id: 'space-002', org_id: 'org-002' } }
    membershipsResponse = { data: [mockMembership, otherMembership], error: null }

    const response = await POST(createRequest({ title: 'Test', category: 'feature', description: 'test' }))

    expect(response.status).toBe(400)
    expect(mockAfter).not.toHaveBeenCalled()
  })
})
