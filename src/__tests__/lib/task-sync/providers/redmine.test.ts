import { describe, it, expect, vi, beforeEach } from 'vitest'
import { redmineAdapter } from '@/lib/task-sync/providers/redmine'
import { validateWebhookUrl } from '@/lib/sinks/ssrf'
import { fetch as undiciFetchMock } from 'undici'
import type { ProviderContext } from '@/lib/task-sync/types'

/**
 * Redmine アダプタ。
 *
 * Redmine REST API（公式 https://www.redmine.org/projects/redmine/wiki/Rest_api ,
 * Rest_Issues, Rest_IssueStatuses, Rest_Projects）の性質:
 *   - 接続先ホストは自ホスト任意URL（テナントごとに可変）。hostPolicy='any-https'。
 *     許可リストで守れないため、IP検査・DNSピン留めは `validateWebhookUrl`
 *     （src/lib/sinks/ssrf.ts の実際のSSRF判定）を経由する。ここではその判定結果への
 *     追従だけを検証し、IP判定そのもの（private/内部IP拒否等）は ssrf.test.ts の責務とする。
 *   - 認証はAPIアクセスキーをヘッダー `X-Redmine-API-Key` で送る方式を使う
 *     （key=クエリ・Basic認証も可だが、鍵をURLに載せないヘッダー方式を選ぶ）。
 *   - 差分は `updated_on=>=<ISO8601>` で絞れる（秒単位のタイムスタンプ粒度）。
 *   - デフォルトは open のissueのみ返る仕様のため、`status_id=*` を明示して完了済みも含める
 *     （そうしないと完了検知ができない）。
 *   - ページングは offset/limit（limit既定25・上限100）、レスポンスの total_count で判定。
 *   - ステータスはインスタンス管理者が自由に定義できるため固定値で決め打ちできない。
 *     `/issue_statuses.json` の `is_closed` を完了**検知**の第一情報源にし、接続設定
 *     `config.redmine_done_status_ids` は補助（is_closed の結果に合算する）。
 *     **書き戻し**（完了にする時に何を書くか）は別設定 `config.redmine_completion_status_id`。
 *   - 削除済み課題を取得するAPIが無く、Webhookもコアに無いため deletionMode='unsupported'。
 */

vi.mock('@/lib/sinks/ssrf', () => ({
  validateWebhookUrl: vi.fn(),
}))
vi.mock('undici', () => ({
  // new Agent(...) で呼ばれるため、Mockはコンストラクト可能な関数(class)にする必要がある
  // （アロー関数バックのvi.fn()は new できずTypeErrorになる）。
  Agent: vi.fn().mockImplementation(function Agent(this: { close: () => Promise<void> }) {
    this.close = vi.fn().mockResolvedValue(undefined)
  }),
  fetch: vi.fn(),
}))

const HOST = 'https://redmine.example.com'
const PINNED_IP = '203.0.113.10'

function ctx(config?: Record<string, unknown>): ProviderContext {
  return { credentials: { kind: 'api_key', token: 'redmine-secret', baseUrl: HOST }, config }
}

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return { status, headers: new Headers(headers), text: async () => JSON.stringify(body) }
}

let fetchMock: ReturnType<typeof vi.fn>
let validateMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  fetchMock = undiciFetchMock as unknown as ReturnType<typeof vi.fn>
  validateMock = validateWebhookUrl as unknown as ReturnType<typeof vi.fn>
  fetchMock.mockReset()
  validateMock.mockReset()
  // 既定は正規の接続先として通す（IP判定そのものはssrf.test.tsの責務。ここでは追従のみ検証）。
  validateMock.mockResolvedValue({ ok: true, hostname: 'redmine.example.com', port: 443, resolvedIps: [PINNED_IP] })
})

function callAt(i: number): [string, RequestInit | undefined] {
  return fetchMock.mock.calls[i] as [string, RequestInit | undefined]
}

function lastCall(): [string, RequestInit | undefined] {
  return callAt(fetchMock.mock.calls.length - 1)
}

function urlAt(i: number): URL {
  return new URL(callAt(i)[0])
}

const ISSUE_STATUSES = {
  issue_statuses: [
    { id: 1, name: '新規', is_closed: false },
    { id: 2, name: '進行中', is_closed: false },
    { id: 3, name: '完了', is_closed: true },
  ],
}

