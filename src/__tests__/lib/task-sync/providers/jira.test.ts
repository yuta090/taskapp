import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { jiraAdapter } from '@/lib/task-sync/providers/jira'
import type { ProviderContext } from '@/lib/task-sync/types'

/**
 * Jira Cloud アダプタ。
 *
 * 調査で確定した事実（出典と確認方法）:
 *   - 検索は新エンドポイント `/rest/api/3/search/jql` を使う。旧 `/rest/api/{2,3}/search` は
 *     公式OpenAPI仕様(https://developer.atlassian.com/cloud/jira/platform/swagger.v3.json、
 *     2026-07-21取得)で `deprecated: true`（削除告知 CHANGE-2046 へのリンク付き）。
 *     ページングは `startAt` ではなく不透明な `nextPageToken`
 *     （レスポンス `{ issues, isLast, nextPageToken }`）。
 *     ⚠未確認: `/rest/api/2/search/jql` は実インスタンス(jira.atlassian.com)で404だったが
 *     `/rest/api/3/search/jql` はパーミッションリダイレクト(302, 404ではない=ルート自体は存在)
 *     だったため、本アダプタは一貫して `/rest/api/3/` を使う（v2は使わない）。
 *   - 完了判定は `fields.status.statusCategory.key === 'done'`。実運用インスタンス
 *     (https://jira.atlassian.com、匿名アクセス可能な公開Jira)の
 *     `/rest/api/2/statuscategory` を実クエリして確認: undefined(1)/new(2)/indeterminate(4)/
 *     done(3) の4種がテナント非依存の固定語彙。ステータス"名前"はワークフローごとに自由定義の
 *     ため名前での判定は不可（真にテナント非依存なので接続設定での上書きは用意しない）。
 *   - `fields.duedate` は実データ確認(jira.atlassian.com CONFCLOUD-83942, duedate:"2026-04-28")
 *     の通り、時刻を持たない 'YYYY-MM-DD' 文字列。
 *   - 担当者は `fields.assignee.accountId`（公式スキーマ `User.accountId` で確認）。
 *   - 完了の書き戻しは transition API。遷移IDはワークフロー依存で固定値を打てないため、
 *     `GET /issue/{id}/transitions` で使える遷移一覧を取得し、
 *     `to.statusCategory.key === 'done'` な遷移を実行時に選んで `POST` する。
 *   - 認証は Basic（メール + APIトークン）。運用者が管理画面で自分で発行できるAPIトークン方式の
 *     方が「既存ツールに繋ぐ」までの摩擦が小さいため既定にした（OAuth 2.0(3LO)は将来の拡張）。
 *   - `ProviderCredentials` にBasic認証のユーザー名(メール)を置く場所が無いため、秘匿値ではない
 *     可視設定として `config.jira_email` に置く契約にした（Asanaの `config.asana_workspace_gid`
 *     と同じ考え方）。
 */

const SITE = 'https://example.atlassian.net'

