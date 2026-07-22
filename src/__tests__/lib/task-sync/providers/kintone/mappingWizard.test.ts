import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { KintoneLiveField } from '@/lib/task-sync/providers/kintone/mapping'
import { AiConfigError } from '@/lib/ai/errors'

/**
 * マッピング提案の橋渡しロジック（kintone/mappingWizard.ts）。
 *
 * ⚠ 最重要の不変条件テスト: buildRefinePrompt が組み立てるLLM向けメッセージに、レコード値・
 * トークン・org特定情報が一切含まれないこと。
 */

const callLlmMock = vi.fn()
vi.mock('@/lib/ai/client', () => ({
  callLlm: (...args: unknown[]) => callLlmMock(...args),
}))

const {
  sanitizeProposalAgainstSchema,
  buildRefinePrompt,
  parseAiRefinementJson,
  applyAiRefinement,
  refineProposalWithAi,
} = await import('@/lib/task-sync/providers/kintone/mappingWizard')

const FIELDS: KintoneLiveField[] = [
  { code: 'title', label: '件名', type: 'SINGLE_LINE_TEXT' },
  { code: 'due', label: '期日', type: 'DATE' },
  { code: 'status', label: 'ステータス', type: 'STATUS' },
  { code: 'select_status', label: '進捗', type: 'DROP_DOWN', options: ['未着手', '完了'] },
]

beforeEach(() => {
  vi.clearAllMocks()
})

describe('sanitizeProposalAgainstSchema', () => {
  it('存在しないtitle_field_codeはnullに落とす', () => {
    const result = sanitizeProposalAgainstSchema(
      { title_field_code: 'ghost', due_field_code: null, status: null },
      FIELDS,
    )
    expect(result.title_field_code).toBeNull()
  })

  it('存在しないdue_field_codeはnullに落とす', () => {
    const result = sanitizeProposalAgainstSchema(
      { title_field_code: 'title', due_field_code: 'ghost', status: null },
      FIELDS,
    )
    expect(result.due_field_code).toBeNull()
  })

  it('DATE型でないdue_field_codeはnullに落とす', () => {
    const result = sanitizeProposalAgainstSchema(
      { title_field_code: 'title', due_field_code: 'title', status: null },
      FIELDS,
    )
    expect(result.due_field_code).toBeNull()
  })

  it('妥当なtitle_field_code/due_field_code/statusはそのまま通す', () => {
    const candidate = {
      title_field_code: 'title',
      due_field_code: 'due',
      status: {
        field_code: 'select_status',
        field_type: 'DROP_DOWN' as const,
        done_values: ['完了'],
        write_done_action: null,
      },
    }
    const result = sanitizeProposalAgainstSchema(candidate, FIELDS)
    expect(result).toEqual(candidate)
  })

  it('存在しない選択肢名を含むstatusはnullに落とす', () => {
    const result = sanitizeProposalAgainstSchema(
      {
        title_field_code: null,
        due_field_code: null,
        status: {
          field_code: 'select_status',
          field_type: 'DROP_DOWN',
          done_values: ['ghost-option'],
          write_done_action: null,
        },
      },
      FIELDS,
    )
    expect(result.status).toBeNull()
  })

  it('STATUS型はdone_valuesを検証できないため、そのまま(空配列)通る', () => {
    const candidate = {
      title_field_code: null,
      due_field_code: null,
      status: { field_code: 'status', field_type: 'STATUS' as const, done_values: [], write_done_action: null },
    }
    const result = sanitizeProposalAgainstSchema(candidate, FIELDS)
    expect(result.status).toEqual(candidate.status)
  })

  it('フィールドが1つも無ければ全てnullに落ちる(due/statusのダミー検証用フィールドが無い場合)', () => {
    const result = sanitizeProposalAgainstSchema(
      {
        title_field_code: 'ghost',
        due_field_code: 'ghost',
        status: { field_code: 'ghost', field_type: 'STATUS', done_values: [], write_done_action: null },
      },
      [],
    )
    expect(result).toEqual({ title_field_code: null, due_field_code: null, status: null })
  })
})

