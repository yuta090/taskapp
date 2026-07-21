import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { trelloAdapter } from '@/lib/task-sync/providers/trello'
import type { ProviderContext } from '@/lib/task-sync/types'

/**
 * Trello アダプタ。
 *
 * Trello REST API（OpenAPI定義 https://developer.atlassian.com/cloud/trello/swagger.v3.json
 * を2026-07-21に取得して確認。ただしこの公式定義自体が疎で `/boards/{id}/cards` の
 * クエリパラメータ等は明記されていない箇所がある＝コード側コメントに「未確認」と明記する）の
 * 性質と、ここで吸収している差異:
 *   - 認証は `key`(アプリのAPIキー)と`token`(ユーザートークン)の2つをクエリで渡す
 *     （securitySchemes.APIKey/APIToken ともに type: apiKey, in: query で確認）。
 *     ProviderCredentials は token 1本しか持たないため、
 *     credentials.token=ユーザートークン(秘匿) / ctx.config.trello_api_key=APIキー(可視) に対応させる。
 *   - ホストは固定（https://api.trello.com/1）。
 *   - 差分取得: `/boards/{boardId}/actions` は `since`(ISO8601 or Mongo ObjectID) で絞れるが
 *     （公式定義で確認）、アクションは変更点の断片（例: updateCardの差分フィールド）しか持たず
 *     カードの完全な現在状態(due/desc等)を得るには結局カード個別GETが要る＝N+1になる上、
 *     全ての変更種別(チェックリスト変更等)がupdateCardアクションとして拾えるとは限らない。
 *     一方 `/boards/{id}/cards` 自体には差分フィルタが存在しない（公式定義に `since`/`before` の
 *     記載なし）ため、こちらを採用し cursorGranularity='none'（全件取得）で宣言する。
 *   - 完了判定: Trello に統一された「完了」概念は無い。`dueComplete`(期日チェックボックス) を
 *     既定の完了シグナルとし、`closed`(アーカイブ)は完了とみなさない（アーカイブは「done」とは
 *     限らず「重複/中止で隠した」等の意図もあるため、完了と混同すると誤って書き戻ってしまう）。
 *     多くの現場は期日を使わず「完了リストへ移動」で運用するため、接続設定
 *     `config.trello_done_list_ids` でリストIDを指定すればそちらを優先する。
 *   - 期日 `due` は実時刻を持つISO8601（日付のみではない）。素朴なUTC切り出しは日本時間で
 *     1日ずれうるため、Dateを経由しformatDateToLocalStringでローカル日付化する。
 *   - 担当者 `idMembers` は複数を返すが ExternalTask.assigneeKey は単一のため先頭のみを採用する
 *     （将来ユーザー対応付けに使う程度の情報のため、複数対応は今回のスコープ外という判断）。
 */

const BASE = 'https://api.trello.com/1'