function ctx(config?: Record<string, unknown>): ProviderContext {
  return {
    credentials: { kind: 'api_key', token: 'api-token-xyz', baseUrl: SITE },
    config: { jira_email: 'ops@example.com', ...config },
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response
}

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function lastCall(): [string, RequestInit | undefined] {
  const call = fetchMock.mock.calls[fetchMock.mock.calls.length - 1]
  return call as [string, RequestInit | undefined]
}

function lastUrl(): URL {
  return new URL(lastCall()[0])
}

describe('jiraAdapter — 宣言', () => {
  it('Basic認証・vendor-domainホストポリシー・差分はタイムスタンプ粒度', () => {
    expect(jiraAdapter.id).toBe('jira')
    expect(jiraAdapter.authKind).toBe('api_key')
    expect(jiraAdapter.hostPolicy).toEqual({ kind: 'vendor-domain', allowedSuffixes: ['.atlassian.net'] })
    expect(jiraAdapter.cursorGranularity).toBe('timestamp')
    // /search/jql は削除済み課題をtombstone無しで単に返さなくなるだけ＝判別不可。
    expect(jiraAdapter.deletionMode).toBe('unsupported')
  })
})

describe('jiraAdapter — 認証', () => {
  it('メール+APIトークンのBasic認証ヘッダを送る', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ values: [], isLast: true }))
    await jiraAdapter.listContainers(ctx())
    const [, init] = lastCall()
    const headers = init?.headers as Record<string, string>
    const expected = `Basic ${Buffer.from('ops@example.com:api-token-xyz').toString('base64')}`
    expect(headers.Authorization).toBe(expected)
  })

  it('config.jira_email が無い接続は配線ミスとして弾く', async () => {
    await expect(
      jiraAdapter.listContainers({
        credentials: { kind: 'api_key', token: 'k', baseUrl: SITE },
      }),
    ).rejects.toMatchObject({ permanent: true, status: 400 })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('接続先URLが無い接続はプログラミングエラーとして弾く', async () => {
    await expect(
      jiraAdapter.listContainers({
        credentials: { kind: 'api_key', token: 'k', baseUrl: null },
        config: { jira_email: 'ops@example.com' },
      }),
    ).rejects.toMatchObject({ permanent: true, status: 400 })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

/**
 * 接続先ホストの検証。*.atlassian.net 以外へ資格情報(Basicヘッダ)を送らないことを、
 * 接続作成時の検証だけに頼らずこの層でも毎回確かめる（Backlogと同じ考え方）。
 */
describe('jiraAdapter — 送信先ホストの検証', () => {
  const cases: Array<[string, string]> = [
    ['http（平文）', 'http://example.atlassian.net'],
    ['Jira以外のホスト', 'https://evil.example.com'],
    ['userinfoで正規ホストに見せかけたURL', 'https://example.atlassian.net@evil.example.com'],
    ['ホスト名の末尾一致すり抜け', 'https://evil-atlassian.net'],
    ['サフィックスを含むだけの別ドメイン', 'https://atlassian.net.evil.com'],
    ['非標準ポート', 'https://example.atlassian.net:8443'],
  ]

  for (const [label, baseUrl] of cases) {
    it(`${label} は fetch する前に拒否する`, async () => {
      await expect(
        jiraAdapter.listContainers({
          credentials: { kind: 'api_key', token: 'k', baseUrl },
          config: { jira_email: 'ops@example.com' },
        }),
      ).rejects.toMatchObject({ permanent: true })
      expect(fetchMock).not.toHaveBeenCalled()
    })
  }

  it('正規の *.atlassian.net は通す', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ values: [], isLast: true }))
    await jiraAdapter.listContainers(ctx())
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('リダイレクトを自動追跡しない（転送先へ資格情報を渡さない）', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ values: [], isLast: true }))
    await jiraAdapter.listContainers(ctx())
    const init = lastCall()[1]
    expect(init?.redirect).toBe('manual')
  })

  it('例外メッセージにAPIトークンを含めない', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({}, 500))
    const err = await jiraAdapter.listContainers(ctx()).catch((e: Error) => e)
    expect(err).toBeInstanceOf(Error)
    expect((err as Error).message).not.toContain('api-token-xyz')
  })
})

describe('jiraAdapter.listContainers', () => {
  it('プロジェクト一覧を id/title に正規化し、アーカイブ済みを除く', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        isLast: true,
        values: [
          { id: '10001', key: 'ALPHA', name: 'アルファ案件', archived: false },
          { id: '10002', key: 'BETA', name: '終了案件', archived: true },
        ],
      }),
    )
    const containers = await jiraAdapter.listContainers(ctx())
    expect(containers).toEqual([{ id: '10001', title: 'アルファ案件' }])
  })

  it('/rest/api/3/project/search をサイトURL配下で叩く', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ values: [], isLast: true }))
    await jiraAdapter.listContainers(ctx())
    const url = lastUrl()
    expect(url.origin).toBe(SITE)
    expect(url.pathname).toBe('/rest/api/3/project/search')
  })

  it('isLast=false の間は startAt を進めてページングする', async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({ isLast: false, values: [{ id: '1', name: '案件1', archived: false }] }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ isLast: true, values: [{ id: '2', name: '案件2', archived: false }] }),
      )
    const containers = await jiraAdapter.listContainers(ctx())
    expect(containers).toEqual([
      { id: '1', title: '案件1' },
      { id: '2', title: '案件2' },
    ])
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const secondUrl = new URL(fetchMock.mock.calls[1][0] as string)
    expect(secondUrl.searchParams.get('startAt')).toBe('100')
  })
})

