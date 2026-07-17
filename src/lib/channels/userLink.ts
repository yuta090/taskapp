import { createHash, randomBytes } from 'crypto'

/**
 * 内部ユーザーの LINE 本人紐付けコード（Stage 2.7-A）。
 *
 * 顧客用の突合コード（channel_link_codes）とは *別物* である。
 * あちらは意図的にワンタイムでない（30日マルチユース。「紙/QRを社長と経理の2人が読む」運用のため）。
 * 同じコードを読んだ別人の承認が本人の承認として通ってしまうため、本人性には使えない。
 *
 * こちらは承認の本人性を担保するためのもので:
 *   - 128bit のワンタイム（使用即失効・15分）
 *   - 平文はDBに保存しない（sha256 のみ）
 *   - 会話ログ(channel_messages)にも *保存前に* マスクする（append-onlyなので入れたら消せない）
 *   - `TA-` プレフィックスで顧客用コードと形式を分け、誤検出・取り違えを防ぐ
 */

/** Crockford Base32。紛らわしい I / L / O / U を除く */
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

/** 26文字 × 5bit = 130bit（128bit以上を満たす） */
const CODE_LENGTH = 26

const CODE_PREFIX = 'TA-'

/** 会話ログに保存する際の置換文字列 */
export const USER_LINK_CODE_MASK = '[認証コード]'

const CODE_PATTERN = new RegExp(`${CODE_PREFIX}[${CROCKFORD}]{${CODE_LENGTH}}`)

/** ワンタイムコードを生成する。平文はここでしか存在せず、発行APIのレスポンスで一度だけ返す */
export function generateUserLinkCode(): string {
  const bytes = randomBytes(CODE_LENGTH)
  let code = ''
  for (let i = 0; i < CODE_LENGTH; i++) {
    // 256 % 32 === 0 なのでモジュロバイアスは生じない
    code += CROCKFORD[bytes[i] % CROCKFORD.length]
  }
  return `${CODE_PREFIX}${code}`
}

/** 入力ゆれ（小文字・前後空白）を吸収する。ハッシュ計算の前に必ず通す */
export function normalizeUserLinkCode(input: string): string {
  return input.trim().toUpperCase()
}

/** DBに保存するのはこのハッシュだけ。平文は保存しない */
export function hashUserLinkCode(code: string): string {
  return createHash('sha256').update(normalizeUserLinkCode(code)).digest('hex')
}

/**
 * 本文から内部ユーザー用コードを *抽出* する（見つからなければ null）。
 *
 * 検出（looksLike）とハッシュ対象は必ず同じ抽出結果を使うこと。
 * 検出は部分一致なのに本文全体をハッシュする、という食い違いがあると:
 *   「このコードです TA-xxx よろしく」とグループに誤爆された場合、
 *   表示はマスクされるのに *コードは失効しない*。
 *   → グループの参加者が見えているコードをコピーして1:1に送れば、
 *     その人が「責任者」として紐付いてしまう（承認の本人性が破れる）。
 */
export function extractUserLinkCode(text: string | null | undefined): string | null {
  if (!text) return null
  const match = normalizeUserLinkCode(text).match(CODE_PATTERN)
  return match ? match[0] : null
}

/** 本文が内部ユーザー用コードを含むか（顧客用の短い突合コードは検出しない） */
export function looksLikeUserLinkCode(text: string | null | undefined): boolean {
  return extractUserLinkCode(text) !== null
}

/**
 * 会話ログに保存する前に、認証コードを含む本文をマスクする。
 *
 * 部分置換ではなく本文ごと置き換える。コードの前後に文章が付いていても平文が残らないようにするため
 * （channel_messages は append-only のトリガーで保護されており、一度入れた本文は redaction 以外で消せない）。
 */
export function maskUserLinkCode(body: string | null): string | null {
  if (!body) return body
  return looksLikeUserLinkCode(body) ? USER_LINK_CODE_MASK : body
}
