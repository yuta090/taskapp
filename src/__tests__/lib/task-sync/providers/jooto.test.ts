import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { jootoAdapter } from '@/lib/task-sync/providers/jooto'
import type { ProviderContext } from '@/lib/task-sync/types'

/**
 * Jooto アダプタ。
 *
 * Jooto API(OpenAPI 3.0。公式リファレンス https://www.jooto.com/api/reference/ 配下、
 * 実体は https://www.jooto.com/wp-content/uploads/2023/05/jooto-public-api.jp_.txt )の性質:
 *   - ホストは固定 https://api.jooto.com（Backlog/Redmineと違いテナント可変ではない）。
 *   - 認証はAPIキー方式(ヘッダー X-Jooto-Api-Key)とOAuth2.0の両方があるが、導入の速さを
 *     優先しBacklog同様まずAPIキー方式のみ対応する。
 *   - コンテナは「プロジェクト」= GET /v1/boards（archivedパラメータで絞り込み可）。
 *   - タスク一覧 GET /v1/boards/{id}/tasks には更新日時での差分取得パラメータが無いため
 *     cursorGranularity='none'（全件取得のみ）。
 *   - ページングは offset ではなく page/per_page。レスポンスの total_pages で次ページ判定。
 *   - 「完了」はstatus(固定enum: to_do/done/cancel/pending/in_progress)で表現され、
 *     プロジェクトごとの再定義ができないため config 上書きは設けず status==='done' 決め打ち。
 *   - archived タスクは真の削除相当が無いため deleted:true として表現する(deletionMode='tombstone')。
 */

const ORG_HOST = 'https://api.jooto.com'

function ctx(config?: Record<string, unknown>): ProviderContext {
  return { credentials: { kind: 'api_key', token: 'jooto-secret' }, config }
}

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(headers),
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

function callAt(i: number): [string, RequestInit | undefined] {
  return fetchMock.mock.calls[i] as [string, RequestInit | undefined]
}

function lastCall(): [string, RequestInit | undefined] {
  return callAt(fetchMock.mock.calls.length - 1)
}

function lastUrl(): URL {
  return new URL(lastCall()[0])
}

function urlAt(i: number): URL {
  return new URL(callAt(i)[0])
}

describe('jootoAdapter — 宣言', () => {
  it('APIキー認証・ホスト固定・差分取得は無し・削除はarchivedで検知できる', () => {
    expect(jootoAdapter.id).toBe('jooto')
    expect(jootoAdapter.authKind).toBe('api_key')
    expect(jootoAdapter.hostPolicy).toEqual({ kind: 'fixed', host: 'api.jooto.com' })
    expect(jootoAdapter.cursorGranularity).toBe('none')
    expect(jootoAdapter.deletionMode).toBe('tombstone')
  })
})

describe('jootoAdapter.listContainers', () => {
  it('プロジェクト(board)一覧を id/title に正規化する', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        boards: [
          { id: 1, title: 'アルファ案件', archived: false },
          { id: 2, title: 'ベータ案件', archived: false },
        ],
        page: 1,
        per_page: 100,
        total: 2,
        total_pages: 1,
      }),
    )
    const containers = await jootoAdapter.listContainers(ctx())
    expect(containers).toEqual([
      { id: '1', title: 'アルファ案件' },
      { id: '2', title: 'ベータ案件' },
    ])
  })

  it('未アーカイブのみ(archived=false)を指定して固定ホスト配下の /v1/boards を叩き、APIキーをヘッダーで送る', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ boards: [], page: 1, per_page: 100, total: 0, total_pages: 1 }))
    await jootoAdapter.listContainers(ctx())
    const url = lastUrl()
    const [, init] = lastCall()
    expect(url.origin).toBe(ORG_HOST)
    expect(url.pathname).toBe('/v1/boards')
    expect(url.searchParams.get('archived')).toBe('false')
    expect((init?.headers as Record<string, string>)['X-Jooto-Api-Key']).toBe('jooto-secret')
  })

  /**
   * 1ページ目しか取らないと、2ページ目以降のボードがエンジンに一度も渡らないまま
   * 「同期成功」としてカーソルが前進し、特定プロジェクトだけ永久に取り込まれない事故になる
   * （codexレビュー指摘）。全ページ取得を固定する。
   */
  it('total_pages が2以上の場合は全ページ取得する', async () => {
    const page1 = Array.from({ length: 100 }, (_, i) => ({ id: i + 1, title: `プロジェクト${i + 1}` }))
    const page2 = [{ id: 101, title: 'プロジェクト101' }]
    fetchMock.mockResolvedValueOnce(jsonResponse({ boards: page1, page: 1, per_page: 100, total: 101, total_pages: 2 }))
    fetchMock.mockResolvedValueOnce(jsonResponse({ boards: page2, page: 2, per_page: 100, total: 101, total_pages: 2 }))

    const containers = await jootoAdapter.listContainers(ctx())
    expect(containers).toHaveLength(101)
    expect(containers[100]).toEqual({ id: '101', title: 'プロジェクト101' })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(urlAt(1).searchParams.get('page')).toBe('2')
  })

  it('空バッチが返ったら(total_pagesの不整合等)無限ループせず打ち切る', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ boards: [], page: 1, per_page: 100, total: 999, total_pages: 10 }))
    const containers = await jootoAdapter.listContainers(ctx())
    expect(containers).toEqual([])
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

