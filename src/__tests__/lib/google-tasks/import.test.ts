import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * src/lib/google-tasks/import.ts — gtasks import ワーカー(外部 gtasks → TaskApp 取り込み)。
 *
 * 正本ルール: import_enabled な接続は gtasks が正本。取り込んだ TaskApp タスクには
 * connector_task_links.origin='external' を張る。エコー回避は二重ガード:
 *   (a) ミラー出力先リスト(title=GOOGLE_TASKS_LIST_TITLE)を読み取り対象から必ず除外
 *   (b) user_task_mirror_refs に既にある google_task_id は取り込まない
 */

const listTaskListsMock = vi.fn()
const listTasksMock = vi.fn()
vi.mock('@/lib/google-tasks/client', () => ({
  listTaskLists: (...a: unknown[]) => listTaskListsMock(...a),
  listTasks: (...a: unknown[]) => listTasksMock(...a),
  googleDueToDateString: (d: string | null | undefined) => (d ? d.slice(0, 10) : null),
}))

const getValidTokenDetailedMock = vi.fn()
vi.mock('@/lib/integrations/token-manager', () => ({
  getValidTokenDetailed: (...a: unknown[]) => getValidTokenDetailedMock(...a),
}))
vi.mock('@/lib/google-calendar/client', () => ({ refreshAccessToken: vi.fn() }))

vi.mock('@/lib/google-tasks/config', () => ({
  GOOGLE_TASKS_LIST_TITLE: 'TaskApp',
}))

// --- 疑似 DB state ---
interface LinkRow {
  connection_id: string
  task_id: string
  external_id: string
  external_list_id: string | null
  origin: string
}
interface RefRow {
  connection_id: string
  google_task_id: string
}
interface ConnRow {
  id: string
  org_id: string
  import_config: Record<string, unknown> | null
  poll_cursor: string | null
}

const rpcMock = vi.fn()
const state = {
  conns: [] as ConnRow[],
  links: [] as LinkRow[],
  refs: [] as RefRow[],
  spaceOrgById: {} as Record<string, string>,
  orgMembers: [] as Array<{ org_id: string; user_id: string }>,
  tasksInserted: [] as Array<Record<string, unknown>>,
  tasksUpdated: [] as Array<{ id: string; value: Record<string, unknown> }>,
  tasksDeleted: [] as string[],
  cursorUpdates: [] as Array<{ id: string; value: Record<string, unknown> }>,
  taskIdSeq: 0,
  // 競合シミュレーション用: insert 時点で「別プロセスが先に link を作った」ことにする(race)。
  raceWinnerLink: null as LinkRow | null,
}

