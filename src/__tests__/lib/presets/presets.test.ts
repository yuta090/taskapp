import { describe, it, expect } from 'vitest'
import {
  getGenrePresets,
  getBlankPreset,
  getPreset,
  PRESET_GENRES,
  isValidPresetGenre,
} from '@/lib/presets'
import { ICON_MAP } from '@/components/space/GenrePicker'

const VALID_TASK_STATUSES = ['backlog', 'todo', 'in_progress', 'in_review', 'done', 'considering']
const VALID_BALL_SIDES = ['client', 'internal', 'agency', 'vendor']
const VALID_CLIENT_SCOPES = ['deliverable', 'internal']

const DUMMY_ORG = 'org-1111'
const DUMMY_SPACE = 'space-2222'
const SAMPLE_SPEC_PAGES = [
  { id: 'page-a', title: 'ページA' },
  { id: 'page-b', title: 'ページB' },
]

/** 統一されたホームのフォールバック文言 */
const HOME_FALLBACK_TEXT = '（ドキュメントリンク未設定）'

/** アプリに実在する連携キー */
const KNOWN_INTEGRATIONS = ['github', 'slack', 'google_calendar', 'video_conference']

describe('presets registry', () => {
  it('9ジャンルすべてを返し、genreキーが有効である', () => {
    const presets = getGenrePresets()
    expect(presets).toHaveLength(9)
    for (const preset of presets) {
      expect(isValidPresetGenre(preset.genre)).toBe(true)
      expect(preset.genre).not.toBe('blank')
    }
  })

  it('getPresetは未知のジャンルでblankにフォールバックする', () => {
    expect(getPreset('unknown' as never).genre).toBe('blank')
  })

  it('PRESET_GENRESの全キーがgetPresetで解決できる', () => {
    for (const genre of PRESET_GENRES) {
      expect(getPreset(genre).genre).toBe(genre)
    }
  })

  it('blankプリセットはWikiページ・マイルストーンを持たない', () => {
    const blank = getBlankPreset()
    expect(blank.wikiPages).toHaveLength(0)
    expect(blank.milestones).toHaveLength(0)
  })
})

