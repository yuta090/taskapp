import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * src/lib/connectors/multica/client.ts — multica API クライアント(送信側)。
 * 契約: docs/spec/MULTICA_CONNECTOR_CONTRACT.md §3(送信) / §5(署名)。
 */

const safeFetchMock = vi.fn()
vi.mock('@/lib/sinks/ssrf', () => ({
  safeFetch: (...args: unknown[]) => safeFetchMock(...args),
}))

const { sendIssueUpsert, sendIssueCancel, formatLocalTimestampWithOffset } = await import(
  '@/lib/connectors/multica/client'
)

const CONN = {
  id: 'conn-multica-1',
  metadata: { multica: { base_url: 'https://multica.example.com', send_secret: 'sec_test' } },
}

const TASK = {
  taskRef: 'task-1',
  title: 'やること',
  body: '本文',
  status: 'todo' as const,
  dueDate: '2026-07-25',
  assigneeHint: '田中さん',
  origin: 'internal' as const,
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('formatLocalTimestampWithOffset', () => {
  it('toISOStringを使わずローカルタイムゾーンのオフセット付き文字列を返す', () => {
    const d = new Date(2026, 6, 20, 10, 0, 0) // 2026-07-20 10:00:00 ローカル
    const s = formatLocalTimestampWithOffset(d)
    expect(s).toMatch(/^2026-07-20T10:00:00[+-]\d{2}:\d{2}$/)
  })
})

describe('sendIssueUpsert', () => {
  it('署名付きPOSTで issue.upsert を送り、issue_id を返す', async () => {
    safeFetchMock.mockResolvedValue({ ok: true, status: 200, bodyText: JSON.stringify({ issue_id: 'iss-1', accepted: true }) })

    const result = await sendIssueUpsert(CONN, TASK)

    expect(result).toEqual({ issueId: 'iss-1' })
    expect(safeFetchMock).toHaveBeenCalledTimes(1)
    const [url, options] = safeFetchMock.mock.calls[0]
    expect(url).toBe('https://multica.example.com/api/agentpm/issues')
    expect(options.method).toBe('POST')
    expect(options.headers['Content-Type']).toBe('application/json')
    expect(options.headers['X-AgentPM-Signature']).toMatch(/^t=\d+,v1=[0-9a-f]{64}$/)

    const body = JSON.parse(options.body)
    expect(body).toMatchObject({
      event_type: 'issue.upsert',
      connection_id: 'conn-multica-1',
      task: {
        task_ref: 'task-1',
        title: 'やること',
        body: '本文',
        status: 'todo',
        due_date: '2026-07-25',
        assignee_hint: '田中さん',
        origin: 'internal',
      },
    })
    expect(typeof body.event_id).toBe('string')
    expect(body.event_id.length).toBeGreaterThan(0)
    expect(body.occurred_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/)
  })

  it('base_url/send_secret が未設定なら permanent_fail相当(status=422)で投げる(無限リトライを防ぐ)', async () => {
    const conn = { id: 'conn-no-config', metadata: {} }
    await expect(sendIssueUpsert(conn, TASK)).rejects.toMatchObject({ status: 422 })
    expect(safeFetchMock).not.toHaveBeenCalled()
  })

  it('metadata.multica が無い接続も同様に422', async () => {
    const conn = { id: 'conn-null-meta', metadata: null }
    await expect(sendIssueUpsert(conn, TASK)).rejects.toMatchObject({ status: 422 })
  })

  it('一時的なHTTP失敗(500)はstatus付きで投げ、呼び出し側が一時失敗として再試行できる', async () => {
    safeFetchMock.mockResolvedValue({ ok: true, status: 500, bodyText: 'server error' })
    await expect(sendIssueUpsert(CONN, TASK)).rejects.toMatchObject({ status: 500 })
  })

  it('恒久的なHTTP失敗(404)はstatus付きで投げる', async () => {
    safeFetchMock.mockResolvedValue({ ok: true, status: 404, bodyText: 'not found' })
    await expect(sendIssueUpsert(CONN, TASK)).rejects.toMatchObject({ status: 404 })
  })

  it('safeFetch自体が失敗(ネットワークエラー)した場合はstatus無しで投げる(一時失敗扱い)', async () => {
    safeFetchMock.mockResolvedValue({ ok: false, error: 'fetch failed: ECONNREFUSED' })
    const err = await sendIssueUpsert(CONN, TASK).catch((e) => e)
    expect(err).toBeInstanceOf(Error)
    expect((err as { status?: number }).status).toBeUndefined()
  })

  it('SSRF拒否は攻撃対象への無限リトライを避けるため恒久失敗相当(status=422)にする', async () => {
    safeFetchMock.mockResolvedValue({ ok: false, error: 'ssrf_blocked:ip_denied' })
    await expect(sendIssueUpsert(CONN, TASK)).rejects.toMatchObject({ status: 422 })
  })

  it('2xxだがissue_idを含まないレスポンスは一時失敗として投げる(statusなし)', async () => {
    safeFetchMock.mockResolvedValue({ ok: true, status: 200, bodyText: JSON.stringify({ accepted: true }) })
    const err = await sendIssueUpsert(CONN, TASK).catch((e) => e)
    expect(err).toBeInstanceOf(Error)
    expect((err as { status?: number }).status).toBeUndefined()
  })
})

describe('sendIssueCancel', () => {
  it('署名付きPOSTで issue.cancel を送る', async () => {
    safeFetchMock.mockResolvedValue({ ok: true, status: 200, bodyText: '{}' })

    await sendIssueCancel(CONN, 'task-1')

    expect(safeFetchMock).toHaveBeenCalledTimes(1)
    const [url, options] = safeFetchMock.mock.calls[0]
    expect(url).toBe('https://multica.example.com/api/agentpm/issues')
    const body = JSON.parse(options.body)
    expect(body).toMatchObject({
      event_type: 'issue.cancel',
      connection_id: 'conn-multica-1',
      task: { task_ref: 'task-1' },
    })
  })

  it('base_url未設定は422で投げる', async () => {
    await expect(sendIssueCancel({ id: 'c', metadata: {} }, 'task-1')).rejects.toMatchObject({ status: 422 })
  })
})
