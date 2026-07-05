import { describe, it, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { sortSpecPagesByPreset, updateHomePageSpecLinks } from '@/lib/presets/homeLinks'
import { getPreset, getBlankPreset } from '@/lib/presets'

const ORG_ID = 'org-1111'
const SPACE_ID = 'space-2222'

interface PageRow {
  id: string
  title: string
  tags: string[]
}

/** wiki_pagesのselect/updateだけを備えた偽Supabaseクライアント */
function makeFakeSupabase(options: {
  pages: PageRow[]
  failSelectTimes?: number
  failUpdateTimes?: number
}) {
  let selectFailures = options.failSelectTimes ?? 0
  let updateFailures = options.failUpdateTimes ?? 0
  const updates: { body: string; pageId: string }[] = []
  let selectCount = 0

  const client = {
    from: vi.fn(() => ({
      select: () => ({
        eq: () => ({
          eq: () => {
            selectCount++
            if (selectFailures > 0) {
              selectFailures--
              return Promise.resolve({ data: null, error: new Error('select failed') })
            }
            return Promise.resolve({ data: options.pages, error: null })
          },
        }),
      }),
      update: (patch: { body: string }) => ({
        eq: (_col: string, pageId: string) => {
          if (updateFailures > 0) {
            updateFailures--
            return Promise.resolve({ error: new Error('update failed') })
          }
          updates.push({ body: patch.body, pageId })
          return Promise.resolve({ error: null })
        },
      }),
    })),
  }

  return {
    client: client as unknown as SupabaseClient,
    updates,
    getSelectCount: () => selectCount,
  }
}

describe('sortSpecPagesByPreset', () => {
  it('DBの返却順に関わらずプリセット定義順に並べ替える', () => {
    const preset = getPreset('system_development')
    // 定義順: 要件定義書, DB設計書, 画面一覧, テスト計画書
    const shuffled: PageRow[] = [
      { id: 'p3', title: '画面一覧', tags: [] },
      { id: 'p1', title: '要件定義書', tags: [] },
      { id: 'p4', title: 'テスト計画書', tags: [] },
      { id: 'p2', title: 'DB設計書', tags: [] },
    ]
    const sorted = sortSpecPagesByPreset(preset, shuffled)
    expect(sorted.map(p => p.title)).toEqual([
      '要件定義書',
      'DB設計書',
      '画面一覧',
      'テスト計画書',
    ])
  })

  it('プリセットに無いタイトルは末尾に回す', () => {
    const preset = getPreset('design')
    const pages: PageRow[] = [
      { id: 'x', title: '手動で作った謎ページ', tags: [] },
      { id: 'p1', title: 'デザインブリーフ', tags: [] },
    ]
    const sorted = sortSpecPagesByPreset(preset, pages)
    expect(sorted.map(p => p.title)).toEqual(['デザインブリーフ', '手動で作った謎ページ'])
  })
})

describe('updateHomePageSpecLinks', () => {
  const preset = getPreset('design')
  const homeRow: PageRow = { id: 'home-1', title: 'プロジェクトホーム', tags: ['ホーム', 'テンプレート'] }
  const specRows: PageRow[] = [
    { id: 's2', title: 'スタイルガイド', tags: ['デザイン', 'テンプレート'] },
    { id: 's1', title: 'デザインブリーフ', tags: ['デザイン', 'テンプレート'] },
  ]

  it('ホーム本文を実IDのリンク（定義順）で更新する', async () => {
    const fake = makeFakeSupabase({ pages: [homeRow, ...specRows] })
    const ok = await updateHomePageSpecLinks(fake.client, preset, ORG_ID, SPACE_ID)

    expect(ok).toBe(true)
    expect(fake.updates).toHaveLength(1)
    expect(fake.updates[0].pageId).toBe('home-1')
    const body = fake.updates[0].body
    expect(body).toContain(SPACE_ID)
    expect(body).not.toContain('placeholder')
    // 定義順: デザインブリーフ → スタイルガイド
    expect(body.indexOf('s1')).toBeLessThan(body.indexOf('s2'))
  })

  it('specページが0件でも更新し、placeholderリンクを残さない', async () => {
    const fake = makeFakeSupabase({ pages: [homeRow] })
    const ok = await updateHomePageSpecLinks(fake.client, preset, ORG_ID, SPACE_ID)

    expect(ok).toBe(true)
    expect(fake.updates).toHaveLength(1)
    expect(fake.updates[0].body).toContain('（ドキュメントリンク未設定）')
    expect(fake.updates[0].body).toContain(SPACE_ID)
  })

  it('一時的な失敗は1回リトライして成功させる', async () => {
    const fake = makeFakeSupabase({ pages: [homeRow, ...specRows], failSelectTimes: 1 })
    const ok = await updateHomePageSpecLinks(fake.client, preset, ORG_ID, SPACE_ID)

    expect(ok).toBe(true)
    expect(fake.updates).toHaveLength(1)
  })

  it('2回連続で失敗したらfalseを返す（例外は投げない）', async () => {
    const fake = makeFakeSupabase({ pages: [homeRow], failUpdateTimes: 2 })
    const ok = await updateHomePageSpecLinks(fake.client, preset, ORG_ID, SPACE_ID)

    expect(ok).toBe(false)
    expect(fake.updates).toHaveLength(0)
  })

  it('ホーム定義のないプリセット（blank）は何もせずtrue', async () => {
    const fake = makeFakeSupabase({ pages: [] })
    const ok = await updateHomePageSpecLinks(fake.client, getBlankPreset(), ORG_ID, SPACE_ID)

    expect(ok).toBe(true)
    expect(fake.updates).toHaveLength(0)
    expect(fake.getSelectCount()).toBe(0)
  })
})
