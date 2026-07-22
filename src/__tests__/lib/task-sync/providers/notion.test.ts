import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { notionAdapter, NOTION_VERSION } from '@/lib/task-sync/providers/notion'
import type { ProviderContext } from '@/lib/task-sync/types'
import type { NotionMapping } from '@/lib/task-sync/providers/notion/mapping'

/**
 * Notion アダプタ — inbound（取り込み）＋ 完了の書き戻しのみ（createTask/updateTask は未実装）。
 *
 * Notion API（2022-06-28。既存 sink アダプタ src/lib/sinks/adapters/notion.ts と同じ
 * Notion-Version に揃える）の性質と、ここで吸収している差異:
 *   - ホストは固定 `api.notion.com`。認証はワークスペース単位の無期限アクセストークン
 *     （既存 notion/client.ts の OAuth 済みトークンを再利用。refresh は無い）。
 *   - `POST /v1/search`（filter: object=database）で共有DB一覧を取得（listContainers）。
 *   - `POST /v1/databases/{id}/query` で差分取得。`last_edited_time` の timestamp フィルタで絞り、
 *     昇順ソート。ページングは `start_cursor`/`next_cursor`（cursorGranularity='timestamp'）。
 *   - Notion DB のプロパティ構造はユーザーごとに違うため、`config.notion_mappings[databaseId]`
 *     に接続時に確定したマッピングを渡す。マッピングが無いDBは恒久エラーで止める
 *     （エンジンがコンテナ単位で停止しカーソル前進しない＝drift/未設定時の停止方針）。
 *   - 完了は status/select(option id)またはcheckbox(真偽)のいずれか、マッピングで指定した型に従う。
 */

const TOKEN = 'notion-secret-token'

function ctx(config?: Record<string, unknown>): ProviderContext {
  return { credentials: { kind: 'oauth', token: TOKEN }, config }
}

function statusMapping(overrides: Partial<NotionMapping['status']> = {}): NotionMapping['status'] {
  return {
    prop_id: 'status-1',
    prop_type: 'status',
    done_option_ids: ['opt-done'],
    write_done_option_id: 'opt-done',
    ...overrides,
  }
}

function mappingConfig(mapping: NotionMapping, databaseId = 'db-1'): Record<string, unknown> {
  return { notion_mappings: { [databaseId]: mapping } }
}

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
    headers: new Headers(),
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

function lastCall(): [string, RequestInit] {
  return fetchMock.mock.calls[fetchMock.mock.calls.length - 1] as [string, RequestInit]
}

function lastBody(): Record<string, unknown> {
  const [, init] = lastCall()
  return JSON.parse(String(init.body)) as Record<string, unknown>
}

/**
 * listChangedTasks は cursor 未指定(=コンテナのポーリング初回ページ)のとき、query の前に
 * 必ず GET /v1/databases/{id}(databases.retrieve) でライブスキーマを取りに行く(実行時drift再検証)。
 * このヘルパーはその応答を組み立てる。プロパティの status/select は options を持つ。
 */
function liveSchemaResponse(
  entries: Array<{ name?: string; id: string; type: string; options?: { id: string; name: string }[] }>,
): Response {
  const properties: Record<string, unknown> = {}
  for (const e of entries) {
    const key = e.name ?? e.id
    properties[key] = {
      id: e.id,
      name: key,
      type: e.type,
      ...(e.type === 'status' ? { status: { options: e.options ?? [] } } : {}),
      ...(e.type === 'select' ? { select: { options: e.options ?? [] } } : {}),
    }
  }
  return jsonResponse({ properties })
}

/** due_prop_id/status いずれも null のマッピング用: 検証対象が無いので空スキーマで常に妥当。 */
function emptySchemaResponse(): Response {
  return jsonResponse({ properties: {} })
}

describe('NOTION_VERSION — トリップワイヤー', () => {
  it(
    'バージョンを上げるなら search の filter 形(value:\'database\' → data_source)と ' +
      'databases.query / pages PATCH の互換を確認してから、この期待値を更新すること',
    () => {
      // NOTION_VERSION='2022-06-28' の前提: listContainers の POST /v1/search が
      // filter:{value:'database', property:'object'} を使っている。Notion API 2025-09-03 では
      // databases が data sources へ移行し、この filter は無効(page/data_sourceのみ有効)になる。
      // 気づかずバージョンだけ上げると、search が何もマッチせず listContainers が例外なしに
      // 空配列を返し、「取り込み対象が0件」という無言の同期停止(silent failure)になる。
      // このテストは「上げるな」ではなく「上げる前に上記2点を確認してから期待値を更新しろ」の意。
      expect(NOTION_VERSION).toBe('2022-06-28')
    },
  )
})

describe('notionAdapter — 宣言', () => {
  it('oauth認証・固定ホスト・timestamp粒度・削除検知なし', () => {
    expect(notionAdapter.id).toBe('notion')
    expect(notionAdapter.authKind).toBe('oauth')
    expect(notionAdapter.hostPolicy).toEqual({ kind: 'fixed', host: 'api.notion.com' })
    expect(notionAdapter.cursorGranularity).toBe('timestamp')
    expect(notionAdapter.deletionMode).toBe('unsupported')
  })

  it('createTask/updateTask は実装しない(取り込み専用+完了書き戻しのみ)', () => {
    expect(notionAdapter.createTask).toBeUndefined()
    expect(notionAdapter.updateTask).toBeUndefined()
  })
})

