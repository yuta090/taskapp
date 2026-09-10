import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import { MANUAL_NAV, MANUAL_SECTIONS, getManualNavEntries } from '@/lib/docs/manualNav'

/**
 * マニュアルの「目次」と「実ファイル」がズレていないことを守るテスト。
 *
 * 実際に起きていたズレ: docs/manual/internal/slack-setup.md は存在するのに、画面の
 * 目次（SectionIndex のカード / PrevNextNav の並び）に載っておらず、リンクを直接
 * 知っている人しか辿り着けなかった。目次を3箇所（カード・前後ナビ・トップの記事数）に
 * 手で書いていたことが原因なので、目次は manualNav.ts 1本に集約し、ここで両方向を検査する。
 */

const MANUAL_DIR = path.join(process.cwd(), 'docs', 'manual')

function markdownSlugs(section: string): string[] {
  return fs
    .readdirSync(path.join(MANUAL_DIR, section))
    // exFAT 上では macOS が `._name.md`（AppleDouble）を作る。ページではないので除く
    .filter((f) => f.endsWith('.md') && f !== 'index.md' && !f.startsWith('.'))
    .map((f) => f.replace(/\.md$/, ''))
    .sort()
}

describe('マニュアルの目次（docs/manual と画面の対応）', () => {
  it.each(MANUAL_SECTIONS)('%s: 目次に載っているページはすべて実在する', (section) => {
    const existing = new Set(markdownSlugs(section))
    for (const entry of getManualNavEntries(section)) {
      expect(existing.has(entry.slug), `${section}/${entry.slug}.md が見つかりません`).toBe(true)
    }
  })

  it.each(MANUAL_SECTIONS)('%s: 実在するページはすべて目次に載っている', (section) => {
    const listed = new Set(getManualNavEntries(section).map((e) => e.slug))
    for (const slug of markdownSlugs(section)) {
      expect(listed.has(slug), `${section}/${slug}.md が目次に載っていません`).toBe(true)
    }
  })

  it('目次の各ページに見出しと説明がある', () => {
    for (const section of MANUAL_SECTIONS) {
      for (const entry of getManualNavEntries(section)) {
        expect(entry.title.length, `${section}/${entry.slug} の見出しが空です`).toBeGreaterThan(0)
        expect(entry.description.length, `${section}/${entry.slug} の説明が空です`).toBeGreaterThan(0)
      }
    }
  })

  it('同じページが二重に載っていない', () => {
    for (const section of MANUAL_SECTIONS) {
      const slugs = getManualNavEntries(section).map((e) => e.slug)
      expect(new Set(slugs).size).toBe(slugs.length)
    }
  })

  it('セクションの定義が MANUAL_NAV と一致する', () => {
    expect(Object.keys(MANUAL_NAV).sort()).toEqual([...MANUAL_SECTIONS].sort())
  })
})

describe('マニュアル本文の画面写真', () => {
  it('画面写真の img タグがサニタイズで消えない', async () => {
    const { getManualPage } = await import('@/lib/markdown')
    const page = await getManualPage(['internal', 'files'])
    expect(page).not.toBeNull()
    // src="/img/help/..." の画面写真が本文に残っていること（消えると手順が読めなくなる）
    expect(page!.html).toMatch(/<img[^>]+src="\/img\/help\/[^"]+\.png"/)
  })

  it('本文が参照する画面写真のファイルが実在する', async () => {
    const referenced = new Set<string>()
    for (const section of MANUAL_SECTIONS) {
      for (const entry of getManualNavEntries(section)) {
        const md = fs.readFileSync(path.join(MANUAL_DIR, section, `${entry.slug}.md`), 'utf8')
        for (const m of md.matchAll(/\((\/img\/help\/[^)]+)\)/g)) referenced.add(m[1])
      }
    }
    expect(referenced.size).toBeGreaterThan(0)
    for (const src of referenced) {
      expect(fs.existsSync(path.join(process.cwd(), 'public', src)), `${src} がありません`).toBe(true)
    }
  })
})
