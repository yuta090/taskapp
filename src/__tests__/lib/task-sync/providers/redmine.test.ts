import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Redmine アダプタ。
 *
 * Redmine REST API（公式 https://www.redmine.org/projects/redmine/wiki/Rest_api ,
 * Rest_Issues, Rest_IssueStatuses, Rest_Projects）の性質:
 *   - 接続先ホストは自ホスト任意URL（テナントごとに可変）。hostPolicy='any-https'。
 *     許可リストで守れないため、実際のIP検査・DNSピン留めは `safeFetch`
 *     （src/lib/sinks/ssrf.ts）を必ず経由する（素の fetch は使わない）。ここでは
 *     safeFetch の戻り値(SafeFetchResult)への追従だけを検証し、IP判定そのもの
 *     （private/内部IP拒否等）は ssrf.test.ts の責務とする。
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
 *   - 応答ヘッダーは safeFetch の responseHeaders から受け取り、429 の Retry-After を運ぶ
 *     （ヘッダーを捨てると制限中に叩き続けて制限期間を自分で延ばすことになる）。
 */

vi.mock('@/lib/sinks/ssrf', () => ({
  safeFetch: vi.fn(),
}))

import { redmineAdapter } from '@/lib/task-sync/providers/redmine'
import { safeFetch } from '@/lib/sinks/ssrf'
import type { ProviderContext } from '@/lib/task-sync/types'

const HOST = 'https://redmine.example.com'

function ctx(config?: Record<string, unknown>): ProviderContext {
  return { credentials: { kind: 'api_key', token: 'redmine-secret', baseUrl: HOST }, config }
}

/** safeFetch の成功応答(SafeFetchResult)を模す。 */
function okResult(body: unknown, status = 200) {
  return { ok: true, status, bodyText: JSON.stringify(body) }
}

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  fetchMock = safeFetch as unknown as ReturnType<typeof vi.fn>
  fetchMock.mockReset()
})

function callAt(i: number): [string, { method?: string; headers?: Record<string, string>; body?: string } | undefined] {
  return fetchMock.mock.calls[i] as [string, { method?: string; headers?: Record<string, string>; body?: string } | undefined]
}

