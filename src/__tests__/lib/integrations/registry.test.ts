import { describe, it, expect } from 'vitest'
import {
  INTEGRATIONS,
  ALL_INTEGRATION_IDS,
  CATEGORY_ORDER,
  CATEGORY_LABEL,
  DIRECTION_LABEL,
  listIntegrations,
  integrationsByCategory,
  availableIntegrations,
  getIntegration,
  isIntegrationId,
  getIntegrationBySinkProvider,
  type IntegrationCategory,
} from '@/lib/integrations/registry'

describe('integration (tool) registry', () => {
  it('各定義の id はキーと一致する', () => {
    for (const [key, def] of Object.entries(INTEGRATIONS)) {
      expect(def.id).toBe(key)
    }
  })

  it('ALL_INTEGRATION_IDS は INTEGRATIONS の全キーを重複なく含む', () => {
    const keys = Object.keys(INTEGRATIONS).sort()
    expect([...ALL_INTEGRATION_IDS].sort()).toEqual(keys)
    expect(new Set(ALL_INTEGRATION_IDS).size).toBe(ALL_INTEGRATION_IDS.length)
  })

  it('listIntegrations は表示順(ALL_INTEGRATION_IDS)を保つ', () => {
    expect(listIntegrations().map((d) => d.id)).toEqual([...ALL_INTEGRATION_IDS])
  })

  it('実装済み(GA)の中核ツールが登録されている', () => {
    for (const id of ['google_tasks', 'multica', 'webhook', 'notion', 'google_sheets']) {
      const def = getIntegration(id)
      expect(def, `${id} missing`).not.toBeNull()
      expect(def!.status).toBe('ga')
    }
  })

  it('カテゴリは CATEGORY_ORDER の3種のいずれか & 全カテゴリにラベルがある', () => {
    for (const def of listIntegrations()) {
      expect(CATEGORY_ORDER).toContain(def.category)
    }
    for (const c of CATEGORY_ORDER) {
      expect(CATEGORY_LABEL[c]).toBeTruthy()
    }
  })

  it('integrationsByCategory は CATEGORY_ORDER 順・空カテゴリを含まない・全件を過不足なく含む', () => {
    const groups = integrationsByCategory()
    expect(groups.map((g) => g.category)).toEqual(
      CATEGORY_ORDER.filter((c) => listIntegrations().some((d) => d.category === c)),
    )
    for (const g of groups) {
      expect(g.items.length).toBeGreaterThan(0)
      expect(g.items.every((d) => d.category === g.category)).toBe(true)
    }
    const flat = groups.flatMap((g) => g.items.map((d) => d.id)).sort()
    expect(flat).toEqual([...ALL_INTEGRATION_IDS].sort())
  })

  it('availableIntegrations は planned を除外する', () => {
    expect(availableIntegrations().every((d) => d.status !== 'planned')).toBe(true)
    expect(availableIntegrations().some((d) => d.id === 'freee')).toBe(false) // planned
    expect(availableIntegrations().some((d) => d.id === 'google_tasks')).toBe(true) // GA
  })

  it('isIntegrationId / getIntegration が正しく判定する', () => {
    expect(isIntegrationId('google_tasks')).toBe(true)
    expect(isIntegrationId('nope')).toBe(false)
    expect(getIntegration('multica')?.id).toBe('multica')
    expect(getIntegration('unknown')).toBeNull()
  })

  it('DIRECTION_LABEL は全方向にラベルを持つ', () => {
    for (const def of listIntegrations()) {
      expect(DIRECTION_LABEL[def.direction]).toBeTruthy()
    }
  })
})

describe('integration registry — surface と実装の整合', () => {
  it('surface=sink は sinkProvider を持ち、connector種別を持たない', () => {
    for (const def of listIntegrations()) {
      if (def.surface === 'sink') {
        expect(def.sinkProvider, `${def.id} sink but no sinkProvider`).toBeTruthy()
        expect(def.connectorKind).toBeUndefined()
      }
    }
  })

  it('surface=connector は connectorKind を持ち、sinkProvider を持たない', () => {
    for (const def of listIntegrations()) {
      if (def.surface === 'connector') {
        expect(def.connectorKind, `${def.id} connector but no connectorKind`).toBeTruthy()
        expect(def.sinkProvider).toBeUndefined()
      }
    }
  })

  it('sinkProvider は SinkProvider の値(webhook/notion/google_sheets)のみ・重複しない', () => {
    const providers = listIntegrations()
      .filter((d) => d.surface === 'sink')
      .map((d) => d.sinkProvider!)
    expect(providers.sort()).toEqual(['google_sheets', 'notion', 'webhook'])
    expect(new Set(providers).size).toBe(providers.length)
  })

  it('getIntegrationBySinkProvider は sink定義を逆引きできる', () => {
    expect(getIntegrationBySinkProvider('webhook')?.id).toBe('webhook')
    expect(getIntegrationBySinkProvider('notion')?.id).toBe('notion')
    expect(getIntegrationBySinkProvider('google_sheets')?.id).toBe('google_sheets')
  })

  it('GA/BETA のツールは catalog 以外の実体ある surface を持つ（掲載だけにしない）', () => {
    for (const def of listIntegrations()) {
      if (def.status !== 'planned') {
        expect(def.surface, `${def.id} is ${def.status} but surface=catalog`).not.toBe('catalog')
      }
    }
  })

  it('planned のツールは surface=catalog（未実装は掲載のみ）', () => {
    for (const def of listIntegrations()) {
      if (def.status === 'planned') {
        expect(def.surface, `${def.id} planned but surface=${def.surface}`).toBe('catalog')
      }
    }
  })
})

describe('integration registry — 課金表示ヒント（proOnly は表示のみ・真実源ではない）', () => {
  it('双方向のタスク同期(two_way)は Pro バッジ表示（CLAUDE.md: 外部連携は原則Pro）', () => {
    for (const def of listIntegrations()) {
      if (def.category === 'task_sync') {
        expect(def.proOnly, `${def.id} task_sync should be proOnly badge`).toBe(true)
      }
    }
  })

  it('会計・請求は Pro バッジ表示', () => {
    for (const def of listIntegrations()) {
      if (def.category === 'accounting') {
        expect(def.proOnly, `${def.id} accounting should be proOnly badge`).toBe(true)
      }
    }
  })

  it('通知連携(sink)は proOnly を付けない（既存の送りっぱなしは据え置き）', () => {
    for (const def of listIntegrations()) {
      if (def.surface === 'sink') {
        expect(def.proOnly, `${def.id} sink should not carry proOnly badge`).toBeFalsy()
      }
    }
  })
})

// カテゴリ網羅性の軽いスモーク（IntegrationCategory の型と CATEGORY_ORDER のズレ検出）
describe('integration registry — カテゴリ定義', () => {
  it('CATEGORY_ORDER は3カテゴリ（task_sync/data_export/accounting）', () => {
    const expected: IntegrationCategory[] = ['task_sync', 'data_export', 'accounting']
    expect([...CATEGORY_ORDER]).toEqual(expected)
  })
})
