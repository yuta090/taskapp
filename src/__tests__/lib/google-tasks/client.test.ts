import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * src/lib/google-tasks/client.ts — Google Tasks API v1 の薄いクライアント。
 *
 * Google Tasks API の制約(確認済み):
 *   - タスクリストは個人所有・共有不可。ミラーは専用リスト "TaskApp" を1つ作りそこへ入れる。
 *   - due は日付のみ(時刻は破棄される)。RFC3339 だが T00:00:00.000Z で送る。
 *   - watch/push 通知なし(逆流はポーリング。updatedMin で差分)。
 *   - 書けるのは title/notes/status/due のみ。external ID 用フィールドは無い
 *     (対応表は user_task_mirror_refs 側で持つ。notes に ID は埋めない)。
 */

const {
  exchangeGoogleTasksCode,
  ensureTaskList,
  listTaskLists,
  listTasks,
  insertTask,
  patchTask,
  deleteTask,
  dateToGoogleDue,
  googleDueToDateString,
} = await import('@/lib/google-tasks/client')

const TASKS = 'https://tasks.googleapis.com/tasks/v1'

let fetchMock: ReturnType<typeof vi.fn>

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response
}

beforeEach(() => {
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
  process.env.GOOGLE_CLIENT_ID = 'client-id'
  process.env.GOOGLE_CLIENT_SECRET = 'client-secret'
  process.env.NEXT_PUBLIC_APP_URL = 'https://app.example.com'
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('dateToGoogleDue', () => {
  it('YYYY-MM-DD を RFC3339(UTC 0時)に変換する', () => {
    expect(dateToGoogleDue('2026-07-20')).toBe('2026-07-20T00:00:00.000Z')
  })
  it('null/undefined はそのまま null', () => {
    expect(dateToGoogleDue(null)).toBeNull()
    expect(dateToGoogleDue(undefined)).toBeNull()
  })
})

describe('googleDueToDateString', () => {
  it('RFC3339(UTC 0時)をローカル日付文字列(YYYY-MM-DD)に変換する(先頭10文字・toISOString不要)', () => {
    expect(googleDueToDateString('2026-07-20T00:00:00.000Z')).toBe('2026-07-20')
  })
  it('null/undefined はそのまま null', () => {
    expect(googleDueToDateString(null)).toBeNull()
    expect(googleDueToDateString(undefined)).toBeNull()
  })
})

describe('listTaskLists', () => {
  it('全タスクリストの id/title を返す(gtasks import の対象リスト列挙用)', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ items: [{ id: 'list-1', title: 'TaskApp' }, { id: 'list-2', title: 'Inbox' }] }),
    )
    const lists = await listTaskLists('at')
    expect(lists).toEqual([{ id: 'list-1', title: 'TaskApp' }, { id: 'list-2', title: 'Inbox' }])
    expect(fetchMock.mock.calls[0][0]).toContain(`${TASKS}/users/@me/lists`)
  })

  it('items が無ければ空配列', async () => {
    fetchMock.mockResolvedValue(jsonResponse({}))
    const lists = await listTaskLists('at')
    expect(lists).toEqual([])
  })
})

describe('exchangeGoogleTasksCode', () => {
  it('認可コードをトークンに交換する(redirect_uri は google_tasks コールバック)', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ access_token: 'at', refresh_token: 'rt', expires_in: 3600, scope: 's' }),
    )
    const r = await exchangeGoogleTasksCode('auth-code')
    expect(r.accessToken).toBe('at')
    expect(r.refreshToken).toBe('rt')
    expect(r.expiresAt).toBeInstanceOf(Date)

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://oauth2.googleapis.com/token')
    const body = (init!.body as URLSearchParams).toString()
    expect(body).toContain('grant_type=authorization_code')
    expect(body).toContain('redirect_uri=https%3A%2F%2Fapp.example.com%2Fapi%2Fintegrations%2Fcallback%2Fgoogle_tasks')
  })

  it('refresh_token が無ければ null', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ access_token: 'at', expires_in: 3600, scope: 's' }))
    const r = await exchangeGoogleTasksCode('c')
    expect(r.refreshToken).toBeNull()
  })
})

