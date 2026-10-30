import { describe, it, expect } from 'vitest'
import { parseInAppLinkTarget, buildTaskHref, buildWikiPageHref, toInAppScreenPath } from '@/lib/navigation/appLinks'

/**
 * 議事録の本文のリンクが「同じプロジェクトのタスク / Wiki」かを見分ける。
 * 見分けられたものだけを、画面を移らずにその場（右パネル・オーバーレイ）で開く。
 */
const ORG = 'org-1'
const SPACE = 'space-1'

describe('parseInAppLinkTarget', () => {
  it('同じプロジェクトのタスクへのリンクはタスクとして読む', () => {
    expect(parseInAppLinkTarget(buildTaskHref(ORG, SPACE, 't1'), ORG, SPACE)).toEqual({ kind: 'task', id: 't1' })
  })

  it('同じプロジェクトの Wiki へのリンクは Wiki として読む', () => {
    expect(parseInAppLinkTarget(buildWikiPageHref(ORG, SPACE, 'w1'), ORG, SPACE)).toEqual({ kind: 'wiki', id: 'w1' })
  })

  it('別のプロジェクトのタスクはその場で開かない（そのプロジェクトの一覧に無いため）', () => {
    expect(parseInAppLinkTarget(buildTaskHref(ORG, 'space-2', 't1'), ORG, SPACE)).toBeNull()
  })

  it('別の組織のリンクはその場で開かない', () => {
    expect(parseInAppLinkTarget(buildTaskHref('org-2', SPACE, 't1'), ORG, SPACE)).toBeNull()
  })

  it('タスクや Wiki 以外の画面・外部サイト・ダウンロードは読まない', () => {
    expect(parseInAppLinkTarget(`/${ORG}/project/${SPACE}/meetings?meeting=m1`, ORG, SPACE)).toBeNull()
    expect(parseInAppLinkTarget('https://example.com/?task=t1', ORG, SPACE)).toBeNull()
    expect(parseInAppLinkTarget('/api/files/f1/download', ORG, SPACE)).toBeNull()
    expect(parseInAppLinkTarget(`/${ORG}/project/${SPACE}`, ORG, SPACE)).toBeNull()
    expect(parseInAppLinkTarget(null, ORG, SPACE)).toBeNull()
  })
})

describe('toInAppScreenPath', () => {
  const ORIGIN = 'https://agentpm.app'

  it('/ 始まりの画面へのリンクはそのまま返す', () => {
    expect(toInAppScreenPath('/o/project/s/wiki?page=p1', ORIGIN)).toBe('/o/project/s/wiki?page=p1')
  })

  it('同じサイトのフル URL は / 始まりに直す（CLI で書いた議事録はこの形で入る）', () => {
    expect(toInAppScreenPath(`${ORIGIN}/o/project/s/wiki?page=p1`, ORIGIN)).toBe('/o/project/s/wiki?page=p1')
    expect(toInAppScreenPath(`${ORIGIN}/o/project/s?task=t1#c`, ORIGIN)).toBe('/o/project/s?task=t1#c')
  })

  it('別のサイト・ダウンロード・空は画面へのリンクとして扱わない', () => {
    expect(toInAppScreenPath('https://example.com/o/project/s?task=t1', ORIGIN)).toBeNull()
    expect(toInAppScreenPath('http://agentpm.app/o/project/s?task=t1', ORIGIN)).toBeNull()
    expect(toInAppScreenPath(`${ORIGIN}/api/files/f1/download`, ORIGIN)).toBeNull()
    expect(toInAppScreenPath('/api/files/f1/download', ORIGIN)).toBeNull()
    expect(toInAppScreenPath('//agentpm.app/o', ORIGIN)).toBeNull()
    expect(toInAppScreenPath('mailto:a@example.com', ORIGIN)).toBeNull()
    expect(toInAppScreenPath(null, ORIGIN)).toBeNull()
  })
})