function makeChain(table: string) {
  let mode: 'select' | 'insert' | 'update' | 'delete' | null = null
  let insertPayload: Record<string, unknown> | null = null
  let updatePayload: Record<string, unknown> | null = null
  const eqFilters: Record<string, unknown> = {}

  function resolveNow(): { data: unknown; error: unknown } {
    if (table === 'integration_connections') {
      if (mode === 'update') {
        state.cursorUpdates.push({ id: eqFilters.id as string, value: updatePayload! })
        return { data: null, error: null }
      }
      return { data: state.conns, error: null }
    }
    if (table === 'connector_task_links') {
      if (mode === 'insert') {
        const dup = state.links.find(
          (l) => l.connection_id === insertPayload!.connection_id && l.external_id === insertPayload!.external_id,
        )
        if (dup) {
          return { data: null, error: { code: '23505' } }
        }
        if (state.raceWinnerLink) {
          // 別プロセスが先に insert 済みだったことにする(race)。この worker の insert は競合で失敗。
          state.links.push(state.raceWinnerLink)
          state.raceWinnerLink = null
          return { data: null, error: { code: '23505' } }
        }
        state.links.push(insertPayload as unknown as LinkRow)
        return { data: null, error: null }
      }
      // select: connection_id のみ(全件) or connection_id+external_id(補償lookup)
      const rows = state.links.filter((l) => {
        if (eqFilters.connection_id && l.connection_id !== eqFilters.connection_id) return false
        if (eqFilters.external_id && l.external_id !== eqFilters.external_id) return false
        return true
      })
      if ('external_id' in eqFilters) {
        // maybeSingle 相当
        return { data: rows[0] ?? null, error: null }
      }
      return { data: rows, error: null }
    }
    if (table === 'user_task_mirror_refs') {
      const rows = state.refs.filter((r) => !eqFilters.connection_id || r.connection_id === eqFilters.connection_id)
      return { data: rows, error: null }
    }
    if (table === 'spaces') {
      // クロステナント防御: id -> org_id を返す(未登録は null = 存在しない扱い)。
      const orgId = state.spaceOrgById[eqFilters.id as string]
      return { data: orgId ? { org_id: orgId } : null, error: null }
    }
    if (table === 'org_memberships') {
      const found = state.orgMembers.some(
        (m) => m.org_id === eqFilters.org_id && m.user_id === eqFilters.user_id,
      )
      return { data: found ? { user_id: eqFilters.user_id } : null, error: null }
    }
    if (table === 'tasks') {
      if (mode === 'insert') {
        const id = `new-task-${++state.taskIdSeq}`
        state.tasksInserted.push({ ...insertPayload, id })
        return { data: { id }, error: null }
      }
      if (mode === 'update') {
        state.tasksUpdated.push({ id: eqFilters.id as string, value: updatePayload! })
        return { data: null, error: null }
      }
      if (mode === 'delete') {
        state.tasksDeleted.push(eqFilters.id as string)
        return { data: null, error: null }
      }
    }
    return { data: null, error: null }
  }

  const chain: Record<string, unknown> = {}
  Object.assign(chain, {
    select: vi.fn(() => {
      if (!mode) mode = 'select'
      return chain
    }),
    insert: vi.fn((v: Record<string, unknown>) => {
      mode = 'insert'
      insertPayload = v
      return chain
    }),
    update: vi.fn((v: Record<string, unknown>) => {
      mode = 'update'
      updatePayload = v
      return chain
    }),
    delete: vi.fn(() => {
      mode = 'delete'
      return chain
    }),
    eq: vi.fn((col: string, val: unknown) => {
      eqFilters[col] = val
      return chain
    }),
    single: vi.fn(() => Promise.resolve(resolveNow())),
    maybeSingle: vi.fn(() => Promise.resolve(resolveNow())),
    then: (resolve: (v: unknown) => unknown) => resolve(resolveNow()),
  })
  return chain
}

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({ rpc: rpcMock, from: vi.fn((t: string) => makeChain(t)) })),
}))

const { importGoogleTasksBatch } = await import('@/lib/google-tasks/import')

const CONN = 'conn-1'
function conn(overrides: Partial<ConnRow> = {}): ConnRow {
  return {
    id: CONN,
    org_id: 'org-1',
    import_config: { target_space_id: 'space-1' },
    poll_cursor: '2026-07-18T00:00:00.000Z',
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://supabase.example.com'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key'
  state.conns = [conn()]
  state.links = []
  state.refs = []
  state.spaceOrgById = { 'space-1': 'org-1' } // 既定: 取り込み先 space は接続 org に属する
  state.orgMembers = [{ org_id: 'org-1', user_id: 'user-9' }] // 既定メンバー(assignee テスト用)
  state.tasksInserted = []
  state.tasksUpdated = []
  state.tasksDeleted = []
  state.cursorUpdates = []
  state.taskIdSeq = 0
  state.raceWinnerLink = null

  getValidTokenDetailedMock.mockResolvedValue({ status: 'ok', token: 'tok' })
  listTaskListsMock.mockResolvedValue([{ id: 'list-other', title: 'Inbox' }, { id: 'list-mirror', title: 'TaskApp' }])
  listTasksMock.mockResolvedValue({ items: [], nextPageToken: null })
  rpcMock.mockResolvedValue({ data: true, error: null })
})

