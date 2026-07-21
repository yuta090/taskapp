import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { backlogAdapter } from '@/lib/task-sync/providers/backlog'
import type { ProviderContext } from '@/lib/task-sync/types'

/**
 * Backlog アダプタ（タスク同期の第1実装＝抽象の検証台）。
 *
 * Backlog API v2 の性質（アダプタが吸収する差異）:
 *   - 接続先ホストがテナントごとに可変（https://<space>.backlog.jp | .com）。
 *   - 認証は APIキーをクエリ `apiKey=` で渡す（OAuth も可だがまずAPIキー方式）。
 *   - 差分は `updatedSince` で絞るが **日付粒度**（YYYY-MM-DD）。時刻では絞れないため、
 *     取りこぼし防止はエンジン側のカーソル補正に委ね、アダプタは日付を素直に渡す。
 *   - ページングは offset/count（count は最大100）。
 *   - 「完了」はステータスIDで表され、**プロジェクトごとにカスタムステータスを定義できる**ため
 *     固定値で決め打ちできない。既定は 4（Backlog標準の「完了」）とし、接続設定
 *     (config.backlog_done_status_ids) で上書きできるようにする。
 */

const SPACE = 'https://example.backlog.jp'

function ctx(config?: Record<string, unknown>): ProviderContext {
  return { credentials: { kind: 'api_key', token: 'secret-key', baseUrl: SPACE }, config }
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

/** 直近の fetch 呼び出しのURLを URL オブジェクトで返す。 */
function lastUrl(): URL {
  const [url] = fetchMock.mock.calls[fetchMock.mock.calls.length - 1]
  return new URL(url as string)
}

describe('backlogAdapter — 宣言', () => {
  it('APIキー認証・ベースURL必須・差分は日付粒度', () => {
    expect(backlogAdapter.id).toBe('backlog')
    expect(backlogAdapter.authKind).toBe('api_key')
    expect(backlogAdapter.requiresBaseUrl).toBe(true)
    expect(backlogAdapter.cursorGranularity).toBe('date')
  })
})

describe('backlogAdapter.listContainers', () => {
  it('プロジェクト一覧を id/title に正規化する', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse([
        { id: 1, projectKey: 'ALPHA', name: 'アルファ案件', archived: false },
        { id: 2, projectKey: 'BETA', name: 'ベータ案件', archived: false },
      ]),
    )
    const containers = await backlogAdapter.listContainers(ctx())
    expect(containers).toEqual([
      { id: '1', title: 'アルファ案件' },
      { id: '2', title: 'ベータ案件' },
    ])
  })

  it('アーカイブ済みプロジェクトは取り込み対象から外す', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse([
        { id: 1, name: '現行案件', archived: false },
        { id: 2, name: '終了案件', archived: true },
      ]),
    )
    expect(await backlogAdapter.listContainers(ctx())).toEqual([{ id: '1', title: '現行案件' }])
  })

  it('APIキーをクエリで送り、スペースURL配下の /api/v2/projects を叩く', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([]))
    await backlogAdapter.listContainers(ctx())
    const url = lastUrl()
    expect(url.origin).toBe(SPACE)
    expect(url.pathname).toBe('/api/v2/projects')
    expect(url.searchParams.get('apiKey')).toBe('secret-key')
  })

  it('baseUrl が無い接続はプログラミングエラーとして弾く（誤ったホストへ鍵を送らない）', async () => {
    await expect(
      backlogAdapter.listContainers({ credentials: { kind: 'api_key', token: 'k', baseUrl: null } }),
    ).rejects.toThrow(/baseUrl/)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

/**
 * 接続先ホストの検証。APIキーがURLクエリに載る方式のため、送信先を間違えることが
 * そのまま鍵の漏洩になる。接続作成時の検証だけに頼らず（DNS再解決・古い保存行・別経路からの
 * 呼び出しがあるため）、**実際にリクエストを出すこの層でも毎回検証する**。
 */
describe('backlogAdapter — 送信先ホストの検証（鍵をBacklog以外へ出さない）', () => {
  const cases: Array<[string, string]> = [
    ['http（平文）', 'http://example.backlog.jp'],
    ['Backlog以外のホスト', 'https://evil.example.com'],
    ['userinfoで正規ホストに見せかけたURL', 'https://example.backlog.jp@evil.example.com'],
    ['ホスト名の末尾一致すり抜け', 'https://evil-backlog.jp'],
    ['サフィックスを含むだけの別ドメイン', 'https://backlog.jp.evil.com'],
    ['内部アドレス', 'https://127.0.0.1'],
    ['非標準ポート', 'https://example.backlog.jp:8443'],
  ]

  for (const [label, baseUrl] of cases) {
    it(`${label} は fetch する前に拒否する`, async () => {
      await expect(
        backlogAdapter.listContainers({ credentials: { kind: 'api_key', token: 'k', baseUrl } }),
      ).rejects.toMatchObject({ permanent: true })
      expect(fetchMock).not.toHaveBeenCalled()
    })
  }

  it('正規のBacklogドメイン(.backlog.jp / .backlog.com / .backlogtool.com)は通す', async () => {
    for (const baseUrl of [
      'https://example.backlog.jp',
      'https://example.backlog.com',
      'https://example.backlogtool.com',
    ]) {
      fetchMock.mockResolvedValueOnce(jsonResponse([]))
      await backlogAdapter.listContainers({ credentials: { kind: 'api_key', token: 'k', baseUrl } })
    }
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('リダイレクトを自動追跡しない（転送先へ鍵を渡さない）', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([]))
    await backlogAdapter.listContainers(ctx())
    const init = (fetchMock.mock.calls[0] as [string, RequestInit])[1]
    expect(init.redirect).toBe('manual')
  })

  it('エラー時に応答本文をログへ出さない（本文にURLや顧客データが含まれ得る）', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    fetchMock.mockResolvedValueOnce(jsonResponse({ leaked: 'apiKey=secret-key' }, 500))
    await expect(backlogAdapter.listContainers(ctx())).rejects.toMatchObject({ status: 500 })
    for (const call of errorSpy.mock.calls) {
      expect(JSON.stringify(call)).not.toContain('secret-key')
    }
    errorSpy.mockRestore()
  })

  it('例外メッセージにAPIキーを含めない', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({}, 500))
    const err = await backlogAdapter.listContainers(ctx()).catch((e: Error) => e)
    expect(err).toBeInstanceOf(Error)
    expect((err as Error).message).not.toContain('secret-key')
  })
})

