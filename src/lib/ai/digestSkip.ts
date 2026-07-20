import { AiConfigError } from './errors'

/**
 * channel-digest cron の抽出スキップ理由を、運用可視化のために分類する。
 *
 * getAiConfig は org_ai_config が未登録/無効/復号不能のとき AiConfigError を投げる。これを
 * 「設定ギャップ（自動タスク化が止まっている・要オペ/ユーザー対応）」として LLM/API 障害と
 * 切り分け、cron が例外を黙って skipped[] に飲み込む（サイレントスキップ）のを止めるためのタグにする。
 *
 * 型で分類する（メッセージ文字列 prefix には依存しない）。文言変更・翻訳・例外ラップで
 * 分類が壊れるのを避ける。後方互換のため、型が付いていない 'AI未設定' 文言だけ救済する。
 */
export type DigestSkipKind = 'ai_unconfigured' | 'llm_error'

export function classifyExtractionSkip(error: unknown): DigestSkipKind {
  if (error instanceof AiConfigError) return 'ai_unconfigured'
  const msg = error instanceof Error ? error.message : typeof error === 'string' ? error : ''
  return msg.startsWith('AI未設定') ? 'ai_unconfigured' : 'llm_error'
}
