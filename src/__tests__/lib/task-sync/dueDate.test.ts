import { describe, it, expect } from 'vitest'
import { externalDueToJstDate } from '@/lib/task-sync/dueDate'

/**
 * 外部ツールの「日時つき期日」→ ローカル日付の変換。
 *
 * これは実際に踏んだ不具合の回帰テスト: サーバーのタイムゾーンで日付を切り出していたため、
 * 本番（Vercel=UTC）では日本時間 8/1 0:00 の期日が **7/31** として取り込まれていた。
 * 利用者から見ると期日が1日早くずれ、リマインドも1日ずれる。
 *
 * このテストは**実行環境のタイムゾーンに依存せず**同じ結果になることを固定する
 * （CI=UTC / 開発機=JST のどちらでも通ること自体が要件）。
 */

describe('externalDueToJstDate — 日本時間の暦日で切り出す', () => {
  it('日本時間の日付境界で切り替わる（UTC環境でも1日ずれない）', () => {
    // 2026-07-31T15:00:00Z = 日本時間 2026-08-01 00:00
    expect(externalDueToJstDate('2026-07-31T15:00:00Z')).toBe('2026-08-01')
    // その1分前はまだ7/31（日本時間 23:59）
    expect(externalDueToJstDate('2026-07-31T14:59:00Z')).toBe('2026-07-31')
  })

  it('タイムゾーン付きの表記も絶対時刻として解釈する', () => {
    // 2026-08-01T00:00:00+09:00 = 2026-07-31T15:00:00Z = 日本時間 8/1
    expect(externalDueToJstDate('2026-08-01T00:00:00+09:00')).toBe('2026-08-01')
    // 米国西海岸の朝は日本時間では翌日
    expect(externalDueToJstDate('2026-07-31T09:00:00-07:00')).toBe('2026-08-01')
  })

  it('日付だけの表記は変換せずそのまま使う（時刻が無いものを変換すると滑る）', () => {
    expect(externalDueToJstDate('2026-07-31')).toBe('2026-07-31')
  })

  it('期日なしは null', () => {
    expect(externalDueToJstDate(null)).toBeNull()
    expect(externalDueToJstDate(undefined)).toBeNull()
    expect(externalDueToJstDate('')).toBeNull()
  })

  it('解釈できない値は期日なしにする（誤った日付で催促しない）', () => {
    expect(externalDueToJstDate('not a date')).toBeNull()
    expect(externalDueToJstDate('2026-99-99T00:00:00Z')).toBeNull()
  })
})
