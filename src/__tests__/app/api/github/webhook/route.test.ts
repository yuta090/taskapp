import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * POST /api/github/webhook — GitHub からの webhook 受信。
 *
 * 背景（GITHUB_ISSUES_LINK_SPEC.md §7.1・§9 PR0b）: これまでは `github_webhook_events` への
 * insert の失敗を見ずに処理を続け、成功・失敗どちらでも `processed=true` にしていた。
 * GitHub は同じ配達（delivery）を再送することがあるため、二重に副作用を起こす恐れがあった。
 *
 * 直した挙動:
 *   - delivery_id が重複（23505）かつ既存行が処理済み(processed=true) → 処理せず 200・duplicate
 *   - delivery_id が重複（23505）かつ既存行が未処理(processed=false・前回失敗) → もう一度処理する
 *   - delivery ヘッダが無い → 重複排除はできないので、従来どおりそのまま処理する
 *   - `processed=true` は成功したときだけ。失敗時は `processed=false` + `error_message`
 */

const DELIVERY = 'delivery-abc-1'

type Row = { processed: boolean; error_message?: string | null }
let rows: Map<string, Row>

const verifyWebhookSignatureMock = vi.fn()
const parseWebhookHeadersMock = vi.fn()
const handlePullRequestEventMock = vi.fn()
const handleInstallationEventMock = vi.fn()
const handleInstallationRepositoriesEventMock = vi.fn()
const handleIssueEventMock = vi.fn()

vi.mock('@/lib/github', () => ({
  verifyWebhookSignature: (...args: unknown[]) => verifyWebhookSignatureMock(...args),
  parseWebhookHeaders: (...args: unknown[]) => parseWebhookHeadersMock(...args),
  handlePullRequestEvent: (...args: unknown[]) => handlePullRequestEventMock(...args),
  handleInstallationEvent: (...args: unknown[]) => handleInstallationEventMock(...args),
  handleInstallationRepositoriesEvent: (...args: unknown[]) => handleInstallationRepositoriesEventMock(...args),
  handleIssueEvent: (...args: unknown[]) => handleIssueEventMock(...args),
}))

function makeGithubWebhookEventsTable() {
  return {
    insert: vi.fn((row: { delivery_id?: string | null; processed?: boolean }) => {
      const id = row.delivery_id
      if (id && rows.has(id)) {
        return Promise.resolve({
          error: { code: '23505', message: 'duplicate key value violates unique constraint' },
        })
      }
      if (id) rows.set(id, { processed: row.processed ?? false })
      return Promise.resolve({ error: null })
    }),
    select: vi.fn(() => ({
      eq: vi.fn((_col: string, id: string) => ({
        single: vi.fn(() => Promise.resolve({ data: rows.get(id) ?? null, error: null })),
      })),
    })),
    update: vi.fn((patch: Partial<Row>) => ({
      eq: vi.fn((_col: string, id: string) => {
        const existing = rows.get(id) ?? { processed: false }
        rows.set(id, { ...existing, ...patch })
        return Promise.resolve({ error: null })
      }),
    })),
  }
}

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    from: vi.fn((table: string) => {
      if (table === 'github_webhook_events') return makeGithubWebhookEventsTable()
      return {}
    }),
  })),
}))

async function load() {
  vi.resetModules()
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'http://localhost:54321')
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-role')
  const route = await import('@/app/api/github/webhook/route')
  return route.POST
}

function post(body: Record<string, unknown> = { action: 'opened' }) {
  return (async () => {
    const POST = await load()
    return POST(
      new NextRequest('https://agentpm.app/api/github/webhook', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
    )
  })()
}

describe('POST /api/github/webhook', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.unstubAllEnvs()
    rows = new Map()
    verifyWebhookSignatureMock.mockReturnValue(true)
    parseWebhookHeadersMock.mockReturnValue({ event: 'pull_request', delivery: DELIVERY, signature: 'sha256=sig' })
    handlePullRequestEventMock.mockResolvedValue({ success: true })
    handleIssueEventMock.mockResolvedValue({ success: true })
  })

  it('初回配達は handler を呼び、成功したら processed=true にする', async () => {
    const res = await post()

    expect(handlePullRequestEventMock).toHaveBeenCalledTimes(1)
    expect(res.status).toBe(200)
    expect(rows.get(DELIVERY)?.processed).toBe(true)
  })

  it('同じ delivery を2回送ると、2回目は handler を呼ばず 200・duplicate を返す', async () => {
    await post()
    handlePullRequestEventMock.mockClear()

    const res = await post()

    expect(handlePullRequestEventMock).not.toHaveBeenCalled()
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ received: true, duplicate: true })
  })

  it('前回失敗した delivery が再送されたら、もう一度処理する', async () => {
    // 1回目: handler が失敗して processed=false のまま残る
    handlePullRequestEventMock.mockRejectedValueOnce(new Error('boom'))
    const first = await post()
    expect(first.status).toBe(500)
    expect(rows.get(DELIVERY)?.processed).toBe(false)

    // 2回目（同じ delivery の再送）: もう一度 handler が呼ばれる
    handlePullRequestEventMock.mockResolvedValueOnce({ success: true })
    const second = await post()

    expect(handlePullRequestEventMock).toHaveBeenCalledTimes(2)
    expect(second.status).toBe(200)
    expect(rows.get(DELIVERY)?.processed).toBe(true)
  })

  it('失敗時は processed=false と error_message を記録し、500 を返す', async () => {
    handlePullRequestEventMock.mockRejectedValueOnce(new Error('network down'))

    const res = await post()

    expect(res.status).toBe(500)
    expect(rows.get(DELIVERY)?.processed).toBe(false)
    expect(rows.get(DELIVERY)?.error_message).toBe('network down')
  })

  it('delivery ヘッダが無いときは重複排除できないが、従来どおり処理する', async () => {
    parseWebhookHeadersMock.mockReturnValue({ event: 'pull_request', delivery: null, signature: 'sha256=sig' })

    const res = await post()
    await post()

    expect(handlePullRequestEventMock).toHaveBeenCalledTimes(2)
    expect(res.status).toBe(200)
  })

  it('event=issues は handleIssueEvent に振り分ける（GITHUB_ISSUES_LINK_SPEC §9 PR1）', async () => {
    parseWebhookHeadersMock.mockReturnValue({ event: 'issues', delivery: DELIVERY, signature: 'sha256=sig' })

    const res = await post({ action: 'opened' })

    expect(handleIssueEventMock).toHaveBeenCalledTimes(1)
    expect(handlePullRequestEventMock).not.toHaveBeenCalled()
    expect(res.status).toBe(200)
    expect(rows.get(DELIVERY)?.processed).toBe(true)
  })
})
