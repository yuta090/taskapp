import { describe, it, expect } from 'vitest'
import {
  appendAttribution,
  sanitizeAttribution,
  parseStoredAttribution,
} from '@/lib/task6/attribution'

/**
 * TASK6 → agentpm登録 の流入計測(アトリビューション)
 *
 * - 記事内CTAの内部リンクに ?ref=task6&art=<記事slug> を自動付与する
 * - 外部リンク・不正slugには付与しない(URLを壊さない)
 * - signup側はパラメータを検証してからユーザーmetadataに載せる(汚染防止)
 */

describe('appendAttribution', () => {
  it('内部リンクに ref と art を付与する', () => {
    expect(appendAttribution('/signup', 'notion-memo')).toBe(
      '/signup?ref=task6&art=notion-memo'
    )
  })

  it('既存のクエリを保持したまま追記する', () => {
    expect(appendAttribution('/signup?plan=free', 'notion-memo')).toBe(
      '/signup?plan=free&ref=task6&art=notion-memo'
    )
  })

  it('ハッシュを保持する', () => {
    expect(appendAttribution('/pricing#pro', 'notion-memo')).toBe(
      '/pricing?ref=task6&art=notion-memo#pro'
    )
  })

  it('外部リンク(https)には付与しない', () => {
    expect(appendAttribution('https://example.com/x', 'notion-memo')).toBe(
      'https://example.com/x'
    )
  })

  it('slugが不正な形式なら付与しない(URLを汚さない)', () => {
    expect(appendAttribution('/signup', 'bad slug!')).toBe('/signup')
    expect(appendAttribution('/signup', '')).toBe('/signup')
  })
})

describe('sanitizeAttribution', () => {
  it('refがtask6でartが正しい形式ならmetadataを返す', () => {
    expect(sanitizeAttribution('task6', 'notion-memo')).toEqual({
      signup_ref: 'task6',
      signup_art: 'notion-memo',
    })
  })

  it('artが無くてもrefだけで成立する', () => {
    expect(sanitizeAttribution('task6', null)).toEqual({ signup_ref: 'task6' })
  })

  it('診断(shindan)もホワイトリストに含まれる', () => {
    expect(sanitizeAttribution('shindan', null)).toEqual({ signup_ref: 'shindan' })
  })

  it('未知のref・不正な形式はnull(何も記録しない)', () => {
    expect(sanitizeAttribution('evil', 'x')).toBeNull()
    expect(sanitizeAttribution('task6<script>', 'x')).toBeNull()
    expect(sanitizeAttribution(null, 'x')).toBeNull()
  })

  it('artが不正な形式ならartだけ落とす', () => {
    expect(sanitizeAttribution('task6', 'bad slug!')).toEqual({ signup_ref: 'task6' })
    expect(sanitizeAttribution('task6', 'a'.repeat(100))).toEqual({ signup_ref: 'task6' })
  })
})

describe('parseStoredAttribution', () => {
  it('localStorageに保存したJSONを検証つきで読み戻す', () => {
    const raw = JSON.stringify({ ref: 'task6', art: 'notion-memo' })
    expect(parseStoredAttribution(raw)).toEqual({ ref: 'task6', art: 'notion-memo' })
  })

  it('壊れたJSON・不正な中身はnull', () => {
    expect(parseStoredAttribution('{oops')).toBeNull()
    expect(parseStoredAttribution(JSON.stringify({ ref: 'evil' }))).toBeNull()
    expect(parseStoredAttribution(null)).toBeNull()
  })
})