describe('redmineAdapter — 宣言', () => {
  it('APIアクセスキー認証・ホストは任意https(自ホスト)・差分は秒単位タイムスタンプ粒度・削除検知は無し', () => {
    expect(redmineAdapter.id).toBe('redmine')
    expect(redmineAdapter.authKind).toBe('api_key')
    expect(redmineAdapter.hostPolicy).toEqual({ kind: 'any-https' })
    expect(redmineAdapter.cursorGranularity).toBe('timestamp')
    expect(redmineAdapter.deletionMode).toBe('unsupported')
  })
})

describe('redmineAdapter.listContainers', () => {
  it('プロジェクト一覧を id/title に正規化する', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        projects: [
          { id: 1, name: 'アルファ案件', identifier: 'alpha' },
          { id: 2, name: 'ベータ案件', identifier: 'beta' },
        ],
        total_count: 2,
        limit: 100,
        offset: 0,
      }),
    )
    const containers = await redmineAdapter.listContainers(ctx())
    expect(containers).toEqual([
      { id: '1', title: 'アルファ案件' },
      { id: '2', title: 'ベータ案件' },
    ])
  })

  it('自ホスト配下の /projects.json をAPIキーヘッダー付きで叩く（DNSピン留め済みの接続で）', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ projects: [], total_count: 0, limit: 100, offset: 0 }))
    await redmineAdapter.listContainers(ctx())
    const url = urlAt(0)
    const [, init] = callAt(0)
    expect(url.origin).toBe(HOST)
    expect(url.pathname).toBe('/projects.json')
    expect((init?.headers as Record<string, string>)['X-Redmine-API-Key']).toBe('redmine-secret')
    expect(validateMock).toHaveBeenCalledWith(url.toString())
  })

  it('baseUrl が無い接続はプログラミングエラーとして弾く（誤ったホストへ鍵を送らない）', async () => {
    await expect(
      redmineAdapter.listContainers({ credentials: { kind: 'api_key', token: 'k', baseUrl: null } }),
    ).rejects.toMatchObject({ permanent: true, status: 400 })
    expect(validateMock).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

/**
 * 接続先ホストの検証。Redmineは顧客が任意のURLを立てられるため許可リストで守れない
 * （Backlogのvendor-domainとは違う性質）。形式（https/443/userinfo無し）はここで、
 * IP/DNSは validateWebhookUrl（ssrf.ts）への委譲で守る。
 */
describe('redmineAdapter — 送信先ホストの検証（鍵を意図しないホストへ出さない）', () => {
  const formatRejectCases: Array<[string, string]> = [
    ['http（平文）', 'http://redmine.example.com'],
    ['userinfoで正規ホストに見せかけたURL', 'https://redmine.example.com@evil.example.com'],
    ['非標準ポート', 'https://redmine.example.com:8443'],
  ]

  for (const [label, baseUrl] of formatRejectCases) {
    it(`${label} は fetch する前に拒否する（形式チェックのみでIP解決すらしない）`, async () => {
      await expect(
        redmineAdapter.listContainers({ credentials: { kind: 'api_key', token: 'k', baseUrl } }),
      ).rejects.toMatchObject({ permanent: true })
      expect(validateMock).not.toHaveBeenCalled()
      expect(fetchMock).not.toHaveBeenCalled()
    })
  }

  it('内部/private IPへ解決されるホストは validateWebhookUrl の判定に従って拒否する', async () => {
    validateMock.mockResolvedValueOnce({ ok: false, reason: 'ip_denied' })
    await expect(
      redmineAdapter.listContainers({ credentials: { kind: 'api_key', token: 'k', baseUrl: 'https://internal.example.com' } }),
    ).rejects.toMatchObject({ permanent: true, status: 400 })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('DNS解決に失敗するホストも恒久失敗として拒否する', async () => {
    validateMock.mockResolvedValueOnce({ ok: false, reason: 'dns_resolution_failed' })
    await expect(redmineAdapter.listContainers(ctx())).rejects.toMatchObject({ permanent: true })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('リダイレクトを自動追跡しない（転送先へ鍵を渡さない）', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ projects: [] }))
    await redmineAdapter.listContainers(ctx())
    const init = lastCall()[1]
    expect(init?.redirect).toBe('manual')
  })

  it('予期しないリダイレクト応答(3xx)は恒久失敗として止める', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({}, 302))
    await expect(redmineAdapter.listContainers(ctx())).rejects.toMatchObject({ status: 400, permanent: true })
  })

  it('エラー時に応答本文をログへ出さない（本文に顧客データ・内部構成が含まれ得る）', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    fetchMock.mockResolvedValueOnce(jsonResponse({ leaked: 'redmine-secret' }, 500))
    await expect(redmineAdapter.listContainers(ctx())).rejects.toMatchObject({ status: 500 })
    for (const call of errorSpy.mock.calls) {
      expect(JSON.stringify(call)).not.toContain('redmine-secret')
    }
    errorSpy.mockRestore()
  })

  it('例外メッセージにAPIキーを含めない', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({}, 500))
    const err = await redmineAdapter.listContainers(ctx()).catch((e: Error) => e)
    expect(err).toBeInstanceOf(Error)
    expect((err as Error).message).not.toContain('redmine-secret')
  })

  it('Retry-After(秒)があれば retryAfterMs として載せる（Redmine独自のレート制限ヘッダーは無いため標準のみ対応）', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({}, 429, { 'Retry-After': '45' }))
    const err = await redmineAdapter.listContainers(ctx()).catch((e) => e)
    expect(err.status).toBe(429)
    expect(err.retryAfterMs).toBe(45_000)
  })
})