describe('preset invariants (全ジャンル共通の品質基準)', () => {
  const presets = getGenrePresets()

  it.each(presets.map(p => [p.genre, p] as const))(
    '%s: label/description/iconが設定されている',
    (_genre, preset) => {
      expect(preset.label.length).toBeGreaterThan(0)
      expect(preset.description.length).toBeGreaterThan(0)
      expect(preset.icon.length).toBeGreaterThan(0)
    },
  )

  it.each(presets.map(p => [p.genre, p] as const))(
    '%s: iconがICON_MAPに登録済み（フォールバックに落ちない）',
    (_genre, preset) => {
      expect(ICON_MAP[preset.icon]).toBeDefined()
    },
  )

  it.each(presets.map(p => [p.genre, p] as const))(
    '%s: ホームページがちょうど1つあり、最後に定義されている',
    (_genre, preset) => {
      const homes = preset.wikiPages.filter(p => p.isHome)
      expect(homes).toHaveLength(1)
      expect(preset.wikiPages[preset.wikiPages.length - 1].isHome).toBe(true)
    },
  )

  it.each(presets.map(p => [p.genre, p] as const))(
    '%s: 全Wikiページに「テンプレート」タグが付いている',
    (_genre, preset) => {
      for (const page of preset.wikiPages) {
        expect(page.tags).toContain('テンプレート')
      }
      const home = preset.wikiPages.find(p => p.isHome)
      expect(home?.tags).toContain('ホーム')
    },
  )

  it.each(presets.map(p => [p.genre, p] as const))(
    '%s: 全ページのgenerateBodyが有効なBlockNote JSON配列を返す',
    (_genre, preset) => {
      for (const page of preset.wikiPages) {
        const body = page.generateBody(DUMMY_ORG, DUMMY_SPACE, SAMPLE_SPEC_PAGES)
        const parsed = JSON.parse(body)
        expect(Array.isArray(parsed)).toBe(true)
        expect(parsed.length).toBeGreaterThan(0)
      }
    },
  )

  it.each(presets.map(p => [p.genre, p] as const))(
    '%s: ホームのフォールバック文言が全ジャンルで統一されている',
    (_genre, preset) => {
      const home = preset.wikiPages.find(p => p.isHome)!
      const body = home.generateBody(DUMMY_ORG, DUMMY_SPACE, [])
      expect(body).toContain(HOME_FALLBACK_TEXT)
      expect(body).not.toContain('生成されませんでした')
    },
  )

  it.each(presets.map(p => [p.genre, p] as const))(
    '%s: ホームはspecPagesのリンクを定義順に埋め込む',
    (_genre, preset) => {
      const home = preset.wikiPages.find(p => p.isHome)!
      const body = home.generateBody(DUMMY_ORG, DUMMY_SPACE, SAMPLE_SPEC_PAGES)
      expect(body).toContain('page-a')
      expect(body).toContain('page-b')
      expect(body.indexOf('page-a')).toBeLessThan(body.indexOf('page-b'))
      expect(body).not.toContain(HOME_FALLBACK_TEXT)
    },
  )

  it.each(presets.map(p => [p.genre, p] as const))(
    '%s: マイルストーンが1件以上あり、orderKeyが昇順で一意',
    (_genre, preset) => {
      expect(preset.milestones.length).toBeGreaterThan(0)
      const keys = preset.milestones.map(m => m.orderKey)
      expect([...keys].sort((a, b) => a - b)).toEqual(keys)
      expect(new Set(keys).size).toBe(keys.length)
      for (const m of preset.milestones) {
        expect(m.name.length).toBeGreaterThan(0)
      }
    },
  )

  it.each(presets.map(p => [p.genre, p] as const))(
    '%s: recommendedIntegrationsが実在する連携キーのみを含む',
    (_genre, preset) => {
      for (const key of preset.recommendedIntegrations) {
        expect(KNOWN_INTEGRATIONS).toContain(key)
      }
    },
  )

  it.each(presets.map(p => [p.genre, p] as const))(
    '%s: サンプルタスクが3〜5件あり、値がCHECK制約の有効値のみを使う',
    (_genre, preset) => {
      expect(preset.sampleTasks.length).toBeGreaterThanOrEqual(3)
      expect(preset.sampleTasks.length).toBeLessThanOrEqual(5)
      for (const task of preset.sampleTasks) {
        expect(task.title.length).toBeGreaterThan(0)
        expect(task.title).not.toMatch(/【サンプル】/)
        expect(task.description).toContain('これはサンプルタスクです。自由に編集・削除できます。')
        expect(VALID_BALL_SIDES).toContain(task.ball)
        expect(VALID_TASK_STATUSES).toContain(task.status)
        expect(VALID_CLIENT_SCOPES).toContain(task.clientScope)
        if (task.milestoneName !== undefined) {
          expect(preset.milestones.map(m => m.name)).toContain(task.milestoneName)
        }
        if (task.dueInDays !== undefined) {
          expect(Number.isInteger(task.dueInDays)).toBe(true)
          expect(task.dueInDays).toBeGreaterThan(0)
        }
      }
    },
  )

  it.each(presets.map(p => [p.genre, p] as const))(
    '%s: ball=client かつ clientScope=deliverable のサンプルタスクが1件以上ある（クライアント確認待ちの例）',
    (_genre, preset) => {
      const deliverableWaiting = preset.sampleTasks.filter(
        t => t.ball === 'client' && t.clientScope === 'deliverable'
      )
      expect(deliverableWaiting.length).toBeGreaterThanOrEqual(1)
    },
  )

  it.each(presets.map(p => [p.genre, p] as const))(
    '%s: 期限付き＋マイルストーン紐付けの社内タスクが1件以上ある',
    (_genre, preset) => {
      const scheduledInternal = preset.sampleTasks.filter(
        t => t.ball === 'internal' && t.dueInDays !== undefined && t.milestoneName !== undefined
      )
      expect(scheduledInternal.length).toBeGreaterThanOrEqual(1)
    },
  )

  it.each(presets.map(p => [p.genre, p] as const))(
    '%s: 着手前（backlog）の社内タスクが1件以上ある',
    (_genre, preset) => {
      const notStarted = preset.sampleTasks.filter(
        t => t.ball === 'internal' && t.status === 'backlog'
      )
      expect(notStarted.length).toBeGreaterThanOrEqual(1)
    },
  )
})

describe('preset content quality (ジャンル固有)', () => {
  it('マーケティング: コンテンツカレンダーに制作フローの節がある', () => {
    const preset = getPreset('marketing')
    const page = preset.wikiPages.find(p => p.title === 'コンテンツカレンダー')!
    const body = page.generateBody(DUMMY_ORG, DUMMY_SPACE)
    expect(body).toContain('制作フロー')
  })

  it('blankプリセットはサンプルタスクを持たない', () => {
    const blank = getBlankPreset()
    expect(blank.sampleTasks).toHaveLength(0)
  })

  it('デザイン制作: 成果物一覧にレビュー・フィードバックのルール節がある', () => {
    const preset = getPreset('design')
    const page = preset.wikiPages.find(p => p.title === '成果物一覧')!
    const body = page.generateBody(DUMMY_ORG, DUMMY_SPACE)
    expect(body).toContain('フィードバック')
    expect(body).toContain('修正回数')
  })

  it('業務システム開発: DB設計書テンプレートが解決できる（モジュール読込が壊れない）', () => {
    const preset = getPreset('system_development')
    const page = preset.wikiPages.find(p => p.title === 'DB設計書')
    expect(page).toBeDefined()
    expect(() => JSON.parse(page!.generateBody(DUMMY_ORG, DUMMY_SPACE))).not.toThrow()
  })
})