describe('backlogAdapter.listChangedTasks', () => {
  const issue = {
    id: 101,
    issueKey: 'ALPHA-1',
    projectId: 1,
    summary: '契約書のドラフト',
    description: '初稿を作る',
    dueDate: '2026-07-31T00:00:00Z',
    status: { id: 2, name: '処理中' },
    assignee: { id: 55, name: '田中' },
    updated: '2026-07-20T10:00:00Z',
  }

  it('課題を ExternalTask に正規化する（期日はローカル日付文字列）', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([issue]))
    const page = await backlogAdapter.listChangedTasks(ctx(), '1', {})
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

  it('期日・本文・担当が無い課題も落とさず null に正規化する', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse([{ id: 102, projectId: 1, summary: '電話する', status: { id: 1, name: '未対応' } }]),
    )
    const page = await backlogAdapter.listChangedTasks(ctx(), '1', {})
    expect(page.items[0]).toMatchObject({ dueDate: null, body: null, assigneeKey: null, completed: false })
  })

  it('標準ステータス4(完了)を completed=true と判定する', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse([{ ...issue, id: 103, status: { id: 4, name: '完了' } }]),
    )
    const page = await backlogAdapter.listChangedTasks(ctx(), '1', {})
    expect(page.items[0].completed).toBe(true)
  })

  it('カスタムステータスを完了とみなす設定は既定(4)に「足す」（標準の完了を見落とさない）', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse([
        { ...issue, id: 104, status: { id: 9, name: '検収済み' } },
        { ...issue, id: 105, status: { id: 4, name: '完了' } },
        { ...issue, id: 106, status: { id: 2, name: '処理中' } },
      ]),
    )
    const page = await backlogAdapter.listChangedTasks(ctx({ backlog_done_status_ids: [9] }), '1', {})
    // 追加指定した 9 も、標準の 4 も完了。設定は既定を「置き換えない」＝
    // カスタムステータスを1つ足しただけで標準の完了課題が未完扱いに化ける事故を防ぐ。
    expect(page.items.map((t) => t.completed)).toEqual([true, true, false])
  })

  it('差分の起点(updatedSince)と対象プロジェクトをクエリに載せ、更新日時の昇順で取る', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([]))
    await backlogAdapter.listChangedTasks(ctx(), '7', { since: '2026-07-19' })
    const url = lastUrl()
    expect(url.pathname).toBe('/api/v2/issues')
    expect(url.searchParams.getAll('projectId[]')).toEqual(['7'])
    expect(url.searchParams.get('updatedSince')).toBe('2026-07-19')
    expect(url.searchParams.get('sort')).toBe('updated')
    expect(url.searchParams.get('order')).toBe('asc')
  })

  it('初回(差分の起点なし)は id 昇順で取る — offsetページング中の更新で古い課題を取りこぼさない', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([]))
    await backlogAdapter.listChangedTasks(ctx(), '7', {})
    // updated 昇順だとページ送り中に更新された課題が後方へ移動し、その分だけ未取得の課題が
    // offset の前へ詰めて飛ばされる。id は不変なので初回全件取得では安定した順序になる。
    expect(lastUrl().searchParams.get('sort')).toBe('created')
    expect(lastUrl().searchParams.get('order')).toBe('asc')
  })

  it('429 は復帰時刻(X-RateLimit-Reset)を retryAfterMs として載せる', async () => {
    const resetEpochSec = Math.floor(Date.now() / 1000) + 120
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 429,
      headers: new Headers({ 'X-RateLimit-Reset': String(resetEpochSec) }),
      json: async () => ({}),
      text: async () => '',
    } as Response)
    const err = await backlogAdapter.listChangedTasks(ctx(), '1', {}).catch((e) => e)
    expect(err.status).toBe(429)
    expect(err.retryAfterMs).toBeGreaterThan(60_000)
    expect(err.retryAfterMs).toBeLessThanOrEqual(120_000)
  })

  it('Retry-After(秒)しか無い場合もそれを使う', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 429,
      headers: new Headers({ 'Retry-After': '30' }),
      json: async () => ({}),
      text: async () => '',
    } as Response)
    const err = await backlogAdapter.listChangedTasks(ctx(), '1', {}).catch((e) => e)
    expect(err.retryAfterMs).toBe(30_000)
  })

  it('1ページ満杯なら次カーソル(offset)を返し、満たなければ null で打ち切る', async () => {
    const full = Array.from({ length: 100 }, (_, i) => ({ ...issue, id: 200 + i }))
    fetchMock.mockResolvedValueOnce(jsonResponse(full))
    const first = await backlogAdapter.listChangedTasks(ctx(), '1', {})
    expect(first.nextCursor).toBe('100')

    fetchMock.mockResolvedValueOnce(jsonResponse([issue]))
    const second = await backlogAdapter.listChangedTasks(ctx(), '1', { cursor: '100' })
    expect(lastUrl().searchParams.get('offset')).toBe('100')
    expect(second.nextCursor).toBeNull()
  })

  it('APIエラーは status を載せた例外にする（エンジンの恒久/一時失敗の分類に使う）', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ errors: [{ message: 'No such project' }] }, 404))
    await expect(backlogAdapter.listChangedTasks(ctx(), '1', {})).rejects.toMatchObject({ status: 404 })
  })
})

