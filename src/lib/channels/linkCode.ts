import { randomInt } from 'node:crypto'

/**
 * 顧問先突合用リンクコード。
 * 事務所が顧問先へ案内 → 顧問先がLINEトークで送り返す → webhookで突合する。
 * 紛らわしい文字(0/O, 1/I/L)を除いた大文字英数8桁。
 */

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
const CODE_LENGTH = 8

export const LINK_CODE_REGEX = new RegExp(`^[${ALPHABET}]{${CODE_LENGTH}}$`)

/**
 * 共有bot（platform account）のグループ紐付けコード（shared_group_claim）用。
 * 設計正本 §2（Fable裁定・確定）: 顧問先突合コードと同じ31文字集合(ALPHABET)だが26文字
 * （≈128.8bit）。8文字と26文字は長さで完全に排他するため、同一ALPHABETでもルーティング衝突なし。
 */
const CLAIM_CODE_LENGTH = 26

export const CLAIM_CODE_REGEX = new RegExp(`^[${ALPHABET}]{${CLAIM_CODE_LENGTH}}$`)

export function generateLinkCode(): string {
  let code = ''
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += ALPHABET[randomInt(ALPHABET.length)]
  }
  return code
}

/**
 * 受信テキストをリンクコードとして解釈する。
 * 前後空白・小文字・全角英数を許容。コード形式でなければ null。
 */
export function normalizeLinkCode(text: string): string | null {
  const normalized = text
    // 空白は全て吸収（全角スペースU+3000・コード内の区切り空白を含む）
    .replace(/[\s\u3000]/g, '')
    // 全角英数 → 半角
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .toUpperCase()

  return LINK_CODE_REGEX.test(normalized) ? normalized : null
}

/**
 * 共有bot（platform account）のグループ紐付けコード（shared_group_claim）専用の受理フィルタ。
 * 設計正本 §2（Fable裁定・確定）: web_approval / code_only 共通の単一形状。
 * 31文字集合(ALPHABET) × 26文字（≈128.8bit）。表示は `GC-` プレフィクス＋ハイフン区切り
 * （例 `GC-XXXXXX-XXXXX-XXXXX-XXXXX-XXXXX`）だが、正準形（HMAC対象・照合対象）は
 * プレフィクス・区切りを除いた26文字本体のみ。
 *
 * 既存の顧問先突合コード（normalizeLinkCode・8文字）とは長さで完全に排他する
 * （8文字コードはここに絶対マッチせず、26文字コードは normalizeLinkCode に絶対マッチしない）。
 * identity/group_link 経路（normalizeLinkCode）はこの関数の追加とは無関係に無変更。
 *
 * 手順（このまま。順序を変えない）:
 *   空白(半角・全角U+3000)とハイフン除去 → 全角英数→半角 → 大文字化 →
 *   先頭に `GC` があれば除去 → `^[ALPHABET]{26}$` に一致すれば26文字本体を返す（外れればnull）。
 */
export function normalizeClaimCode(text: string): string | null {
  let normalized = text
    // 空白(全角U+3000含む)とハイフン区切りを除去
    .replace(/[-\s\u3000]/g, '')
    // 全角英数 → 半角
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .toUpperCase()

  if (normalized.startsWith('GC')) {
    normalized = normalized.slice(2)
  }

  return CLAIM_CODE_REGEX.test(normalized) ? normalized : null
}