function ctx(config?: Record<string, unknown>): ProviderContext {
  return {
    credentials: { kind: 'api_key', token: 'user-token-secret' },
    config: { trello_api_key: 'app-key-visible', ...config },
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
  return fetchMock.mock.calls[fetchMock.mock.calls.length - 1] as [string, RequestInit | undefined]
}

function lastUrl(): URL {
  return new URL(lastCall()[0])
}

describe('trelloAdapter — 宣言', () => {
  it('APIキー方式(key+token)・ベースURL不要・差分APIなし(全件取得)', () => {
    expect(trelloAdapter.id).toBe('trello')
    expect(trelloAdapter.authKind).toBe('api_key')
    expect(trelloAdapter.hostPolicy).toEqual({ kind: 'fixed', host: 'api.trello.com' })
    expect(trelloAdapter.cursorGranularity).toBe('none')
  })
})

describe('trelloAdapter.listContainers', () => {
  it('自分のオープンなボード一覧を id/title に正規化する', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse([
        { id: 'b1', name: 'アルファ案件', closed: false },
        { id: 'b2', name: 'ベータ案件', closed: false },
      ]),
    )
    const containers = await trelloAdapter.listContainers(ctx())
    expect(containers).toEqual([
      { id: 'b1', title: 'アルファ案件' },
      { id: 'b2', title: 'ベータ案件' },
    ])
  })

  it('key/tokenをクエリで送り、/members/me/boards をfilter=openで叩く', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([]))
    await trelloAdapter.listContainers(ctx())
    const url = lastUrl()
    expect(url.origin + url.pathname).toBe(`${BASE}/members/me/boards`)
    expect(url.searchParams.get('key')).toBe('app-key-visible')
    expect(url.searchParams.get('token')).toBe('user-token-secret')
    expect(url.searchParams.get('filter')).toBe('open')
  })

  it('trello_api_key が未設定の接続は配線ミスとして弾く', async () => {
    await expect(
      trelloAdapter.listContainers({ credentials: { kind: 'api_key', token: 't' }, config: {} }),
    ).rejects.toThrow(/trello_api_key/)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('trelloAdapter.listChangedTasks', () => {
  const card = {
    id: 'c1',
    name: '契約書のドラフト',
    desc: '初稿を作る',
    due: '2026-07-31T15:00:00.000Z', // JSTでは 08-01
    dueComplete: false,
    closed: false,
    idList: 'list-todo',
    idMembers: ['m1', 'm2'],
    dateLastActivity: '2026-07-20T10:00:00.000Z',
  }

  it('カードを ExternalTask に正規化する（期日はローカル日付、担当は先頭メンバー）', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([card]))
    const page = await trelloAdapter.listChangedTasks(ctx(), 'b1', {})
    expect(page.items).toEqual([
      {
        externalId: 'c1',
        containerId: 'b1',
        title: '契約書のドラフト',
        body: '初稿を作る',
        dueDate: '2026-08-01',
        completed: false,
        assigneeKey: 'm1',
        updatedAt: '2026-07-20T10:00:00.000Z',
      },
    ])
  })

  it('期日・本文・担当者が無いカードも落とさず null に正規化する', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse([{ id: 'c2', name: '電話する', idList: 'list-todo', idMembers: [] }]),
    )
    const page = await trelloAdapter.listChangedTasks(ctx(), 'b1', {})
    expect(page.items[0]).toMatchObject({ dueDate: null, body: null, assigneeKey: null, completed: false })
  })

  it('dueComplete=true を完了と判定する（既定の完了シグナル）', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([{ ...card, id: 'c3', dueComplete: true }]))
    const page = await trelloAdapter.listChangedTasks(ctx(), 'b1', {})
    expect(page.items[0].completed).toBe(true)
  })

  it('closed(アーカイブ)は既定では完了とみなさない', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([{ ...card, id: 'c4', closed: true, dueComplete: false }]))
    const page = await trelloAdapter.listChangedTasks(ctx(), 'b1', {})
    expect(page.items[0].completed).toBe(false)
  })

  it('接続設定 trello_done_list_ids を指定すればリスト所属で完了を判定する(dueCompleteより優先)', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse([
        { ...card, id: 'c5', idList: 'list-done', dueComplete: false },
        { ...card, id: 'c6', idList: 'list-todo', dueComplete: true },
      ]),
    )
    const page = await trelloAdapter.listChangedTasks(ctx({ trello_done_list_ids: ['list-done'] }), 'b1', {})
    // list-done所属のc5は完了。list-todo所属のc6はdueComplete=trueでも設定ありなら不採用。
    expect(page.items.map((t) => t.completed)).toEqual([true, false])
  })

  it('/boards/{id}/cards を叩き、nextCursorは常にnull(差分APIが無いため毎回全件取得)', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([card]))
    const page = await trelloAdapter.listChangedTasks(ctx(), 'b1', {})
    const url = lastUrl()
    expect(url.origin + url.pathname).toBe(`${BASE}/boards/b1/cards`)
    expect(page.nextCursor).toBeNull()
  })

  it('APIエラーは status を載せた例外にする', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ message: 'invalid id' }, 404))
    await expect(trelloAdapter.listChangedTasks(ctx(), 'b1', {})).rejects.toMatchObject({ status: 404 })
  })
})

describe('trelloAdapter.completeTask', () => {
  it('既定ではdueComplete=trueをPUTする', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: 'c1', dueComplete: true }))
    await trelloAdapter.completeTask(ctx(), { externalId: 'c1', containerId: 'b1' })

    const [url, init] = lastCall()
    const u = new URL(url)
    expect(u.origin + u.pathname).toBe(`${BASE}/cards/c1`)
    expect(init?.method).toBe('PUT')
    expect(u.searchParams.get('dueComplete')).toBe('true')
    expect(u.searchParams.get('key')).toBe('app-key-visible')
    expect(u.searchParams.get('token')).toBe('user-token-secret')
  })

  it('trello_done_list_idsが設定されていれば先頭のリストへ移動して完了を表す', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: 'c1' }))
    await trelloAdapter.completeTask(ctx({ trello_done_list_ids: ['list-done', 'list-archive'] }), {
      externalId: 'c1',
      containerId: 'b1',
    })
    const url = lastUrl()
    expect(url.searchParams.get('idList')).toBe('list-done')
    expect(url.searchParams.get('dueComplete')).toBeNull()
  })

  it('404(既に消えている)も status を保って投げる', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ message: 'not found' }, 404))
    await expect(
      trelloAdapter.completeTask(ctx(), { externalId: 'x', containerId: 'b1' }),
    ).rejects.toMatchObject({ status: 404 })
  })
})
