import { formatDateToLocalString } from '@/lib/gantt/dateUtils'
import type { CursorGranularity } from '@/lib/task-sync/types'

/**
 * 差分取得カーソルの provider 非依存ロジック。
 *
 * ツールごとに「更新日時で絞れる精度」が違う（Backlog=日付単位 / Asana・Linear=秒単位 /
 * Trello=差分APIなし）。この差をアダプタごとに書き分けると取りこぼしの温床になるため、
 * アダプタには粒度（cursorGranularity）だけ宣言してもらい、安全側の重なりはここで一元的に付ける。
 *
 * 重複取得は害にならない: 同じ外部タスクを2回見ても connector_task_links の
 * unique(connection_id, external_id) により2回目は既存リンクの更新に倒れ、タスクは増えない。
 * よって「取りこぼさない」側に倒すのが常に正しい。
 */

/** timestamp 粒度で戻す幅。ポーリング中に更新された行を次回で確実に拾うための重なり（gtasks import と同値）。 */
const TIMESTAMP_OVERLAP_MS = 60_000

/** ISO8601（ミリ秒付きUTC）かどうか。カーソルの形式検証に使う。 */
const ISO_TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/
/** ローカル日付 'YYYY-MM-DD' かどうか。 */
const LOCAL_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/**
 * 取り込み成功後に保存する次回カーソルを作る。**必ず安全側（過去寄り）に戻す**。
 *
 * @param at 取り込みを開始した時刻。呼び出し側が渡す（テスト可能にするため now を内部で取らない）。
 * @returns 保存すべきカーソル文字列。差分APIを持たないツール（'none'）は null（保存しない）。
 */
export function advanceCursor(granularity: CursorGranularity, at: Date): string | null {
  if (granularity === 'none') return null

  if (granularity === 'timestamp') {
    // タイムスタンプカーソル用途のため toISOString を使う（CLAUDE.md の禁止はローカル日付表示の話で、
    // 既存 gtasks import.ts の poll_cursor も同じ例外扱い）。
    return new Date(at.getTime() - TIMESTAMP_OVERLAP_MS).toISOString()
  }

  // date 粒度: 「当日」は日付でしか絞れず、その日の後続更新を取り逃す。前日から取り直す。
  // ローカル日付で計算する（toISOString 経由だと日本時間の深夜で1日ずれる）。
  const prev = new Date(at)
  prev.setDate(prev.getDate() - 1)
  return formatDateToLocalString(prev)
}

/**
 * 保存済みカーソルを今回の取得条件（アダプタの `since`）へ変換する。
 *
 * 形式が粒度と食い違うカーソル（provider 付け替えや過去の実装の残骸）は**捨てて全件取得に倒す**。
 * そのまま渡すと外部APIが 400 を返し、カーソルが前進しないまま毎サイクル同じ失敗を繰り返して
 * その接続の取り込みが恒久停止する（gtasks の wedge と同じ事故）ため、安全側は「多く取る」。
 */
export function sinceForFetch(granularity: CursorGranularity, cursor: string | null): string | undefined {
  if (granularity === 'none' || !cursor) return undefined
  if (granularity === 'timestamp') return ISO_TIMESTAMP_RE.test(cursor) ? cursor : undefined
  return LOCAL_DATE_RE.test(cursor) ? cursor : undefined
}