describe('backlogAdapter.completeTask', () => {
  it('課題のステータスを完了(4)へ更新する', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: 101 }))
    await backlogAdapter.completeTask(ctx(), { externalId: '101', containerId: '1' })

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(new URL(url).pathname).toBe('/api/v2/issues/101')
    expect(init.method).toBe('PATCH')
    // Backlog の書き込みAPIは application/x-www-form-urlencoded
    expect(String(init.body)).toContain('statusId=4')
  })

  it('書き戻し先のステータスは専用設定で指定する（完了とみなす集合とは別物）', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: 101 }))
    // 「どれを完了とみなすか(検知)」と「完了にするとき何を書くか(書込)」は別の関心事。
    // 検知の集合の先頭を書込先に流用すると、配列の順序という無関係な事情で書込先が決まってしまう。
    await backlogAdapter.completeTask(
      ctx({ backlog_done_status_ids: [9, 12], backlog_completion_status_id: 12 }),
      { externalId: '101', containerId: '1' },
    )
    expect(String((fetchMock.mock.calls[0] as [string, RequestInit])[1].body)).toContain('statusId=12')
  })

  it('書き戻し先が未設定なら標準の完了(4)を使う（検知の設定に引きずられない）', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: 101 }))
    await backlogAdapter.completeTask(ctx({ backlog_done_status_ids: [9] }), {
      externalId: '101',
      containerId: '1',
    })
    expect(String((fetchMock.mock.calls[0] as [string, RequestInit])[1].body)).toContain('statusId=4')
  })

  it('404(既に消えている)も status を保って投げ、呼び出し側が完了同義として握れるようにする', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ errors: [] }, 404))
    await expect(
      backlogAdapter.completeTask(ctx(), { externalId: '999', containerId: '1' }),
    ).rejects.toMatchObject({ status: 404 })
  })
})
