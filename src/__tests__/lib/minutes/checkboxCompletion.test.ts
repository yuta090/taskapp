import { describe, it, expect } from 'vitest'
import { collectCheckedTaskIds, detectCheckedTaskIds } from '@/lib/minutes/checkboxCompletion'

const T1 = '3f2504e0-4f89-11d3-9a0c-0305e82c3301'
const T2 = '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d'
const line = (checked: boolean, text: string, id?: string) =>
  `- [${checked ? 'x' : ' '}] ${text}${id ? ` <!--task:${id}-->` : ''}`

describe('detectCheckedTaskIds: 拾うとき', () => {
  it('チェックを入れた行のタスクを拾う', () => {
    const prev = line(false, '玄関の向きを決める', T1)
    const next = line(true, '玄関の向きを決める', T1)
    expect(detectCheckedTaskIds(prev, next)).toEqual([T1])
  })

  it('一度に複数チェックされても全部拾う', () => {
    const prev = [line(false, 'A', T1), line(false, 'B', T2)].join('\n')
    const next = [line(true, 'A', T1), line(true, 'B', T2)].join('\n')
    expect(detectCheckedTaskIds(prev, next)).toEqual([T1, T2])
  })

  it('行が動いても、印の uuid で追える', () => {
    const prev = ['# 見出し', line(false, 'A', T1)].join('\n')
    const next = [line(true, 'A', T1), '# 見出し', '- 足した行'].join('\n')
    expect(detectCheckedTaskIds(prev, next)).toEqual([T1])
  })

  it('大文字の X でも拾う', () => {
    const prev = line(false, 'A', T1)
    const next = `- [X] A <!--task:${T1}-->`
    expect(detectCheckedTaskIds(prev, next)).toEqual([T1])
  })
})

describe('detectCheckedTaskIds: 拾わないとき', () => {
  it('外したときは何もしない（完了を取り消さない）', () => {
    const prev = line(true, 'A', T1)
    const next = line(false, 'A', T1)
    expect(detectCheckedTaskIds(prev, next)).toEqual([])
  })

  it('もともとチェック済みなら拾わない（同じ内容の保存で何度も走らせない）', () => {
    const prev = line(true, 'A', T1)
    const next = line(true, 'A', T1)
    expect(detectCheckedTaskIds(prev, next)).toEqual([])
  })

  it('タスクがまだ無い行は拾わない', () => {
    const prev = line(false, 'A')
    const next = line(true, 'A')
    expect(detectCheckedTaskIds(prev, next)).toEqual([])
  })

  it('前に無かった行は拾わない（貼り付けで一気に完了させない）', () => {
    const prev = '# 見出し'
    const next = line(true, 'A', T1)
    expect(detectCheckedTaskIds(prev, next)).toEqual([])
  })

  it('チェックリストでない行は拾わない', () => {
    const prev = `- A <!--task:${T1}-->`
    const next = `- A <!--task:${T1}-->`
    expect(detectCheckedTaskIds(prev, next)).toEqual([])
  })

  it('本文だけ直した行は拾わない', () => {
    const prev = line(false, 'A', T1)
    const next = line(false, 'A を少し直した', T1)
    expect(detectCheckedTaskIds(prev, next)).toEqual([])
  })

  it('空でも落ちない', () => {
    expect(detectCheckedTaskIds('', '')).toEqual([])
  })
})

/**
 * CLI から「いま本文でチェックが付いている行」をまとめて完了にするための取り出し。
 * 画面は「チェックが入った瞬間」を差分で拾うが、CLI には前の本文が無いので、
 * 本文1つだけを見て拾う。
 */
describe('collectCheckedTaskIds: 本文1つから拾う', () => {
  it('チェックが付いていて、タスクの印がある行を拾う', () => {
    const md = [line(true, 'A', T1), line(false, 'B', T2)].join('\n')
    expect(collectCheckedTaskIds(md)).toEqual([T1])
  })

  it('印の無い行は拾わない（タスクがまだ無い）', () => {
    expect(collectCheckedTaskIds(line(true, '印なし'))).toEqual([])
  })

  it('大文字の [X] も拾う', () => {
    expect(collectCheckedTaskIds(`- [X] A <!--task:${T1}-->`)).toEqual([T1])
  })

  it('字下げした行も拾う（画面のチェックと同じ扱い）', () => {
    expect(collectCheckedTaskIds(`  ${line(true, 'A', T1)}`)).toEqual([T1])
  })

  it('同じ印が何度も出ても1回だけ返す', () => {
    const md = [line(true, 'A', T1), line(true, 'A の写し', T1)].join('\n')
    expect(collectCheckedTaskIds(md)).toEqual([T1])
  })

  it('チェックリストでない行は見ない', () => {
    expect(collectCheckedTaskIds(`ふつうの段落 <!--task:${T1}-->`)).toEqual([])
  })

  it('空の本文なら空', () => {
    expect(collectCheckedTaskIds('')).toEqual([])
  })
})

/**
 * 目印は本文に書かれた文字なので、人や AI が壊れた形で書くことがある。
 * UUID の形でないものを渡すと、DB 側が `invalid input syntax for type uuid` で落ち、
 * **その会議のぶんが丸ごと失敗する**（CLI の `minutes complete-checked`）。
 * 形を確かめて、違う行は飛ばす。
 */
describe('壊れた目印は飛ばす', () => {
  it('UUID の形でない目印は拾わない', () => {
    expect(collectCheckedTaskIds('- [x] A <!--task:abc-->')).toEqual([])
    expect(detectCheckedTaskIds('- [ ] A <!--task:abc-->', '- [x] A <!--task:abc-->')).toEqual([])
  })

  it('壊れた目印があっても、同じ本文の正しい目印は拾う', () => {
    const md = `- [x] 壊れ <!--task:abc-->\n- [x] 正しい <!--task:${T1}-->`
    expect(collectCheckedTaskIds(md)).toEqual([T1])
  })

  it('空の目印も拾わない', () => {
    expect(collectCheckedTaskIds('- [x] A <!--task:-->')).toEqual([])
  })
})
