import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * recordAiUsage — LLM使用量の best-effort 記録（COGS実測テレメトリ）。
 * 抽出本体を絶対に壊さないこと（記録失敗は握りつぶす）が最重要の性質。
 * getOrgPooledCostJpyThisMonth — 当月 pooled 原価の円積み上げ（org別月次capの判定用）。
 */

const insertMock = vi.fn()
const rpcMock = vi.fn()
const fromMock = vi.fn(() => ({ insert: insertMock }))
const createAdminClientMock = vi.fn(() => ({ from: fromMock, rpc: rpcMock }))
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: createAdminClientMock,
}))

const { recordAiUsage, getOrgPooledCostJpyThisMonth } = await import('@/lib/ai/usage')
const { estimateCostJpy } = await import('@/lib/ai/cost')

beforeEach(() => {
  vi.clearAllMocks()
  insertMock.mockResolvedValue({ error: null })
})

describe('recordAiUsage', () => {
  it('ai_usage_events に正しいペイロードで insert する（既定 key_source=byo）', async () => {
    await recordAiUsage({
      orgId: 'org-1',
      provider: 'openai',
      model: 'gpt-4o-mini',
      promptTokens: 1200,
      completionTokens: 340,
      purpose: 'digest_extract',
    })
    expect(fromMock).toHaveBeenCalledWith('ai_usage_events')
    expect(insertMock).toHaveBeenCalledWith({
      org_id: 'org-1',
      provider: 'openai',
      model: 'gpt-4o-mini',
      prompt_tokens: 1200,
      completion_tokens: 340,
      purpose: 'digest_extract',
      key_source: 'byo',
    })
  })

  it('keySource=pooled は key_source=pooled で記録（BYOと分別）', async () => {
    await recordAiUsage({
      orgId: 'org-1',
      provider: 'openai',
      model: 'gpt-4o-mini',
      promptTokens: 5,
      completionTokens: 2,
      keySource: 'pooled',
    })
    expect(insertMock).toHaveBeenCalledWith(expect.objectContaining({ key_source: 'pooled' }))
  })

  it('purpose 未指定は null で記録', async () => {
    await recordAiUsage({
      orgId: 'org-1',
      provider: 'anthropic',
      model: 'claude-haiku-4-5',
      promptTokens: 10,
      completionTokens: 5,
    })
    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({ purpose: null }),
    )
  })

  it('insert が例外を投げても本処理を壊さない（reject しない）', async () => {
    insertMock.mockRejectedValue(new Error('db down'))
    await expect(
      recordAiUsage({
        orgId: 'org-1',
        provider: 'openai',
        model: 'gpt-4o-mini',
        promptTokens: 1,
        completionTokens: 1,
      }),
    ).resolves.toBeUndefined()
  })

  it('admin client 生成が投げても reject しない', async () => {
    createAdminClientMock.mockImplementationOnce(() => {
      throw new Error('no service key')
    })
    await expect(
      recordAiUsage({
        orgId: 'org-1',
        provider: 'openai',
        model: 'gpt-4o-mini',
        promptTokens: 1,
        completionTokens: 1,
      }),
    ).resolves.toBeUndefined()
  })
})

describe('getOrgPooledCostJpyThisMonth', () => {
  it('model別トークンを cost.ts の単価で円換算して合算する', async () => {
    rpcMock.mockResolvedValue({
      data: [{ model: 'gpt-4o-mini', prompt_tokens: 1000, completion_tokens: 500 }],
      error: null,
    })
    const got = await getOrgPooledCostJpyThisMonth('org-1')
    const want = estimateCostJpy('gpt-4o-mini', { promptTokens: 1000, completionTokens: 500 })!
    expect(rpcMock).toHaveBeenCalledWith('app_org_pooled_usage_this_month', { p_org: 'org-1' })
    expect(got).toBeCloseTo(want, 6)
  })

  it('複数modelを合算する', async () => {
    rpcMock.mockResolvedValue({
      data: [
        { model: 'gpt-4o-mini', prompt_tokens: 1000, completion_tokens: 0 },
        { model: 'gpt-4o', prompt_tokens: 0, completion_tokens: 1000 },
      ],
      error: null,
    })
    const got = await getOrgPooledCostJpyThisMonth('org-1')
    const want =
      estimateCostJpy('gpt-4o-mini', { promptTokens: 1000, completionTokens: 0 })! +
      estimateCostJpy('gpt-4o', { promptTokens: 0, completionTokens: 1000 })!
    expect(got).toBeCloseTo(want, 6)
  })

  it('行なしは 0 円', async () => {
    rpcMock.mockResolvedValue({ data: [], error: null })
    expect(await getOrgPooledCostJpyThisMonth('org-1')).toBe(0)
  })

  it('RPCエラーは throw する（呼び出し側が fail-open で握る）', async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: 'boom' } })
    await expect(getOrgPooledCostJpyThisMonth('org-1')).rejects.toThrow(/app_org_pooled_usage_this_month/)
  })
})
