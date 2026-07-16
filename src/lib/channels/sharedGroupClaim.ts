import { createHmac, randomInt } from 'node:crypto'

/**
 * 共有bot（platform account）グループ紐付けコード（Stage 4 §2/§3。Fable裁定・確定形状）。
 *
 * コード形状は web_approval / code_only 共通の単一形状: 31文字集合(ALPHABET) × 26文字
 * （≈128.8bit）。表示は `GC-` プレフィクス＋ハイフン区切りだが、正準形（HMAC対象）は
 * プレフィクス・区切りを除いた26文字本体のみ（@/lib/channels/linkCode.ts の
 * normalizeClaimCode が受理フィルタ・正準化を担う。顧客用突合コード normalizeLinkCode(8文字)
 * とは長さで完全に排他しており、コード空間は混同しない）。
 *
 * 設計正本 §2 channel_link_codes: 生codeを保存せず HMAC+pepper（128bit相当）で保持する。
 * hashSharedGroupClaimCode の入力は必ず normalizeClaimCode が返した26文字正準形にすること
 * （発行側=PR3 も償還側=本ファイルも同じ正準形をHMACする前提。ここがずれるとcode_hashが
 * 一致せず正当なコードが常にinvalid扱いになる）。
 * pepperは専用のSHARED_GROUP_CLAIM_PEPPERを優先し、未設定時はSYSTEM_ENCRYPTION_KEY（既存の
 * システム秘密鍵）にフォールバックする。将来pepperを分離したい場合は前者のみ設定すればよい。
 */
/**
 * fail-closed: 未設定(undefined)だけでなく空文字も拒否する。
 * SHARED_GROUP_CLAIM_PEPPER→SYSTEM_ENCRYPTION_KEYの優先順位で解決した「最終的なpepper」が
 * 空/undefinedなら、空のHMAC鍵（=誰でも計算可能な既知鍵と同義）を黙って受け入れず必ず例外を投げる
 * （`??` はnull/undefinedのみをフォールバック対象にするため、値の空文字判定はここで別途行う）。
 */
function getPepper(): string {
  const pepper = process.env.SHARED_GROUP_CLAIM_PEPPER ?? process.env.SYSTEM_ENCRYPTION_KEY
  if (!pepper || pepper.length === 0) {
    throw new Error('SHARED_GROUP_CLAIM_PEPPER (or SYSTEM_ENCRYPTION_KEY) is not configured')
  }
  return pepper
}

/**
 * DBに保存する code_hash を計算する。平文コードはここでしか扱わない。
 * @param canonicalCode normalizeClaimCode() が返した26文字正準形（プレフィクス・区切り除去済み）。
 */
export function hashSharedGroupClaimCode(canonicalCode: string): string {
  return createHmac('sha256', getPepper()).update(canonicalCode).digest('hex')
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
