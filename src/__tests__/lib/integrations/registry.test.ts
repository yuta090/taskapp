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
  featuredIntegrations,
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

// 主要ツール（featured）とカタログの広さ。ツール数が多いのでUIは「主要を先頭 + すべて表示」で
// 出し分ける（ToolRail）。registry がその出し分けの単一の真実の源であることを固定する。
describe('integration registry — featured（主要ツール）', () => {
  it('featuredIntegrations は表示順を保ち、featured=true だけを返す', () => {
    const featured = featuredIntegrations()
    expect(featured.every((d) => d.featured === true)).toBe(true)
    expect(featured.map((d) => d.id)).toEqual(
      listIntegrations()
        .filter((d) => d.featured)
        .map((d) => d.id),
    )
  })

  it('実際に使える(planned以外)ツールは必ず featured（使えるものを畳まない）', () => {
    for (const def of listIntegrations()) {
      if (def.status !== 'planned') {
        expect(def.featured, `${def.id} is ${def.status} but not featured`).toBe(true)
      }
    }
  })

  it('featured は全体より十分少ない（「すべて表示」に意味がある）', () => {
    expect(featuredIntegrations().length).toBeLessThan(listIntegrations().length)
  })

  it('各カテゴリに最低1つは featured がある（初期表示が空のカテゴリを作らない）', () => {
    for (const group of integrationsByCategory()) {
      expect(
        group.items.some((d) => d.featured),
        `category ${group.category} has no featured tool`,
      ).toBe(true)
    }
  })
})

// 「既に使っている外部タスク管理と繋ぐ」ことが本製品の生命線のため、主要なプロジェクト管理/
// タスク管理ツールがカタログに載っていること自体を回帰テストで固定する。
describe('integration registry — プロジェクト管理/タスク管理ツールの網羅', () => {
  const EXPECTED_TASK_TOOLS = [
    'google_tasks',
    'multica',
    'backlog',
    'jooto',
    'jira',
    'redmine',
    'asana',
    'trello',
    'microsoft_todo',
    'linear',
    'wrike',
    'clickup',
    'monday',
    'chatwork',
    'garoon',
  ] as const

  it('主要なプロジェクト管理ツールが task_sync カテゴリに登録されている', () => {
    for (const id of EXPECTED_TASK_TOOLS) {
      const def = getIntegration(id)
      expect(def, `${id} missing from registry`).not.toBeNull()
      expect(def!.category, `${id} should be task_sync`).toBe('task_sync')
    }
  })

  it('日本で普及するツール(Backlog/Jooto/Redmine/Chatwork/Garoon)を含む', () => {
    for (const id of ['backlog', 'jooto', 'redmine', 'chatwork', 'garoon']) {
      expect(getIntegration(id), `${id} missing`).not.toBeNull()
    }
  })

  it('task_sync の全ツールが接続の手間(setupComplexity)を宣言する', () => {
    // 「どのツールが繋ぐのに何を要求するか」を案内文と実装優先度の両方で使うため、
    // タスク同期に載せる以上は必ず宣言させる（宣言漏れ＝案内できないツールになる）。
    for (const def of listIntegrations()) {
      if (def.category === 'task_sync') {
        expect(def.setupComplexity, `${def.id} lacks setupComplexity`).toBeTruthy()
      }
    }
  })

  it('外部データ構造がユーザーごとに違うツールは schema_mapping を宣言する', () => {
    // 項目の対応付けウィザードが要るツールを、実装前にカタログの時点で識別できるようにする。
    for (const id of ['kintone', 'airtable']) {
      expect(getIntegration(id)?.setupComplexity, `${id} should need schema mapping`).toBe('schema_mapping')
    }
  })

  it('task_sync は双方向、ただし受信専用は inbound を名乗る（できないことをできると言わない）', () => {
    // 受信専用（汎用Webhook）は、こちらから取りに行かないので外部の状態を能動的に確認できず、
    // 完了の書き戻しもできない。two_way と混ぜると利用者の期待値がずれる。
    for (const def of listIntegrations()) {
      if (def.category === 'task_sync') {
        expect(['two_way', 'inbound'], `${def.id} unexpected direction`).toContain(def.direction)
      }
    }
  })

  it('受信専用のツールは完了の書き戻しを名乗らない', () => {
    for (const def of listIntegrations()) {
      if (def.direction === 'inbound') {
        expect(def.capabilities?.completionWrite, `${def.id} cannot write back`).toBe(false)
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

// AI秘書 Stage5 期限リマインド(PR-0): connector surface(gtasks/multica) の capabilities 不変条件。
// docs/spec/AI_SECRETARY_STAGE5_DUE_REMINDERS.md §4.5/§5.3/§6
describe('integration registry — capabilities(期限リマインドconnector surface)', () => {
  it('connector surface(google_tasks/multica)は capabilities を持つ', () => {
    for (const id of ['google_tasks', 'multica'] as const) {
      const def = getIntegration(id)
      expect(def?.capabilities, `${id} should have capabilities`).toBeTruthy()
    }
  })

  it('planned(未接続)のツールは capabilities を持たない、または全て無効(false/none)', () => {
    for (const def of listIntegrations()) {
      if (def.status === 'planned') {
        if (def.capabilities) {
          expect(def.capabilities.dueImport, `${def.id} planned should not import due`).toBe(false)
          expect(def.capabilities.completionWrite, `${def.id} planned should not write completion`).toBe(false)
          expect(def.capabilities.dueFreshness, `${def.id} planned dueFreshness should be none`).toBe('none')
        }
      }
    }
  })

  it('dueImport=true の provider は dueFreshness が none ではない(鮮度証明が必須)', () => {
    for (const def of listIntegrations()) {
      if (def.capabilities?.dueImport) {
        expect(def.capabilities.dueFreshness, `${def.id} dueImport but dueFreshness=none`).not.toBe('none')
      }
    }
  })

  it('google_tasks: dueImport=true・completionWrite=true・poll-sla鮮度＋SLA分数を持つ', () => {
    const def = getIntegration('google_tasks')
    expect(def?.capabilities).toMatchObject({
      dueImport: true,
      completionWrite: true,
      dueFreshness: 'poll-sla',
    })
    expect(def?.capabilities?.pollFreshnessSlaMinutes).toBeGreaterThan(0)
  })

  it('multica: due_dateを持たないため dueImport=false・dueFreshness=none。completionWriteはtrue', () => {
    const def = getIntegration('multica')
    expect(def?.capabilities).toMatchObject({
      dueImport: false,
      completionWrite: true,
      dueFreshness: 'none',
    })
  })
})
