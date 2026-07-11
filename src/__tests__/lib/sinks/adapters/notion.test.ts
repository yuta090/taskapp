import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Notion adapter — AI_SECRETARY_STAGE3_INTEGRATIONS.md §2-3(Notion) / 受け入れ基準13。
 * refベースのupsert意味論(sink_external_refsの読み書きはstore層をモックする)と
 * 失敗分類(dispatcher側classifyDeliveryFailureに委ねるためadapterはresponseStatusを
 * 素通しするだけ)を検証する。fetchはモック(宛先はapi.notion.com固定でSSRF対象外)。
 */

const findExternalRefMock = vi.fn()
const saveExternalRefMock = vi.fn()
vi.mock('@/lib/sinks/store', () => ({
  findExternalRef: (...args: unknown[]) => findExternalRefMock(...args),
  saveExternalRef: (...args: unknown[]) => saveExternalRefMock(...args),
}))

const {
  deliverNotion,
  testNotionConnection,
  isValidNotionDatabaseId,
  __resetNotionThrottleForTests,
} = await import('@/lib/sinks/adapters/notion')

const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

const SINK = {
  id: 'sink-1',
  provider: 'notion' as const,
  accessToken: 'secret_token',
  databaseId: '12345678-1234-1234-1234-123456789012',
}

function delivery(overrides: Partial<Parameters<typeof deliverNotion>[1]> = {}) {
  return {
    id: 'delivery-1',
    digestTaskId: 'task-1',
    eventType: 'task.created',
    eventKey: 'task.created:task-1:evt-1',
    payload: {
      occurredAt: '2026-07-12T00:00:00.000Z',
      task: {
        id: 'task-1',
        title: '発注書を送る',
        assignee_hint: '田中',
        status: 'open',
        group: '本店グループ',
        space: '受発注',
        source: { channel: 'line' },
      },
    },
    ...overrides,
  }
}

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  __resetNotionThrottleForTests()
})

describe('isValidNotionDatabaseId', () => {
  it('accepts a 32-digit hex id', () => {
    expect(isValidNotionDatabaseId('1234567890abcdef1234567890abcdef')).toBe(true)
  })
  it('accepts a UUID-formatted id', () => {
    expect(isValidNotionDatabaseId('12345678-1234-1234-1234-123456789012')).toBe(true)
  })
  it('rejects ids with disallowed characters (URL-path injection guard)', () => {
    expect(isValidNotionDatabaseId('../../etc/passwd')).toBe(false)
    expect(isValidNotionDatabaseId('1234567890abcdef1234567890abcde!')).toBe(false)
    expect(isValidNotionDatabaseId('')).toBe(false)
  })
})

