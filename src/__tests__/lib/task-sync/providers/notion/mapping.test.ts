import { describe, it, expect } from 'vitest'
import {
  parseNotionMapping,
  validateMappingAgainstSchema,
  type NotionLiveProperties,
  type NotionMapping,
} from '@/lib/task-sync/providers/notion/mapping'

/**
 * Notion inbound のマッピング検証（信頼境界）。
 *
 * import_config.notion_mappings[databaseId] に保存されるマッピングは、Notion側で
 * プロパティが後から削除・型変更・リネームされ得るため、**保存時だけでなく実行時にも**
 * 「今のスキーマに対して整合するか」を検証する必要がある（保存時検証だけだと drift を検知できない）。
 * ここではライブスキーマ(databases.retrieve の properties)に対する検証だけをテストする。
 */

const liveProps: NotionLiveProperties = {
  期日: { id: 'due-1', type: 'date' },
  タイトル: { id: 'title-1', type: 'title' },
  ステータス: {
    id: 'status-1',
    type: 'status',
    status: {
      options: [
        { id: 'opt-todo', name: '未着手' },
        { id: 'opt-doing', name: '対応中' },
        { id: 'opt-done', name: '完了' },
      ],
    },
  },
  区分: {
    id: 'select-1',
    type: 'select',
    select: {
      options: [
        { id: 'sel-open', name: '未対応' },
        { id: 'sel-closed', name: 'クローズ' },
      ],
    },
  },
  完了チェック: { id: 'checkbox-1', type: 'checkbox' },
}

function baseMapping(overrides: Partial<NotionMapping> = {}): NotionMapping {
  return {
    due_prop_id: 'due-1',
    status: {
      prop_id: 'status-1',
      prop_type: 'status',
      done_option_ids: ['opt-done'],
      write_done_option_id: 'opt-done',
    },
    confirmed_at: '2026-07-21T00:00:00.000Z',
    ...overrides,
  }
}

