import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * recordAiUsage — LLM使用量の best-effort 記録（COGS実測テレメトリ）。
 * 抽出本体を絶対に壊さないこと（記録失敗は握りつぶす）が最重要の性質。
 */

const insertMock = vi.fn()
const fromMock = vi.fn(() => ({ insert: insertMock }))
const createAdminClientMock = vi.fn(() => ({ from: fromMock }))
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: createAdminClientMock,
}))

const { recordAiUsage } = await import('@/lib/ai/usage')

beforeEach(() => {
  vi.clearAllMocks()
  insertMock.mockResolvedValue({ error: null })
})

describe('recordAiUsage', () => {
  it('ai_usage_events に正しいペイロードで insert する', async () => {
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
    })
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