describe('deliverNotion', () => {
  it('rejects an invalid database_id before making any request (permanent, no fetch)', async () => {
    const result = await deliverNotion({ ...SINK, databaseId: 'not-an-id' }, delivery())
    expect(result.ok).toBe(false)
    expect(result.permanent).toBe(true)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('creates a page and saves the ref when no ref exists yet', async () => {
    findExternalRefMock.mockResolvedValue(null)
    fetchMock.mockResolvedValue(jsonResponse(200, { id: 'page-abc' }))
    saveExternalRefMock.mockResolvedValue({ outcome: 'inserted' })

    const result = await deliverNotion(SINK, delivery())

    expect(result.ok).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.notion.com/v1/pages')
    expect(init.method).toBe('POST')
    expect(init.headers['Authorization']).toBe('Bearer secret_token')
    expect(init.headers['Notion-Version']).toBe('2022-06-28')

    const body = JSON.parse(init.body)
    expect(body.parent).toEqual({ database_id: SINK.databaseId })
    expect(body.properties['名前'].title[0].text.content).toBe('発注書を送る')
    expect(body.properties['ステータス'].rich_text[0].text.content).toBe('open')
    expect(body.properties['担当'].rich_text[0].text.content).toBe('田中')
    expect(body.properties['出典'].rich_text[0].text.content).toContain('本店グループ')
    expect(body.properties['発生時刻'].date.start).toBe('2026-07-12T00:00:00.000Z')

    expect(saveExternalRefMock).toHaveBeenCalledWith('sink-1', 'task-1', 'page-abc')
  })

  it('updates the existing page (PATCH) when a ref already exists', async () => {
    findExternalRefMock.mockResolvedValue('page-existing')
    fetchMock.mockResolvedValue(jsonResponse(200, { id: 'page-existing' }))

    const result = await deliverNotion(SINK, delivery({ eventType: 'task.done' }))

    expect(result.ok).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.notion.com/v1/pages/page-existing')
    expect(init.method).toBe('PATCH')
    expect(saveExternalRefMock).not.toHaveBeenCalled()
  })

  it('URL-encodes the stored ref before embedding it in the PATCH path', async () => {
    // page_id自体はNotionのUUID形式だが、defense-in-depthとしてURLパス埋め込み前に
    // encodeURIComponentを通すことを検証する(レビュー指摘・Minor#4)。
    findExternalRefMock.mockResolvedValue('page id/with?special&chars')
    fetchMock.mockResolvedValue(jsonResponse(200, { id: 'page-existing' }))

    await deliverNotion(SINK, delivery())

    const [url] = fetchMock.mock.calls[0]
    expect(url).toBe(`https://api.notion.com/v1/pages/${encodeURIComponent('page id/with?special&chars')}`)
  })

  it('URL-encodes the conflict-fallback ref before embedding it in the PATCH path', async () => {
    findExternalRefMock.mockResolvedValue(null)
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, { id: 'page-orphan' }))
      .mockResolvedValueOnce(jsonResponse(200, { id: 'page-winner' }))
    saveExternalRefMock.mockResolvedValue({ outcome: 'conflict', existingRef: 'winner id/with space' })

    await deliverNotion(SINK, delivery())

    const [url] = fetchMock.mock.calls[1]
    expect(url).toBe(`https://api.notion.com/v1/pages/${encodeURIComponent('winner id/with space')}`)
  })

  it('retries saveExternalRef once immediately on a non-conflict error, then succeeds', async () => {
    findExternalRefMock.mockResolvedValue(null)
    fetchMock.mockResolvedValue(jsonResponse(200, { id: 'page-abc' }))
    saveExternalRefMock
      .mockRejectedValueOnce(new Error('sink_external_refs: insert failed: connection reset'))
      .mockResolvedValueOnce({ outcome: 'inserted' })

    const result = await deliverNotion(SINK, delivery())

    expect(result.ok).toBe(true)
    expect(saveExternalRefMock).toHaveBeenCalledTimes(2)
  })

  it('propagates the error when saveExternalRef fails twice in a row (delivery stays unresolved for redelivery)', async () => {
    findExternalRefMock.mockResolvedValue(null)
    fetchMock.mockResolvedValue(jsonResponse(200, { id: 'page-abc' }))
    saveExternalRefMock.mockRejectedValue(new Error('sink_external_refs: insert failed: db down'))

    await expect(deliverNotion(SINK, delivery())).rejects.toThrow('db down')
    expect(saveExternalRefMock).toHaveBeenCalledTimes(2)
  })

  it('acceptance #13: a done delivery arriving before created creates the page in done state, and the later created delivery is absorbed into an update (no duplicate page)', async () => {
    // 1st delivery: task.done arrives first, no ref yet -> creates page in done state
    findExternalRefMock.mockResolvedValueOnce(null)
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: 'page-done-first' }))
    saveExternalRefMock.mockResolvedValueOnce({ outcome: 'inserted' })

    const doneResult = await deliverNotion(
      SINK,
      delivery({ eventType: 'task.done', payload: { occurredAt: '2026-07-12T00:05:00.000Z', task: { ...delivery().payload.task, status: 'done' } } }),
    )
    expect(doneResult.ok).toBe(true)
    expect(fetchMock).toHaveBeenNthCalledWith(1, 'https://api.notion.com/v1/pages', expect.objectContaining({ method: 'POST' }))

    // 2nd delivery: the created event (occurred earlier in wall-clock terms but delivered later)
    // finds the ref created above and updates that same page instead of creating a new one.
    findExternalRefMock.mockResolvedValueOnce('page-done-first')
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: 'page-done-first' }))

    const createdResult = await deliverNotion(SINK, delivery({ eventType: 'task.created' }))
    expect(createdResult.ok).toBe(true)
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://api.notion.com/v1/pages/page-done-first',
      expect.objectContaining({ method: 'PATCH' }),
    )
    // Only one page was ever created.
    expect(fetchMock.mock.calls.filter(([, init]) => init.method === 'POST').length).toBe(1)
  })

  it('falls back to updating the existing ref when saveExternalRef reports a concurrent-insert conflict', async () => {
    findExternalRefMock.mockResolvedValue(null)
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, { id: 'page-orphan' })) // create succeeds
      .mockResolvedValueOnce(jsonResponse(200, { id: 'page-winner' })) // fallback PATCH

    saveExternalRefMock.mockResolvedValue({ outcome: 'conflict', existingRef: 'page-winner' })

    const result = await deliverNotion(SINK, delivery())

    expect(result.ok).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock).toHaveBeenNthCalledWith(2, 'https://api.notion.com/v1/pages/page-winner', expect.objectContaining({ method: 'PATCH' }))
  })

  it('classifies a 400 (property mismatch) as permanent by passing the status through (dispatcher classifies)', async () => {
    findExternalRefMock.mockResolvedValue(null)
    fetchMock.mockResolvedValue(jsonResponse(400, { message: 'property does not exist' }))

    const result = await deliverNotion(SINK, delivery())
    expect(result.ok).toBe(false)
    expect(result.responseStatus).toBe(400)
    expect(result.permanent).toBeUndefined()
  })

  it('passes through 401 responseStatus (dispatcher classifies permanent+countsTowardFailures)', async () => {
    findExternalRefMock.mockResolvedValue(null)
    fetchMock.mockResolvedValue(jsonResponse(401, { message: 'unauthorized' }))

    const result = await deliverNotion(SINK, delivery())
    expect(result.ok).toBe(false)
    expect(result.responseStatus).toBe(401)
  })

  it('passes through 429 responseStatus (dispatcher classifies as temporary/backoff)', async () => {
    findExternalRefMock.mockResolvedValue(null)
    fetchMock.mockResolvedValue(jsonResponse(429, { message: 'rate limited' }))

    const result = await deliverNotion(SINK, delivery())
    expect(result.ok).toBe(false)
    expect(result.responseStatus).toBe(429)
  })

  it('passes through 5xx responseStatus (dispatcher classifies as temporary/backoff)', async () => {
    findExternalRefMock.mockResolvedValue(null)
    fetchMock.mockResolvedValue(jsonResponse(503, { message: 'unavailable' }))

    const result = await deliverNotion(SINK, delivery())
    expect(result.ok).toBe(false)
    expect(result.responseStatus).toBe(503)
  })

  it('treats a delivery with no digestTaskId/task (e.g. ping) as a permanent local failure', async () => {
    const result = await deliverNotion(SINK, delivery({ digestTaskId: null, payload: { occurredAt: '2026-07-12T00:00:00.000Z', task: null } }))
    expect(result.ok).toBe(false)
    expect(result.permanent).toBe(true)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('testNotionConnection', () => {
  it('queries the database with page_size:1 to verify access without creating a page', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { results: [] }))
    const result = await testNotionConnection(SINK)
    expect(result.ok).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(`https://api.notion.com/v1/databases/${SINK.databaseId}/query`)
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toEqual({ page_size: 1 })
  })

  it('rejects an invalid database_id before making any request', async () => {
    const result = await testNotionConnection({ ...SINK, databaseId: 'bad id' })
    expect(result.ok).toBe(false)
    expect(result.permanent).toBe(true)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('passes through a 404 responseStatus (dispatcher classifies)', async () => {
    fetchMock.mockResolvedValue(jsonResponse(404, { message: 'not found' }))
    const result = await testNotionConnection(SINK)
    expect(result.ok).toBe(false)
    expect(result.responseStatus).toBe(404)
  })
})
