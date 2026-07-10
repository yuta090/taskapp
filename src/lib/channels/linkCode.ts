import { randomInt } from 'node:crypto'

/**
 * 顧問先突合用リンクコード。
 * 事務所が顧問先へ案内 → 顧問先がLINEトークで送り返す → webhookで突合する。
 * 紛らわしい文字(0/O, 1/I/L)を除いた大文字英数8桁。
 */

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
const CODE_LENGTH = 8

export const LINK_CODE_REGEX = new RegExp(`^[${ALPHABET}]{${CODE_LENGTH}}$`)

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
    .trim()
    // 全角英数 → 半角
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .toUpperCase()

  return LINK_CODE_REGEX.test(normalized) ? normalized : null
}