function lastCall() {
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
      okResult({
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

  it('自ホスト配下の /projects.json をAPIキーヘッダー付きで safeFetch 経由で叩く', async () => {
    fetchMock.mockResolvedValueOnce(okResult({ projects: [], total_count: 0, limit: 100, offset: 0 }))
    await redmineAdapter.listContainers(ctx())
    const url = urlAt(0)
    const [, init] = callAt(0)
    expect(url.origin).toBe(HOST)
    expect(url.pathname).toBe('/projects.json')
    expect(init?.headers?.['X-Redmine-API-Key']).toBe('redmine-secret')
  })

  it('baseUrl が無い接続はプログラミングエラーとして弾く（誤ったホストへ鍵を送らない）', async () => {
    await expect(
      redmineAdapter.listContainers({ credentials: { kind: 'api_key', token: 'k', baseUrl: null } }),
    ).rejects.toMatchObject({ permanent: true, status: 400 })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  /**
   * 1ページ目しか取らないと、2ページ目以降のプロジェクトがエンジンに一度も渡らないまま
   * 「同期成功」としてカーソルが前進し、特定プロジェクトだけ永久に取り込まれない事故になる
   * （codexレビュー指摘）。全ページ取得を固定する。
   */
  it('total_count が limit を超える場合は全ページ取得する', async () => {
    const page1 = Array.from({ length: 100 }, (_, i) => ({ id: i + 1, name: `プロジェクト${i + 1}` }))
    const page2 = [{ id: 101, name: 'プロジェクト101' }]
    fetchMock.mockResolvedValueOnce(okResult({ projects: page1, total_count: 101, limit: 100, offset: 0 }))
    fetchMock.mockResolvedValueOnce(okResult({ projects: page2, total_count: 101, limit: 100, offset: 100 }))

    const containers = await redmineAdapter.listContainers(ctx())
    expect(containers).toHaveLength(101)
    expect(containers[100]).toEqual({ id: '101', title: 'プロジェクト101' })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(urlAt(1).searchParams.get('offset')).toBe('100')
  })

  it('空バッチが返ったら(total_countの不整合等)無限ループせず打ち切る', async () => {
    fetchMock.mockResolvedValueOnce(okResult({ projects: [], total_count: 999, limit: 100, offset: 0 }))
    const containers = await redmineAdapter.listContainers(ctx())
    expect(containers).toEqual([])
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

/**
 * 接続先ホストの検証。Redmineは顧客が任意のURLを立てられるため許可リストで守れない
 * （Backlogのvendor-domainとは違う性質）。形式（https/443/userinfo無し）は
 * `hostPolicy.ts`(assertAllowedHost) が safeFetch を呼ぶ前に弾き、IP/DNSは
 * safeFetch(ssrf.ts) 内部の validateWebhookUrl への委譲で守る（ここではその
 * 判定結果への追従だけを検証する）。
 */
describe('redmineAdapter — 送信先ホストの検証（鍵を意図しないホストへ出さない）', () => {
  const formatRejectCases: Array<[string, string]> = [
    ['http（平文）', 'http://redmine.example.com'],
    ['userinfoで正規ホストに見せかけたURL', 'https://redmine.example.com@evil.example.com'],
    ['非標準ポート', 'https://redmine.example.com:8443'],
  ]

  for (const [label, baseUrl] of formatRejectCases) {
    it(`${label} は safeFetch を呼ぶ前に拒否する（形式チェックのみでIP解決すらしない）`, async () => {
      await expect(
        redmineAdapter.listContainers({ credentials: { kind: 'api_key', token: 'k', baseUrl } }),
      ).rejects.toMatchObject({ permanent: true })
      expect(fetchMock).not.toHaveBeenCalled()
    })
  }

  it('内部/private IPへ解決されるホストは safeFetch(validateWebhookUrl) の拒否に従う', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, error: 'ssrf_blocked:ip_denied' })
    await expect(
      redmineAdapter.listContainers({ credentials: { kind: 'api_key', token: 'k', baseUrl: 'https://internal.example.com' } }),
    ).rejects.toMatchObject({ permanent: true, status: 400 })
  })

  it('DNS解決に失敗するホストも恒久失敗として扱う', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, error: 'ssrf_blocked:dns_resolution_failed' })
    await expect(redmineAdapter.listContainers(ctx())).rejects.toMatchObject({ permanent: true, status: 400 })
  })

  it('ネットワーク断・タイムアウト(ssrf_blockedでない失敗)は一時失敗として扱う（再試行可）', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, error: 'fetch failed: timeout' })
    const err = await redmineAdapter.listContainers(ctx()).catch((e) => e)
    expect(err.permanent).toBeFalsy()
    expect(err.status).toBeUndefined()
  })

  it('予期しないリダイレクト応答(3xx)は恒久失敗として止める', async () => {
    fetchMock.mockResolvedValueOnce(okResult({}, 302))
    await expect(redmineAdapter.listContainers(ctx())).rejects.toMatchObject({ status: 400, permanent: true })
  })

  it('エラー時に応答本文をログへ出さない（本文に顧客データ・内部構成が含まれ得る）', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    fetchMock.mockResolvedValueOnce(okResult({ leaked: 'redmine-secret' }, 500))
    await expect(redmineAdapter.listContainers(ctx())).rejects.toMatchObject({ status: 500 })
    for (const call of errorSpy.mock.calls) {
      expect(JSON.stringify(call)).not.toContain('redmine-secret')
    }
    errorSpy.mockRestore()
  })

  it('例外メッセージにAPIキーを含めない', async () => {
    fetchMock.mockResolvedValueOnce(okResult({}, 500))
    const err = await redmineAdapter.listContainers(ctx()).catch((e: Error) => e)
    expect(err).toBeInstanceOf(Error)
    expect((err as Error).message).not.toContain('redmine-secret')
  })

  it('429はRetry-After(秒)を復帰時刻として載せる', async () => {
    // 制限中に固定バックオフで叩き続けると制限期間を自分で延ばしてしまうため、外部が示した
    // 復帰時刻を必ず運ぶ。
    fetchMock.mockResolvedValueOnce({ ...okResult({}, 429), responseHeaders: { 'retry-after': '45' } })
    const err = await redmineAdapter.listContainers(ctx()).catch((e) => e)
    expect(err.status).toBe(429)
    expect(err.retryAfterMs).toBe(45_000)
  })

  it('Retry-Afterが無い429はエンジンの既定バックオフに委ねる(undefined)', async () => {
    fetchMock.mockResolvedValueOnce(okResult({}, 429))
    const err = await redmineAdapter.listContainers(ctx()).catch((e) => e)
    expect(err.status).toBe(429)
    expect(err.retryAfterMs).toBeUndefined()
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
    fetchMock.mockResolvedValueOnce(okResult({ issues: [issue], total_count: 1, limit: 100, offset: 0 }))
    fetchMock.mockResolvedValueOnce(okResult(ISSUE_STATUSES))
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
      okResult({
        issues: [{ id: 102, project: { id: 1 }, subject: '電話する', status: { id: 1, name: '新規' } }],
        total_count: 1,
        limit: 100,
        offset: 0,
      }),
    )
    fetchMock.mockResolvedValueOnce(okResult(ISSUE_STATUSES))
    const page = await redmineAdapter.listChangedTasks(ctx(), '1', {})
    expect(page.items[0]).toMatchObject({ dueDate: null, body: null, assigneeKey: null, completed: false })
  })

  it('is_closed なステータス(完了)を completed=true と判定する', async () => {
    fetchMock.mockResolvedValueOnce(
      okResult({ issues: [{ ...issue, id: 103, status: { id: 3, name: '完了' } }], total_count: 1, limit: 100, offset: 0 }),
    )
    fetchMock.mockResolvedValueOnce(okResult(ISSUE_STATUSES))
    const page = await redmineAdapter.listChangedTasks(ctx(), '1', {})
    expect(page.items[0].completed).toBe(true)
  })

  it('接続設定(redmine_done_status_ids)は is_closed の結果に合算される（補助であって上書きではない）', async () => {
    fetchMock.mockResolvedValueOnce(
      okResult({
        issues: [
          { ...issue, id: 104, status: { id: 4, name: '却下' } }, // is_closed=falseだが設定で完了扱いにしたい
          { ...issue, id: 105, status: { id: 3, name: '完了' } }, // is_closedで完了
        ],
        total_count: 2,
        limit: 100,
        offset: 0,
      }),
    )
    fetchMock.mockResolvedValueOnce(okResult(ISSUE_STATUSES))
    const page = await redmineAdapter.listChangedTasks(ctx({ redmine_done_status_ids: [4] }), '1', {})
    expect(page.items.map((t) => t.completed)).toEqual([true, true])
  })

  it('project_idと status_id=* (openのみのデフォルトを避ける)を指定する', async () => {
    fetchMock.mockResolvedValueOnce(okResult({ issues: [], total_count: 0, limit: 100, offset: 0 }))
    fetchMock.mockResolvedValueOnce(okResult(ISSUE_STATUSES))
    await redmineAdapter.listChangedTasks(ctx(), '7', {})
    const url = urlAt(0)
    expect(url.pathname).toBe('/issues.json')
    expect(url.searchParams.get('project_id')).toBe('7')
    expect(url.searchParams.get('status_id')).toBe('*')
  })

  it('初回(差分の起点なし)は id 昇順で取る — offsetページング中の更新で古い課題を取りこぼさない', async () => {
    fetchMock.mockResolvedValueOnce(okResult({ issues: [], total_count: 0, limit: 100, offset: 0 }))
    fetchMock.mockResolvedValueOnce(okResult(ISSUE_STATUSES))
    await redmineAdapter.listChangedTasks(ctx(), '7', {})
    expect(urlAt(0).searchParams.get('sort')).toBe('id')
  })

  it('差分の起点(since)があるときは updated_on 昇順で取り、updated_on=>=<since> をクエリに載せる', async () => {
    fetchMock.mockResolvedValueOnce(okResult({ issues: [], total_count: 0, limit: 100, offset: 0 }))
    fetchMock.mockResolvedValueOnce(okResult(ISSUE_STATUSES))
    await redmineAdapter.listChangedTasks(ctx(), '7', { since: '2026-07-19T00:00:00Z' })
    const url = urlAt(0)
    expect(url.searchParams.get('sort')).toBe('updated_on')
    expect(url.searchParams.get('updated_on')).toBe('>=2026-07-19T00:00:00Z')
  })

  it('total_countより取得済み件数が少なければ次カーソル(offset)を返し、取り切れば null で打ち切る', async () => {
    const full = Array.from({ length: 100 }, (_, i) => ({ ...issue, id: 200 + i }))
    fetchMock.mockResolvedValueOnce(okResult({ issues: full, total_count: 150, limit: 100, offset: 0 }))
    fetchMock.mockResolvedValueOnce(okResult(ISSUE_STATUSES))
    const first = await redmineAdapter.listChangedTasks(ctx(), '1', {})
    expect(first.nextCursor).toBe('100')

    fetchMock.mockResolvedValueOnce(okResult({ issues: [issue], total_count: 101, limit: 100, offset: 100 }))
    fetchMock.mockResolvedValueOnce(okResult(ISSUE_STATUSES))
    const second = await redmineAdapter.listChangedTasks(ctx(), '1', { cursor: '100' })
    expect(urlAt(2).searchParams.get('offset')).toBe('100')
    expect(second.nextCursor).toBeNull()
  })

  it('APIエラーは status を載せた例外にする（エンジンの恒久/一時失敗の分類に使う）', async () => {
    fetchMock.mockResolvedValueOnce(okResult({ errors: [{ message: 'No such project' }] }, 404))
    await expect(redmineAdapter.listChangedTasks(ctx(), '1', {})).rejects.toMatchObject({ status: 404 })
  })

  it('⚠既知の制約: 応答本文が壊れたJSON(500byte打ち切り等)なら一時失敗として再試行に回す', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, bodyText: '{"issues": [ { "id": 1, "subject": "切' })
    const err = await redmineAdapter.listChangedTasks(ctx(), '1', {}).catch((e) => e)
    expect(err.permanent).toBeFalsy()
    expect(err.status).toBeUndefined()
  })
})

