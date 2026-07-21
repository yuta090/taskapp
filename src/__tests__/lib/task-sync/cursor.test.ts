import { describe, it, expect } from 'vitest'
import { advanceCursor, sinceForFetch } from '@/lib/task-sync/cursor'

/**
 * 差分取得カーソルの provider 非依存ロジック。
 *
 * ツールによって「更新日時で絞れる精度」が違う（Backlog=日付単位 / Asana・Linear=秒単位 /
 * Trello=そもそも差分APIが無い）。この差をアダプタごとに書き分けると取りこぼしの原因になるため、
 * 粒度(cursorGranularity)を宣言してもらい、安全側の重なりをここで一元的に付ける。
 *
 * 取りこぼしが起きる状況:
 *   - timestamp 粒度: ポーリング中に更新された行が「取得済み時刻」の直後に入り、次回の起点が
 *     それより後だと飛ぶ → 60秒手前に戻す（既存 gtasks import と同じ値）。
 *   - date 粒度: 「今日更新された分」は今日という日付でしか絞れず、当日中の後続更新を取り逃す
 *     → 前日から取り直す（重複は connector_task_links の一意性で吸収されるので安全側に倒す）。
 */

const NOW = new Date(2026, 6, 21, 15, 30, 0) // 2026-07-21 15:30 ローカル

describe('advanceCursor — 次回の起点を安全側に戻して保存する', () => {
  it('timestamp 粒度: 60秒手前のタイムスタンプを返す', () => {
    const cursor = advanceCursor('timestamp', NOW)
    expect(cursor).toBe(new Date(NOW.getTime() - 60_000).toISOString())
  })

  it('date 粒度: 前日のローカル日付を返す（当日中の後続更新を取り逃さない）', () => {
    expect(advanceCursor('date', NOW)).toBe('2026-07-20')
  })

  it('date 粒度: 月初は前月末へ正しく戻る', () => {
    expect(advanceCursor('date', new Date(2026, 6, 1, 9, 0, 0))).toBe('2026-06-30')
  })

  it('date 粒度: UTC変換を経由しないため日本時間の深夜でも1日ずれない', () => {
    // ローカル 2026-07-21 00:30 は UTC では 2026-07-20 15:30(JST想定)。toISOString 経由だと
    // 前日になり、さらに1日引くと2日ずれる。ローカル日付で計算していることを固定する。
    expect(advanceCursor('date', new Date(2026, 6, 21, 0, 30, 0))).toBe('2026-07-20')
  })

  it('none 粒度: 差分APIが無いツールはカーソルを持たない', () => {
    expect(advanceCursor('none', NOW)).toBeNull()
  })
})

describe('sinceForFetch — 保存済みカーソルを今回の取得条件へ変換する', () => {
  it('保存済みカーソルがあればそのまま起点に使う', () => {
    expect(sinceForFetch('timestamp', '2026-07-20T10:00:00.000Z')).toBe('2026-07-20T10:00:00.000Z')
    expect(sinceForFetch('date', '2026-07-20')).toBe('2026-07-20')
  })

  it('初回(カーソル未保存)は undefined = 全件取得', () => {
    expect(sinceForFetch('timestamp', null)).toBeUndefined()
    expect(sinceForFetch('date', null)).toBeUndefined()
  })

  it('none 粒度は保存値があっても差分条件を付けない（毎回全件）', () => {
    expect(sinceForFetch('none', '2026-07-20')).toBeUndefined()
  })

  it('粒度と保存形式が食い違うカーソルは捨てる（過去の設定変更やprovider付け替えの残骸）', () => {
    // date 粒度なのに ISO タイムスタンプが入っている＝そのまま渡すとAPIが400を返し取り込みが止まる。
    expect(sinceForFetch('date', '2026-07-20T10:00:00.000Z')).toBeUndefined()
    // timestamp 粒度なのに日付だけ＝起点が曖昧。安全側で全件取得に倒す。
    expect(sinceForFetch('timestamp', '2026-07-20')).toBeUndefined()
  })
})