describe('buildRefinePrompt', () => {
  it('フィールドのメタデータ(code/label/type/選択肢名)のみを含む — レコード値・トークンは一切含まない', () => {
    const messages = buildRefinePrompt(FIELDS)
    const serialized = JSON.stringify(messages)

    expect(serialized).toContain('期日')
    expect(serialized).toContain('ステータス')
    expect(serialized).toContain('完了')

    expect(serialized).not.toContain('secret-token')
    expect(serialized).not.toContain('access_token')
    expect(serialized).not.toContain('org-1')
    expect(serialized).not.toContain('app_id')
    expect(serialized.toLowerCase()).not.toContain('record')
  })

  it('system+userの2メッセージで、userはフィールド一覧のJSONのみ', () => {
    const messages = buildRefinePrompt(FIELDS)
    expect(messages).toHaveLength(2)
    expect(messages[0].role).toBe('system')
    expect(messages[1].role).toBe('user')
    const parsed = JSON.parse(messages[1].content)
    expect(parsed.fields).toHaveLength(FIELDS.length)
  })
})

describe('parseAiRefinementJson', () => {
  it('正しい形のJSONをパースする', () => {
    const result = parseAiRefinementJson(
      JSON.stringify({
        title_field_code: 'title',
        due_field_code: 'due',
        status_field_code: 'select_status',
        done_values: ['完了'],
      }),
    )
    expect(result).toEqual({
      title_field_code: 'title',
      due_field_code: 'due',
      status_field_code: 'select_status',
      done_values: ['完了'],
    })
  })

  it('```json フェンス付きの応答も許容する', () => {
    const result = parseAiRefinementJson(
      '```json\n' +
        JSON.stringify({ title_field_code: null, due_field_code: null, status_field_code: null, done_values: [] }) +
        '\n```',
    )
    expect(result).toEqual({ title_field_code: null, due_field_code: null, status_field_code: null, done_values: [] })
  })

  it('壊れたJSONはnullを返す', () => {
    expect(parseAiRefinementJson('not json at all {')).toBeNull()
  })

  it('想定と違う形(title_field_codeが数値)はnullを返す', () => {
    expect(
      parseAiRefinementJson(
        JSON.stringify({ title_field_code: 123, due_field_code: null, status_field_code: null }),
      ),
    ).toBeNull()
  })

  it('done_valuesが文字列配列でなければnullを返す', () => {
    expect(
      parseAiRefinementJson(
        JSON.stringify({
          title_field_code: null,
          due_field_code: null,
          status_field_code: 'select_status',
          done_values: [1, 2],
        }),
      ),
    ).toBeNull()
  })

  it('done_valuesを省略しても既定の空配列で受理する', () => {
    expect(
      parseAiRefinementJson(
        JSON.stringify({ title_field_code: null, due_field_code: null, status_field_code: null }),
      ),
    ).toEqual({ title_field_code: null, due_field_code: null, status_field_code: null, done_values: [] })
  })
})

const HEURISTIC = {
  title_field_code: 'title',
  due_field_code: 'due',
  status: {
    field_code: 'select_status',
    field_type: 'DROP_DOWN' as const,
    done_values: ['完了'],
    write_done_action: null,
  },
}

