import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fetchDatabaseSchema, proposeMapping } from '@/lib/task-sync/providers/notion/schema'
import type { NotionDatabaseSchema } from '@/lib/task-sync/providers/notion/schema'

/**
 * Notion DB スキーマ取得＋マッピング提案（純関数側）。
 *
 * fetchDatabaseSchema は databases.retrieve をレコード値抜きのメタ（id/name/type/options）に
 * 正規化するだけ。proposeMapping は LLM を使わず、名前・型からの決定的ヒューリスティックで
 * 「たたき台」を作る（最終確定はユーザー。テスト可能性のため決定的にする）。
 */

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

describe('fetchDatabaseSchema', () => {
  it('databases.retrieve のプロパティをメタだけに正規化する（レコード値は取得しない）', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        object: 'database',
        id: 'db-1',
        properties: {
          Name: { id: 'title', name: 'Name', type: 'title' },
          期日: { id: 'due-1', name: '期日', type: 'date', date: {} },
          ステータス: {
            id: 'status-1',
            name: 'ステータス',
            type: 'status',
            status: { options: [{ id: 'opt-done', name: '完了', color: 'green' }] },
          },
        },
      }),
    )
    const schema = await fetchDatabaseSchema('secret-token', 'db-1')
    expect(schema).toEqual([
      { id: 'title', name: 'Name', type: 'title' },
      { id: 'due-1', name: '期日', type: 'date' },
      { id: 'status-1', name: 'ステータス', type: 'status', options: [{ id: 'opt-done', name: '完了' }] },
    ])
  })

  it('固定ホスト api.notion.com の /v1/databases/{id} を Bearer + Notion-Version で叩く', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ properties: {} }))
    await fetchDatabaseSchema('secret-token', 'db-1')
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(new URL(url).origin).toBe('https://api.notion.com')
    expect(new URL(url).pathname).toBe('/v1/databases/db-1')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer secret-token')
    expect((init.headers as Record<string, string>)['Notion-Version']).toBe('2022-06-28')
  })

  it('失敗時は status を載せた ProviderError を投げる', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ message: 'not found' }, 404))
    await expect(fetchDatabaseSchema('secret-token', 'ghost-db')).rejects.toMatchObject({ status: 404 })
  })
})

describe('proposeMapping', () => {
  it('date型のプロパティがあれば due_prop_id を高信頼度で提案する', () => {
    const schema: NotionDatabaseSchema = [
      { id: 'title-1', name: 'Name', type: 'title' },
      { id: 'due-1', name: '期日', type: 'date' },
    ]
    const proposal = proposeMapping(schema)
    expect(proposal.due_prop_id).toBe('due-1')
    expect(proposal.due_prop_id_confidence).toBe('high')
  })

  it('date型のプロパティが無ければ due_prop_id は null・信頼度none', () => {
    const schema: NotionDatabaseSchema = [{ id: 'title-1', name: 'Name', type: 'title' }]
    const proposal = proposeMapping(schema)
    expect(proposal.due_prop_id).toBeNull()
    expect(proposal.due_prop_id_confidence).toBe('none')
  })

  it('status型に「完了」を含む option があれば done_option として高信頼度で提案する', () => {
    const schema: NotionDatabaseSchema = [
      {
        id: 'status-1',
        name: 'ステータス',
        type: 'status',
        options: [
          { id: 'opt-todo', name: '未着手' },
          { id: 'opt-doing', name: '対応中' },
          { id: 'opt-done', name: '完了' },
        ],
      },
    ]
    const proposal = proposeMapping(schema)
    expect(proposal.status).toEqual({
      prop_id: 'status-1',
      prop_type: 'status',
      done_option_ids: ['opt-done'],
      write_done_option_id: 'opt-done',
    })
    expect(proposal.status_confidence).toBe('high')
  })

  it('status型があっても完了らしき option が無ければ低信頼度・done未設定で提案する', () => {
    const schema: NotionDatabaseSchema = [
      {
        id: 'status-1',
        name: 'ステータス',
        type: 'status',
        options: [
          { id: 'opt-a', name: 'A' },
          { id: 'opt-b', name: 'B' },
        ],
      },
    ]
    const proposal = proposeMapping(schema)
    expect(proposal.status).toEqual({
      prop_id: 'status-1',
      prop_type: 'status',
      done_option_ids: [],
      write_done_option_id: null,
    })
    expect(proposal.status_confidence).toBe('low')
  })

  it('select型の「クローズ」「closed」も done として拾う', () => {
    const schema: NotionDatabaseSchema = [
      {
        id: 'select-1',
        name: '区分',
        type: 'select',
        options: [
          { id: 'sel-open', name: '未対応' },
          { id: 'sel-closed', name: 'クローズ' },
        ],
      },
    ]
    const proposal = proposeMapping(schema)
    expect(proposal.status).toMatchObject({
      prop_id: 'select-1',
      prop_type: 'select',
      done_option_ids: ['sel-closed'],
      write_done_option_id: 'sel-closed',
    })
  })

  it('status/select が無く checkbox に「完了」を含む名前があれば候補にする（信頼度は控えめ）', () => {
    const schema: NotionDatabaseSchema = [
      { id: 'title-1', name: 'Name', type: 'title' },
      { id: 'checkbox-1', name: '完了チェック', type: 'checkbox' },
    ]
    const proposal = proposeMapping(schema)
    expect(proposal.status).toEqual({
      prop_id: 'checkbox-1',
      prop_type: 'checkbox',
      done_option_ids: [],
      write_done_option_id: null,
    })
    expect(proposal.status_confidence).toBe('medium')
  })

  it('候補になる型が何も無ければ status は null・信頼度none', () => {
    const schema: NotionDatabaseSchema = [{ id: 'title-1', name: 'Name', type: 'title' }]
    const proposal = proposeMapping(schema)
    expect(proposal.status).toBeNull()
    expect(proposal.status_confidence).toBe('none')
  })

  it('status型を select型・checkbox より優先する', () => {
    const schema: NotionDatabaseSchema = [
      {
        id: 'select-1',
        name: '区分',
        type: 'select',
        options: [{ id: 'sel-closed', name: 'クローズ' }],
      },
      {
        id: 'status-1',
        name: 'ステータス',
        type: 'status',
        options: [{ id: 'opt-done', name: '完了' }],
      },
      { id: 'checkbox-1', name: '完了チェック', type: 'checkbox' },
    ]
    const proposal = proposeMapping(schema)
    expect(proposal.status?.prop_id).toBe('status-1')
  })
})
