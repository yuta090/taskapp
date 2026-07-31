import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * GET /api/integrations/connections/[id]/containers?org_id=...
 *
 * 取り込み対象に選べる入れ物（Notion=データベース、Backlog=プロジェクト等）を一覧する
 * provider非依存のエンドポイント。ここで固定したい境界:
 *   - owner/adminのみ(requireOrgAdmin)
 *   - connection_id は org_id 境界付きで引く(他orgの接続は絶対に引けない・provider不問)
 *   - アダプタが無い provider は 400
 *   - トークン・応答本文は一切返さない/ログに出さない
 *   - 401=失効(409+再接続導線) / 403=アクセス権無し(400) / その他一時障害=502 に写像する
 *   - import_config.read_container_ids を selected_container_ids として一緒に返す
 */

const getUserMock = vi.fn()
const membershipSingleMock = vi.fn()
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: getUserMock },
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          eq: vi.fn(() => ({ single: membershipSingleMock })),
        })),
      })),
    })),
  })),
}))

const connectionResultMock = vi.fn()
/** findConnection が積んだ .eq() 呼び出しの引数を全て記録する(境界の直接検証に使う)。 */
let connectionEqCalls: Array<[string, unknown]> = []
function makeConnectionSelectChain() {
  const chain: Record<string, unknown> = {}
  Object.assign(chain, {
    eq: vi.fn((...args: [string, unknown]) => {
      connectionEqCalls.push(args)
      return chain
    }),
    maybeSingle: vi.fn(() => Promise.resolve(connectionResultMock())),
  })
  return chain
}
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: vi.fn(() => ({ select: vi.fn(() => makeConnectionSelectChain()) })),
  }),
}))

const resolveCredentialsMock = vi.fn()
vi.mock('@/lib/task-sync/credentials', () => ({
  resolveCredentials: (...args: unknown[]) => resolveCredentialsMock(...args),
}))

const getTaskSyncAdapterMock = vi.fn()
vi.mock('@/lib/task-sync/adapters', () => ({
  getTaskSyncAdapter: (...args: unknown[]) => getTaskSyncAdapterMock(...args),
}))

const getValidTokenDetailedMock = vi.fn()
vi.mock('@/lib/integrations/token-manager', () => ({
  getValidTokenDetailed: (...args: unknown[]) => getValidTokenDetailedMock(...args),
}))
vi.mock('@/lib/google-calendar/client', () => ({ refreshAccessToken: vi.fn() }))
const listTaskListsMock = vi.fn()
vi.mock('@/lib/google-tasks/client', () => ({
  listTaskLists: (...args: unknown[]) => listTaskListsMock(...args),
}))

const { GET } = await import('@/app/api/integrations/connections/[id]/containers/route')

const ORG_ID = '11111111-1111-4111-8111-111111111111'
const CONNECTION_ID = '22222222-2222-4222-8222-222222222222'

function callGet(connectionId: string, orgId: string | null) {
  const url = new URL(`http://localhost:3000/api/integrations/connections/${connectionId}/containers`)
  if (orgId !== null) url.searchParams.set('org_id', orgId)
  const request = new NextRequest(url)
  return GET(request, { params: Promise.resolve({ id: connectionId }) })
}

const listContainersMock = vi.fn()

function adapter(over: Record<string, unknown> = {}) {
  return {
    id: 'notion',
    authKind: 'oauth',
    hostPolicy: { kind: 'fixed', host: 'api.notion.com' },
    listContainers: listContainersMock,
    ...over,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  connectionEqCalls = []
  getUserMock.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
  membershipSingleMock.mockResolvedValue({ data: { role: 'owner' }, error: null })
  connectionResultMock.mockReturnValue({
    data: {
      id: CONNECTION_ID,
      org_id: ORG_ID,
      provider: 'notion',
      auth_kind: 'oauth',
      access_token_encrypted: 'enc',
      import_config: { read_container_ids: ['db-1'] },
    },
    error: null,
  })
  resolveCredentialsMock.mockResolvedValue({ status: 'ok', credentials: { kind: 'oauth', token: 'secret-token' } })
  getTaskSyncAdapterMock.mockReturnValue(adapter())
  listContainersMock.mockResolvedValue([
    { id: 'db-1', title: 'タスク一覧' },
    { id: 'db-2', title: '議事録' },
  ])
})

