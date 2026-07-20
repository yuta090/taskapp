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

  it('行はあるが enabled=false なら configured:false / reason:disabled', async () => {
    fromResponse = { data: { enabled: false }, error: null }
    expect(await ai.getAiConfigStatus('org-1')).toEqual({ configured: false, reason: 'disabled' })
  })

  it('行があり enabled=true なら configured:true', async () => {
    fromResponse = { data: { enabled: true }, error: null }
    expect(await ai.getAiConfigStatus('org-1')).toEqual({ configured: true })
  })

  it('DBエラーは throw せず configured:false / reason:error を返す（可視化を止めない）', async () => {
    fromResponse = { data: null, error: { message: 'boom' } }
    expect(await ai.getAiConfigStatus('org-1')).toEqual({ configured: false, reason: 'error' })
  })

  it('APIキーは select しない（復号せず安価に判定する）', async () => {
    fromResponse = { data: { enabled: true }, error: null }
    await ai.getAiConfigStatus('org-1')
    const builder = fromMock.mock.results[0].value
    expect(builder.select).toHaveBeenCalledWith('enabled')
  })
})
