import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { chatworkTaskAdapter } from '@/lib/task-sync/providers/chatwork'
import type { ProviderContext } from '@/lib/task-sync/types'

/**
 * Chatwork タスク アダプタ。
 *
 * 公式APIリファレンス（https://developer.chatwork.com/reference/ 配下）で確認した性質と、
 * ここで吸収している差異:
 *   - ホストは固定 `https://api.chatwork.com`、認証はヘッダー `X-ChatworkToken`（APIキー）。
 *     運用者が自分で発行できる（Backlog/Jooto と同じ判断）。
 *   - コンテナは「チャット」= `GET /rooms`。role='readonly' のチャットは完了の書き戻しが
 *     できないため候補に出さない（出すと必ず失敗する接続を作らせてしまう）。
 *   - タスク一覧 `GET /rooms/{room_id}/tasks` は **最大100件・ページングなし・更新日時での
 *     絞り込みも無い** → cursorGranularity='none'（毎回取り直し）・nextCursor は常に null。
 *   - status を省略すると未完了/完了のどちらが返るか仕様上あいまいなため、`status=open` と
 *     `status=done` を明示して2回叩き、完了の取り込みを確実にする。
 *   - タスクは本文（body）だけでタイトルを持たない → 1行目をタイトルに、全文を本文にする。
 *   - 期限は `limit_time`（UNIX秒）＋ `limit_type`（none/date/time）。Chatworkは日本のサービスで
 *     期限はJSTで設定されるため、**JSTの暦日**に落とす（サーバのTZに依存させない）。
 *   - 空のタスク一覧は 204 No Content（本文なし）で返るため、json() を呼ばずに空配列にする。
 */

function ctx(config?: Record<string, unknown>): ProviderContext {
  return { credentials: { kind: 'api_key', token: 'cw-secret' }, config }
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

/** 204 No Content（本文が無いので json() を呼ぶと例外になる、という実物の挙動を再現する） */
function noContentResponse(): Response {
  return {
    ok: true,
    status: 204,
    headers: new Headers(),
    json: async () => {
      throw new SyntaxError('Unexpected end of JSON input')
    },
    text: async () => '',
  } as unknown as Response
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

function urlAt(i: number): URL {
  return new URL(callAt(i)[0])
}

function task(over: Record<string, unknown> = {}) {
  return {
    task_id: 3,
    account: { account_id: 78, name: '山田' },
    assigned_by_account: { account_id: 456, name: '佐藤' },
    message_id: '13245',
    body: '請求書を確認してください',
    limit_time: 0,
    status: 'open',
    limit_type: 'none',
    ...over,
  }
}

describe('chatworkTaskAdapter — 宣言', () => {
  it('APIキー認証・ホスト固定・差分取得なし・削除は検知できない', () => {
    expect(chatworkTaskAdapter.id).toBe('chatwork')
    expect(chatworkTaskAdapter.authKind).toBe('api_key')
    expect(chatworkTaskAdapter.hostPolicy).toEqual({ kind: 'fixed', host: 'api.chatwork.com' })
    expect(chatworkTaskAdapter.cursorGranularity).toBe('none')
    // 100件で打ち切られ得るため「応答に無い＝削除」と断定できない（誤って対応を切らない）
    expect(chatworkTaskAdapter.deletionMode).toBe('unsupported')
  })

  it('TaskAppからの起票（createTask）は提供しない＝取り込み＋完了の書き戻し専用', () => {
    // POST /rooms/{id}/tasks は担当者(to_ids)が必須で、誰に割り当てるかを決められないため
    expect(chatworkTaskAdapter.createTask).toBeUndefined()
  })
})

describe('chatworkTaskAdapter.listContainers', () => {
  it('チャット一覧を取得し、閲覧のみ(readonly)のチャットは候補から外す', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse([
        { room_id: 123, name: '顧問先A', type: 'group', role: 'admin' },
        { room_id: 124, name: '閲覧だけの部屋', type: 'group', role: 'readonly' },
        { room_id: 125, name: '個別やり取り', type: 'direct', role: 'member' },
      ]),
    )

    const containers = await chatworkTaskAdapter.listContainers(ctx())

    expect(urlAt(0).toString()).toBe('https://api.chatwork.com/v2/rooms')
    expect(callAt(0)[1]?.headers).toMatchObject({ 'X-ChatworkToken': 'cw-secret' })
    expect(containers).toEqual([
      { id: '123', title: '顧問先A' },
      { id: '125', title: '個別やり取り' },
    ])
  })

  it('名前が無いチャットはIDで代替する', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([{ room_id: 9, type: 'group', role: 'member' }]))
    await expect(chatworkTaskAdapter.listContainers(ctx())).resolves.toEqual([{ id: '9', title: '9' }])
  })
})