describe('GET /api/integrations/connections/[id]/containers', () => {
  it('400 for an invalid connection id', async () => {
    const response = await callGet('not-a-uuid', ORG_ID)
    expect(response.status).toBe(400)
  })

  it('400 for a missing org_id query param', async () => {
    const response = await callGet(CONNECTION_ID, null)
    expect(response.status).toBe(400)
  })

  it('400 for an invalid org_id query param', async () => {
    const response = await callGet(CONNECTION_ID, 'not-a-uuid')
    expect(response.status).toBe(400)
  })

  it('401 when unauthenticated', async () => {
    getUserMock.mockResolvedValue({ data: { user: null }, error: null })
    const response = await callGet(CONNECTION_ID, ORG_ID)
    expect(response.status).toBe(401)
  })

  it('403 for members (owner/admin only)', async () => {
    membershipSingleMock.mockResolvedValue({ data: { role: 'member' }, error: null })
    const response = await callGet(CONNECTION_ID, ORG_ID)
    expect(response.status).toBe(403)
  })

  it('404 when the connection does not belong to the requesting org (cross-org access is impossible)', async () => {
    connectionResultMock.mockReturnValue({ data: null, error: null })
    const response = await callGet(CONNECTION_ID, ORG_ID)
    expect(response.status).toBe(404)
  })

  /**
   * ⚠ IDORテストが空振りしないための直接検証(認可境界)。上のテストはモックが常に同じ結果を
   * 返すため、実装から `.eq('org_id', ...)` を消してもテスト自体は通ってしまう(空振り)。
   * ここでは .eq() 呼び出しの実引数を記録して、id・org_idの2条件で絞っていることを直接assertする。
   */
  it('findConnectionはid・org_idの2条件で.eq()を呼ぶ(認可境界の直接検証)', async () => {
    await callGet(CONNECTION_ID, ORG_ID)
    const calledKeys = connectionEqCalls.map(([key]) => key)
    expect(calledKeys).toContain('id')
    expect(calledKeys).toContain('org_id')
    expect(connectionEqCalls).toContainEqual(['id', CONNECTION_ID])
    expect(connectionEqCalls).toContainEqual(['org_id', ORG_ID])
  })

  it('400 when the provider has no adapter implementation', async () => {
    connectionResultMock.mockReturnValue({
      data: { id: CONNECTION_ID, org_id: ORG_ID, provider: 'wrike', auth_kind: 'api_key', import_config: {} },
      error: null,
    })
    getTaskSyncAdapterMock.mockReturnValue(null)
    const response = await callGet(CONNECTION_ID, ORG_ID)
    expect(response.status).toBe(400)
    expect(listContainersMock).not.toHaveBeenCalled()
  })

  it('422 when credentials are misconfigured', async () => {
    resolveCredentialsMock.mockResolvedValue({ status: 'misconfigured', reason: 'api_key is missing' })
    const response = await callGet(CONNECTION_ID, ORG_ID)
    expect(response.status).toBe(422)
  })

  it('409 when credentials are auth_failed (needs reconnect)', async () => {
    resolveCredentialsMock.mockResolvedValue({ status: 'auth_failed' })
    const response = await callGet(CONNECTION_ID, ORG_ID)
    expect(response.status).toBe(409)
    expect((await response.json()).error).toContain('再接続')
  })

  it('502 when credentials resolution hits a transient error', async () => {
    resolveCredentialsMock.mockResolvedValue({ status: 'transient_error' })
    const response = await callGet(CONNECTION_ID, ORG_ID)
    expect(response.status).toBe(502)
  })

  it('200: returns containers + selected_container_ids from import_config.read_container_ids', async () => {
    const response = await callGet(CONNECTION_ID, ORG_ID)
    const data = await response.json()
    expect(response.status).toBe(200)
    expect(data.containers).toEqual([
      { id: 'db-1', title: 'タスク一覧' },
      { id: 'db-2', title: '議事録' },
    ])
    expect(data.selected_container_ids).toEqual(['db-1'])
  })

  it('selected_container_ids は import_config.read_container_ids が無ければ空配列', async () => {
    connectionResultMock.mockReturnValue({
      data: { id: CONNECTION_ID, org_id: ORG_ID, provider: 'notion', auth_kind: 'oauth', import_config: {} },
      error: null,
    })
    const response = await callGet(CONNECTION_ID, ORG_ID)
    const data = await response.json()
    expect(response.status).toBe(200)
    expect(data.selected_container_ids).toEqual([])
  })

  it('トークンをlistContainersに渡すがレスポンスには一切含めない', async () => {
    const response = await callGet(CONNECTION_ID, ORG_ID)
    const raw = JSON.stringify(await response.json())
    expect(listContainersMock).toHaveBeenCalledWith(
      expect.objectContaining({ credentials: { kind: 'oauth', token: 'secret-token' } }),
    )
    expect(raw).not.toContain('secret-token')
  })

  it('401(トークン失効)なら409+再接続導線になる', async () => {
    listContainersMock.mockRejectedValue(Object.assign(new Error('unauthorized'), { status: 401 }))
    const response = await callGet(CONNECTION_ID, ORG_ID)
    expect(response.status).toBe(409)
    expect((await response.json()).error).toContain('再接続')
  })

  it('403(アクセス権無し)は400のまま', async () => {
    listContainersMock.mockRejectedValue(Object.assign(new Error('forbidden'), { status: 403 }))
    const response = await callGet(CONNECTION_ID, ORG_ID)
    expect(response.status).toBe(400)
    expect((await response.json()).error).toContain('アクセス権')
  })

  it('その他のエラー(一時障害)は502', async () => {
    listContainersMock.mockRejectedValue(Object.assign(new Error('boom'), { status: 500 }))
    const response = await callGet(CONNECTION_ID, ORG_ID)
    expect(response.status).toBe(502)
  })

  it('ネットワークエラー(statusなし)も502', async () => {
    listContainersMock.mockRejectedValue(new Error('network down'))
    const response = await callGet(CONNECTION_ID, ORG_ID)
    expect(response.status).toBe(502)
  })

  it('アダプタの戻り値をそのまま返さず{id,title}へ再マップする(余分なフィールドを落とす)', async () => {
    listContainersMock.mockResolvedValue([
      { id: 'db-1', title: 'タスク一覧', __internal: 'secret-detail', accessToken: 'leak-me' },
    ])
    const response = await callGet(CONNECTION_ID, ORG_ID)
    const data = await response.json()
    expect(data.containers).toEqual([{ id: 'db-1', title: 'タスク一覧' }])
    const raw = JSON.stringify(data)
    expect(raw).not.toContain('secret-detail')
    expect(raw).not.toContain('leak-me')
  })

  it('一時障害時、例外messageやトークンをログに出さない(provider/status/エラー名のみ)', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    listContainersMock.mockRejectedValue(
      Object.assign(new Error('detailed internal failure: token=secret-token-abc'), { status: 500 }),
    )
    await callGet(CONNECTION_ID, ORG_ID)
    expect(consoleErrorSpy).toHaveBeenCalled()
    const loggedArgs = consoleErrorSpy.mock.calls[0].map((arg) => String(arg))
    expect(loggedArgs.some((arg) => arg.includes('secret-token-abc'))).toBe(false)
    expect(loggedArgs.some((arg) => arg.includes('detailed internal failure'))).toBe(false)
    consoleErrorSpy.mockRestore()
  })
})

