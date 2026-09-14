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

/** 行から `<!--task:uuid-->` の uuid を取る。無ければ null */
function markerOf(line: string): string | null {
  const m = /<!--task:([^>]+)-->/.exec(line)
  return m ? m[1] : null
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
