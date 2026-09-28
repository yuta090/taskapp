/**
 * Wiki 本文（BlockNote のブロック JSON の文字列）を比べる・合わせるための小さな道具。
 * React も DOM も使わない（保存のフック `useWikiBodySave` と同時編集の両方から使う）。
 */
import { minutesSeedHash } from '@/lib/collab/hash'

/**
 * Wiki 本文(BlockNote の JSON文字列)を「開いただけでは保存しない」比較のために正規化する。
 * DB 側で組み立てられた本文（rpc_set_spec_state の追記は jsonb を ::text にするため
 * キー順・空白が変わる／generateDefaultWikiBody・SPEC_TEMPLATES・プリセット適用で
 * 手組みされた本文）は、クライアントの JSON.stringify(editor.document) とキー順や
 * 空白が一致しないことがある。単純な JSON.parse→JSON.stringify の往復では
 * オブジェクトのキー順は元のまま保たれてしまう（並べ替わらない）ため、それだけでは
 * 足りない。オブジェクトのキーをアルファベット順に並べ替えてから比較用の文字列に
 * する（配列の並びは意味を持つため崩さない）。JSON として壊れている値は、正規化を
 * あきらめて元の文字列のまま返す（＝そのケースは「別物」として保存される安全側に倒れる。
 * 議事録の computeBaseline(MinutesDocumentView.tsx) と同じ「開いたときと同じなら
 * 保存しない」という考え方を、Wiki の JSON 本文向けに実装したもの）。
 */
export function canonicalizeWikiBody(value: string | null): string | null {
  if (value === null) return null
  try {
    const sortKeysDeep = (input: unknown): unknown => {
      if (Array.isArray(input)) return input.map(sortKeysDeep)
      if (input !== null && typeof input === 'object') {
        const sorted: Record<string, unknown> = {}
        for (const key of Object.keys(input as Record<string, unknown>).sort()) {
          sorted[key] = sortKeysDeep((input as Record<string, unknown>)[key])
        }
        return sorted
      }
      return input
    }
    return JSON.stringify(sortKeysDeep(JSON.parse(value)))
  } catch {
    return value
  }
}

/**
 * 本文の合言葉。同時編集で「部屋の誰かがこの本文を保存した」かを見分けるのに使う
 * （`meta.savedHash`）。キーの順・空白の違いは同じ本文として扱う。
 */
export function wikiContentHash(body: string | null): string {
  return minutesSeedHash(canonicalizeWikiBody(body ?? '') ?? '')
}

function parseBlocks(body: string | null): unknown[] | null {
  if (body === null || body.trim() === '') return []
  try {
    const parsed: unknown = JSON.parse(body)
    return Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

/**
 * サーバーの本文が「知っている本文の末尾にブロックを足しただけ」なら、足された分を返す。
 * それ以外（途中が変わった・減った・何も足されていない・読めない）は null。
 *
 * 仕様の確定（`rpc_set_spec_state`）は、Wiki の本文の末尾にブロックを1つ足す。
 * そのたびに開いている人へ競合の帯を出すと、確定するたびに書き手が止まる。
 * 足されただけと分かれば、書いている画面の末尾へ差し込めば済む（議事録の AI 秘書の追記と同じ考え方）。
 * DB が組み立てた本文はキーの順と空白が変わるので、ブロックごとに正規化して比べる。
 */
export function wikiAppendedBlocks(known: string | null, fresh: string | null): unknown[] | null {
  const before = parseBlocks(known)
  const after = parseBlocks(fresh)
  if (!before || !after || after.length <= before.length) return null
  for (let i = 0; i < before.length; i++) {
    const x = canonicalizeWikiBody(JSON.stringify(before[i]))
    const y = canonicalizeWikiBody(JSON.stringify(after[i]))
    if (x !== y) return null
  }
  return after.slice(before.length)
}
