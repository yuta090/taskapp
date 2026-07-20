import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * getAiConfigStatus — org_ai_config の「有無・有効/無効」だけを APIキーを復号せずに
 * 安価に判定するステータス。自動タスク抽出(channel-digest cron)が動く前提が揃っているかの
 * 可視化・セットアップチェックリスト・運用ログのために使う。
 *
 * getAiConfig(復号あり・失敗時throw)と異なり、こちらは throw せず値で返す＝
 * 「AI未設定で自動タスク化が止まっている」ことを黙って握り潰さず、必ず可視化できるようにする。
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function chain(response: any) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const builder: any = {}
  for (const m of ['select', 'eq']) {
    builder[m] = vi.fn(() => builder)
  }
  builder.maybeSingle = vi.fn(() => Promise.resolve(response))
  return builder
}

let fromResponse: unknown
const fromMock = vi.fn()

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({ from: fromMock })),
}))

const ai = await import('@/lib/ai/client')

beforeEach(() => {
  vi.clearAllMocks()
  fromMock.mockImplementation(() => chain(fromResponse))
})

describe('getAiConfigStatus', () => {
  it('行が無ければ configured:false / reason:missing（AI未登録）', async () => {
    fromResponse = { data: null, error: null }
    expect(await ai.getAiConfigStatus('org-1')).toEqual({ configured: false, reason: 'missing' })
  })

  it('enabled=false なら configured:false / reason:disabled（キーはある）', async () => {
    fromResponse = { data: { enabled: false, api_key_encrypted: 'enc' }, error: null }
    expect(await ai.getAiConfigStatus('org-1')).toEqual({ configured: false, reason: 'disabled' })
  })

  it('enabled=true かつキーあり なら configured:true', async () => {
    fromResponse = { data: { enabled: true, api_key_encrypted: 'enc' }, error: null }
    expect(await ai.getAiConfigStatus('org-1')).toEqual({ configured: true })
  })

  it('enabled=true でもキーが空なら configured:false / reason:missing（緑表示にしない）', async () => {
    fromResponse = { data: { enabled: true, api_key_encrypted: '' }, error: null }
    expect(await ai.getAiConfigStatus('org-1')).toEqual({ configured: false, reason: 'missing' })
  })

  it('enabled=true でもキーが null なら configured:false / reason:missing', async () => {
    fromResponse = { data: { enabled: true, api_key_encrypted: null }, error: null }
    expect(await ai.getAiConfigStatus('org-1')).toEqual({ configured: false, reason: 'missing' })
  })

  it('DBエラーは throw せず configured:false / reason:error を返す（可視化を止めない）', async () => {
    fromResponse = { data: null, error: { message: 'boom' } }
    expect(await ai.getAiConfigStatus('org-1')).toEqual({ configured: false, reason: 'error' })
  })

  it('APIキーは有無だけ select する（復号はしない＝安価）', async () => {
    fromResponse = { data: { enabled: true, api_key_encrypted: 'enc' }, error: null }
    await ai.getAiConfigStatus('org-1')
    const builder = fromMock.mock.results[0].value
    expect(builder.select).toHaveBeenCalledWith('enabled, api_key_encrypted')
  })
})
