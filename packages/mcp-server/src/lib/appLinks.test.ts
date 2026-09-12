import { describe, it, expect } from 'vitest'
import {
  buildFileDownloadLink,
  buildMinutesLink,
  buildProjectBasePath,
  buildTaskLink,
  buildWikiPageLink,
  withLink,
} from './appLinks.js'

const ORG = 'org-1'
const SPACE = 'space-1'

/**
 * CLI・API から受け取った物を、そのまま Wiki や議事録の本文に貼れるようにするための
 * リンク。画面側（src/lib/navigation/appLinks.ts）と同じ綴りでなければ、貼っても開かない。
 */
describe('appLinks — CLI/API が返すリンク', () => {
  it('プロジェクトの土台のパス', () => {
    expect(buildProjectBasePath(ORG, SPACE)).toBe('/org-1/project/space-1')
  })

  it('タスクは ?task= で開く', () => {
    expect(buildTaskLink(ORG, SPACE, 't1')).toBe('/org-1/project/space-1?task=t1')
  })

  it('Wikiページは wiki?page= で開く', () => {
    expect(buildWikiPageLink(ORG, SPACE, 'p1')).toBe('/org-1/project/space-1/wiki?page=p1')
  })

  it('議事録は meetings?meeting= で開く', () => {
    expect(buildMinutesLink(ORG, SPACE, 'm1')).toBe('/org-1/project/space-1/meetings?meeting=m1')
  })

  it('ファイルはダウンロードのパス', () => {
    expect(buildFileDownloadLink('f1')).toBe('/api/files/f1/download')
  })
})

describe('withLink — 行に link を足す', () => {
  it('link を先頭に置く（表示が先頭8列までのため）', () => {
    const row = withLink({ id: 'p1', title: 'ページ' }, '/org-1/project/space-1/wiki?page=p1')
    expect(Object.keys(row)[0]).toBe('link')
    expect(row.link).toBe('/org-1/project/space-1/wiki?page=p1')
  })

  it('元の値は変えない', () => {
    const row = withLink({ id: 'p1', title: 'ページ', tags: ['仕様書'] }, '/x')
    expect(row.id).toBe('p1')
    expect(row.title).toBe('ページ')
    expect(row.tags).toEqual(['仕様書'])
  })
})