describe('notionAdapter.listContainers', () => {
  it('POST /v1/search で database を検索し id/title に正規化する', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        results: [
          { id: 'db-1', title: [{ plain_text: '案件' }, { plain_text: 'タスク' }] },
          { id: 'db-2', title: [{ plain_text: 'メモDB' }] },
        ],
        next_cursor: null,
        has_more: false,
      }),
    )
    const containers = await notionAdapter.listContainers(ctx())
    expect(containers).toEqual([
      { id: 'db-1', title: '案件タスク' },
      { id: 'db-2', title: 'メモDB' },
    ])

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(new URL(url).origin).toBe('https://api.notion.com')
    expect(new URL(url).pathname).toBe('/v1/search')
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKEN}`)
    expect((init.headers as Record<string, string>)['Notion-Version']).toBe('2022-06-28')
    const body = JSON.parse(String(init.body)) as Record<string, unknown>
    expect(body.filter).toEqual({ value: 'database', property: 'object' })
  })

  it('has_more の間はページングして全件集約する', async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          results: [{ id: 'db-1', title: [{ plain_text: 'DB1' }] }],
          next_cursor: 'cursor-1',
          has_more: true,
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          results: [{ id: 'db-2', title: [{ plain_text: 'DB2' }] }],
          next_cursor: null,
          has_more: false,
        }),
      )
    const containers = await notionAdapter.listContainers(ctx())
    expect(containers).toEqual([
      { id: 'db-1', title: 'DB1' },
      { id: 'db-2', title: 'DB2' },
    ])
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const secondBody = JSON.parse(String((fetchMock.mock.calls[1] as [string, RequestInit])[1].body)) as Record<
      string,
      unknown
    >
    expect(secondBody.start_cursor).toBe('cursor-1')
  })

  it('title が無いDBは id をタイトル代わりに使う', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ results: [{ id: 'db-3' }], next_cursor: null, has_more: false }),
    )
    const containers = await notionAdapter.listContainers(ctx())
    expect(containers).toEqual([{ id: 'db-3', title: 'db-3' }])
  })

  it('has_more=trueなのにnext_cursorが空(応答不整合)なら、取り切ったことにせずエラーにする', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ results: [{ id: 'db-1', title: [{ plain_text: 'DB1' }] }], next_cursor: null, has_more: true }),
    )
    await expect(notionAdapter.listContainers(ctx())).rejects.toThrow(/next_cursorが空/)
  })

  it('next_cursorが前回から前進していない(応答不整合)ならエラーにする', async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          results: [{ id: 'db-1', title: [{ plain_text: 'DB1' }] }],
          next_cursor: 'cursor-1',
          has_more: true,
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          results: [{ id: 'db-2', title: [{ plain_text: 'DB2' }] }],
          next_cursor: 'cursor-1', // 前回と同じ=前進していない
          has_more: true,
        }),
      )
    await expect(notionAdapter.listContainers(ctx())).rejects.toThrow(/前進していません/)
  })
})

describe('notionAdapter.listChangedTasks — マッピング未設定', () => {
  /**
   * ⚠ 「未マッピング(設定途中の正常な状態)」と「マッピングが壊れている(異常)」の区別
   * （kintoneアダプタと同じ是正。共有直後・マッピングウィザード未完了のDBが1つあるだけで
   * 接続全体の取り込みが止まっていた実バグの再現テスト）。notion_mappingsにdatabaseIdの
   * エントリ自体が無い(=まだウィザードを完了していない)場合だけ pendingConfig:true を立てる。
   * エンジン(engine.ts)はこのフラグを見て、このDBだけを対象から外し、他のDBの取り込みは続行する。
   */
  it('databaseId のマッピングのエントリ自体が無い(未設定)場合はpendingConfig:trueで区別してfetchする前に止める', async () => {
    await expect(notionAdapter.listChangedTasks(ctx(), 'db-1', {})).rejects.toMatchObject({
      permanent: true,
      status: 400,
      pendingConfig: true,
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('notion_mappingsに他DBのエントリはあるが、このdatabaseId自体のエントリが無い場合もpendingConfig:trueになる', async () => {
    await expect(
      notionAdapter.listChangedTasks(ctx({ notion_mappings: { 'db-other': { due_prop_id: null, status: null, confirmed_at: '2026-01-01T00:00:00.000Z' } } }), 'db-1', {}),
    ).rejects.toMatchObject({ permanent: true, status: 400, pendingConfig: true })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('エントリはあるが値が不正(壊れている)なDBは、未設定とは区別しpendingConfigを立てずに止める', async () => {
    // due_prop_id が数値(不正な形式)＝parseNotionMappingが拒否する壊れたデータ。
    // 「まだ設定していない」のではなく異常な状態なので、エンジンはこのコンテナだけを
    // 対象から外さず接続全体を止める(従来どおり)。
    let caught: unknown
    try {
      await notionAdapter.listChangedTasks(ctx({ notion_mappings: { 'db-1': { due_prop_id: 123 } } }), 'db-1', {})
    } catch (err) {
      caught = err
    }
    expect(caught).toMatchObject({ permanent: true })
    expect((caught as { pendingConfig?: boolean }).pendingConfig).toBeUndefined()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('notionAdapter.listChangedTasks — 正規化', () => {
  function pageFixture(overrides: Record<string, unknown> = {}) {
    return {
      id: 'page-1',
      last_edited_time: '2026-07-20T10:00:00.000Z',
      properties: {
        Name: { id: 'title', type: 'title', title: [{ plain_text: '契約書のドラフト' }] },
        期日: { id: 'due-1', type: 'date', date: { start: '2026-07-31' } },
        ステータス: { id: 'status-1', type: 'status', status: { id: 'opt-doing', name: '対応中' } },
      },
      ...overrides,
    }
  }

  it('date/title/statusを ExternalTask に正規化する', async () => {
    fetchMock.mockResolvedValueOnce(
      liveSchemaResponse([
        { id: 'due-1', type: 'date' },
        { id: 'status-1', type: 'status', options: [{ id: 'opt-done', name: '完了' }] },
      ]),
    )
    fetchMock.mockResolvedValueOnce(jsonResponse({ results: [pageFixture()], next_cursor: null, has_more: false }))
    const mapping: NotionMapping = {
      due_prop_id: 'due-1',
      status: statusMapping(),
      confirmed_at: '2026-07-01T00:00:00.000Z',
    }
    const page = await notionAdapter.listChangedTasks(ctx(mappingConfig(mapping)), 'db-1', {})
    expect(page.items).toEqual([
      {
        externalId: 'page-1',
        containerId: 'db-1',
        title: '契約書のドラフト',
        body: null,
        dueDate: '2026-07-31',
        completed: false,
        updatedAt: '2026-07-20T10:00:00.000Z',
      },
    ])
  })

  it('期日プロパティが実時刻を持っていても先頭10文字のローカル日付に落とす(UTC変換しない)', async () => {
    fetchMock.mockResolvedValueOnce(liveSchemaResponse([{ id: 'due-1', type: 'date' }]))
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        results: [
          pageFixture({
            properties: {
              Name: { id: 'title', type: 'title', title: [{ plain_text: 'T' }] },
              期日: { id: 'due-1', type: 'date', date: { start: '2026-07-31T23:00:00.000+09:00' } },
            },
          }),
        ],
        next_cursor: null,
        has_more: false,
      }),
    )
    const mapping: NotionMapping = { due_prop_id: 'due-1', status: null, confirmed_at: '2026-01-01T00:00:00.000Z' }
    const page = await notionAdapter.listChangedTasks(ctx(mappingConfig(mapping)), 'db-1', {})
    expect(page.items[0].dueDate).toBe('2026-07-31')
  })

  it('due_prop_id が null なら常に dueDate=null', async () => {
    fetchMock.mockResolvedValueOnce(emptySchemaResponse())
    fetchMock.mockResolvedValueOnce(jsonResponse({ results: [pageFixture()], next_cursor: null, has_more: false }))
    const mapping: NotionMapping = { due_prop_id: null, status: null, confirmed_at: '2026-01-01T00:00:00.000Z' }
    const page = await notionAdapter.listChangedTasks(ctx(mappingConfig(mapping)), 'db-1', {})
    expect(page.items[0].dueDate).toBeNull()
  })

  it('期日プロパティ値が空(date:null)なら dueDate=null', async () => {
    fetchMock.mockResolvedValueOnce(liveSchemaResponse([{ id: 'due-1', type: 'date' }]))
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        results: [
          pageFixture({
            properties: {
              Name: { id: 'title', type: 'title', title: [{ plain_text: 'T' }] },
              期日: { id: 'due-1', type: 'date', date: null },
            },
          }),
        ],
        next_cursor: null,
        has_more: false,
      }),
    )
    const mapping: NotionMapping = { due_prop_id: 'due-1', status: null, confirmed_at: '2026-01-01T00:00:00.000Z' }
    const page = await notionAdapter.listChangedTasks(ctx(mappingConfig(mapping)), 'db-1', {})
    expect(page.items[0].dueDate).toBeNull()
  })

  it('status型: done_option_idsに含まれるoptionなら completed=true', async () => {
    fetchMock.mockResolvedValueOnce(
      liveSchemaResponse([{ id: 'status-1', type: 'status', options: [{ id: 'opt-done', name: '完了' }] }]),
    )
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        results: [
          pageFixture({
            properties: {
              Name: { id: 'title', type: 'title', title: [{ plain_text: 'T' }] },
              ステータス: { id: 'status-1', type: 'status', status: { id: 'opt-done', name: '完了' } },
            },
          }),
        ],
        next_cursor: null,
        has_more: false,
      }),
    )
    const mapping: NotionMapping = { due_prop_id: null, status: statusMapping(), confirmed_at: '2026-01-01T00:00:00.000Z' }
    const page = await notionAdapter.listChangedTasks(ctx(mappingConfig(mapping)), 'db-1', {})
    expect(page.items[0].completed).toBe(true)
  })

  it('select型: done_option_idsに含まれるoptionなら completed=true', async () => {
    fetchMock.mockResolvedValueOnce(
      liveSchemaResponse([{ id: 'select-1', type: 'select', options: [{ id: 'sel-closed', name: 'クローズ' }] }]),
    )
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        results: [
          pageFixture({
            properties: {
              Name: { id: 'title', type: 'title', title: [{ plain_text: 'T' }] },
              区分: { id: 'select-1', type: 'select', select: { id: 'sel-closed', name: 'クローズ' } },
            },
          }),
        ],
        next_cursor: null,
        has_more: false,
      }),
    )
    const mapping: NotionMapping = {
      due_prop_id: null,
      status: statusMapping({ prop_id: 'select-1', prop_type: 'select', done_option_ids: ['sel-closed'], write_done_option_id: 'sel-closed' }),
      confirmed_at: '2026-01-01T00:00:00.000Z',
    }
    const page = await notionAdapter.listChangedTasks(ctx(mappingConfig(mapping)), 'db-1', {})
    expect(page.items[0].completed).toBe(true)
  })

  it('checkbox型: trueなら completed=true', async () => {
    fetchMock.mockResolvedValueOnce(liveSchemaResponse([{ id: 'checkbox-1', type: 'checkbox' }]))
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        results: [
          pageFixture({
            properties: {
              Name: { id: 'title', type: 'title', title: [{ plain_text: 'T' }] },
              完了チェック: { id: 'checkbox-1', type: 'checkbox', checkbox: true },
            },
          }),
        ],
        next_cursor: null,
        has_more: false,
      }),
    )
    const mapping: NotionMapping = {
      due_prop_id: null,
      status: statusMapping({ prop_id: 'checkbox-1', prop_type: 'checkbox', done_option_ids: [], write_done_option_id: null }),
      confirmed_at: '2026-01-01T00:00:00.000Z',
    }
    const page = await notionAdapter.listChangedTasks(ctx(mappingConfig(mapping)), 'db-1', {})
    expect(page.items[0].completed).toBe(true)
  })

  it('statusマッピングが無ければ completed は常にfalse', async () => {
    fetchMock.mockResolvedValueOnce(emptySchemaResponse())
    fetchMock.mockResolvedValueOnce(jsonResponse({ results: [pageFixture()], next_cursor: null, has_more: false }))
    const mapping: NotionMapping = { due_prop_id: null, status: null, confirmed_at: '2026-01-01T00:00:00.000Z' }
    const page = await notionAdapter.listChangedTasks(ctx(mappingConfig(mapping)), 'db-1', {})
    expect(page.items[0].completed).toBe(false)
  })

  it('複数のリッチテキスト片を連結してタイトルにする', async () => {
    fetchMock.mockResolvedValueOnce(emptySchemaResponse())
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        results: [
          pageFixture({
            properties: {
              Name: {
                id: 'title',
                type: 'title',
                title: [{ plain_text: '前半' }, { plain_text: '後半' }],
              },
            },
          }),
        ],
        next_cursor: null,
        has_more: false,
      }),
    )
    const mapping: NotionMapping = { due_prop_id: null, status: null, confirmed_at: '2026-01-01T00:00:00.000Z' }
    const page = await notionAdapter.listChangedTasks(ctx(mappingConfig(mapping)), 'db-1', {})
    expect(page.items[0].title).toBe('前半後半')
  })
})

describe('notionAdapter.listChangedTasks — ページ値の信頼境界(期日が無言で消える経路の防止)', () => {
  /**
   * 初回ページのライブスキーマ検証(assertMappingMatchesLiveSchema)を通った後でも、そのページの
   * 応答自体が不整合（プロパティ欠落・型変更・不正な日付）なら、期日を無言でnullに潰さず
   * 一時失敗として止める。正常な「期日なし」は date プロパティが存在し値が null のときだけ。
   */

  function pageFixture(overrides: Record<string, unknown> = {}) {
    return {
      id: 'page-1',
      last_edited_time: '2026-07-20T10:00:00.000Z',
      properties: {},
      ...overrides,
    }
  }

  it('(a) マッピング済みの期日プロパティがページ応答に存在しなければエラーにする(nullに潰さない)', async () => {
    fetchMock.mockResolvedValueOnce(liveSchemaResponse([{ id: 'due-1', type: 'date' }]))
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        results: [
          pageFixture({
            properties: {
              Name: { id: 'title', type: 'title', title: [{ plain_text: 'T' }] },
              // 期日プロパティ(due-1)自体が応答に無い。
            },
          }),
        ],
        next_cursor: null,
        has_more: false,
      }),
    )
    const mapping: NotionMapping = { due_prop_id: 'due-1', status: null, confirmed_at: '2026-01-01T00:00:00.000Z' }
    const err = await notionAdapter.listChangedTasks(ctx(mappingConfig(mapping)), 'db-1', {}).catch((e) => e)
    expect(err.message).toContain('プロパティがページ応答に存在しません')
    expect(err.permanent).toBeFalsy() // 一時失敗として扱う(恒久エラーに化けさせない)
  })

  it('(b) マッピング済みプロパティの型がdateでなければエラーにする', async () => {
    fetchMock.mockResolvedValueOnce(liveSchemaResponse([{ id: 'due-1', type: 'date' }]))
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        results: [
          pageFixture({
            properties: {
              Name: { id: 'title', type: 'title', title: [{ plain_text: 'T' }] },
              期日: { id: 'due-1', type: 'checkbox', checkbox: true },
            },
          }),
        ],
        next_cursor: null,
        has_more: false,
      }),
    )
    const mapping: NotionMapping = { due_prop_id: 'due-1', status: null, confirmed_at: '2026-01-01T00:00:00.000Z' }
    await expect(notionAdapter.listChangedTasks(ctx(mappingConfig(mapping)), 'db-1', {})).rejects.toThrow(/date/)
  })

  it('(c) date.startが不正な日付形式ならエラーにする', async () => {
    fetchMock.mockResolvedValueOnce(liveSchemaResponse([{ id: 'due-1', type: 'date' }]))
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        results: [
          pageFixture({
            properties: {
              Name: { id: 'title', type: 'title', title: [{ plain_text: 'T' }] },
              期日: { id: 'due-1', type: 'date', date: { start: 'not-a-date' } },
            },
          }),
        ],
        next_cursor: null,
        has_more: false,
      }),
    )
    const mapping: NotionMapping = { due_prop_id: 'due-1', status: null, confirmed_at: '2026-01-01T00:00:00.000Z' }
    await expect(notionAdapter.listChangedTasks(ctx(mappingConfig(mapping)), 'db-1', {})).rejects.toThrow(
      /不正な日付形式/,
    )
  })

  it('(c-2) date.startが存在しない月日(2026-99-99)ならエラーにする(形式は合致するが暦日として不正)', async () => {
    fetchMock.mockResolvedValueOnce(liveSchemaResponse([{ id: 'due-1', type: 'date' }]))
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        results: [
          pageFixture({
            properties: {
              Name: { id: 'title', type: 'title', title: [{ plain_text: 'T' }] },
              期日: { id: 'due-1', type: 'date', date: { start: '2026-99-99' } },
            },
          }),
        ],
        next_cursor: null,
        has_more: false,
      }),
    )
    const mapping: NotionMapping = { due_prop_id: 'due-1', status: null, confirmed_at: '2026-01-01T00:00:00.000Z' }
    await expect(notionAdapter.listChangedTasks(ctx(mappingConfig(mapping)), 'db-1', {})).rejects.toThrow(
      /不正な日付形式/,
    )
  })

  it('(c-3) date.startが存在しない暦日(2026-02-30。3月2日への自動繰り上げ)ならエラーにする', async () => {
    fetchMock.mockResolvedValueOnce(liveSchemaResponse([{ id: 'due-1', type: 'date' }]))
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        results: [
          pageFixture({
            properties: {
              Name: { id: 'title', type: 'title', title: [{ plain_text: 'T' }] },
              期日: { id: 'due-1', type: 'date', date: { start: '2026-02-30' } },
            },
          }),
        ],
        next_cursor: null,
        has_more: false,
      }),
    )
    const mapping: NotionMapping = { due_prop_id: 'due-1', status: null, confirmed_at: '2026-01-01T00:00:00.000Z' }
    await expect(notionAdapter.listChangedTasks(ctx(mappingConfig(mapping)), 'db-1', {})).rejects.toThrow(
      /不正な日付形式/,
    )
  })

  it('(c-4) date.startがうるう年の2/29なら正常に取り込む(閏年の暦日検証)', async () => {
    fetchMock.mockResolvedValueOnce(liveSchemaResponse([{ id: 'due-1', type: 'date' }]))
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        results: [
          pageFixture({
            properties: {
              Name: { id: 'title', type: 'title', title: [{ plain_text: 'T' }] },
              期日: { id: 'due-1', type: 'date', date: { start: '2028-02-29' } },
            },
          }),
        ],
        next_cursor: null,
        has_more: false,
      }),
    )
    const mapping: NotionMapping = { due_prop_id: 'due-1', status: null, confirmed_at: '2026-01-01T00:00:00.000Z' }
    const page = await notionAdapter.listChangedTasks(ctx(mappingConfig(mapping)), 'db-1', {})
    expect(page.items[0].dueDate).toBe('2028-02-29')
  })

  it('(d) date:null は正常な「期日未設定」としてdueDate=nullを返す(エラーにしない)', async () => {
    fetchMock.mockResolvedValueOnce(liveSchemaResponse([{ id: 'due-1', type: 'date' }]))
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        results: [
          pageFixture({
            properties: {
              Name: { id: 'title', type: 'title', title: [{ plain_text: 'T' }] },
              期日: { id: 'due-1', type: 'date', date: null },
            },
          }),
        ],
        next_cursor: null,
        has_more: false,
      }),
    )
    const mapping: NotionMapping = { due_prop_id: 'due-1', status: null, confirmed_at: '2026-01-01T00:00:00.000Z' }
    const page = await notionAdapter.listChangedTasks(ctx(mappingConfig(mapping)), 'db-1', {})
    expect(page.items[0].dueDate).toBeNull()
  })

  it('statusマッピング済みプロパティがページ応答に存在しなければ completed=false に落とさずエラーにする', async () => {
    fetchMock.mockResolvedValueOnce(
      liveSchemaResponse([{ id: 'status-1', type: 'status', options: [{ id: 'opt-done', name: '完了' }] }]),
    )
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        results: [
          pageFixture({
            properties: {
              Name: { id: 'title', type: 'title', title: [{ plain_text: 'T' }] },
              // ステータスプロパティ(status-1)自体が応答に無い。
            },
          }),
        ],
        next_cursor: null,
        has_more: false,
      }),
    )
    const mapping: NotionMapping = { due_prop_id: null, status: statusMapping(), confirmed_at: '2026-01-01T00:00:00.000Z' }
    await expect(notionAdapter.listChangedTasks(ctx(mappingConfig(mapping)), 'db-1', {})).rejects.toThrow(
      /プロパティがページ応答に存在しません/,
    )
  })

  it('statusマッピング済みプロパティの値が空(未選択)なら completed=false でよい(エラーにしない)', async () => {
    fetchMock.mockResolvedValueOnce(
      liveSchemaResponse([{ id: 'status-1', type: 'status', options: [{ id: 'opt-done', name: '完了' }] }]),
    )
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        results: [
          pageFixture({
            properties: {
              Name: { id: 'title', type: 'title', title: [{ plain_text: 'T' }] },
              ステータス: { id: 'status-1', type: 'status', status: null },
            },
          }),
        ],
        next_cursor: null,
        has_more: false,
      }),
    )
    const mapping: NotionMapping = { due_prop_id: null, status: statusMapping(), confirmed_at: '2026-01-01T00:00:00.000Z' }
    const page = await notionAdapter.listChangedTasks(ctx(mappingConfig(mapping)), 'db-1', {})
    expect(page.items[0].completed).toBe(false)
  })
})

describe('notionAdapter.listChangedTasks — 差分フィルタ・ページング', () => {
  const mapping: NotionMapping = { due_prop_id: null, status: null, confirmed_at: '2026-01-01T00:00:00.000Z' }

  it('since を last_edited_time の on_or_after フィルタに変換し、昇順ソートを付ける', async () => {
    fetchMock.mockResolvedValueOnce(emptySchemaResponse())
    fetchMock.mockResolvedValueOnce(jsonResponse({ results: [], next_cursor: null, has_more: false }))
    await notionAdapter.listChangedTasks(ctx(mappingConfig(mapping)), 'db-1', { since: '2026-07-19T00:00:00.000Z' })

    const [url, init] = fetchMock.mock.calls[1] as [string, RequestInit]
    expect(new URL(url).pathname).toBe('/v1/databases/db-1/query')
    const body = JSON.parse(String(init.body)) as Record<string, unknown>
    expect(body.filter).toEqual({
      timestamp: 'last_edited_time',
      last_edited_time: { on_or_after: '2026-07-19T00:00:00.000Z' },
    })
    expect(body.sorts).toEqual([{ timestamp: 'last_edited_time', direction: 'ascending' }])
  })

  it('since が無ければ filter を付けない', async () => {
    fetchMock.mockResolvedValueOnce(emptySchemaResponse())
    fetchMock.mockResolvedValueOnce(jsonResponse({ results: [], next_cursor: null, has_more: false }))
    await notionAdapter.listChangedTasks(ctx(mappingConfig(mapping)), 'db-1', {})
    const body = JSON.parse(String((fetchMock.mock.calls[1] as [string, RequestInit])[1].body)) as Record<
      string,
      unknown
    >
    expect(body.filter).toBeUndefined()
  })

  it('cursor を start_cursor として渡す', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ results: [], next_cursor: null, has_more: false }))
    await notionAdapter.listChangedTasks(ctx(mappingConfig(mapping)), 'db-1', { cursor: 'cur-1' })
    const body = JSON.parse(String((fetchMock.mock.calls[0] as [string, RequestInit])[1].body)) as Record<
      string,
      unknown
    >
    expect(body.start_cursor).toBe('cur-1')
  })

  it('has_more=true なら next_cursor を返し、falseならnullで打ち切る', async () => {
    fetchMock.mockResolvedValueOnce(emptySchemaResponse())
    fetchMock.mockResolvedValueOnce(jsonResponse({ results: [], next_cursor: 'cur-2', has_more: true }))
    const page = await notionAdapter.listChangedTasks(ctx(mappingConfig(mapping)), 'db-1', {})
    expect(page.nextCursor).toBe('cur-2')

    fetchMock.mockResolvedValueOnce(emptySchemaResponse())
    fetchMock.mockResolvedValueOnce(jsonResponse({ results: [], next_cursor: null, has_more: false }))
    const page2 = await notionAdapter.listChangedTasks(ctx(mappingConfig(mapping)), 'db-1', {})
    expect(page2.nextCursor).toBeNull()
  })

  it('has_more=trueなのにnext_cursorが空(応答不整合)なら、取り切ったことにせずエラーにする', async () => {
    fetchMock.mockResolvedValueOnce(emptySchemaResponse())
    fetchMock.mockResolvedValueOnce(jsonResponse({ results: [], next_cursor: null, has_more: true }))
    await expect(
      notionAdapter.listChangedTasks(ctx(mappingConfig(mapping)), 'db-1', {}),
    ).rejects.toThrow(/next_cursorが空/)
  })

  it('429は復帰時刻(Retry-After秒)をretryAfterMsとして載せる', async () => {
    fetchMock.mockResolvedValueOnce(emptySchemaResponse())
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 429,
      headers: new Headers({ 'Retry-After': '20' }),
      json: async () => ({}),
      text: async () => '',
    } as Response)
    const err = await notionAdapter.listChangedTasks(ctx(mappingConfig(mapping)), 'db-1', {}).catch((e) => e)
    expect(err.status).toBe(429)
    expect(err.retryAfterMs).toBe(20_000)
  })

  it('APIエラーはstatusを載せた例外にする', async () => {
    fetchMock.mockResolvedValueOnce(emptySchemaResponse())
    fetchMock.mockResolvedValueOnce(jsonResponse({ message: 'object_not_found' }, 404))
    await expect(notionAdapter.listChangedTasks(ctx(mappingConfig(mapping)), 'db-1', {})).rejects.toMatchObject({
      status: 404,
    })
  })
})

describe('notionAdapter.listChangedTasks — 実行時スキーマdrift再検証', () => {
  /**
   * 顧客が Notion 側でプロパティを削除・型変更しても TaskApp には通知が来ない(webhookではなく
   * ポーリングのため)。放置すると findPropertyById が null を返すだけで、期日が無言でnullになり
   * (AI秘書の期限リマインドが無言で止まる)、status も無言で completed=false 固定になる。
   * これを防ぐため、cursor未指定(=コンテナのポーリング初回ページ)のときだけ1回、ライブスキーマを
   * 取り直してマッピングを再検証し、不一致なら推測で続行せず恒久エラーで取り込みを止める。
   */

  it('期日プロパティがライブスキーマから消えていれば、dueDateをnullにせず恒久停止する(本丸の回帰テスト)', async () => {
    // ライブスキーマに due-1 が存在しない(顧客がNotion側で期日プロパティを削除した想定)。
    fetchMock.mockResolvedValueOnce(liveSchemaResponse([{ id: 'title', type: 'title', name: 'Name' }]))
    const mapping: NotionMapping = { due_prop_id: 'due-1', status: null, confirmed_at: '2026-01-01T00:00:00.000Z' }

    await expect(
      notionAdapter.listChangedTasks(ctx(mappingConfig(mapping)), 'db-1', {}),
    ).rejects.toMatchObject({ permanent: true, status: 400 })

    // databases.query(取り込み本体)へは進んでいない = dueDate:null のタスクを黙って返していない。
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(new URL(url).pathname).toBe('/v1/databases/db-1')
  })

  it('statusプロパティの型がライブスキーマと食い違っていれば恒久停止する', async () => {
    // マッピングは prop_type='status' で保存されているが、実際は select 型に変わっている。
    fetchMock.mockResolvedValueOnce(
      liveSchemaResponse([{ id: 'status-1', type: 'select', options: [{ id: 'opt-done', name: '完了' }] }]),
    )
    const mapping: NotionMapping = { due_prop_id: null, status: statusMapping(), confirmed_at: '2026-01-01T00:00:00.000Z' }

    await expect(
      notionAdapter.listChangedTasks(ctx(mappingConfig(mapping)), 'db-1', {}),
    ).rejects.toMatchObject({ permanent: true, status: 400 })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('done_option_idがライブスキーマ上に実在しなければ恒久停止する', async () => {
    // status-1 は status型のまま残っているが、opt-done という選択肢自体が削除されている。
    fetchMock.mockResolvedValueOnce(
      liveSchemaResponse([{ id: 'status-1', type: 'status', options: [{ id: 'opt-other', name: '別の選択肢' }] }]),
    )
    const mapping: NotionMapping = { due_prop_id: null, status: statusMapping(), confirmed_at: '2026-01-01T00:00:00.000Z' }

    await expect(
      notionAdapter.listChangedTasks(ctx(mappingConfig(mapping)), 'db-1', {}),
    ).rejects.toMatchObject({ permanent: true, status: 400 })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('ライブスキーマがマッピングと整合していれば従来どおりタスクを返す', async () => {
    fetchMock.mockResolvedValueOnce(
      liveSchemaResponse([
        { id: 'due-1', type: 'date' },
        { id: 'status-1', type: 'status', options: [{ id: 'opt-done', name: '完了' }] },
      ]),
    )
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        results: [
          {
            id: 'page-1',
            last_edited_time: '2026-07-20T10:00:00.000Z',
            properties: {
              Name: { id: 'title', type: 'title', title: [{ plain_text: 'T' }] },
              期日: { id: 'due-1', type: 'date', date: { start: '2026-07-31' } },
              ステータス: { id: 'status-1', type: 'status', status: { id: 'opt-done', name: '完了' } },
            },
          },
        ],
        next_cursor: null,
        has_more: false,
      }),
    )
    const mapping: NotionMapping = { due_prop_id: 'due-1', status: statusMapping(), confirmed_at: '2026-01-01T00:00:00.000Z' }
    const page = await notionAdapter.listChangedTasks(ctx(mappingConfig(mapping)), 'db-1', {})
    expect(page.items[0]).toMatchObject({ dueDate: '2026-07-31', completed: true })
  })

  it('cursor指定時(2ページ目)は fetchDatabaseSchema を呼ばない(1ポーリング1コンテナ1回)', async () => {
    const mapping: NotionMapping = { due_prop_id: 'due-1', status: null, confirmed_at: '2026-01-01T00:00:00.000Z' }
    fetchMock.mockResolvedValueOnce(jsonResponse({ results: [], next_cursor: null, has_more: false }))
    await notionAdapter.listChangedTasks(ctx(mappingConfig(mapping)), 'db-1', { cursor: 'cur-1' })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(new URL(url).pathname).toBe('/v1/databases/db-1/query')
  })

  it('fetchDatabaseSchemaが一時失敗(429/5xx)を投げたとき、permanentに化けず伝播する', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 503,
      headers: new Headers(),
      json: async () => ({}),
      text: async () => '',
    } as Response)
    const mapping: NotionMapping = { due_prop_id: 'due-1', status: null, confirmed_at: '2026-01-01T00:00:00.000Z' }

    const err = await notionAdapter.listChangedTasks(ctx(mappingConfig(mapping)), 'db-1', {}).catch((e) => e)
    expect(err.status).toBe(503)
    expect(err.permanent).toBeFalsy()
    // databases.query(取り込み本体)へは進んでいない。
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('notionAdapter.completeTask', () => {
  it('status型: PATCH /v1/pages/{id} で write_done_option_id を書き込む', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: 'page-1' }))
    const mapping: NotionMapping = { due_prop_id: null, status: statusMapping(), confirmed_at: '2026-01-01T00:00:00.000Z' }
    await notionAdapter.completeTask(ctx(mappingConfig(mapping)), { externalId: 'page-1', containerId: 'db-1' })

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(new URL(url).pathname).toBe('/v1/pages/page-1')
    expect(init.method).toBe('PATCH')
    const body = JSON.parse(String(init.body)) as Record<string, unknown>
    expect(body.properties).toEqual({ 'status-1': { status: { id: 'opt-done' } } })
  })

  it('select型: write_done_option_id を select として書き込む', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: 'page-1' }))
    const mapping: NotionMapping = {
      due_prop_id: null,
      status: statusMapping({ prop_id: 'select-1', prop_type: 'select', done_option_ids: ['sel-closed'], write_done_option_id: 'sel-closed' }),
      confirmed_at: '2026-01-01T00:00:00.000Z',
    }
    await notionAdapter.completeTask(ctx(mappingConfig(mapping)), { externalId: 'page-1', containerId: 'db-1' })
    const body = lastBody()
    expect(body.properties).toEqual({ 'select-1': { select: { id: 'sel-closed' } } })
  })

  it('checkbox型: true を書き込む', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: 'page-1' }))
    const mapping: NotionMapping = {
      due_prop_id: null,
      status: statusMapping({ prop_id: 'checkbox-1', prop_type: 'checkbox', done_option_ids: [], write_done_option_id: null }),
      confirmed_at: '2026-01-01T00:00:00.000Z',
    }
    await notionAdapter.completeTask(ctx(mappingConfig(mapping)), { externalId: 'page-1', containerId: 'db-1' })
    const body = lastBody()
    expect(body.properties).toEqual({ 'checkbox-1': { checkbox: true } })
  })

  it('完了同期(status)が未設定なら fetch せず恒久エラー', async () => {
    const mapping: NotionMapping = { due_prop_id: 'due-1', status: null, confirmed_at: '2026-01-01T00:00:00.000Z' }
    await expect(
      notionAdapter.completeTask(ctx(mappingConfig(mapping)), { externalId: 'page-1', containerId: 'db-1' }),
    ).rejects.toMatchObject({ permanent: true })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('databaseIdのマッピング自体が無ければ fetch せず恒久エラー', async () => {
    await expect(
      notionAdapter.completeTask(ctx(), { externalId: 'page-1', containerId: 'db-1' }),
    ).rejects.toMatchObject({ permanent: true })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('404(既に消えている)もstatusを保って投げる', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ message: 'not found' }, 404))
    const mapping: NotionMapping = { due_prop_id: null, status: statusMapping(), confirmed_at: '2026-01-01T00:00:00.000Z' }
    await expect(
      notionAdapter.completeTask(ctx(mappingConfig(mapping)), { externalId: 'page-1', containerId: 'db-1' }),
    ).rejects.toMatchObject({ status: 404 })
  })

  it('リダイレクトを自動追跡しない(転送先へトークンを渡さない)', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: 'page-1' }))
    const mapping: NotionMapping = { due_prop_id: null, status: statusMapping(), confirmed_at: '2026-01-01T00:00:00.000Z' }
    await notionAdapter.completeTask(ctx(mappingConfig(mapping)), { externalId: 'page-1', containerId: 'db-1' })
    const [, init] = lastCall()
    expect(init.redirect).toBe('manual')
  })
})