describe('applyAiRefinement', () => {
  it('AIが実在しないtitle_field_codeを返したら採用せず、ヒューリスティックの値を維持する', () => {
    const result = applyAiRefinement(
      { title_field_code: 'ghost', due_field_code: null, status_field_code: null, done_values: [] },
      FIELDS,
      HEURISTIC,
    )
    expect(result.title_field_code).toBe(HEURISTIC.title_field_code)
  })

  it('AIが実在しないdue_field_codeを返したら採用せず、ヒューリスティックの値を維持する', () => {
    const result = applyAiRefinement(
      { title_field_code: null, due_field_code: 'ghost', status_field_code: null, done_values: [] },
      FIELDS,
      HEURISTIC,
    )
    expect(result.due_field_code).toBe(HEURISTIC.due_field_code)
  })

  it('AIがDATE型でないフィールドをdue_field_codeに指定したら採用しない', () => {
    const result = applyAiRefinement(
      { title_field_code: null, due_field_code: 'title', status_field_code: null, done_values: [] },
      FIELDS,
      HEURISTIC,
    )
    expect(result.due_field_code).toBe(HEURISTIC.due_field_code)
  })

  it('AIが妥当なdue_field_codeを返せば採用する', () => {
    const fields: KintoneLiveField[] = [...FIELDS, { code: 'created_on', label: '作成日', type: 'DATE' }]
    const result = applyAiRefinement(
      { title_field_code: null, due_field_code: 'created_on', status_field_code: null, done_values: [] },
      fields,
      HEURISTIC,
    )
    expect(result.due_field_code).toBe('created_on')
  })

  it('AIがtitle/due_field_code:nullを返せばnullを採用する(ヒューリスティックより優先)', () => {
    const result = applyAiRefinement(
      { title_field_code: null, due_field_code: null, status_field_code: null, done_values: [] },
      FIELDS,
      HEURISTIC,
    )
    expect(result.title_field_code).toBeNull()
    expect(result.due_field_code).toBeNull()
  })

  it('AIが実在しない選択肢名だけを返したらstatusはヒューリスティックを維持する', () => {
    const result = applyAiRefinement(
      { title_field_code: null, due_field_code: null, status_field_code: 'select_status', done_values: ['ghost'] },
      FIELDS,
      HEURISTIC,
    )
    expect(result.status).toEqual(HEURISTIC.status)
  })

  it('AIが妥当なstatus_field_code/done_valuesを返せば採用する', () => {
    const result = applyAiRefinement(
      { title_field_code: null, due_field_code: null, status_field_code: 'select_status', done_values: ['未着手'] },
      FIELDS,
      HEURISTIC,
    )
    expect(result.status).toEqual({
      field_code: 'select_status',
      field_type: 'DROP_DOWN',
      done_values: ['未着手'],
      write_done_action: null,
    })
  })

  /**
   * ⚠ STATUS 以外のフィールドに write_done_action を提案しないこと(かつSTATUS自体にも提案しない
   * ことをここで固定する。applyAiRefinementはどのfield_typeでもwrite_done_actionを一切設定しない)。
   */
  it('DROP_DOWN(STATUS以外)を指定してもwrite_done_actionはnullのまま', () => {
    const result = applyAiRefinement(
      { title_field_code: null, due_field_code: null, status_field_code: 'select_status', done_values: ['完了'] },
      FIELDS,
      HEURISTIC,
    )
    expect(result.status?.write_done_action).toBeNull()
  })

  it('STATUS型を指定すると、done_valuesは検証できないため空配列・write_done_actionはnullで組み立てる', () => {
    const result = applyAiRefinement(
      {
        title_field_code: null,
        due_field_code: null,
        status_field_code: 'status',
        done_values: ['何かの値'],
      },
      FIELDS,
      HEURISTIC,
    )
    expect(result.status).toEqual({
      field_code: 'status',
      field_type: 'STATUS',
      done_values: [],
      write_done_action: null,
    })
  })

  it('AIがstatus_field_code:nullを返せばnullを採用する', () => {
    const result = applyAiRefinement(
      { title_field_code: null, due_field_code: null, status_field_code: null, done_values: [] },
      FIELDS,
      HEURISTIC,
    )
    expect(result.status).toBeNull()
  })
})