/**
 * Google Tasks は専用ワーカーで動き task-sync アダプタを持たないため、以前はここで
 * 「このツールはまだ対応していません」と弾かれていた。その結果 Google ToDo だけ
 * 取り込み対象を内部IDで手入力させるしかなく、画面に意味の通らない欄が残っていた。
 * 一覧の形（{id,title}[]）は他ツールと同じなので、ここで橋渡しする。
 */
describe('GET containers — Google Tasks(専用ワーカー側)', () => {
  beforeEach(() => {
    connectionResultMock.mockReturnValue({
      data: {
        id: CONNECTION_ID,
        org_id: ORG_ID,
        provider: 'google_tasks',
        import_config: {},
      },
      error: null,
    })
    getValidTokenDetailedMock.mockResolvedValue({ status: 'ok', token: 'access-token' })
    listTaskListsMock.mockResolvedValue([
      { id: 'list-1', title: 'マイタスク' },
      { id: 'list-2', title: 'TaskApp' },
    ])
  })

  it('リスト一覧を他ツールと同じ形で返す(アダプタは使わない)', async () => {
    const response = await callGet(CONNECTION_ID, ORG_ID)
    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data.containers).toEqual([
      { id: 'list-1', title: 'マイタスク' },
      { id: 'list-2', title: 'TaskApp' },
    ])
    expect(getTaskSyncAdapterMock).not.toHaveBeenCalled()
  })

  it('古い保存キー(read_list_ids)の選択状態も拾う(画面でチェックが消えないように)', async () => {
    connectionResultMock.mockReturnValue({
      data: {
        id: CONNECTION_ID,
        org_id: ORG_ID,
        provider: 'google_tasks',
        import_config: { read_list_ids: ['list-1'] },
      },
      error: null,
    })
    const response = await callGet(CONNECTION_ID, ORG_ID)
    const data = await response.json()
    expect(data.selected_container_ids).toEqual(['list-1'])
  })

  it('トークン失効は409(再接続導線。他ツールと同じ写像)', async () => {
    getValidTokenDetailedMock.mockResolvedValue({ status: 'auth_failed' })
    const response = await callGet(CONNECTION_ID, ORG_ID)
    expect(response.status).toBe(409)
  })

  it('一時障害は502(設定は正しいかもしれないので失効扱いにしない)', async () => {
    getValidTokenDetailedMock.mockResolvedValue({ status: 'transient_error' })
    const response = await callGet(CONNECTION_ID, ORG_ID)
    expect(response.status).toBe(502)
  })

  it('一覧取得の失敗時、例外messageやトークンをログに出さない', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    listTaskListsMock.mockRejectedValue(new Error('boom token=secret-abc'))
    await callGet(CONNECTION_ID, ORG_ID)
    const loggedArgs = consoleErrorSpy.mock.calls.flat().map((a) => String(a))
    expect(loggedArgs.some((a) => a.includes('secret-abc'))).toBe(false)
    consoleErrorSpy.mockRestore()
  })
})
