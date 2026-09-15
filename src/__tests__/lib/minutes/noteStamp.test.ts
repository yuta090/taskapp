import { describe, expect, it } from 'vitest'
import {
  formatNoteStamp,
  formatNoteStampLabel,
  normalizeNoteAuthor,
  noteAuthorNameOf,
} from '@/lib/minutes/noteStamp'

describe('メモに残す書いた人の名前', () => {
  it('前後の空白を落とす', () => {
    expect(normalizeNoteAuthor('  高橋 優太  ')).toBe('高橋 優太')
  })

  it('改行やタブは空白1つにする（目印は1行に収める）', () => {
    expect(normalizeNoteAuthor('高橋\n\t優太')).toBe('高橋 優太')
  })

  it('< と > を落とす（目印の `-->` を名前で閉じさせない）', () => {
    expect(normalizeNoteAuthor('a-->b<c')).toBe('a--bc')
  })

  it('長すぎる名前は40文字で切る', () => {
    expect(normalizeNoteAuthor('あ'.repeat(50))).toBe('あ'.repeat(40))
  })

  it('無いときは空文字', () => {
    expect(normalizeNoteAuthor('')).toBe('')
    expect(normalizeNoteAuthor('   ')).toBe('')
    expect(normalizeNoteAuthor(undefined)).toBe('')
    expect(normalizeNoteAuthor(null)).toBe('')
  })
})

describe('メンバー一覧から自分の名前を引く', () => {
  const USER_ID = '12345678-aaaa-bbbb-cccc-000000000000'

  it('プロフィールの表示名を返す', () => {
    expect(noteAuthorNameOf([{ id: USER_ID, displayName: '高橋 優太' }], USER_ID)).toBe('高橋 優太')
  })

  it('一覧に居ない・ログイン前なら空文字', () => {
    expect(noteAuthorNameOf([{ id: 'other', displayName: '佐藤' }], USER_ID)).toBe('')
    expect(noteAuthorNameOf([{ id: USER_ID, displayName: '高橋' }], '')).toBe('')
    expect(noteAuthorNameOf([{ id: USER_ID, displayName: '高橋' }], undefined)).toBe('')
  })

  it('表示名が未設定のときの仮の名前（id の先頭8文字…）は名前として残さない', () => {
    expect(noteAuthorNameOf([{ id: USER_ID, displayName: '12345678...' }], USER_ID)).toBe('')
  })
})

describe('会議メモに残す日時', () => {
  it('日本の時刻の年月日と時分を、そのままの形で持つ', () => {
    // jstNow() が返す Date は「ローカルの getter が日本時間を返す」形
    const jst = new Date(2026, 8, 15, 14, 30, 0)
    expect(formatNoteStamp(jst)).toBe('2026-09-15T14:30')
  })

  it('1桁の月日・時分も2桁でそろえる', () => {
    expect(formatNoteStamp(new Date(2026, 0, 3, 9, 5, 0))).toBe('2026-01-03T09:05')
  })

  it('本番が UTC でも日本の日付になる', () => {
    // 日本時間 2026-09-15 07:00（＝UTC では前日の 22:00）
    const realMoment = new Date('2026-09-14T22:00:00Z')
    expect(formatNoteStamp(undefined, realMoment)).toBe('2026-09-15T07:00')
  })
})

describe('会議メモの日時の見せ方', () => {
  const today = new Date(2026, 8, 15, 18, 0, 0)

  it('同じ年なら月日と時刻だけ', () => {
    expect(formatNoteStampLabel('2026-09-15T14:30', today)).toBe('9/15 14:30')
  })

  it('年が違えば年も出す', () => {
    expect(formatNoteStampLabel('2025-12-03T09:05', today)).toBe('2025/12/3 9:05')
  })

  it('形が違うものは出さない', () => {
    expect(formatNoteStampLabel('こわれた', today)).toBeNull()
    expect(formatNoteStampLabel('', today)).toBeNull()
    expect(formatNoteStampLabel(undefined, today)).toBeNull()
  })
})
