import { describe, it, expect } from 'vitest'
import { candidateSubLabel, toMinutesPreview, type RawMinutesPreview } from '@/lib/minutes/preview'

const PAGE_ID = '3f2504e0-4f89-11d3-9a0c-0305e82c3301'

const raw = (over: Partial<RawMinutesPreview> = {}): RawMinutesPreview => ({
  new_spec_count: 0,
  existing_spec_count: 0,
  new_specs: [],
  existing_specs: [],
  ...over,
})

describe('toMinutesPreview: 旧来の SPEC 行', () => {
  it('spec_path をそのまま持ち、決める札として扱う', () => {
    const view = toMinutesPreview(
      raw({
        new_spec_count: 1,
        new_specs: [{ line_number: 3, spec_path: '/spec/A.md#x', title: '料金を決める' }],
      })
    )
    expect(view.newSpecs[0]).toEqual({
      lineNumber: 3,
      title: '料金を決める',
      specPath: '/spec/A.md#x',
      wikiPageId: null,
      wikiPageTitle: null,
      isSpec: true,
    })
  })
})

describe('toMinutesPreview: Wiki ページに紐づく行', () => {
  it('仕様書タグ付きなら決める札として扱う', () => {
    const view = toMinutesPreview(
      raw({
        new_spec_count: 1,
        new_specs: [
          {
            line_number: 5,
            title: '玄関の向きを決める',
            wiki_page_id: PAGE_ID,
            wiki_page_title: '家の間取り',
            is_spec: true,
          },
        ],
      })
    )
    expect(view.newSpecs[0]).toEqual({
      lineNumber: 5,
      title: '玄関の向きを決める',
      specPath: null,
      wikiPageId: PAGE_ID,
      wikiPageTitle: '家の間取り',
      isSpec: true,
    })
  })

  it('タグ無しなら参考資料付きのふつうのタスクとして扱う', () => {
    const view = toMinutesPreview(
      raw({
        new_spec_count: 1,
        new_specs: [
          {
            line_number: 5,
            title: '間取り案を3つ作る',
            wiki_page_id: PAGE_ID,
            wiki_page_title: '家の間取り',
            is_spec: false,
          },
        ],
      })
    )
    expect(view.newSpecs[0].isSpec).toBe(false)
  })
})

describe('toMinutesPreview: 作成済みの行', () => {
  it('task_id を持ち、無ければ空文字にする', () => {
    const view = toMinutesPreview(
      raw({
        existing_spec_count: 2,
        existing_specs: [
          { line_number: 1, spec_path: '/spec/A.md#x', title: 'a', task_id: 't-1' },
          { line_number: 2, title: 'b', wiki_page_id: PAGE_ID, wiki_page_title: 'P', is_spec: true },
        ],
      })
    )
    expect(view.existingSpecs[0].taskId).toBe('t-1')
    expect(view.existingSpecs[1].taskId).toBe('')
    expect(view.existingSpecs[1].wikiPageTitle).toBe('P')
  })
})

describe('toMinutesPreview: 件数', () => {
  it('件数はそのまま持ち越す', () => {
    const view = toMinutesPreview(raw({ new_spec_count: 4, existing_spec_count: 7 }))
    expect(view.newSpecCount).toBe(4)
    expect(view.existingSpecCount).toBe(7)
  })

  it('配列が欠けていても空として扱う（古い定義の DB でも落ちない）', () => {
    const view = toMinutesPreview({
      new_spec_count: 0,
      existing_spec_count: 0,
    } as RawMinutesPreview)
    expect(view.newSpecs).toEqual([])
    expect(view.existingSpecs).toEqual([])
  })
})

describe('candidateSubLabel', () => {
  it('Wiki ページ名を優先して出す', () => {
    expect(
      candidateSubLabel({
        lineNumber: 1,
        title: 't',
        specPath: null,
        wikiPageId: PAGE_ID,
        wikiPageTitle: '家の間取り',
        isSpec: true,
      })
    ).toBe('家の間取り')
  })

  it('Wiki が無ければ仕様書のパスを出す', () => {
    expect(
      candidateSubLabel({
        lineNumber: 1,
        title: 't',
        specPath: '/spec/A.md#x',
        wikiPageId: null,
        wikiPageTitle: null,
        isSpec: true,
      })
    ).toBe('/spec/A.md#x')
  })

  it('どちらも無ければ空文字（行を消さずに題名だけ出す）', () => {
    expect(
      candidateSubLabel({
        lineNumber: 1,
        title: 't',
        specPath: null,
        wikiPageId: null,
        wikiPageTitle: null,
        isSpec: false,
      })
    ).toBe('')
  })
})