describe('refineProposalWithAi', () => {
  it('LLMに渡すmessagesにレコード値・トークンを含めない(callLlmへの実引数を検査)', async () => {
    callLlmMock.mockResolvedValue({
      content: JSON.stringify({ title_field_code: null, due_field_code: null, status_field_code: null }),
    })
    await refineProposalWithAi({ orgId: 'org-1', fields: FIELDS, heuristic: HEURISTIC })

    expect(callLlmMock).toHaveBeenCalledTimes(1)
    const callArgs = callLlmMock.mock.calls[0][0] as { orgId: string; messages: unknown; purpose?: string }
    expect(callArgs.purpose).toBe('kintone_mapping_propose')
    const serialized = JSON.stringify(callArgs.messages)
    expect(serialized).not.toContain('secret-token')
    expect(serialized).not.toContain('access_token')
  })

  /**
   * ⚠ 回帰耐性の強化: 上のテストだけでは弱い。FIELDS には余計なプロパティが1つも無いため、
   * buildRefinePrompt が「フィールドを丸ごとJSONに載せる」実装に書き換えられても緑のままになる。
   * ここでは**型を意図的に破って**レコード値・トークン相当のプロパティを混ぜたfixtureを渡し、
   * 「allowlist(code/label/type/options)以外はプロンプトに入らない」ことを固定する。
   * 現実の混入経路: schema.ts の正規化を経ずに fields.json 由来の生オブジェクトが渡される、
   * KintoneLiveField に将来フィールドが足される、など。
   */
  it('フィールドに余計なプロパティ(レコード値・トークン)が混ざってもプロンプトに入らない', async () => {
    const dirtyFields = [
      {
        code: 'title',
        label: '件名',
        type: 'SINGLE_LINE_TEXT',
        // 以下は KintoneLiveField に存在しないプロパティ（意図的に型を破っている）
        record_value: 'secret-token: 顧客Aの機密メモ',
        token: 'access_token-abcdef',
        defaultValue: '取引先名を入れる',
      },
      {
        code: 'select_status',
        label: '進捗',
        type: 'DROP_DOWN',
        options: ['未着手', '完了'],
        record_value: ['secret-token-in-array'],
      },
    ] as unknown as KintoneLiveField[]

    callLlmMock.mockResolvedValue({
      content: JSON.stringify({ title_field_code: null, due_field_code: null, status_field_code: null }),
    })
    await refineProposalWithAi({ orgId: 'org-1', fields: dirtyFields, heuristic: HEURISTIC })

    const callArgs = callLlmMock.mock.calls[0][0] as { messages: unknown }
    const serialized = JSON.stringify(callArgs.messages)
    expect(serialized).not.toContain('record_value')
    expect(serialized).not.toContain('secret-token')
    expect(serialized).not.toContain('access_token')
    expect(serialized).not.toContain('defaultValue')
    expect(serialized).not.toContain('顧客Aの機密メモ')
    // 一方で、推定に必要な情報(コード・表示名・型・選択肢名)は落ちていないこと
    expect(serialized).toContain('select_status')
    expect(serialized).toContain('進捗')
    expect(serialized).toContain('未着手')
  })

  it('AiConfigError(AI未設定・上限到達)ならヒューリスティックへフォールバックする(source:heuristic)', async () => {
    callLlmMock.mockRejectedValue(new AiConfigError('missing', 'AI未設定'))
    const result = await refineProposalWithAi({ orgId: 'org-1', fields: FIELDS, heuristic: HEURISTIC })
    expect(result.source).toBe('heuristic')
    expect(result.aiUnavailableReason).toBe('ai_unconfigured')
    expect(result.title_field_code).toBe(HEURISTIC.title_field_code)
    expect(result.status).toEqual(HEURISTIC.status)
  })

  it('LLMが壊れたJSONを返してもヒューリスティックへフォールバックする', async () => {
    callLlmMock.mockResolvedValue({ content: 'this is not json' })
    const result = await refineProposalWithAi({ orgId: 'org-1', fields: FIELDS, heuristic: HEURISTIC })
    expect(result.source).toBe('heuristic')
    expect(result.aiUnavailableReason).toBe('invalid_response')
  })

  it('LLM呼び出し自体がその他のエラーで失敗してもヒューリスティックへフォールバックする', async () => {
    callLlmMock.mockRejectedValue(new Error('OpenAI API エラー (500)'))
    const result = await refineProposalWithAi({ orgId: 'org-1', fields: FIELDS, heuristic: HEURISTIC })
    expect(result.source).toBe('heuristic')
    expect(result.aiUnavailableReason).toBe('llm_error')
  })

  it('正常なAI応答はsource:aiで適用結果を返す', async () => {
    callLlmMock.mockResolvedValue({
      content: JSON.stringify({
        title_field_code: 'title',
        due_field_code: 'due',
        status_field_code: 'select_status',
        done_values: ['完了'],
      }),
    })
    const result = await refineProposalWithAi({ orgId: 'org-1', fields: FIELDS, heuristic: HEURISTIC })
    expect(result.source).toBe('ai')
    expect(result.title_field_code).toBe('title')
    expect(result.due_field_code).toBe('due')
    expect(result.status).toEqual(HEURISTIC.status)
  })
})
