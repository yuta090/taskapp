import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fetchAppFields, proposeMapping } from '@/lib/task-sync/providers/kintone/schema'
import type { KintoneLiveField } from '@/lib/task-sync/providers/kintone/mapping'

/**
 * kintone フィールド定義取得＋マッピング提案（純関数側）。
 * fetchAppFields は GET /k/v1/app/form/fields.json をメタ（code/type/label/options）に正規化する
 * だけ。proposeMapping は LLM を使わず、コード名・型からの決定的ヒューリスティックで
 * 「たたき台」を作る。
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

describe('fetchAppFields', () => {
  it('fields.json の properties をメタだけに正規化する（レコード値は取得しない）', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        properties: {
          title: { code: 'title', label: 'タイトル', type: 'SINGLE_LINE_TEXT', required: false },
          due: { code: 'due', label: '期日', type: 'DATE', required: false },
          status: {
            code: 'status',
            label: 'ステータス',
            type: 'DROP_DOWN',
            required: false,
            options: { 未着手: { label: '未着手', index: '0' }, 完了: { label: '完了', index: '1' } },
          },
        },
        revision: '3',
      }),
    )
    const fields = await fetchAppFields('https://foo.cybozu.com', 'token-1', '5')
    expect(fields).toEqual([
      { code: 'title', type: 'SINGLE_LINE_TEXT', label: 'タイトル' },
      { code: 'due', type: 'DATE', label: '期日' },
      { code: 'status', type: 'DROP_DOWN', label: 'ステータス', options: ['未着手', '完了'] },
    ])
  })

  it('vendor-domain(.cybozu.com/.kintone.com)配下の app/form/fields.json を X-Cybozu-API-Token で叩く', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ properties: {} }))
    await fetchAppFields('https://foo.cybozu.com', 'token-1', '5')
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const parsed = new URL(url)
    expect(parsed.origin).toBe('https://foo.cybozu.com')
    expect(parsed.pathname).toBe('/k/v1/app/form/fields.json')
    expect(parsed.searchParams.get('app')).toBe('5')
    expect((init.headers as Record<string, string>)['X-Cybozu-API-Token']).toBe('token-1')
  })

  it('正規ドメイン以外のbaseUrlは拒否する(SSRF境界)', async () => {
    await expect(fetchAppFields('https://evil.example.com', 'token-1', '5')).rejects.toMatchObject({
      permanent: true,
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('失敗時は status を載せた ProviderError を投げる', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ message: 'not found' }, 404))
    await expect(fetchAppFields('https://foo.cybozu.com', 'token-1', 'ghost')).rejects.toMatchObject({
      status: 404,
    })
  })
})

describe('proposeMapping', () => {
  it('SINGLE_LINE_TEXTのコード名がヒント語を含めばtitleを高信頼度で提案する', () => {
    const fields: KintoneLiveField[] = [
      { code: 'メモ', type: 'SINGLE_LINE_TEXT', label: 'メモ' },
      { code: 'タスク名', type: 'SINGLE_LINE_TEXT', label: 'タスク名' },
    ]
    const proposal = proposeMapping(fields)
    expect(proposal.title_field_code).toBe('タスク名')
    expect(proposal.title_field_code_confidence).toBe('high')
  })

  it('ヒント語が無ければ先頭のSINGLE_LINE_TEXTを低信頼度で仮提案する', () => {
    const fields: KintoneLiveField[] = [{ code: 'memo', type: 'SINGLE_LINE_TEXT', label: 'メモ' }]
    const proposal = proposeMapping(fields)
    expect(proposal.title_field_code).toBe('memo')
    expect(proposal.title_field_code_confidence).toBe('low')
  })

  it('SINGLE_LINE_TEXTが無ければtitleはnone', () => {
    const proposal = proposeMapping([{ code: 'due', type: 'DATE', label: '期日' }])
    expect(proposal.title_field_code).toBeNull()
    expect(proposal.title_field_code_confidence).toBe('none')
  })

  it('DATE型のフィールドがあればdueを高信頼度で提案する', () => {
    const fields: KintoneLiveField[] = [{ code: 'due', type: 'DATE', label: '期日' }]
    const proposal = proposeMapping(fields)
    expect(proposal.due_field_code).toBe('due')
    expect(proposal.due_field_code_confidence).toBe('high')
  })

  it('DATE型が無ければdueはnone', () => {
    const proposal = proposeMapping([{ code: 'title', type: 'SINGLE_LINE_TEXT', label: 'タイトル' }])
    expect(proposal.due_field_code).toBeNull()
    expect(proposal.due_field_code_confidence).toBe('none')
  })

  it('STATUS型があれば検出するが、選択肢/アクションは手動設定に倒す(低信頼度)', () => {
    const fields: KintoneLiveField[] = [{ code: 'processStatus', type: 'STATUS', label: 'ステータス' }]
    const proposal = proposeMapping(fields)
    expect(proposal.status?.field_code).toBe('processStatus')
    expect(proposal.status?.field_type).toBe('STATUS')
    expect(proposal.status?.done_values).toEqual([])
    expect(proposal.status?.write_done_action).toBeNull()
    expect(proposal.status_confidence).toBe('low')
  })

  it('DROP_DOWNの選択肢に「完了」があれば中信頼度でdone_valuesを提案する', () => {
    const fields: KintoneLiveField[] = [
      { code: 'status', type: 'DROP_DOWN', label: 'ステータス', options: ['未着手', '進行中', '完了'] },
    ]
    const proposal = proposeMapping(fields)
    expect(proposal.status?.field_code).toBe('status')
    expect(proposal.status?.field_type).toBe('DROP_DOWN')
    expect(proposal.status?.done_values).toEqual(['完了'])
    expect(proposal.status_confidence).toBe('medium')
  })

  it('STATUS型を優先し、DROP_DOWNより先に検出する', () => {
    const fields: KintoneLiveField[] = [
      { code: 'status', type: 'DROP_DOWN', label: 'ステータス', options: ['完了'] },
      { code: 'processStatus', type: 'STATUS', label: 'プロセス' },
    ]
    const proposal = proposeMapping(fields)
    expect(proposal.status?.field_type).toBe('STATUS')
  })

  it('完了に使えそうなフィールドが無ければstatusはnull/none', () => {
    const proposal = proposeMapping([{ code: 'title', type: 'SINGLE_LINE_TEXT', label: 'タイトル' }])
    expect(proposal.status).toBeNull()
    expect(proposal.status_confidence).toBe('none')
  })
})
