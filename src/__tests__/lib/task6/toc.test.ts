import { describe, it, expect } from 'vitest'
import { extractH2Headings, splitAfterLead, TOC_MIN_HEADINGS } from '@/lib/task6/toc'

/**
 * 長い記事の目次。**装飾ではなく機能**なので、短い記事には出さない（重く見えるだけ）。
 * 見出しが TOC_MIN_HEADINGS 本以上のときだけ出す。
 */
describe('extractH2Headings', () => {
  it('h2 の id と見出し文を、本文の順に取り出す', () => {
    const html = '<h2 id="a">症状：終わらない</h2><p>本文</p><h2 id="b">原因1：締切だけ</h2>'
    expect(extractH2Headings(html)).toEqual([
      { id: 'a', text: '症状：終わらない' },
      { id: 'b', text: '原因1：締切だけ' },
    ])
  })

  it('h3 は目次に入れない（階層を増やすと目次自体が読み物になる）', () => {
    const html = '<h2 id="a">見出し</h2><h3 id="a1">小見出し</h3>'
    expect(extractH2Headings(html)).toEqual([{ id: 'a', text: '見出し' }])
  })

  it('見出しの中の装飾タグは落として、文字だけにする', () => {
    const html = '<h2 id="a">対処：<strong>3つ</strong>試す</h2>'
    expect(extractH2Headings(html)).toEqual([{ id: 'a', text: '対処：3つ試す' }])
  })

  it('id が無い見出しは飛ばす（リンクできないため）', () => {
    const html = '<h2>idなし</h2><h2 id="b">あり</h2>'
    expect(extractH2Headings(html)).toEqual([{ id: 'b', text: 'あり' }])
  })

  it('見出しが無ければ空配列', () => {
    expect(extractH2Headings('<p>本文だけ</p>')).toEqual([])
  })

  it('目次を出す下限は6本（短い記事には出さない）', () => {
    expect(TOC_MIN_HEADINGS).toBe(6)
  })
})

describe('splitAfterLead', () => {
  it('最初の hr の直後で切る（書き出しの余韻を目次で潰さない）', () => {
    const html = '<p>書き出し</p><hr><p>解説</p><hr><p>続き</p>'
    expect(splitAfterLead(html)).toEqual({
      lead: '<p>書き出し</p><hr>',
      rest: '<p>解説</p><hr><p>続き</p>',
    })
  })

  it('自己終了形の hr も同じように扱う', () => {
    const html = '<p>書き出し</p><hr/><p>解説</p>'
    expect(splitAfterLead(html).rest).toBe('<p>解説</p>')
  })

  it('hr が無ければ、すべてを rest にする（目次が先頭に出る）', () => {
    const html = '<h2 id="a">見出し</h2><p>本文</p>'
    expect(splitAfterLead(html)).toEqual({ lead: '', rest: html })
  })
})
