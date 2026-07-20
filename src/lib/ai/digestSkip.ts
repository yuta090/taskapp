/**
 * channel-digest cron の抽出スキップ理由を、運用可視化のために分類する。
 *
 * getAiConfig は org_ai_config が未登録/無効のとき 'AI未設定: ...' を投げる。これを
 * 「設定ギャップ（自動タスク化が止まっている・要オペ対応）」として LLM/API 障害と切り分け、
 * cron が例外を黙って skipped[] に飲み込む（サイレントスキップ）のを止めるためのタグにする。
 */
export type DigestSkipKind = 'ai_unconfigured' | 'llm_error'

export function classifyExtractionSkip(reason: string): DigestSkipKind {
  return reason.startsWith('AI未設定') ? 'ai_unconfigured' : 'llm_error'
}