describe('jiraAdapter.listChangedTasks', () => {
  const issue = {
    id: '20001',
    key: 'ALPHA-1',
    fields: {
      summary: '契約書のドラフト',
      description: '初稿を作る',
      duedate: '2026-07-31',
      status: { statusCategory: { key: 'indeterminate', name: 'In Progress' } },
      assignee: { accountId: 'acc-55', displayName: '田中' },
      updated: '2026-07-20T10:00:00.000+0900',
    },
  }

  it('課題を ExternalTask に正規化する（期日はそのままローカル日付文字列）', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ issues: [issue], isLast: true, nextPageToken: null }))
    const page = await jiraAdapter.listChangedTasks(ctx(), '10001', {})
    expect(page.items).toEqual([
      {
        externalId: '20001',
        containerId: '10001',
        title: '契約書のドラフト',
        body: '初稿を作る',
        dueDate: '2026-07-31',
        completed: false,
        assigneeKey: 'acc-55',
        updatedAt: '2026-07-20T10:00:00.000+0900',
      },
    ])
  })

  it('期日・本文・担当が無い課題も落とさず null に正規化する', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        issues: [{ id: '20002', key: 'ALPHA-2', fields: { summary: '電話する', status: { statusCategory: { key: 'new' } } } }],
        isLast: true,
      }),
    )
    const page = await jiraAdapter.listChangedTasks(ctx(), '10001', {})
    expect(page.items[0]).toMatchObject({ dueDate: null, body: null, assigneeKey: null, completed: false })
  })

  it('statusCategory.key = done を completed=true と判定する（ステータス名がワークフロー依存でも揺れない）', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        issues: [{ ...issue, id: '20003', fields: { ...issue.fields, status: { statusCategory: { key: 'done', name: 'カスタム完了名' } } } }],
        isLast: true,
      }),
    )
    const page = await jiraAdapter.listChangedTasks(ctx(), '10001', {})
    expect(page.items[0].completed).toBe(true)
  })

  it('JQLでプロジェクトを絞り、updated順に取る', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ issues: [], isLast: true }))
    await jiraAdapter.listChangedTasks(ctx(), '10001', {})
    const url = lastUrl()
    expect(url.pathname).toBe('/rest/api/3/search/jql')
    expect(url.searchParams.get('jql')).toBe('project = 10001 ORDER BY updated ASC')
  })

  /**
   * 回帰テスト: since を絶対日時リテラル('yyyy-MM-dd HH:mm')で渡すと、Jiraはそれを**サイト/
   * ユーザーのタイムゾーンの壁時計時刻**として解釈する（絶対日時リテラルはタイムゾーン表記を
   * 受け付けない。実インスタンスで '+0000' サフィックスを付けると
   * "Date value ... is invalid" で拒否されることを確認済み）。保存カーソルはUTCのため、
   * サイトがUTCより西（例: US/Pacific, UTC-8）だと実効下限が「後ろ」へ数時間ずれ、その間の
   * 更新分をカーソル前進後は二度と拾えなくなる（恒久的な取りこぼし）。
   *
   * 修正: 絶対時刻の代わりに JQL の**相対期間リテラル**('-NNm'。クエリ実行時の now からの
   * 経過時間で評価され、タイムゾーンを一切経由しない)を使う。実インスタンスで
   * '-10080m'（7日相当の分指定）と '-7d' が完全に同じ件数を返すことを検証済み＝
   * 壁時計変換を通っていない証拠。これによりタイムゾーン解釈の余地自体を無くす。
   */
  it('sinceは絶対日時ではなくJQLの相対期間(-Nm)で渡す(タイムゾーンを経由しないため西半球でも取りこぼさない)', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-20T12:00:00.000Z'))
    fetchMock.mockResolvedValueOnce(jsonResponse({ issues: [], isLast: true }))
    await jiraAdapter.listChangedTasks(ctx(), '10001', { since: '2026-07-20T10:00:00.000Z' })
    const url = lastUrl()
    // 2時間(120分)経過。壁時計文字列(タイムゾーン依存)ではなく相対期間(タイムゾーン非依存)で渡す。
    expect(url.searchParams.get('jql')).toBe('project = 10001 AND updated >= "-120m" ORDER BY updated ASC')
    vi.useRealTimers()
  })

  it('経過時間の端数(秒未満)は切り上げる(実際の経過分数より短く見積もって取りこぼす方向には倒れない)', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-20T10:01:30.000Z')) // sinceから1分30秒経過
    fetchMock.mockResolvedValueOnce(jsonResponse({ issues: [], isLast: true }))
    await jiraAdapter.listChangedTasks(ctx(), '10001', { since: '2026-07-20T10:00:00.000Z' })
    // 切り捨てて "-1m" にすると直近30秒の更新を取りこぼす。切り上げて "-2m" にする。
    expect(lastUrl().searchParams.get('jql')).toBe('project = 10001 AND updated >= "-2m" ORDER BY updated ASC')
    vi.useRealTimers()
  })

  it('cursor(nextPageToken)を渡し、レスポンスの nextPageToken をそのまま次カーソルにする', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ issues: [], isLast: false, nextPageToken: 'opaque-token-abc' }),
    )
    const page = await jiraAdapter.listChangedTasks(ctx(), '10001', { cursor: 'prev-token' })
    expect(lastUrl().searchParams.get('nextPageToken')).toBe('prev-token')
    expect(page.nextCursor).toBe('opaque-token-abc')
  })

  it('isLast=true なら nextCursor は null で打ち切る', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ issues: [], isLast: true, nextPageToken: 'ignored' }))
    const page = await jiraAdapter.listChangedTasks(ctx(), '10001', {})
    expect(page.nextCursor).toBeNull()
  })

  it('APIエラーは status を載せた例外にする', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ errorMessages: ['no such project'] }, 400))
    await expect(jiraAdapter.listChangedTasks(ctx(), '10001', {})).rejects.toMatchObject({ status: 400 })
  })

  it('429 は Retry-After(秒) を retryAfterMs として載せる', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 429,
      headers: new Headers({ 'Retry-After': '30' }),
      json: async () => ({}),
      text: async () => '',
    } as Response)
    const err = await jiraAdapter.listChangedTasks(ctx(), '10001', {}).catch((e) => e)
    expect(err.status).toBe(429)
    expect(err.retryAfterMs).toBe(30_000)
  })
})