/**
 * ホストが固定のため、接続の credentials.baseUrl に何が入っていても常に api.jooto.com を叩く
 * （バグ・混線でユーザー入力が紛れ込んでも誤送信しない）。
 */
describe('jootoAdapter — ホスト固定の防御（credentials.baseUrlを無視する）', () => {
  it('baseUrlに別ホストが入っていても常に api.jooto.com を叩く', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ boards: [], page: 1, per_page: 100, total: 0, total_pages: 1 }))
    await jootoAdapter.listContainers({
      credentials: { kind: 'api_key', token: 'jooto-secret', baseUrl: 'https://evil.example.com' },
    })
    expect(lastUrl().origin).toBe(ORG_HOST)
  })

  it('リダイレクトを自動追跡しない（転送先へ鍵を渡さない）', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ boards: [], page: 1, per_page: 100, total: 0, total_pages: 1 }))
    await jootoAdapter.listContainers(ctx())
    const init = lastCall()[1]
    expect(init?.redirect).toBe('manual')
  })

  it('エラー時に応答本文をログへ出さない（本文に顧客データが含まれ得る）', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    fetchMock.mockResolvedValueOnce(jsonResponse({ leaked: 'secret-data' }, 500))
    await expect(jootoAdapter.listContainers(ctx())).rejects.toMatchObject({ status: 500 })
    for (const call of errorSpy.mock.calls) {
      expect(JSON.stringify(call)).not.toContain('secret-data')
    }
    errorSpy.mockRestore()
  })

  it('429 は復帰時刻(X-RateLimit-Reset)を retryAfterMs として載せる', async () => {
    const resetEpochSec = Math.floor(Date.now() / 1000) + 90
    fetchMock.mockResolvedValueOnce(jsonResponse({}, 429, { 'X-RateLimit-Reset': String(resetEpochSec) }))
    const err = await jootoAdapter.listContainers(ctx()).catch((e) => e)
    expect(err.status).toBe(429)
    expect(err.retryAfterMs).toBeGreaterThan(60_000)
    expect(err.retryAfterMs).toBeLessThanOrEqual(90_000)
  })

  it('Retry-After(秒)しか無い場合もそれを使う', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({}, 429, { 'Retry-After': '30' }))
    const err = await jootoAdapter.listContainers(ctx()).catch((e) => e)
    expect(err.retryAfterMs).toBe(30_000)
  })
})

