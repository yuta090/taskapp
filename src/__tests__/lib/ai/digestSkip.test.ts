import { describe, it, expect } from 'vitest'
import { classifyExtractionSkip } from '@/lib/ai/digestSkip'
import { AiConfigError } from '@/lib/ai/client'

/**
 * channel-digest cron の抽出スキップ理由の分類。
 * 「AI未設定/無効/復号不能(設定ギャップ・要対応)」を LLM/API 障害から切り分けて運用ログに残す契約。
 * 型(AiConfigError)で分類し、メッセージ文言には依存しない（文言変更で壊れないように）。
 */
describe('classifyExtractionSkip', () => {
  it('AiConfigError は種別に関わらず ai_unconfigured（設定ギャップ）', () => {
    expect(classifyExtractionSkip(new AiConfigError('missing', 'x'))).toBe('ai_unconfigured')
    expect(classifyExtractionSkip(new AiConfigError('disabled', 'x'))).toBe('ai_unconfigured')
    // 復号失敗も「キーが壊れていて要再設定」＝設定ギャップ側に寄せる（従来は llm_error に埋もれていた）
    expect(classifyExtractionSkip(new AiConfigError('decrypt_failed', 'x'))).toBe('ai_unconfigured')
  })

  it('LLM/API障害・その他の Error は llm_error', () => {
    expect(classifyExtractionSkip(new Error('OpenAI API エラー (500): ...'))).toBe('llm_error')
    expect(classifyExtractionSkip(new Error('Anthropic レート制限'))).toBe('llm_error')
    expect(classifyExtractionSkip(new Error('unexpected boom'))).toBe('llm_error')
  })

  it('後方互換: 型が付いていない「AI未設定」文言の Error/文字列は救済して ai_unconfigured', () => {
    expect(classifyExtractionSkip(new Error('AI未設定: 登録されていません'))).toBe('ai_unconfigured')
    expect(classifyExtractionSkip('AI未設定: 無効')).toBe('ai_unconfigured')
  })

  it('null/undefined など非Errorは llm_error（安全側）', () => {
    expect(classifyExtractionSkip(null)).toBe('llm_error')
    expect(classifyExtractionSkip(undefined)).toBe('llm_error')
  })
})