describe('redmineAdapter.completeTask', () => {
  it('is_closedな先頭ステータスへ PUT /issues/{id}.json で更新する(application/json)（書き戻し先未設定の既定動作）', async () => {
    fetchMock.mockResolvedValueOnce(okResult(ISSUE_STATUSES))
    fetchMock.mockResolvedValueOnce(okResult({}))
    await redmineAdapter.completeTask(ctx(), { externalId: '101', containerId: '1' })

    const [url, init] = lastCall()
    expect(new URL(url).pathname).toBe('/issues/101.json')
    expect(init?.method).toBe('PUT')
    expect(init?.headers?.['Content-Type']).toBe('application/json')
    expect(JSON.parse(String(init?.body))).toEqual({ issue: { status_id: 3 } })
  })

  it('書き戻し先は専用設定(redmine_completion_status_id)で指定でき、is_closed一覧は取得しない', async () => {
    fetchMock.mockResolvedValueOnce(okResult({}))
    await redmineAdapter.completeTask(ctx({ redmine_completion_status_id: 9, redmine_done_status_ids: [4] }), {
      externalId: '101',
      containerId: '1',
    })
    // 検知用の redmine_done_status_ids には引きずられない(書込先=9であって4や配列先頭ではない)。
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(JSON.parse(String(lastCall()[1]?.body))).toEqual({ issue: { status_id: 9 } })
  })

  it('書き戻し先が未設定・is_closedなステータスも無い接続は恒久失敗にする', async () => {
    fetchMock.mockResolvedValueOnce(okResult({ issue_statuses: [] }))
    await expect(
      redmineAdapter.completeTask(ctx(), { externalId: '101', containerId: '1' }),
    ).rejects.toMatchObject({ permanent: true, status: 400 })
  })

  it('404(既に消えている)も status を保って投げ、呼び出し側が完了同義として握れるようにする', async () => {
    fetchMock.mockResolvedValueOnce(okResult(ISSUE_STATUSES))
    fetchMock.mockResolvedValueOnce(okResult({ errors: [] }, 404))
    await expect(
      redmineAdapter.completeTask(ctx(), { externalId: '999', containerId: '1' }),
    ).rejects.toMatchObject({ status: 404 })
  })
})