describe('importGoogleTasksBatch', () => {
  it('新規の外部タスク → TaskApp タスクを作成し origin=external の link を張る', async () => {
    listTasksMock.mockImplementation((_tok: string, listId: string) =>
      listId === 'list-other'
        ? Promise.resolve({ items: [{ id: 'gt-new', title: '新規タスク', status: 'needsAction' }], nextPageToken: null })
        : Promise.resolve({ items: [], nextPageToken: null }),
    )
    const s = await importGoogleTasksBatch()

    expect(state.tasksInserted).toHaveLength(1)
    expect(state.tasksInserted[0]).toMatchObject({ org_id: 'org-1', space_id: 'space-1', title: '新規タスク' })
    expect(state.links).toHaveLength(1)
    expect(state.links[0]).toMatchObject({
      connection_id: CONN,
      external_id: 'gt-new',
      origin: 'external',
    })
    expect(s.created).toBe(1)
  })

  it('カーソルのオーバーラップで同一 external_id を2回取り込んでもタスクは1件(冪等)', async () => {
    listTasksMock.mockImplementation((_tok: string, listId: string) =>
      listId === 'list-other'
        ? Promise.resolve({ items: [{ id: 'gt-dup', title: '重複タスク', status: 'needsAction' }], nextPageToken: null })
        : Promise.resolve({ items: [], nextPageToken: null }),
    )
    await importGoogleTasksBatch()
    await importGoogleTasksBatch() // 2回目(cron 再実行・updatedMin オーバーラップを模す)

    expect(state.tasksInserted).toHaveLength(1)
    expect(state.links).toHaveLength(1)
    expect(state.tasksUpdated.length).toBeGreaterThanOrEqual(1) // 2回目は既存 link → update に倒れる
  })

  it('ミラー出力先リスト(title=TaskApp)は import 対象から必ず除外する(エコー回避a)', async () => {
    await importGoogleTasksBatch()
    expect(listTasksMock).not.toHaveBeenCalledWith(expect.anything(), 'list-mirror', expect.anything())
  })

  it('read_list_ids を明示指定してもミラー出力先リストは除外する', async () => {
    state.conns = [conn({ import_config: { target_space_id: 'space-1', read_list_ids: ['list-mirror', 'list-other'] } })]
    await importGoogleTasksBatch()
    expect(listTasksMock).not.toHaveBeenCalledWith(expect.anything(), 'list-mirror', expect.anything())
    expect(listTasksMock).toHaveBeenCalledWith(expect.anything(), 'list-other', expect.anything())
  })

  it('user_task_mirror_refs に既にある google_task_id は取り込まない(エコー回避b)', async () => {
    state.refs = [{ connection_id: CONN, google_task_id: 'gt-echo' }]
    listTasksMock.mockImplementation((_tok: string, listId: string) =>
      listId === 'list-other'
        ? Promise.resolve({ items: [{ id: 'gt-echo', title: '自分のミラー', status: 'needsAction' }], nextPageToken: null })
        : Promise.resolve({ items: [], nextPageToken: null }),
    )
    const s = await importGoogleTasksBatch()
    expect(state.tasksInserted).toHaveLength(0)
    expect(state.links).toHaveLength(0)
    expect(s.created).toBe(0)
  })

  it('外部タスクが completed かつ既存 link あり → rpc_connector_complete_task で done化', async () => {
    state.links = [{ connection_id: CONN, task_id: 'task-existing', external_id: 'gt-1', external_list_id: 'list-other', origin: 'external' }]
    listTasksMock.mockImplementation((_tok: string, listId: string) =>
      listId === 'list-other'
        ? Promise.resolve({ items: [{ id: 'gt-1', title: '完了タスク', status: 'completed' }], nextPageToken: null })
        : Promise.resolve({ items: [], nextPageToken: null }),
    )
    const s = await importGoogleTasksBatch()
    expect(rpcMock).toHaveBeenCalledWith('rpc_connector_complete_task', {
      p_connection_id: CONN,
      p_task_id: 'task-existing',
    })
    expect(s.completed).toBe(1)
    expect(s.updated).toBe(1)
  })

  it('既に done(RPC が false を返す)は completed カウントに入れない(no-op)', async () => {
    state.links = [{ connection_id: CONN, task_id: 'task-existing', external_id: 'gt-1', external_list_id: 'list-other', origin: 'external' }]
    rpcMock.mockResolvedValue({ data: false, error: null })
    listTasksMock.mockImplementation((_tok: string, listId: string) =>
      listId === 'list-other'
        ? Promise.resolve({ items: [{ id: 'gt-1', title: '完了タスク', status: 'completed' }], nextPageToken: null })
        : Promise.resolve({ items: [], nextPageToken: null }),
    )
    const s = await importGoogleTasksBatch()
    expect(s.completed).toBe(0)
  })

  it('既存 link ありの needsAction タスクは title/due を更新するだけ(完了RPCは呼ばない)', async () => {
    state.links = [{ connection_id: CONN, task_id: 'task-existing', external_id: 'gt-1', external_list_id: 'list-other', origin: 'external' }]
    listTasksMock.mockImplementation((_tok: string, listId: string) =>
      listId === 'list-other'
        ? Promise.resolve({ items: [{ id: 'gt-1', title: '更新後タイトル', status: 'needsAction' }], nextPageToken: null })
        : Promise.resolve({ items: [], nextPageToken: null }),
    )
    await importGoogleTasksBatch()
    expect(state.tasksUpdated).toHaveLength(1)
    expect(state.tasksUpdated[0]).toMatchObject({ id: 'task-existing', value: { title: '更新後タイトル' } })
    expect(rpcMock).not.toHaveBeenCalledWith('rpc_connector_complete_task', expect.anything())
  })

  it('target_space_id が無い import_config は skip する', async () => {
    state.conns = [conn({ import_config: {} })]
    const s = await importGoogleTasksBatch()
    expect(listTaskListsMock).not.toHaveBeenCalled()
    expect(s.skipped).toBe(1)
  })

  it('トークン失効の接続は skip しカーソルを進めない', async () => {
    getValidTokenDetailedMock.mockResolvedValue({ status: 'auth_failed' })
    const s = await importGoogleTasksBatch()
    expect(listTaskListsMock).not.toHaveBeenCalled()
    expect(s.skipped).toBe(1)
    expect(state.cursorUpdates).toHaveLength(0)
  })

  it('成功したら poll_cursor を前進させる', async () => {
    await importGoogleTasksBatch()
    expect(state.cursorUpdates).toHaveLength(1)
    expect(state.cursorUpdates[0].id).toBe(CONN)
    expect(typeof state.cursorUpdates[0].value.poll_cursor).toBe('string')
  })

  it('listTasks が失敗したら poll_cursor を進めず skip(取りこぼさない)', async () => {
    listTasksMock.mockImplementation((_tok: string, listId: string) =>
      listId === 'list-other'
        ? Promise.reject(Object.assign(new Error('boom'), { status: 500 }))
        : Promise.resolve({ items: [], nextPageToken: null }),
    )
    const s = await importGoogleTasksBatch()
    expect(s.skipped).toBe(1)
    expect(state.cursorUpdates).toHaveLength(0)
  })

  it('default_assignee_id が設定されていれば新規タスクの assignee_id に使う', async () => {
    state.conns = [conn({ import_config: { target_space_id: 'space-1', default_assignee_id: 'user-9' } })]
    listTasksMock.mockImplementation((_tok: string, listId: string) =>
      listId === 'list-other'
        ? Promise.resolve({ items: [{ id: 'gt-new', title: 'x', status: 'needsAction' }], nextPageToken: null })
        : Promise.resolve({ items: [], nextPageToken: null }),
    )
    await importGoogleTasksBatch()
    expect(state.tasksInserted[0]).toMatchObject({ assignee_id: 'user-9' })
  })

  it('deleted な外部タスクは無視する', async () => {
    listTasksMock.mockImplementation((_tok: string, listId: string) =>
      listId === 'list-other'
        ? Promise.resolve({ items: [{ id: 'gt-gone', title: 'x', status: 'needsAction', deleted: true }], nextPageToken: null })
        : Promise.resolve({ items: [], nextPageToken: null }),
    )
    const s = await importGoogleTasksBatch()
    expect(state.tasksInserted).toHaveLength(0)
    expect(s.created).toBe(0)
  })

  it('クロステナント防御: target_space_id が接続の org に属さない → 接続を skip(取り込まない)', async () => {
    state.spaceOrgById = { 'space-1': 'org-OTHER' } // space-1 は別 org の space
    listTasksMock.mockImplementation((_tok: string, listId: string) =>
      listId === 'list-other'
        ? Promise.resolve({ items: [{ id: 'gt-x', title: 'x', status: 'needsAction' }], nextPageToken: null })
        : Promise.resolve({ items: [], nextPageToken: null }),
    )
    const s = await importGoogleTasksBatch()
    expect(state.tasksInserted).toHaveLength(0)
    expect(listTaskListsMock).not.toHaveBeenCalled() // 検証で先に弾き、Google API も叩かない
    expect(s.skipped).toBe(1)
    expect(state.cursorUpdates).toHaveLength(0)
  })

  it('クロステナント防御: default_assignee_id が org メンバーでない → 担当を外して(null)取り込む', async () => {
    state.conns = [conn({ import_config: { target_space_id: 'space-1', default_assignee_id: 'user-outsider' } })]
    // orgMembers に user-outsider は居ない(既定は user-9 のみ)
    listTasksMock.mockImplementation((_tok: string, listId: string) =>
      listId === 'list-other'
        ? Promise.resolve({ items: [{ id: 'gt-new', title: 'x', status: 'needsAction' }], nextPageToken: null })
        : Promise.resolve({ items: [], nextPageToken: null }),
    )
    const s = await importGoogleTasksBatch()
    expect(state.tasksInserted).toHaveLength(1)
    expect(state.tasksInserted[0]).toMatchObject({ assignee_id: null })
    expect(s.created).toBe(1)
  })

  it('read_list_ids に実在しないリストIDが混ざっても正常リストは取り込む(wedge防止)', async () => {
    state.conns = [conn({ import_config: { target_space_id: 'space-1', read_list_ids: ['list-nonexistent', 'list-other'] } })]
    listTasksMock.mockImplementation((_tok: string, listId: string) =>
      listId === 'list-other'
        ? Promise.resolve({ items: [{ id: 'gt-ok', title: 'x', status: 'needsAction' }], nextPageToken: null })
        : Promise.resolve({ items: [], nextPageToken: null }),
    )
    const s = await importGoogleTasksBatch()
    // 実在しない list-nonexistent は listTasks に渡さない(404で接続全体が停滞しない)
    expect(listTasksMock).not.toHaveBeenCalledWith(expect.anything(), 'list-nonexistent', expect.anything())
    expect(listTasksMock).toHaveBeenCalledWith(expect.anything(), 'list-other', expect.anything())
    expect(s.created).toBe(1)
    expect(state.cursorUpdates).toHaveLength(1) // 正常に完了しカーソル前進
  })

  it('link insert が競合(23505)したら補償削除して既存タスクへ倒す(重複タスクを作らない)', async () => {
    // loadLinkMap 時点では link 未存在(未 import)。insert 直前に別プロセスが先着した想定(race)。
    state.raceWinnerLink = {
      connection_id: CONN,
      task_id: 'task-raced',
      external_id: 'gt-race',
      external_list_id: 'list-other',
      origin: 'external',
    }
    listTasksMock.mockImplementation((_tok: string, listId: string) =>
      listId === 'list-other'
        ? Promise.resolve({ items: [{ id: 'gt-race', title: 'x', status: 'needsAction' }], nextPageToken: null })
        : Promise.resolve({ items: [], nextPageToken: null }),
    )
    await importGoogleTasksBatch()
    // 作成した task はいったん insert されるが、link 競合検知で補償 delete され既存(task-raced)へ倒れる
    expect(state.tasksDeleted).toContain(state.tasksInserted[0]?.id)
    expect(state.links.find((l) => l.external_id === 'gt-race')?.task_id).toBe('task-raced')
  })
})