describe('redmineAdapter.listChangedTasks', () => {
  const issue = {
    id: 101,
    project: { id: 1, name: 'アルファ案件' },
    subject: '契約書のドラフト',
    description: '初稿を作る',
    due_date: '2026-07-31',
    status: { id: 2, name: '進行中' },
    assigned_to: { id: 55, name: '田中' },
    updated_on: '2026-07-20T10:00:00Z',
  }

  it('issueを ExternalTask に正規化する（due_dateは既にローカル日付文字列でそのまま使う）', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ issues: [issue], total_count: 1, limit: 100, offset: 0 }))
    fetchMock.mockResolvedValueOnce(jsonResponse(ISSUE_STATUSES))
    const page = await redmineAdapter.listChangedTasks(ctx(), '1', {})
    expect(page.items).toEqual([
      {
        externalId: '101',
        containerId: '1',
        title: '契約書のドラフト',
        body: '初稿を作る',
        dueDate: '2026-07-31',
        completed: false,
        assigneeKey: '55',
        updatedAt: '2026-07-20T10:00:00Z',
      },
    ])
  })

  it('期日・本文・担当が無いissueも落とさず null に正規化する', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        issues: [{ id: 102, project: { id: 1 }, subject: '電話する', status: { id: 1, name: '新規' } }],
        total_count: 1,
        limit: 100,
        offset: 0,
      }),
    )
    fetchMock.mockResolvedValueOnce(jsonResponse(ISSUE_STATUSES))
    const page = await redmineAdapter.listChangedTasks(ctx(), '1', {})
    expect(page.items[0]).toMatchObject({ dueDate: null, body: null, assigneeKey: null, completed: false })
  })

  it('is_closed なステータス(完了)を completed=true と判定する', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ issues: [{ ...issue, id: 103, status: { id: 3, name: '完了' } }], total_count: 1, limit: 100, offset: 0 }),
    )
    fetchMock.mockResolvedValueOnce(jsonResponse(ISSUE_STATUSES))
    const page = await redmineAdapter.listChangedTasks(ctx(), '1', {})
    expect(page.items[0].completed).toBe(true)
  })

  it('接続設定(redmine_done_status_ids)は is_closed の結果に合算される（補助であって上書きではない）', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        issues: [
          { ...issue, id: 104, status: { id: 4, name: '却下' } }, // is_closed=falseだが設定で完了扱いにしたい
          { ...issue, id: 105, status: { id: 3, name: '完了' } }, // is_closedで完了
        ],
        total_count: 2,
        limit: 100,
        offset: 0,
      }),
    )
    fetchMock.mockResolvedValueOnce(jsonResponse(ISSUE_STATUSES))
    const page = await redmineAdapter.listChangedTasks(ctx({ redmine_done_status_ids: [4] }), '1', {})
    expect(page.items.map((t) => t.completed)).toEqual([true, true])
  })

  it('project_idと status_id=* (openのみのデフォルトを避ける)を指定する', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ issues: [], total_count: 0, limit: 100, offset: 0 }))
    fetchMock.mockResolvedValueOnce(jsonResponse(ISSUE_STATUSES))
    await redmineAdapter.listChangedTasks(ctx(), '7', {})
    const url = urlAt(0)
    expect(url.pathname).toBe('/issues.json')
    expect(url.searchParams.get('project_id')).toBe('7')
    expect(url.searchParams.get('status_id')).toBe('*')
  })

  it('初回(差分の起点なし)は id 昇順で取る — offsetページング中の更新で古い課題を取りこぼさない', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ issues: [], total_count: 0, limit: 100, offset: 0 }))
    fetchMock.mockResolvedValueOnce(jsonResponse(ISSUE_STATUSES))
    await redmineAdapter.listChangedTasks(ctx(), '7', {})
    expect(urlAt(0).searchParams.get('sort')).toBe('id')
  })

  it('差分の起点(since)があるときは updated_on 昇順で取り、updated_on=>=<since> をクエリに載せる', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ issues: [], total_count: 0, limit: 100, offset: 0 }))
    fetchMock.mockResolvedValueOnce(jsonResponse(ISSUE_STATUSES))
    await redmineAdapter.listChangedTasks(ctx(), '7', { since: '2026-07-19T00:00:00Z' })
    const url = urlAt(0)
    expect(url.searchParams.get('sort')).toBe('updated_on')
    expect(url.searchParams.get('updated_on')).toBe('>=2026-07-19T00:00:00Z')
  })

  it('total_countより取得済み件数が少なければ次カーソル(offset)を返し、取り切れば null で打ち切る', async () => {
    const full = Array.from({ length: 100 }, (_, i) => ({ ...issue, id: 200 + i }))
    fetchMock.mockResolvedValueOnce(jsonResponse({ issues: full, total_count: 150, limit: 100, offset: 0 }))
    fetchMock.mockResolvedValueOnce(jsonResponse(ISSUE_STATUSES))
    const first = await redmineAdapter.listChangedTasks(ctx(), '1', {})
    expect(first.nextCursor).toBe('100')

    fetchMock.mockResolvedValueOnce(jsonResponse({ issues: [issue], total_count: 101, limit: 100, offset: 100 }))
    fetchMock.mockResolvedValueOnce(jsonResponse(ISSUE_STATUSES))
    const second = await redmineAdapter.listChangedTasks(ctx(), '1', { cursor: '100' })
    expect(urlAt(2).searchParams.get('offset')).toBe('100')
    expect(second.nextCursor).toBeNull()
  })

  it('APIエラーは status を載せた例外にする（エンジンの恒久/一時失敗の分類に使う）', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ errors: [{ message: 'No such project' }] }, 404))
    await expect(redmineAdapter.listChangedTasks(ctx(), '1', {})).rejects.toMatchObject({ status: 404 })
  })
})

