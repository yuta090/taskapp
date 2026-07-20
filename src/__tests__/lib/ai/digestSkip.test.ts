import { describe, it, expect } from 'vitest'
import { classifyExtractionSkip } from '@/lib/ai/digestSkip'

/**
 * channel-digest cron の抽出スキップ理由の分類。
 * 「AI未設定で自動タスク化が止まっている(要オペ対応)」を、LLM/API障害から切り分けて
 * 運用ログに残せるようにする＝サイレントスキップを止めるための契約。
 * getAiConfig が投げる 'AI未設定: ...' 文言に依存するので回帰で固定する。
 */
describe('classifyExtractionSkip', () => {
  it('「AI未設定: ...」は ai_unconfigured（設定ギャップ）', () => {
    expect(classifyExtractionSkip('AI未設定: この組織にはAI設定が登録されていません')).toBe('ai_unconfigured')
    expect(classifyExtractionSkip('AI未設定: AI機能が無効になっています')).toBe('ai_unconfigured')
  })

  it('LLM/API障害・その他は llm_error', () => {
    expect(classifyExtractionSkip('OpenAI API エラー (500): ...')).toBe('llm_error')
    expect(classifyExtractionSkip('Anthropic レート制限: しばらく待って')).toBe('llm_error')
    expect(classifyExtractionSkip('APIキーの復号化に失敗しました')).toBe('llm_error')
    expect(classifyExtractionSkip('unexpected boom')).toBe('llm_error')
  })
})
