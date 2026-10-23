import { describe, expect, it } from 'vitest'
import type { Space } from '@/types/database'
import { listProjects } from './spaceList'

function space(over: Partial<Space>): Space {
  return { id: 's1', org_id: 'o1', name: 'A社サイト', sort_order: 0, archived_at: null, ...over } as Space
}

describe('listProjects', () => {
  it('アーカイブ済みは出さない', () => {
    const list = listProjects([space({ id: 'a' }), space({ id: 'b', archived_at: '2026-09-01T00:00:00Z' })])
    expect(list.map((s) => s.id)).toEqual(['a'])
  })

  it('sort_order の昇順に並べる', () => {
    const list = listProjects([space({ id: 'a', sort_order: 2 }), space({ id: 'b', sort_order: 1 })])
    expect(list.map((s) => s.id)).toEqual(['b', 'a'])
  })

  it('sort_order が同じなら名前順', () => {
    const list = listProjects([space({ id: 'a', name: 'B社' }), space({ id: 'b', name: 'A社' })])
    expect(list.map((s) => s.id)).toEqual(['b', 'a'])
  })

  it('入力の配列を並べ替えない', () => {
    const input = [space({ id: 'a', sort_order: 2 }), space({ id: 'b', sort_order: 1 })]
    listProjects(input)
    expect(input.map((s) => s.id)).toEqual(['a', 'b'])
  })
})
