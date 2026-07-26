import { describe, it, expect } from 'vitest'
import {
  SHINDAN_TYPE_ARTICLE_SLUGS,
  MAX_ARTICLES_PER_TYPE,
  articleSlugsForType,
  isShindanTypeKey,
} from '@/lib/task6/shindanArticles'
import { PROCESS_KEYS } from '@/lib/shindan/model'

/**
 * 診断タイプ → TASK6記事（処方箋）の対応表。正本は docs/blog/SHINDAN_ARTICLE_MAP.md。
 *
 * 記事はDB(blog_posts)にあり公開状態が変わるため、**ここは「候補の並び」だけ**を持ち、
 * 実際に出すかどうか（公開済みか）はAPI側が確かめる。ここに未公開のslugが載っていても
 * 画面には出ない＝リンク切れが構造的に起きない、という分担にする。
 */
describe('診断タイプ×記事の対応表', () => {
  it('診断が出しうるタイプ（t1〜t8）を漏れなく網羅する', () => {
    for (const key of PROCESS_KEYS) {
      expect(SHINDAN_TYPE_ARTICLE_SLUGS[key], `${key} の候補が無い`).toBeDefined()
    }
    expect(Object.keys(SHINDAN_TYPE_ARTICLE_SLUGS).sort()).toEqual([...PROCESS_KEYS].sort())
  })

  it('候補slugはURLに使える形で、同じタイプ内で重複しない', () => {
    for (const [key, slugs] of Object.entries(SHINDAN_TYPE_ARTICLE_SLUGS)) {
      for (const slug of slugs) {
        expect(slug, `${key}: ${slug}`).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
      }
      expect(new Set(slugs).size, `${key} に重複したslugがある`).toBe(slugs.length)
    }
  })

  it('1タイプに出す本数は上限を超えない（結果画面を記事リンクで埋めない）', () => {
    for (const slugs of Object.values(SHINDAN_TYPE_ARTICLE_SLUGS)) {
      expect(slugs.length).toBeLessThanOrEqual(MAX_ARTICLES_PER_TYPE)
    }
  })

  it('articleSlugsForType は対応表の順（主処方が先頭）をそのまま返す', () => {
    for (const key of PROCESS_KEYS) {
      expect(articleSlugsForType(key)).toEqual(SHINDAN_TYPE_ARTICLE_SLUGS[key])
    }
  })

  it('知らないタイプは空配列（例外にしない＝結果画面を落とさない）', () => {
    expect(articleSlugsForType('t99')).toEqual([])
    expect(articleSlugsForType('')).toEqual([])
  })

  it('isShindanTypeKey は診断のタイプだけを通す', () => {
    expect(isShindanTypeKey('t1')).toBe(true)
    expect(isShindanTypeKey('t8')).toBe(true)
    // t9(量の負荷)はタイプ一覧に出ない＝対応表の対象外
    expect(isShindanTypeKey('t9')).toBe(false)
    expect(isShindanTypeKey('T1')).toBe(false)
    expect(isShindanTypeKey('drop table')).toBe(false)
  })
})