describe('parseNotionMapping', () => {
  it('正しい形のマッピングをそのまま通す', () => {
    const result = parseNotionMapping(baseMapping())
    expect(result).toEqual({ ok: true, data: baseMapping() })
  })

  it('未知フィールドは strip する', () => {
    const result = parseNotionMapping({ ...baseMapping(), unknown_field: 'x' } as unknown)
    expect(result.ok).toBe(true)
    expect((result as { ok: true; data: NotionMapping }).data).not.toHaveProperty('unknown_field')
  })

  it('due_prop_id は null を許容する（期日を取り込まない）', () => {
    const result = parseNotionMapping(baseMapping({ due_prop_id: null }))
    expect(result.ok).toBe(true)
    expect((result as { ok: true; data: NotionMapping }).data.due_prop_id).toBeNull()
  })

  it('status は null を許容する（完了同期なし）', () => {
    const result = parseNotionMapping(baseMapping({ status: null }))
    expect(result.ok).toBe(true)
    expect((result as { ok: true; data: NotionMapping }).data.status).toBeNull()
  })

  it('prop_type が status/select/checkbox 以外は弾く', () => {
    const result = parseNotionMapping(
      baseMapping({
        status: {
          prop_id: 'status-1',
          // @ts-expect-error 不正な値を検証する
          prop_type: 'multi_select',
          done_option_ids: [],
          write_done_option_id: null,
        },
      }),
    )
    expect(result.ok).toBe(false)
    expect((result as { ok: false; reason: string }).reason).toMatch(/prop_type/)
  })

  it('status/select型で done_option_ids が空配列なら弾く(全ページ永久にcompleted=falseになるため)', () => {
    const result = parseNotionMapping(
      baseMapping({
        status: {
          prop_id: 'status-1',
          prop_type: 'status',
          done_option_ids: [],
          write_done_option_id: null,
        },
      }),
    )
    expect(result.ok).toBe(false)
    expect((result as { ok: false; reason: string }).reason).toMatch(/done_option_ids/)
  })

  it('checkbox型で done_option_ids が非空配列でも拒否せず空配列へ正規化して受理する（無害な違反でコンテナ全体を止めない）', () => {
    // checkbox は isCompleted() が done_option_ids を一切参照しない（checkbox 値で直接判定する）ため、
    // 非空でも実行結果に影響しない。拒否してコンテナ全体（期日取り込み含む）を止めるのは
    // 処罰が不均衡なので、静かに正規化して受理する。
    const result = parseNotionMapping(
      baseMapping({
        status: {
          prop_id: 'checkbox-1',
          prop_type: 'checkbox',
          done_option_ids: ['whatever'],
          write_done_option_id: null,
        },
      }),
    )
    expect(result.ok).toBe(true)
    expect((result as { ok: true; data: NotionMapping }).data.status?.done_option_ids).toEqual([])
  })

  it('confirmed_at がISO8601として妥当でなければ弾く(監査値のため)', () => {
    const result = parseNotionMapping(baseMapping({ confirmed_at: 'not-a-date' }))
    expect(result.ok).toBe(false)
    expect((result as { ok: false; reason: string }).reason).toMatch(/confirmed_at/)
  })

  it('confirmed_at が非ISO8601表記（Dateなら解釈できてしまう形）なら弾く', () => {
    // 旧実装は new Date(str) が解釈できれば通していたため、こういう非ISO表記まで通っていた。
    const result = parseNotionMapping(baseMapping({ confirmed_at: 'July 1, 2026' }))
    expect(result.ok).toBe(false)
    expect((result as { ok: false; reason: string }).reason).toMatch(/confirmed_at/)
  })

  it('confirmed_at が存在しない暦日（2026-02-30。3月2日へ自動繰り上げされる形）なら弾く', () => {
    const result = parseNotionMapping(baseMapping({ confirmed_at: '2026-02-30T00:00:00.000Z' }))
    expect(result.ok).toBe(false)
    expect((result as { ok: false; reason: string }).reason).toMatch(/confirmed_at/)
  })

  it('confirmed_at が存在しない月日（2026-99-99）なら弾く', () => {
    const result = parseNotionMapping(baseMapping({ confirmed_at: '2026-99-99T00:00:00.000Z' }))
    expect(result.ok).toBe(false)
    expect((result as { ok: false; reason: string }).reason).toMatch(/confirmed_at/)
  })

  it('confirmed_at が妥当なISO8601なら値を書き換えずそのまま通す', () => {
    const result = parseNotionMapping(baseMapping({ confirmed_at: '2026-07-21T00:00:00.000Z' }))
    expect(result.ok).toBe(true)
    expect((result as { ok: true; data: NotionMapping }).data.confirmed_at).toBe('2026-07-21T00:00:00.000Z')
  })

  it('confirmed_at がうるう年の2/29なら通す(閏年の暦日検証)', () => {
    const result = parseNotionMapping(baseMapping({ confirmed_at: '2028-02-29T00:00:00.000Z' }))
    expect(result.ok).toBe(true)
  })

  it('confirmed_at がうるう年でない年の2/29なら弾く', () => {
    const result = parseNotionMapping(baseMapping({ confirmed_at: '2026-02-29T00:00:00.000Z' }))
    expect(result.ok).toBe(false)
    expect((result as { ok: false; reason: string }).reason).toMatch(/confirmed_at/)
  })

  it('done_option_ids に重複があっても拒否せず一意化して受理する（実行結果に影響しない無害な違反）', () => {
    // isCompleted() は includes() で判定するため、同じ id が1回でも2回でも判定結果は変わらない。
    const result = parseNotionMapping(
      baseMapping({
        status: {
          prop_id: 'status-1',
          prop_type: 'status',
          done_option_ids: ['opt-done', 'opt-done'],
          write_done_option_id: 'opt-done',
        },
      }),
    )
    expect(result.ok).toBe(true)
    expect((result as { ok: true; data: NotionMapping }).data.status?.done_option_ids).toEqual(['opt-done'])
  })
})

