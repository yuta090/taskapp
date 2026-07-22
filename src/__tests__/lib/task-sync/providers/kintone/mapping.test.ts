import { describe, it, expect } from 'vitest'
import {
  parseKintoneMapping,
  validateMappingAgainstSchema,
  isValidKintoneAppId,
  type KintoneMapping,
  type KintoneLiveField,
} from '@/lib/task-sync/providers/kintone/mapping'

const CONFIRMED_AT = '2026-07-01T00:00:00.000Z'

function validMapping(overrides: Partial<KintoneMapping> = {}): KintoneMapping {
  return {
    title_field_code: 'title',
    due_field_code: 'due',
    status: {
      field_code: 'status',
      field_type: 'DROP_DOWN',
      done_values: ['完了'],
      write_done_action: null,
    },
    confirmed_at: CONFIRMED_AT,
    ...overrides,
  }
}

describe('isValidKintoneAppId', () => {
  it('数値文字列のみ受理する', () => {
    expect(isValidKintoneAppId('123')).toBe(true)
    expect(isValidKintoneAppId('0')).toBe(true)
  })
  it('数値以外・空文字・巨大すぎる桁数は拒否する', () => {
    expect(isValidKintoneAppId('')).toBe(false)
    expect(isValidKintoneAppId('12a')).toBe(false)
    expect(isValidKintoneAppId('-1')).toBe(false)
    expect(isValidKintoneAppId('1'.repeat(30))).toBe(false)
  })
})

describe('parseKintoneMapping', () => {
  it('妥当な値をそのまま受理する', () => {
    const result = parseKintoneMapping(validMapping())
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.title_field_code).toBe('title')
      expect(result.data.status?.done_values).toEqual(['完了'])
    }
  })

  it('status: null（完了同期なし）を受理する', () => {
    const result = parseKintoneMapping(validMapping({ status: null }))
    expect(result.ok).toBe(true)
  })

  it('due_field_code: null（期日を取り込まない）を受理する', () => {
    const result = parseKintoneMapping(validMapping({ due_field_code: null }))
    expect(result.ok).toBe(true)
  })

  it('title_field_code が無い/空文字なら拒否する', () => {
    const raw = { ...validMapping(), title_field_code: '' }
    expect(parseKintoneMapping(raw).ok).toBe(false)
    const raw2 = { ...validMapping() } as Record<string, unknown>
    delete raw2.title_field_code
    expect(parseKintoneMapping(raw2).ok).toBe(false)
  })

  it('未知フィールドは strip される', () => {
    const raw = { ...validMapping(), evil: 'x' }
    const result = parseKintoneMapping(raw)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(Object.keys(result.data)).not.toContain('evil')
    }
  })

  it('status.field_type が未知の値なら拒否する', () => {
    const raw = validMapping({
      status: { field_code: 's', field_type: 'UNKNOWN' as never, done_values: ['x'], write_done_action: null },
    })
    expect(parseKintoneMapping(raw).ok).toBe(false)
  })

  it('status.done_values が空配列なら拒否する（完了同期しないなら status を null に）', () => {
    const raw = validMapping({
      status: { field_code: 's', field_type: 'DROP_DOWN', done_values: [], write_done_action: null },
    })
    expect(parseKintoneMapping(raw).ok).toBe(false)
  })

  it('status.done_values は重複を一意化して受理する', () => {
    const raw = validMapping({
      status: { field_code: 's', field_type: 'DROP_DOWN', done_values: ['完了', '完了'], write_done_action: null },
    })
    const result = parseKintoneMapping(raw)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.status?.done_values).toEqual(['完了'])
    }
  })

  it('confirmed_at が不正なISO8601（実在しない暦日）なら拒否する', () => {
    const raw = validMapping({ confirmed_at: '2026-02-30T00:00:00.000Z' })
    expect(parseKintoneMapping(raw).ok).toBe(false)
  })

  it('confirmed_at が非ISO形式なら拒否する', () => {
    const raw = validMapping({ confirmed_at: 'July 1, 2026' })
    expect(parseKintoneMapping(raw).ok).toBe(false)
  })

  it('mapping がオブジェクトでなければ拒否する', () => {
    expect(parseKintoneMapping(null).ok).toBe(false)
    expect(parseKintoneMapping('string').ok).toBe(false)
    expect(parseKintoneMapping([1, 2]).ok).toBe(false)
  })

  it('write_done_action は文字列またはnullを受理する', () => {
    const raw = validMapping({
      status: { field_code: 's', field_type: 'STATUS', done_values: ['完了'], write_done_action: '承認' },
    })
    const result = parseKintoneMapping(raw)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data.status?.write_done_action).toBe('承認')
  })

  it('MAX_ID_LEN を超える巨大な field_code は拒否する', () => {
    const raw = validMapping({ title_field_code: 'x'.repeat(300) })
    expect(parseKintoneMapping(raw).ok).toBe(false)
  })

  // ⚠ completeTaskの書き戻しは常にプロセス管理のUpdate Status APIを使い、これが更新するのは
  // STATUSフィールドの値のみ。DROP_DOWN等でwrite_done_actionを許すと「書き戻し成功に見えるが
  // マッピングされた選択肢フィールドは実際には更新されず、次の取り込みで未完了と判定され続ける」
  // という完了が永久に定着しない不整合になるため、STATUS型以外では拒否する。
  it('DROP_DOWNでwrite_done_actionを指定したマッピングは拒否される', () => {
    const raw = validMapping({
      status: { field_code: 's', field_type: 'DROP_DOWN', done_values: ['完了'], write_done_action: '完了にする' },
    })
    expect(parseKintoneMapping(raw).ok).toBe(false)
  })

  it('RADIO_BUTTON/CHECK_BOXでもwrite_done_actionを指定したマッピングは拒否される', () => {
    for (const fieldType of ['RADIO_BUTTON', 'CHECK_BOX'] as const) {
      const raw = validMapping({
        status: { field_code: 's', field_type: fieldType, done_values: ['完了'], write_done_action: '完了にする' },
      })
      expect(parseKintoneMapping(raw).ok, `${fieldType} should be rejected`).toBe(false)
    }
  })

  it('STATUSならwrite_done_actionを指定したマッピングが受理される', () => {
    const raw = validMapping({
      status: { field_code: 's', field_type: 'STATUS', done_values: ['完了'], write_done_action: '完了にする' },
    })
    const result = parseKintoneMapping(raw)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data.status?.write_done_action).toBe('完了にする')
  })

  it('STATUS以外でwrite_done_action: nullは受理される(検知のみ・読み専用の契約)', () => {
    const raw = validMapping({
      status: { field_code: 's', field_type: 'DROP_DOWN', done_values: ['完了'], write_done_action: null },
    })
    expect(parseKintoneMapping(raw).ok).toBe(true)
  })

  it('done_values の件数上限(200件)を超えたら拒否する', () => {
    const raw = validMapping({
      status: {
        field_code: 's',
        field_type: 'DROP_DOWN',
        done_values: Array.from({ length: 201 }, (_, i) => `v${i}`),
        write_done_action: null,
      },
    })
    expect(parseKintoneMapping(raw).ok).toBe(false)
  })
})