describe('chatworkTaskAdapter.listChangedTasks', () => {
  it('未完了と完了を明示的に2回取得し、1ページで取り切る（ページングが無いため）', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse([task({ task_id: 1, status: 'open' })]))
      .mockResolvedValueOnce(jsonResponse([task({ task_id: 2, status: 'done' })]))

    const page = await chatworkTaskAdapter.listChangedTasks(ctx(), '123', {})

    expect(urlAt(0).pathname).toBe('/v2/rooms/123/tasks')
    expect(urlAt(0).searchParams.get('status')).toBe('open')
    expect(urlAt(1).searchParams.get('status')).toBe('done')
    expect(page.items.map((t) => t.externalId)).toEqual(['1', '2'])
    expect(page.items.map((t) => t.completed)).toEqual([false, true])
    // ページングが無いので次ページは常に無い
    expect(page.nextCursor).toBeNull()
  })

  it('タスクが無いチャットは204で返るため、空配列にする（json()を呼ばない）', async () => {
    fetchMock.mockResolvedValueOnce(noContentResponse()).mockResolvedValueOnce(noContentResponse())

    const page = await chatworkTaskAdapter.listChangedTasks(ctx(), '123', {})

    expect(page).toEqual({ items: [], nextCursor: null })
  })

  it('本文の1行目をタイトルにし、全文を本文として残す', async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse([task({ body: '  請求書を送る  \n期日までにお願いします\n（添付あり）' })]),
      )
      .mockResolvedValueOnce(jsonResponse([]))

    const [item] = (await chatworkTaskAdapter.listChangedTasks(ctx(), '123', {})).items

    expect(item.title).toBe('請求書を送る')
    expect(item.body).toBe('請求書を送る\n期日までにお願いします\n（添付あり）')
  })

  it('1行しかない本文は本文をnullにする（タイトルと同じ内容を二重に持たない）', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse([task({ body: '請求書を送る' })]))
      .mockResolvedValueOnce(jsonResponse([]))

    const [item] = (await chatworkTaskAdapter.listChangedTasks(ctx(), '123', {})).items

    expect(item.title).toBe('請求書を送る')
    expect(item.body).toBeNull()
  })

  it('本文が空のタスクもタイトルを空にしない', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse([task({ body: '   ' })]))
      .mockResolvedValueOnce(jsonResponse([]))

    const [item] = (await chatworkTaskAdapter.listChangedTasks(ctx(), '123', {})).items

    expect(item.title).toBe('(無題)')
    expect(item.body).toBeNull()
  })

  it('期限はJSTの暦日に落とす（サーバのTZに依存しない）', async () => {
    // 2026-07-26 08:00 JST = 2026-07-25 23:00 UTC。UTCで日付を取ると前日にずれる値を選ぶ。
    const limitTime = Math.floor(Date.UTC(2026, 6, 25, 23, 0, 0) / 1000)
    fetchMock
      .mockResolvedValueOnce(jsonResponse([task({ limit_time: limitTime, limit_type: 'time' })]))
      .mockResolvedValueOnce(jsonResponse([]))

    const [item] = (await chatworkTaskAdapter.listChangedTasks(ctx(), '123', {})).items

    expect(item.dueDate).toBe('2026-07-26')
  })

  it('期限なし（limit_type=none / limit_time=0）は null', async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse([
          task({ task_id: 1, limit_type: 'none', limit_time: 0 }),
          task({ task_id: 2, limit_type: 'none', limit_time: 1785000000 }),
        ]),
      )
      .mockResolvedValueOnce(jsonResponse([]))

    const items = (await chatworkTaskAdapter.listChangedTasks(ctx(), '123', {})).items

    expect(items.map((t) => t.dueDate)).toEqual([null, null])
  })

  it('担当者とコンテナIDを保持する', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse([task({ account: { account_id: 78, name: '山田' } })]))
      .mockResolvedValueOnce(jsonResponse([]))

    const [item] = (await chatworkTaskAdapter.listChangedTasks(ctx(), '123', {})).items

    expect(item.containerId).toBe('123')
    expect(item.assigneeKey).toBe('78')
    // 更新日時を返すフィールドがAPIに無いので、あると偽らない
    expect(item.updatedAt).toBeNull()
  })
})

