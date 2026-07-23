import { describe, it, expect } from 'vitest'
import { isCompletionDeclaration } from '@/lib/channels/doneSuggest/detector'

describe('isCompletionDeclaration', () => {
  describe('肯定（完了宣言）', () => {
    const positives = [
      '完了しました',
      '完了した',
      '完了です',
      '完了',
      '終わりました',
      '終わった',
      '対応済みです',
      '対応済み',
      '対応しました',
      '対応済',
      'done',
      'Done!',
      'DONE',
      "It's done",
    ]
    for (const text of positives) {
      it(`「${text}」→ true`, () => {
        expect(isCompletionDeclaration(text)).toBe(true)
      })
    }
  })

  describe('否定（未完了）→ false', () => {
    const negatives = [
      'まだ完了してない',
      '完了してない',
      'まだ対応できてないです',
      '対応できませんでした',
      '終わっていません',
      '終わってません',
      '未完了です',
      '未対応です',
      '対応できなかった',
      'not done yet',
      "I'm not done",
    ]
    for (const text of negatives) {
      it(`「${text}」→ false`, () => {
        expect(isCompletionDeclaration(text)).toBe(false)
      })
    }
  })

  describe('疑問形 → false', () => {
    const questions = ['完了した?', '完了しましたか', '対応しましたか？', 'done?', '終わりましたか']
    for (const text of questions) {
      it(`「${text}」→ false`, () => {
        expect(isCompletionDeclaration(text)).toBe(false)
      })
    }
  })

  describe('条件形・未来/予定・意思（M-1是正・code review） → false', () => {
    const conditionalOrFuture = [
      '終わったら連絡します',
      '完了したら報告します',
      '完了したら報告',
      '本日完了予定です',
      '完了予定です',
      '完了します',
      '対応します',
      'もうすぐ完了',
      '完了できそう',
    ]
    for (const text of conditionalOrFuture) {
      it(`「${text}」→ false（まだ終わっていない/意思表明にすぎない）`, () => {
        expect(isCompletionDeclaration(text)).toBe(false)
      })
    }

    // 上記ガードを足しても、実際の完了報告（過去形）は引き続きHITさせる（precision優先の裏側）。
    const stillTrue = ['完了しました', '完了した', '終わりました', '終わった', '対応済みです', '対応しました', 'done']
    for (const text of stillTrue) {
      it(`「${text}」→ true（ガード追加後も完了報告は維持）`, () => {
        expect(isCompletionDeclaration(text)).toBe(true)
      })
    }
  })

  describe('依頼文（他者への依頼） → false', () => {
    const requests = ['完了のご確認をお願いします', '対応してください', '完了させてください']
    for (const text of requests) {
      it(`「${text}」→ false`, () => {
        expect(isCompletionDeclaration(text)).toBe(false)
      })
    }
  })

  describe('長文', () => {
    it('完了語彙を含むが疑問形で終わる長文 → false', () => {
      const text =
        '本日はお世話になっております。先日ご依頼いただいた件について、念のためご確認ですが、' +
        '本当に完了しましたか？もう一度確認をお願いいたします。'
      expect(isCompletionDeclaration(text)).toBe(false)
    })

    it('完了宣言を含む長文（否定/疑問/依頼なし） → true', () => {
      const text =
        'お世話になっております。ご依頼いただいた見積書の件、先ほど確認の上、対応しました。' +
        '内容に問題があればまたご連絡いただければ幸いです。'
      // ※「内容に問題があれば」は否定/疑問/依頼のいずれのパターンにも当たらない想定
      expect(isCompletionDeclaration(text)).toBe(true)
    })
  })

  describe('完了語彙を含まない/空 → false', () => {
    const others = ['', '  ', 'こんにちは', '請求書を送ります', '対応中です', '対応します']
    for (const text of others) {
      it(`「${text}」→ false`, () => {
        expect(isCompletionDeclaration(text)).toBe(false)
      })
    }
  })

  it('null/undefined → false', () => {
    expect(isCompletionDeclaration(null)).toBe(false)
    expect(isCompletionDeclaration(undefined)).toBe(false)
  })
})