describe('redmineAdapter.completeTask', () => {
  it('is_closedな先頭ステータスへ PUT /issues/{id}.json で更新する(application/json)（書き戻し先未設定の既定動作）', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(ISSUE_STATUSES))
    fetchMock.mockResolvedValueOnce(jsonResponse({}))
    await redmineAdapter.completeTask(ctx(), { externalId: '101', containerId: '1' })

    const [url, init] = lastCall()
    expect(new URL(url).pathname).toBe('/issues/101.json')
    expect(init?.method).toBe('PUT')
    expect((init?.headers as Record<string, string>)['Content-Type']).toBe('application/json')
    expect(JSON.parse(String(init?.body))).toEqual({ issue: { status_id: 3 } })
  })

  it('書き戻し先は専用設定(redmine_completion_status_id)で指定でき、is_closed一覧は取得しない', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({}))
    await redmineAdapter.completeTask(ctx({ redmine_completion_status_id: 9, redmine_done_status_ids: [4] }), {
      externalId: '101',
      containerId: '1',
    })
    // 検知用の redmine_done_status_ids には引きずられない(書込先=9であって4や配列先頭ではない)。
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(JSON.parse(String(lastCall()[1]?.body))).toEqual({ issue: { status_id: 9 } })
  })

  it('書き戻し先が未設定・is_closedなステータスも無い接続は恒久失敗にする', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ issue_statuses: [] }))
    await expect(
      redmineAdapter.completeTask(ctx(), { externalId: '101', containerId: '1' }),
    ).rejects.toMatchObject({ permanent: true, status: 400 })
  })

  it('404(既に消えている)も status を保って投げ、呼び出し側が完了同義として握れるようにする', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(ISSUE_STATUSES))
    fetchMock.mockResolvedValueOnce(jsonResponse({ errors: [] }, 404))
    await expect(
      redmineAdapter.completeTask(ctx(), { externalId: '999', containerId: '1' }),
    ).rejects.toMatchObject({ status: 404 })
  })
})