describe('ensureTaskList', () => {
  it('既存の同名リストがあればそのIDを返す(新規作成しない)', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ items: [{ id: 'list-1', title: 'TaskApp' }, { id: 'other', title: 'Other' }] }),
    )
    const id = await ensureTaskList('at', 'TaskApp')
    expect(id).toBe('list-1')
    expect(fetchMock).toHaveBeenCalledTimes(1) // list のみ。insert しない
    expect(fetchMock.mock.calls[0][0]).toContain(`${TASKS}/users/@me/lists`)
  })

  it('同名リストが無ければ作成してそのIDを返す', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ items: [{ id: 'other', title: 'Other' }] }))
      .mockResolvedValueOnce(jsonResponse({ id: 'new-list', title: 'TaskApp' }))
    const id = await ensureTaskList('at', 'TaskApp')
    expect(id).toBe('new-list')
    const [url, init] = fetchMock.mock.calls[1]
    expect(url).toBe(`${TASKS}/users/@me/lists`)
    expect(init!.method).toBe('POST')
    expect(JSON.parse(init!.body as string)).toEqual({ title: 'TaskApp' })
  })
})

describe('listTasks', () => {
  it('updatedMin/showCompleted/showHidden/pageToken をクエリに載せる', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ items: [{ id: 't1' }], nextPageToken: 'np' }))
    const r = await listTasks('at', 'list-1', { updatedMin: '2026-07-18T00:00:00.000Z', pageToken: 'pt' })
    expect(r.items).toHaveLength(1)
    expect(r.nextPageToken).toBe('np')
    const url = fetchMock.mock.calls[0][0] as string
    expect(url).toContain(`${TASKS}/lists/list-1/tasks`)
    expect(url).toContain('updatedMin=2026-07-18T00%3A00%3A00.000Z')
    expect(url).toContain('showCompleted=true')
    expect(url).toContain('showHidden=true')
    expect(url).toContain('pageToken=pt')
  })

  it('items が無ければ空配列', async () => {
    fetchMock.mockResolvedValue(jsonResponse({}))
    const r = await listTasks('at', 'list-1', {})
    expect(r.items).toEqual([])
  })
})

describe('insertTask', () => {
  it('title/notes/due/status を body に載せて POST する', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: 'gt-1', title: 'やること' }))
    const t = await insertTask('at', 'list-1', {
      title: 'やること',
      notes: 'TaskApp同期',
      due: '2026-07-20T00:00:00.000Z',
      status: 'needsAction',
    })
    expect(t.id).toBe('gt-1')
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(`${TASKS}/lists/list-1/tasks`)
    expect(init!.method).toBe('POST')
    expect(JSON.parse(init!.body as string)).toEqual({
      title: 'やること',
      notes: 'TaskApp同期',
      due: '2026-07-20T00:00:00.000Z',
      status: 'needsAction',
    })
  })
})

describe('patchTask', () => {
  it('渡したフィールドだけ PATCH する', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: 'gt-1', status: 'completed' }))
    await patchTask('at', 'list-1', 'gt-1', { status: 'completed' })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(`${TASKS}/lists/list-1/tasks/gt-1`)
    expect(init!.method).toBe('PATCH')
    expect(JSON.parse(init!.body as string)).toEqual({ status: 'completed' })
  })
})

describe('deleteTask', () => {
  it('DELETE を叩く', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 204, text: async () => '' } as Response)
    await deleteTask('at', 'list-1', 'gt-1')
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(`${TASKS}/lists/list-1/tasks/gt-1`)
    expect(init!.method).toBe('DELETE')
  })

  it('404(既に消えている)は成功扱いにする(冪等)', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 404, text: async () => 'Not Found' } as Response)
    await expect(deleteTask('at', 'list-1', 'gt-1')).resolves.toBeUndefined()
  })
})

describe('エラーハンドリング(失効の分類)', () => {
  it('401 は status=401 を付けて throw する(token-manager が失効と分類できるように)', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 401, text: async () => 'Unauthorized' } as Response)
    await expect(insertTask('at', 'list-1', { title: 'x' })).rejects.toMatchObject({ status: 401 })
  })

  it('500 は status=500 を付けて throw する(一時障害)', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500, text: async () => 'err' } as Response)
    await expect(listTasks('at', 'list-1', {})).rejects.toMatchObject({ status: 500 })
  })
})
