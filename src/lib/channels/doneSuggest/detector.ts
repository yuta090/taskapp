/**
 * 完了宣言テキストの検知（純関数・Fable裁定「完了サジェスト」v1・precision優先）。
 *
 * 「完了サジェスト」は誤爆すると顧客チャットではなく本人への私信(DM)で出るうえ、
 * task_id unique な台帳（1タスク=生涯1サジェスト）により後から出し直せない。
 * よって曖昧な文はヒットさせない — false positive（誤って完了扱いを訊く）より
 * false negative（沈黙・出し漏れ）を優先する。
 *
 * 判定は2段構え:
 *   1. 完了語彙（「完了」「終わりました」「終わった」「対応済み」「対応しました」「done」等）に
 *      マッチするか（POSITIVE_PATTERNS）
 *   2. 否定/疑問/依頼の文脈が無いか（NEGATION_PATTERNS/QUESTION_PATTERNS/REQUEST_PATTERNS）
 * の両方を満たしたときだけ true。
 */

/** 完了語彙。「完了」「対応」は接尾辞を伴わない裸の語も許容する（短文の一言報告に対応するため）。 */
const POSITIVE_PATTERNS: RegExp[] = [
  /完了(しました|した|です)?/,
  /終わ(りました|った)/,
  /対応(済み|しました|済)/,
  /done/i,
]

/**
 * 否定（未完了）の文脈。
 * - 「まだ」: 「まだ完了してない」「まだです」等
 * - 「〜ません」: 「してません」「できませんでした」等（動詞の種類を問わず広く拾う）
 * - 「て(い)?ない」: 「してない」「していない」「できてない」「できていない」等
 * - 「なかった」: 「できなかった」等
 * - 「未完了/未対応」: 「完了」を部分文字列に含むが実際は未完了を表す語（誤検知防止の要）
 * - 英語 not: "not done yet" 等
 *
 * M-1是正（code review）: 条件形・未来/予定・意思・可能性の表現も除外する。
 * 「終わったら連絡します」「完了予定です」「完了します」「もうすぐ完了」「完了できそう」は
 * いずれも“まだ終わっていない”のに POSITIVE_PATTERNS の裸の部分一致（「完了」「終わった」等）に
 * ヒットしてしまう。1タスク=生涯1サジェスト（task_id unique）の下でこれを誤爆すると、
 * 後で本当に「完了しました」と言っても二度と出せなくなる（拾い漏れゼロの訴求を損なう）ため、
 * 「実際の完了報告（過去形）」だけを通す方向に倒す。
 * - 「たら」: 条件形（「終わったら」「完了したら」）。過去形「〜ました/でした」は「たら」を含まない。
 * - 「予定」: 「完了予定です」
 * - 「でき(そう|る)」: 「完了できそう」「対応できる」（見込み・可能）
 * - 「つもり」: 意思表明
 * - 「します」: 未来/現在形の宣言（「対応します」「完了します」）。「しました」は「します」を
 *   部分文字列として含まない（し・ま・し・た の並びに「します」の し・ま・す は現れない）ため、
 *   過去形の完了報告を誤って除外することはない。
 * - 「もうすぐ」: 「もうすぐ完了」
 */
const NEGATION_PATTERNS: RegExp[] = [
  /まだ/,
  /ません/,
  /て(い)?ない/,
  /なかった/,
  /未完了|未対応/,
  /\bnot\b/i,
  /たら/,
  /予定/,
  /でき(そう|る)/,
  /つもり/,
  /します/,
  /もうすぐ/,
]

/** 疑問形。「?」「？」、および文末が「〜か」で終わる形（例: 終わりましたか） */
const QUESTION_PATTERNS: RegExp[] = [/[?？]/, /か\s*$/]

/** 依頼文。自分の完了報告ではなく他者への依頼（例: 「完了のご確認をお願いします」） */
const REQUEST_PATTERNS: RegExp[] = [/お願い/, /ください/, /下さい/]

export function isCompletionDeclaration(text: string | null | undefined): boolean {
  if (!text) return false
  const trimmed = text.trim()
  if (!trimmed) return false

  if (!POSITIVE_PATTERNS.some((pattern) => pattern.test(trimmed))) return false
  if (NEGATION_PATTERNS.some((pattern) => pattern.test(trimmed))) return false
  if (QUESTION_PATTERNS.some((pattern) => pattern.test(trimmed))) return false
  if (REQUEST_PATTERNS.some((pattern) => pattern.test(trimmed))) return false

  return true
}