describe('validateMappingAgainstSchema', () => {
  const liveFields: KintoneLiveField[] = [
    { code: 'title', type: 'SINGLE_LINE_TEXT', label: 'タイトル' },
    { code: 'due', type: 'DATE', label: '期日' },
    { code: 'status', type: 'DROP_DOWN', label: 'ステータス', options: ['未着手', '進行中', '完了'] },
    { code: 'processStatus', type: 'STATUS', label: 'ステータス(プロセス管理)' },
  ]

  it('妥当なマッピングは valid=true', () => {
    expect(validateMappingAgainstSchema(validMapping(), liveFields)).toEqual({ valid: true })
  })

  it('title_field_code が実在しないなら invalid', () => {
    const result = validateMappingAgainstSchema(validMapping({ title_field_code: 'ghost' }), liveFields)
    expect(result.valid).toBe(false)
  })

  it('due_field_code が実在するがDATE型でないなら invalid', () => {
    const result = validateMappingAgainstSchema(validMapping({ due_field_code: 'status' }), liveFields)
    expect(result.valid).toBe(false)
  })

  it('due_field_code が null なら期日検証をスキップする', () => {
    const result = validateMappingAgainstSchema(validMapping({ due_field_code: null }), liveFields)
    expect(result.valid).toBe(true)
  })

  it('status.field_code が実在しないなら invalid', () => {
    const result = validateMappingAgainstSchema(
      validMapping({
        status: { field_code: 'ghost', field_type: 'DROP_DOWN', done_values: ['完了'], write_done_action: null },
      }),
      liveFields,
    )
    expect(result.valid).toBe(false)
  })

  it('status.field_type が実際の型と食い違うなら invalid', () => {
    const result = validateMappingAgainstSchema(
      validMapping({
        status: { field_code: 'status', field_type: 'RADIO_BUTTON', done_values: ['完了'], write_done_action: null },
      }),
      liveFields,
    )
    expect(result.valid).toBe(false)
  })

  it('DROP_DOWN の done_values に実在しない選択肢名が含まれるなら invalid', () => {
    const result = validateMappingAgainstSchema(
      validMapping({
        status: { field_code: 'status', field_type: 'DROP_DOWN', done_values: ['存在しない'], write_done_action: null },
      }),
      liveFields,
    )
    expect(result.valid).toBe(false)
  })

  it('STATUS型は選択肢一覧が fields.json に無いため done_values の実在チェックをスキップする', () => {
    // STATUS型のプロセス管理ステータス名は Get Process Management Settings 側にしか無い
    // （本PRのスコープ外）。fields.json だけでは検証できないため、実在しない値でも通す。
    const result = validateMappingAgainstSchema(
      validMapping({
        status: {
          field_code: 'processStatus',
          field_type: 'STATUS',
          done_values: ['未確認だが検証できない値'],
          write_done_action: '承認',
        },
      }),
      liveFields,
    )
    expect(result.valid).toBe(true)
  })

  it('status が null なら完了同期の検証をスキップする', () => {
    const result = validateMappingAgainstSchema(validMapping({ status: null }), liveFields)
    expect(result.valid).toBe(true)
  })

  // 防御的二重チェック: 通常はparseKintoneMappingが拒否するため起こり得ないが、この制約導入前に
  // 保存された既存データに対するdrift検証としても効かせる(mapping.ts側のコメント参照)。
  it('DROP_DOWN型なのにwrite_done_actionが設定されている(既存データ等)なら invalid', () => {
    const result = validateMappingAgainstSchema(
      validMapping({
        status: { field_code: 'status', field_type: 'DROP_DOWN', done_values: ['完了'], write_done_action: '承認' },
      }),
      liveFields,
    )
    expect(result.valid).toBe(false)
  })
})
