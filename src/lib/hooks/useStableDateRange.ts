'use client'

import { useState } from 'react'

export interface DateRange {
  start: Date
  end: Date
}

/**
 * 日付範囲(start/end)を「値」で安定化するフック。
 *
 * calcDateRange はタスク配列が変わるたびに new Date(...) を返すため、内容(getTime())が
 * 同じでもオブジェクト参照は毎回変わる。GanttRow は memo でラップされているが、
 * props の startDate/endDate がこの参照ゆれのせいで shallow-compare に引っかかり、
 * タスク一覧のどんな変更(関係ないタスクの更新など)でも全行が再レンダリングされてしまう。
 *
 * getTime() が前回と同じであれば前回の Date オブジェクト参照をそのまま返し、
 * 変わったときだけ新しい参照を返すことで、この無駄な再レンダリングを防ぐ。
 *
 * ref を使った「レンダー中に ref を読み書きする」実装は react-hooks/refs に抵触するため、
 * 「レンダー中に前回情報とのズレを検知して setState で補正する」という React 公式パターン
 * (useEffectを使わない・guardがあるので無限ループにはならない)を使う。
 */
export function useStableDateRange(range: DateRange): DateRange {
  const [stable, setStable] = useState<DateRange>(range)

  if (
    stable.start.getTime() !== range.start.getTime() ||
    stable.end.getTime() !== range.end.getTime()
  ) {
    setStable(range)
    // このレンダーではまだ state が更新されていないので、今回分は新しい値を直接返す
    return range
  }

  return stable
}
