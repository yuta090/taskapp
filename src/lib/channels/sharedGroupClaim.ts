import { createHmac, randomInt } from 'node:crypto'

/**
 * 共有bot（platform account）グループ紐付けコード（Stage 4 §2/§3）。
 *
 * コード自体の形式・入力ゆれの吸収（全角/半角・大小文字・空白）は既存の顧客用突合コード
 * （@/lib/channels/linkCode.ts の normalizeLinkCode）と共有する。二つのコード空間は
 * 保存列で自然に分離される（顧客用コードは channel_link_codes.code に平文保存、
 * shared_group_claim は code_hash のみ・code列はNULL — CHECK(channel_link_codes_shared_claim_shape)
 * で強制）ため、同じ文字コード表を使っても衝突しない。
 *
 * 設計正本 §2 channel_link_codes: 生codeを保存せず HMAC+pepper（128bit相当）で保持する。
 * pepperは専用のSHARED_GROUP_CLAIM_PEPPERを優先し、未設定時はSYSTEM_ENCRYPTION_KEY（既存の
 * システム秘密鍵）にフォールバックする。将来pepperを分離したい場合は前者のみ設定すればよい。
 */
function getPepper(): string {
  const pepper = process.env.SHARED_GROUP_CLAIM_PEPPER ?? process.env.SYSTEM_ENCRYPTION_KEY
  if (!pepper) {
    throw new Error('SHARED_GROUP_CLAIM_PEPPER (or SYSTEM_ENCRYPTION_KEY) is not configured')
  }
  return pepper
}

/** DBに保存する code_hash を計算する。平文コードはここでしか扱わない。 */
export function hashSharedGroupClaimCode(normalizedCode: string): string {
  return createHmac('sha256', getPepper()).update(normalizedCode).digest('hex')
}

/** 紛らわしい文字(0/O, 1/I/L)を除いた大文字英数。既存リンクコードと同一表（linkCode.tsのALPHABETと揃える） */
const CHALLENGE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
const CHALLENGE_LENGTH = 4

/**
 * 承認者（org内部ユーザー）がグループを識別するための確認番号（content-freeな照合材料。
 * 会話本文ではない）。channel_group_claims.challenge_label に保存し、投入者への返信と
 * 承認コンソール（PR3）双方に出す想定。
 */
export function generateGroupClaimChallengeLabel(): string {
  let label = ''
  for (let i = 0; i < CHALLENGE_LENGTH; i++) {
    label += CHALLENGE_ALPHABET[randomInt(CHALLENGE_ALPHABET.length)]
  }
  return label
}