describe('chatworkTaskAdapter.completeTask', () => {
  it('フォーム形式で body=done を送る', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ task_id: 3 }))

    await chatworkTaskAdapter.completeTask(ctx(), { externalId: '3', containerId: '123' })

    const [url, init] = callAt(0)
    expect(url).toBe('https://api.chatwork.com/v2/rooms/123/tasks/3/status')
    expect(init?.method).toBe('PUT')
    expect(init?.body).toBe('body=done')
    expect(init?.headers).toMatchObject({
      'X-ChatworkToken': 'cw-secret',
      'Content-Type': 'application/x-www-form-urlencoded',
    })
  })

  it('404はstatusを保った例外にする（既に消えている＝呼び出し側が完了と同義に扱える）', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ errors: ['not found'] }, 404))

    await expect(
      chatworkTaskAdapter.completeTask(ctx(), { externalId: '3', containerId: '123' }),
    ).rejects.toMatchObject({ status: 404 })
  })
})

describe('chatworkTaskAdapter — 失敗の分類', () => {
  it('429はX-RateLimit-Reset(UNIX秒)から復帰時刻を載せる', async () => {
    const resetSec = Math.floor(Date.now() / 1000) + 90
    fetchMock.mockResolvedValue(
      jsonResponse({ errors: ['rate limit'] }, 429, { 'X-RateLimit-Reset': String(resetSec) }),
    )

    const err = await chatworkTaskAdapter.listContainers(ctx()).catch((e) => e)

    expect(err.status).toBe(429)
    expect(err.retryAfterMs).toBeGreaterThan(0)
  })

  it('401は恒久失敗として status を載せる（キーの入れ違いは再試行で直らない）', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ errors: ['invalid token'] }, 401))

    await expect(chatworkTaskAdapter.listContainers(ctx())).rejects.toMatchObject({ status: 401 })
  })

  it('リダイレクトは恒久失敗にする（正規のAPIは返さない＝設定ミスか介在者）', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(null, 302))

    await expect(chatworkTaskAdapter.listContainers(ctx())).rejects.toMatchObject({
      status: 400,
      permanent: true,
    })
  })

  it('ネットワーク例外は一時失敗（statusを付けない＝エンジンが再試行できる）', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('network down'))

    const err = await chatworkTaskAdapter.listContainers(ctx()).catch((e) => e)

    expect(err.status).toBeUndefined()
    expect(err.permanent).toBeUndefined()
    // 外部の例外メッセージをそのまま載せない（種別だけ）
    expect(err.message).toContain('TypeError')
    expect(err.message).not.toContain('network down')
  })
})
