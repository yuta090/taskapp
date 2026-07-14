import { describe, it, expect } from 'vitest'
import { parseJapaneseDue, validateDue, formatDueLabel } from '@/lib/channels/digest/due'

/**
 * 申し送りの期限（日付＋時刻）の解決（Stage 2.6）。
 *
 * - 相対表現（明日/金曜/今週中）は「基準日時(JST)」から絶対日付に解決する
 * - 時刻の明示がなければ null（終日）。「午前中」「朝イチ」等の曖昧語は丸めない
 * - 過去日・遠すぎる日付は保存前に落とす（LLMは年を間違え、過去日を返す）
 * - 日付はローカルタイムゾーン維持（toISOString禁止・CLAUDE.md）
 */

// 2026-07-14(火) 10:30 JST を基準にする
const NOW = new Date(2026, 6, 14, 10, 30)

describe('parseJapaneseDue: 相対日付', () => {
  it('「明日までに」を翌日に解決する', () => {
    expect(parseJapaneseDue('明日までに請求書を送る', NOW).dueDate).toBe('2026-07-15')
  })

  it('「今日中」を当日に解決する', () => {
    expect(parseJapaneseDue('今日中に確認お願いします', NOW).dueDate).toBe('2026-07-14')
  })

  it('「明後日」を翌々日に解決する', () => {
    expect(parseJapaneseDue('明後日に納品', NOW).dueDate).toBe('2026-07-16')
  })

  it('「金曜まで」を今週の金曜に解決する（基準日は火曜）', () => {
    expect(parseJapaneseDue('金曜までに酒屋へ発注', NOW).dueDate).toBe('2026-07-17')
  })

  it('「月曜まで」は基準日より後の月曜（翌週）に解決する', () => {
    expect(parseJapaneseDue('月曜までにお願いします', NOW).dueDate).toBe('2026-07-20')
  })

  it('「来週火曜」は翌週の火曜に解決する', () => {
    expect(parseJapaneseDue('来週火曜に打ち合わせ', NOW).dueDate).toBe('2026-07-21')
  })

  it('「今週中」を今週の金曜（週の終端）に丸める', () => {
    expect(parseJapaneseDue('今週中に見積もりを出す', NOW).dueDate).toBe('2026-07-17')
  })

  it('「今月中」を月末に丸める', () => {
    expect(parseJapaneseDue('今月中に精算', NOW).dueDate).toBe('2026-07-31')
  })
})

describe('parseJapaneseDue: 絶対日付', () => {
  it('「7/17」を解決する', () => {
    expect(parseJapaneseDue('7/17までに提出', NOW).dueDate).toBe('2026-07-17')
  })

  it('「7月17日」を解決する', () => {
    expect(parseJapaneseDue('7月17日に納品します', NOW).dueDate).toBe('2026-07-17')
  })

  it('基準日より前の月日は翌年と解釈する（年末の「1/5」）', () => {
    const dec = new Date(2026, 11, 28, 9, 0)
    expect(parseJapaneseDue('1/5までにお願いします', dec).dueDate).toBe('2027-01-05')
  })
})

describe('parseJapaneseDue: 時刻', () => {
  it('「17時まで」を17:00に解決する', () => {
    const due = parseJapaneseDue('明日の17時までに発注', NOW)
    expect(due).toEqual({ dueDate: '2026-07-15', dueTime: '17:00' })
  })

  it('「17:30」を解決する', () => {
    expect(parseJapaneseDue('明日17:30に集合', NOW).dueTime).toBe('17:30')
  })

  it('「17時半」を17:30に解決する', () => {
    expect(parseJapaneseDue('明日の17時半まで', NOW).dueTime).toBe('17:30')
  })

  it('「午後5時」を17:00に解決する', () => {
    expect(parseJapaneseDue('明日の午後5時までに', NOW).dueTime).toBe('17:00')
  })

  it('時刻の明示がなければ null（終日）', () => {
    expect(parseJapaneseDue('明日までに発注', NOW).dueTime).toBeNull()
  })

  it('「3時間かかる」の「時間」を時刻として拾わない（所要時間であって締切ではない）', () => {
    expect(parseJapaneseDue('明日までに、作業は3時間かかります', NOW)).toEqual({
      dueDate: '2026-07-15',
      dueTime: null,
    })
  })

  it('「午前中」「朝イチ」等の曖昧語は時刻に丸めない', () => {
    expect(parseJapaneseDue('明日の午前中にお願いします', NOW).dueTime).toBeNull()
    expect(parseJapaneseDue('明日の朝イチで', NOW).dueTime).toBeNull()
  })

  it('日付が取れない本文の時刻は捨てる（時刻だけの期限は保持しない）', () => {
    expect(parseJapaneseDue('17時に電話します', NOW)).toEqual({ dueDate: null, dueTime: null })
  })
})

describe('parseJapaneseDue: 期限を含まない本文', () => {
  it('期限表現がなければ両方 null', () => {
    expect(parseJapaneseDue('議事録を共有しておきます', NOW)).toEqual({ dueDate: null, dueTime: null })
  })
})

describe('validateDue: LLM出力の検証', () => {
  it('正しい形式はそのまま通す', () => {
    expect(validateDue('2026-07-17', '17:00', NOW)).toEqual({ dueDate: '2026-07-17', dueTime: '17:00' })
  })

  it('基準日と同日（当日期限）は通す', () => {
    expect(validateDue('2026-07-14', null, NOW).dueDate).toBe('2026-07-14')
  })

  it('過去日は null に落とす（「昨日までに」は期限として無意味）', () => {
    expect(validateDue('2026-07-13', '10:00', NOW)).toEqual({ dueDate: null, dueTime: null })
  })

  it('180日より先は null に落とす（LLMの年取り違え除け）', () => {
    expect(validateDue('2027-07-17', null, NOW).dueDate).toBeNull()
  })

  it('形式不正は null に落とす', () => {
    expect(validateDue('2026/07/17', null, NOW).dueDate).toBeNull()
    expect(validateDue('来週', null, NOW).dueDate).toBeNull()
    expect(validateDue('2026-13-45', null, NOW).dueDate).toBeNull()
  })

  it('時刻の形式不正は時刻だけ落とし、日付は残す', () => {
    expect(validateDue('2026-07-17', '25:00', NOW)).toEqual({ dueDate: '2026-07-17', dueTime: null })
    expect(validateDue('2026-07-17', '夕方', NOW)).toEqual({ dueDate: '2026-07-17', dueTime: null })
  })

  it('日付が null なら時刻も落とす', () => {
    expect(validateDue(null, '17:00', NOW)).toEqual({ dueDate: null, dueTime: null })
  })
})

describe('formatDueLabel: 表示', () => {
  const today = '2026-07-14'

  it('日付＋時刻を「⏰7/17(金) 17:00」で表示する', () => {
    expect(formatDueLabel('2026-07-17', '17:00', today)).toBe('⏰7/17(金) 17:00')
  })

  it('時刻なし（終日）は日付だけ表示する', () => {
    expect(formatDueLabel('2026-07-17', null, today)).toBe('⏰7/17(金)')
  })

  it('当日は「今日」と表示する', () => {
    expect(formatDueLabel('2026-07-14', '17:00', today)).toBe('⏰今日 17:00')
  })

  it('期限超過は ⚠️ に変える', () => {
    expect(formatDueLabel('2026-07-12', null, today)).toBe('⚠️7/12(日) 期限超過')
  })

  it('期限なしは空文字（⏰ごと出さない）', () => {
    expect(formatDueLabel(null, null, today)).toBe('')
  })
})