describe('validateMappingAgainstSchema', () => {
  it('正当なマッピング(status型)は通る', () => {
    expect(validateMappingAgainstSchema(baseMapping(), liveProps)).toEqual({ valid: true })
  })

  it('正当なマッピング(checkbox型)は通る', () => {
    const mapping = baseMapping({
      status: {
        prop_id: 'checkbox-1',
        prop_type: 'checkbox',
        done_option_ids: [],
        write_done_option_id: null,
      },
    })
    expect(validateMappingAgainstSchema(mapping, liveProps)).toEqual({ valid: true })
  })

  it('正当なマッピング(select型)は通る', () => {
    const mapping = baseMapping({
      status: {
        prop_id: 'select-1',
        prop_type: 'select',
        done_option_ids: ['sel-closed'],
        write_done_option_id: 'sel-closed',
      },
    })
    expect(validateMappingAgainstSchema(mapping, liveProps)).toEqual({ valid: true })
  })

  it('due_prop_id が null なら期日の検証はスキップされ通る', () => {
    const mapping = baseMapping({ due_prop_id: null })
    expect(validateMappingAgainstSchema(mapping, liveProps)).toEqual({ valid: true })
  })

  it('status が null なら完了同期の検証はスキップされ通る', () => {
    const mapping = baseMapping({ status: null })
    expect(validateMappingAgainstSchema(mapping, liveProps)).toEqual({ valid: true })
  })

  it('実在しない due_prop_id を弾く', () => {
    const result = validateMappingAgainstSchema(baseMapping({ due_prop_id: 'ghost-id' }), liveProps)
    expect(result.valid).toBe(false)
    expect((result as { valid: false; reason: string }).reason).toMatch(/due_prop_id/)
  })

  it('due_prop が date 型でないと弾く（title を指定した場合）', () => {
    const result = validateMappingAgainstSchema(baseMapping({ due_prop_id: 'title-1' }), liveProps)
    expect(result.valid).toBe(false)
    expect((result as { valid: false; reason: string }).reason).toMatch(/date/)
  })

  it('status.prop_id が実在しないプロパティを弾く', () => {
    const mapping = baseMapping({
      status: {
        prop_id: 'ghost-status',
        prop_type: 'status',
        done_option_ids: ['opt-done'],
        write_done_option_id: 'opt-done',
      },
    })
    const result = validateMappingAgainstSchema(mapping, liveProps)
    expect(result.valid).toBe(false)
    expect((result as { valid: false; reason: string }).reason).toMatch(/prop_id/)
  })

  it('status.prop_type が実際の型と不一致なら弾く', () => {
    const mapping = baseMapping({
      status: {
        prop_id: 'select-1', // 実際は select
        prop_type: 'status',
        done_option_ids: ['sel-closed'],
        write_done_option_id: 'sel-closed',
      },
    })
    const result = validateMappingAgainstSchema(mapping, liveProps)
    expect(result.valid).toBe(false)
    expect((result as { valid: false; reason: string }).reason).toMatch(/prop_type/)
  })

  it('done_option_ids に実在しない option id が含まれると弾く', () => {
    const mapping = baseMapping({
      status: {
        prop_id: 'status-1',
        prop_type: 'status',
        done_option_ids: ['opt-done', 'ghost-option'],
        write_done_option_id: 'opt-done',
      },
    })
    const result = validateMappingAgainstSchema(mapping, liveProps)
    expect(result.valid).toBe(false)
    expect((result as { valid: false; reason: string }).reason).toMatch(/done_option_ids/)
  })

  it('write_done_option_id が実在しない option id なら弾く', () => {
    const mapping = baseMapping({
      status: {
        prop_id: 'status-1',
        prop_type: 'status',
        done_option_ids: ['opt-done'],
        write_done_option_id: 'ghost-option',
      },
    })
    const result = validateMappingAgainstSchema(mapping, liveProps)
    expect(result.valid).toBe(false)
    expect((result as { valid: false; reason: string }).reason).toMatch(/write_done_option_id/)
  })

  it('checkbox 型で write_done_option_id が非nullなら弾く', () => {
    const mapping = baseMapping({
      status: {
        prop_id: 'checkbox-1',
        prop_type: 'checkbox',
        done_option_ids: [],
        write_done_option_id: 'opt-done',
      },
    })
    const result = validateMappingAgainstSchema(mapping, liveProps)
    expect(result.valid).toBe(false)
    expect((result as { valid: false; reason: string }).reason).toMatch(/write_done_option_id/)
  })

  it('status/select型で done_option_ids が空配列なら弾く(全ページ永久にcompleted=falseになる設定不備)', () => {
    const mapping = baseMapping({
      status: {
        prop_id: 'status-1',
        prop_type: 'status',
        done_option_ids: [],
        write_done_option_id: null,
      },
    })
    const result = validateMappingAgainstSchema(mapping, liveProps)
    expect(result.valid).toBe(false)
    expect((result as { valid: false; reason: string }).reason).toMatch(/done_option_ids/)
  })

  it('checkbox型で done_option_ids が非空配列なら弾く', () => {
    const mapping = baseMapping({
      status: {
        prop_id: 'checkbox-1',
        prop_type: 'checkbox',
        done_option_ids: ['whatever'],
        write_done_option_id: null,
      },
    })
    const result = validateMappingAgainstSchema(mapping, liveProps)
    expect(result.valid).toBe(false)
    expect((result as { valid: false; reason: string }).reason).toMatch(/done_option_ids/)
  })
})