describe('jiraAdapter.completeTask', () => {
  it('遷移一覧から to.statusCategory.key=done な遷移を選んで実行する', async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          transitions: [
            { id: '11', name: '作業開始', to: { statusCategory: { key: 'indeterminate' } } },
            { id: '31', name: '完了にする', to: { statusCategory: { key: 'done' } } },
          ],
        }),
      )
      .mockResolvedValueOnce(jsonResponse({}, 204))

    await jiraAdapter.completeTask(ctx(), { externalId: '20001', containerId: '10001' })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    const [getUrl] = fetchMock.mock.calls[0] as [string]
    expect(new URL(getUrl).pathname).toBe('/rest/api/3/issue/20001/transitions')

    const [postUrl, postInit] = fetchMock.mock.calls[1] as [string, RequestInit]
    expect(new URL(postUrl).pathname).toBe('/rest/api/3/issue/20001/transitions')
    expect(postInit.method).toBe('POST')
    expect(JSON.parse(String(postInit.body))).toEqual({ transition: { id: '31' } })
  })

  it('完了へ直接遷移できるワークフロー経路が無い場合は恒久失敗(422)にする', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        transitions: [{ id: '11', name: '作業開始', to: { statusCategory: { key: 'indeterminate' } } }],
      }),
    )
    await expect(
      jiraAdapter.completeTask(ctx(), { externalId: '20001', containerId: '10001' }),
    ).rejects.toMatchObject({ status: 422, permanent: true })
    // 遷移が見つからない場合はPOSTを送らない(存在しない遷移IDを叩かない)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('404(既に消えている)も status を保って投げる', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ errorMessages: ['not found'] }, 404))
    await expect(
      jiraAdapter.completeTask(ctx(), { externalId: '999', containerId: '10001' }),
    ).rejects.toMatchObject({ status: 404 })
  })
})