describe('jootoAdapter.listChangedTasks', () => {
  const task = {
    id: 101,
    task_number: 5,
    name: '契約書のドラフト',
    description: '初稿を作る',
    assigned_user_ids: [55],
    deadline_date_time: '2026-07-31T00:00:00Z',
    status: 'in_progress',
    archived: false,
    updated_at: '2026-07-20T10:00:00Z',
    board_id: 1,
    list_id: 9,
  }

  it('タスクを ExternalTask に正規化する（期日はローカル日付文字列）', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ tasks: [task], page: 1, per_page: 100, total: 1, total_pages: 1 }),
    )
    const page = await jootoAdapter.listChangedTasks(ctx(), '1', {})
    expect(page.items).toEqual([
      {
        externalId: '101',
        containerId: '1',
        title: '契約書のドラフト',
        body: '初稿を作る',
        dueDate: '2026-07-31',
        completed: false,
        deleted: false,
        assigneeKey: '55',
        updatedAt: '2026-07-20T10:00:00Z',
      },
    ])
  })

  it('期日・本文・担当が無いタスクも落とさず null に正規化する', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        tasks: [{ id: 102, task_number: 6, name: '電話する', status: 'to_do', archived: false, board_id: 1, list_id: 9 }],
        page: 1,
        per_page: 100,
        total: 1,
        total_pages: 1,
      }),
    )
    const page = await jootoAdapter.listChangedTasks(ctx(), '1', {})
    expect(page.items[0]).toMatchObject({ dueDate: null, body: null, assigneeKey: null, completed: false })
  })

  it("status='done' を completed=true と判定する", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ tasks: [{ ...task, id: 103, status: 'done' }], page: 1, per_page: 100, total: 1, total_pages: 1 }),
    )
    const page = await jootoAdapter.listChangedTasks(ctx(), '1', {})
    expect(page.items[0].completed).toBe(true)
  })

  it("status='cancel' は完了扱いにしない（対応しない、であって完了ではない）", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ tasks: [{ ...task, id: 104, status: 'cancel' }], page: 1, per_page: 100, total: 1, total_pages: 1 }),
    )
    const page = await jootoAdapter.listChangedTasks(ctx(), '1', {})
    expect(page.items[0].completed).toBe(false)
  })

  it('archived=true のタスクは deleted:true として正規化する（真の削除相当が無いため）', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ tasks: [{ ...task, id: 105, archived: true }], page: 1, per_page: 100, total: 1, total_pages: 1 }),
    )
    const page = await jootoAdapter.listChangedTasks(ctx(), '1', {})
    expect(page.items[0].deleted).toBe(true)
  })

  it('対象プロジェクトのタスク一覧をページングパラメータ付きで取得する', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ tasks: [], page: 1, per_page: 100, total: 0, total_pages: 1 }))
    await jootoAdapter.listChangedTasks(ctx(), '7', {})
    const url = lastUrl()
    expect(url.pathname).toBe('/v1/boards/7/tasks')
    expect(url.searchParams.get('per_page')).toBe('100')
    expect(url.searchParams.get('page')).toBe('1')
  })

  it('total_pages より現ページが小さければ次カーソル(次ページ番号)を返し、最終ページなら null で打ち切る', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ tasks: [task], page: 1, per_page: 100, total: 250, total_pages: 3 }),
    )
    const first = await jootoAdapter.listChangedTasks(ctx(), '1', {})
    expect(first.nextCursor).toBe('2')

    fetchMock.mockResolvedValueOnce(
      jsonResponse({ tasks: [task], page: 3, per_page: 100, total: 250, total_pages: 3 }),
    )
    const last = await jootoAdapter.listChangedTasks(ctx(), '1', { cursor: '3' })
    expect(lastUrl().searchParams.get('page')).toBe('3')
    expect(last.nextCursor).toBeNull()
  })

  it('APIエラーは status を載せた例外にする（エンジンの恒久/一時失敗の分類に使う）', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ errors: [{ message: 'not found' }] }, 404))
    await expect(jootoAdapter.listChangedTasks(ctx(), '1', {})).rejects.toMatchObject({ status: 404 })
  })
})

describe('jootoAdapter.completeTask', () => {
  it("タスクのstatusを 'done' へ PATCH で更新する(application/json)", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: 101, status: 'done' }))
    await jootoAdapter.completeTask(ctx(), { externalId: '101', containerId: '1' })

    const [url, init] = lastCall()
    expect(new URL(url).pathname).toBe('/v1/boards/1/tasks/101')
    expect(init?.method).toBe('PATCH')
    expect((init?.headers as Record<string, string>)['Content-Type']).toBe('application/json')
    expect(JSON.parse(String(init?.body))).toEqual({ status: 'done' })
  })

  it('404(既に消えている)も status を保って投げ、呼び出し側が完了同義として握れるようにする', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ errors: [] }, 404))
    await expect(
      jootoAdapter.completeTask(ctx(), { externalId: '999', containerId: '1' }),
    ).rejects.toMatchObject({ status: 404 })
  })
})
