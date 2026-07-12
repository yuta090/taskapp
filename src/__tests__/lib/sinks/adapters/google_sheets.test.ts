import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Google Sheets adapter — AI_SECRETARY_STAGE3_INTEGRATIONS.md §2-3(Google Sheets) / PR-4。
 * ログ方式(行appendのみ・行更新なし・ref登録なし)。失敗分類はwebhook/notionと同じ方針:
 * adapterはresponseStatusを素通しするだけで、dispatcher側classifyDeliveryFailureが分類する。
 */

const {
  deliverGoogleSheets,
  testGoogleSheetsConnection,
  isValidSpreadsheetId,
  isValidSheetName,
  __resetGoogleSheetsThrottleForTests,
} = await import('@/lib/sinks/adapters/google_sheets')

const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

const SINK = {
  id: 'sink-1',
  provider: 'google_sheets' as const,
  accessToken: 'access-token-1',
  spreadsheetId: '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms',
  sheetName: 'タスク',
}

function delivery(overrides: Partial<Parameters<typeof deliverGoogleSheets>[1]> = {}) {
  return {
    id: 'delivery-1',
    eventType: 'task.created',
    eventKey: 'task.created:task-1:evt-1',
    payload: {
      occurred_at: '2026-07-12T00:00:00.000Z',
      task: {
        id: 'task-1',
        title: '発注書を送る',
        assignee_hint: '田中',
        status: 'open',
        group: '本店グループ',
        space: '受発注',
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
  __resetGoogleSheetsThrottleForTests()
})

describe('isValidSpreadsheetId', () => {
  it('accepts a typical Google Sheets id (20-100 alnum/underscore/hyphen chars)', () => {
    expect(isValidSpreadsheetId('1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms')).toBe(true)
  })
  it('rejects ids that are too short (URL-path injection guard)', () => {
    expect(isValidSpreadsheetId('short')).toBe(false)
  })
  it('rejects ids with disallowed characters', () => {
    expect(isValidSpreadsheetId('../../etc/passwd'.padEnd(20, 'a'))).toBe(false)
    expect(isValidSpreadsheetId('')).toBe(false)
  })
})

describe('isValidSheetName', () => {
  it('accepts a normal sheet name', () => {
    expect(isValidSheetName('タスク')).toBe(true)
    expect(isValidSheetName('Sheet1')).toBe(true)
  })
  it('rejects an empty name or one over 100 chars', () => {
    expect(isValidSheetName('')).toBe(false)
    expect(isValidSheetName('a'.repeat(101))).toBe(false)
  })
  it('rejects names containing control characters', () => {
    expect(isValidSheetName('Sheet\n1')).toBe(false)
    expect(isValidSheetName('Sheet\t1')).toBe(false)
  })
})

describe('deliverGoogleSheets', () => {
  it('rejects an invalid spreadsheet_id before making any request (permanent, no fetch)', async () => {
    const result = await deliverGoogleSheets({ ...SINK, spreadsheetId: 'bad' }, delivery())
    expect(result.ok).toBe(false)
    expect(result.permanent).toBe(true)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects an invalid sheet_name before making any request (permanent, no fetch)', async () => {
    const result = await deliverGoogleSheets({ ...SINK, sheetName: '' }, delivery())
    expect(result.ok).toBe(false)
    expect(result.permanent).toBe(true)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('appends a row via values:append with valueInputOption=RAW and insertDataOption=INSERT_ROWS', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { updates: { updatedRows: 1 } }))

    const result = await deliverGoogleSheets(SINK, delivery())

    expect(result.ok).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toContain(`/v4/spreadsheets/${SINK.spreadsheetId}/values/`)
    expect(url).toContain(':append')
    expect(url).toContain('valueInputOption=RAW')
    expect(url).toContain('insertDataOption=INSERT_ROWS')
    expect(init.method).toBe('POST')
    expect(init.headers['Authorization']).toBe('Bearer access-token-1')
    const body = JSON.parse(init.body)
    expect(body.values[0][0]).toBe('2026-07-12T00:00:00.000Z')
  })

  it('URL-encodes the A1 range, escaping single quotes in the sheet name (defense-in-depth)', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, {}))
    await deliverGoogleSheets({ ...SINK, sheetName: "O'Brien's Sheet" }, delivery())

    const [url] = fetchMock.mock.calls[0]
    const expectedRange = encodeURIComponent(`'O''Brien''s Sheet'!A1`)
    expect(url).toContain(`/values/${expectedRange}:append`)
  })

  it('writes the fixed v1 row schema, converting null/missing fields to empty strings', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, {}))
    await deliverGoogleSheets(
      SINK,
      delivery({
        payload: {
          occurred_at: '2026-07-12T00:05:00.000Z',
          task: { id: 'task-2', title: '見積書を確認', status: null, assignee_hint: undefined, group: '', space: null },
        },
      }),
    )

    const [, init] = fetchMock.mock.calls[0]
    const body = JSON.parse(init.body)
    expect(body.values).toEqual([
      ['2026-07-12T00:05:00.000Z', 'task.created', '見積書を確認', '', '', '', '', 'task.created:task-1:evt-1', 'delivery-1'],
    ])
  })

  it('treats a delivery with no task (e.g. ping) as a permanent local failure without making a request', async () => {
    const result = await deliverGoogleSheets(
      SINK,
      delivery({ payload: { occurred_at: '2026-07-12T00:00:00.000Z', task: null } }),
    )
    expect(result.ok).toBe(false)
    expect(result.permanent).toBe(true)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('passes through a 400 responseStatus (dispatcher classifies)', async () => {
    fetchMock.mockResolvedValue(jsonResponse(400, { error: { message: 'bad range' } }))
    const result = await deliverGoogleSheets(SINK, delivery())
    expect(result.ok).toBe(false)
    expect(result.responseStatus).toBe(400)
    expect(result.permanent).toBeUndefined()
  })

  it('passes through a 401 responseStatus (dispatcher classifies permanent+countsTowardFailures)', async () => {
    fetchMock.mockResolvedValue(jsonResponse(401, { error: { message: 'unauthorized' } }))
    const result = await deliverGoogleSheets(SINK, delivery())
    expect(result.ok).toBe(false)
    expect(result.responseStatus).toBe(401)
  })

  it('passes through a 429 responseStatus (dispatcher classifies as temporary/backoff, matches Sheets quota errors)', async () => {
    fetchMock.mockResolvedValue(jsonResponse(429, { error: { message: 'rate limited' } }))
    const result = await deliverGoogleSheets(SINK, delivery())
    expect(result.ok).toBe(false)
    expect(result.responseStatus).toBe(429)
  })

  it('passes through a 5xx responseStatus (dispatcher classifies as temporary/backoff)', async () => {
    fetchMock.mockResolvedValue(jsonResponse(503, { error: { message: 'unavailable' } }))
    const result = await deliverGoogleSheets(SINK, delivery())
    expect(result.ok).toBe(false)
    expect(result.responseStatus).toBe(503)
  })

  it('treats a request timeout as a network-style failure (no responseStatus, dispatcher retries as temporary)', async () => {
    fetchMock.mockImplementation(
      (_url: string, init: { signal?: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => {
            const error = new Error('The operation was aborted')
            error.name = 'AbortError'
            reject(error)
          })
        }),
    )

    const resultPromise = deliverGoogleSheets(SINK, delivery(), { timeoutMs: 5 })
    const result = await resultPromise
    expect(result.ok).toBe(false)
    expect(result.responseStatus).toBeUndefined()
    expect(result.permanent).toBeUndefined()
  })

  it('throttles consecutive calls to at least 1000ms apart (Sheets write quota 60req/min/user)', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, {}))
    vi.useFakeTimers()
    try {
      const first = deliverGoogleSheets(SINK, delivery())
      await vi.advanceTimersByTimeAsync(0)
      const second = deliverGoogleSheets(SINK, delivery())

      await vi.advanceTimersByTimeAsync(999)
      expect(fetchMock).toHaveBeenCalledTimes(1)

      await vi.advanceTimersByTimeAsync(1)
      await Promise.all([first, second])
      expect(fetchMock).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('testGoogleSheetsConnection', () => {
  it('GETs spreadsheet metadata (fields=spreadsheetId) to verify access without writing a row', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { spreadsheetId: SINK.spreadsheetId }))
    const result = await testGoogleSheetsConnection(SINK)
    expect(result.ok).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(`https://sheets.googleapis.com/v4/spreadsheets/${SINK.spreadsheetId}?fields=spreadsheetId`)
    expect(init.method).toBe('GET')
    expect(init.headers['Authorization']).toBe('Bearer access-token-1')
  })

  it('rejects an invalid spreadsheet_id before making any request', async () => {
    const result = await testGoogleSheetsConnection({ ...SINK, spreadsheetId: 'bad' })
    expect(result.ok).toBe(false)
    expect(result.permanent).toBe(true)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('passes through a 404 responseStatus (dispatcher classifies)', async () => {
    fetchMock.mockResolvedValue(jsonResponse(404, { error: { message: 'not found' } }))
    const result = await testGoogleSheetsConnection(SINK)
    expect(result.ok).toBe(false)
    expect(result.responseStatus).toBe(404)
  })
})
