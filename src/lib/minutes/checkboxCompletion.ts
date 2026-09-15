/**
 * 議事録のチェックを入れたときに、そのタスクを完了にする判定。
 *
 * 会議中に「これ終わったね」となったとき、チェックを入れる動きが自然なのに、
 * これまでは `- [x]` にしてもタスクは動かなかった（見た目だけ変わるので完了したと誤解する）。
 *
 * 危ない方向は閉じる:
 *   - 拾うのは**タスクがすでにある行**だけ（`<!--task:uuid-->` の印がある行）。
 *     印の無い行は、まだタスクが無いので完了のしようがない。
 *   - **外したときは何もしない。** 完了を取り消すかどうかは決めることが多く、
 *     取り消しの事故のほうが痛い。戻したいときはタスク側で行う。
 *   - 一度に複数行がチェックされることもある（貼り付け等）ので、配列で返す。
 */

/**
 * 目印の中身が UUID の形か。目印は本文に書かれたただの文字なので、人や AI が
 * 壊れた形で書くことがある。形を確かめずに DB へ渡すと `invalid input syntax for
 * type uuid` で落ち、**その会議のぶんが丸ごと失敗する**（CLI の `minutes complete-checked`）。
 * 画面の「タスク作成済み」の印（`MinutesEditor` の UUID_RE）と同じ形を見る。
 */
const TASK_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** 行から `<!--task:uuid-->` の uuid を取る。無い・形が違うなら null（その行は飛ばす） */
function markerOf(line: string): string | null {
  const m = /<!--task:([^>]+)-->/.exec(line)
  if (!m) return null
  return TASK_ID_RE.test(m[1]) ? m[1] : null
}

/** チェックリスト行なら、チェックが入っているかを返す。チェックリストでなければ null */
function checkedOf(line: string): boolean | null {
  const m = /^\s*-\s*\[([ xX])\]/.exec(line)
  if (!m) return null
  return m[1] !== ' '
}

/**
 * 前後の本文を見比べて、「チェックが入った」かつ「タスクがある」行の taskId を返す。
 *
 * 行番号ではなく**印の uuid で突き合わせる**。行を足したり消したりすると番号がずれるが、
 * uuid なら同じ行を追える。
 */
export function detectCheckedTaskIds(prevMd: string, nextMd: string): string[] {
  const before = new Map<string, boolean>()
  for (const line of prevMd.split('\n')) {
    const id = markerOf(line)
    const checked = checkedOf(line)
    if (id !== null && checked !== null) before.set(id, checked)
  }

  const completed: string[] = []
  for (const line of nextMd.split('\n')) {
    const id = markerOf(line)
    const checked = checkedOf(line)
    if (id === null || checked !== true) continue
    // 前に無かった行（貼り付け等）は拾わない。前の状態が分からないものを動かさない
    if (before.get(id) === false) completed.push(id)
  }
  return completed
}

/**
 * 本文1つを見て、「チェックが付いている」かつ「タスクがある」行の taskId を返す。
 *
 * 画面は「チェックが入った瞬間」を前後の本文の差分で拾うが、CLI には**前の本文が無い**。
 * そこで「いま付いているチェック」をまとめて拾い、まだ完了になっていないタスクだけを
 * 完了にする（何度実行しても結果は同じ）。
 *
 * 外したチェックは見ない（完了の取り消しはしない）のは画面と同じ。
 */
export function collectCheckedTaskIds(md: string): string[] {
  const ids: string[] = []
  const seen = new Set<string>()
  for (const line of md.split('\n')) {
    const checked = checkedOf(line)
    if (checked !== true) continue
    const id = markerOf(line)
    if (id === null || seen.has(id)) continue
    seen.add(id)
    ids.push(id)
  }
  return ids
}
