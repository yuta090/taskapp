import { describe, it, expect, vi } from 'vitest'
import { filterSuggestionItems } from '@blocknote/core/extensions'
import { buildInsertLinkMenuItems } from '@/components/editor/appLink'

/**
 * 「/」メニューから、種類ごとに直接開けるようにする。
 * 日本語でも英語でも同じ項目に行き着くこと（「タスク」でも「task」でも出る）。
 */
const open = vi.fn()
const items = () => buildInsertLinkMenuItems(open)

/** BlockNote が実際に使う絞り込みを通す */
function search(query: string) {
  return filterSuggestionItems(items() as never, query).map(
    (item) => (item as unknown as { key: string }).key
  )
}

describe('「/」メニューの項目', () => {
  it('ファイル・Wiki・議事録・タスクを別々に出す', () => {
    expect(items().map((item) => item.key)).toEqual([
      'insert_link_task',
      'insert_link_file',
      'insert_link_wiki',
      'insert_link_meeting',
    ])
  })

  it('押すとその種類でピッカーが開く', () => {
    open.mockClear()
    items().find((item) => item.key === 'insert_link_wiki')!.onItemClick()
    expect(open).toHaveBeenCalledWith('wiki')
  })

  it.each([
    ['タスク', 'insert_link_task'],
    ['task', 'insert_link_task'],
    ['ファイル', 'insert_link_file'],
    ['file', 'insert_link_file'],
    ['Wiki', 'insert_link_wiki'],
    ['ウィキ', 'insert_link_wiki'],
    ['議事録', 'insert_link_meeting'],
    ['meeting', 'insert_link_meeting'],
    ['minutes', 'insert_link_meeting'],
  ])('「%s」で %s が出る', (query, key) => {
    expect(search(query)).toContain(key)
  })

  it('大文字小文字は問わない', () => {
    expect(search('TASK')).toContain('insert_link_task')
    expect(search('WIKI')).toContain('insert_link_wiki')
  })

  it('「リンク」「link」ではどれも出る（種類を決めていないとき）', () => {
    expect(search('リンク')).toHaveLength(4)
    expect(search('link')).toHaveLength(4)
  })
})
