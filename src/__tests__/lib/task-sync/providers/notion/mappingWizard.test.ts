import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { NotionDatabaseSchema } from '@/lib/task-sync/providers/notion/schema'
import { AiConfigError } from '@/lib/ai/errors'

/**
 * マッピング提案の橋渡しロジック（mappingWizard.ts）。
 *
 * ⚠ 最重要の不変条件テスト: buildRefinePrompt が組み立てるLLM向けメッセージに、レコード値・
 * トークン・org特定情報が一切含まれないこと。
 */

const callLlmMock = vi.fn()
vi.mock('@/lib/ai/client', () => ({
  callLlm: (...args: unknown[]) => callLlmMock(...args),
}))

const {
  toLiveProperties,
  sanitizeProposalAgainstSchema,
  buildRefinePrompt,
  parseAiRefinementJson,
  applyAiRefinement,
  refineProposalWithAi,
} = await import('@/lib/task-sync/providers/notion/mappingWizard')

const SCHEMA: NotionDatabaseSchema = [
  { id: 'title-1', name: 'Name', type: 'title' },
  { id: 'due-1', name: '期日', type: 'date' },
  {
    id: 'status-1',
    name: 'ステータス',
    type: 'status',
    options: [
      { id: 'opt-todo', name: '未着手' },
      { id: 'opt-done', name: '完了' },
    ],
  },
]

beforeEach(() => {
  vi.clearAllMocks()
})

describe('toLiveProperties', () => {
  it('プロパティ配列を名前キーの NotionLiveProperties に変換する(status.optionsを保持)', () => {
    const live = toLiveProperties(SCHEMA)
    expect(live['期日']).toEqual({ id: 'due-1', type: 'date' })
    expect(live['ステータス']).toEqual({
      id: 'status-1',
      type: 'status',
      status: { options: [{ id: 'opt-todo', name: '未着手' }, { id: 'opt-done', name: '完了' }] },
    })
  })
})

describe('sanitizeProposalAgainstSchema', () => {
  it('存在しないdue_prop_idはnullに落とす', () => {
    const live = toLiveProperties(SCHEMA)
    const result = sanitizeProposalAgainstSchema({ due_prop_id: 'ghost-prop', status: null }, live)
    expect(result.due_prop_id).toBeNull()
  })

  it('妥当なdue_prop_id/statusはそのまま通す', () => {
    const live = toLiveProperties(SCHEMA)
    const candidate = {
      due_prop_id: 'due-1',
      status: {
        prop_id: 'status-1',
        prop_type: 'status' as const,
        done_option_ids: ['opt-done'],
        write_done_option_id: 'opt-done',
      },
    }
    const result = sanitizeProposalAgainstSchema(candidate, live)
    expect(result).toEqual(candidate)
  })

  it('存在しないoption idを含むstatusはnullに落とす', () => {
    const live = toLiveProperties(SCHEMA)
    const result = sanitizeProposalAgainstSchema(
      {
        due_prop_id: null,
        status: {
          prop_id: 'status-1',
          prop_type: 'status',
          done_option_ids: ['ghost-option'],
          write_done_option_id: 'ghost-option',
        },
      },
      live,
    )
    expect(result.status).toBeNull()
  })
})

describe('buildRefinePrompt', () => {
  it('プロパティのメタデータ(id/name/type/option名)のみを含む — レコード値・トークンは一切含まない', () => {
    const messages = buildRefinePrompt(SCHEMA)
    const serialized = JSON.stringify(messages)

    // メタデータは含まれる
    expect(serialized).toContain('期日')
    expect(serialized).toContain('ステータス')
    expect(serialized).toContain('opt-done')

    // レコード値・秘密情報の類は一切含まれてはならない
    expect(serialized).not.toContain('secret-token')
    expect(serialized).not.toContain('access_token')
    expect(serialized).not.toContain('org-1')
    expect(serialized).not.toContain('database_id')
    expect(serialized.toLowerCase()).not.toContain('page_id')
    expect(serialized.toLowerCase()).not.toContain('record')
  })

  it('system+userの2メッセージで、userはスキーマのJSONのみ', () => {
    const messages = buildRefinePrompt(SCHEMA)
    expect(messages).toHaveLength(2)
    expect(messages[0].role).toBe('system')
    expect(messages[1].role).toBe('user')
    const parsed = JSON.parse(messages[1].content)
    expect(parsed.properties).toHaveLength(SCHEMA.length)
  })
})

describe('parseAiRefinementJson', () => {
  it('正しい形のJSONをパースする', () => {
    const result = parseAiRefinementJson(
      JSON.stringify({ due_prop_id: 'due-1', status_prop_id: 'status-1', done_option_ids: ['opt-done'] }),
    )
    expect(result).toEqual({ due_prop_id: 'due-1', status_prop_id: 'status-1', done_option_ids: ['opt-done'] })
  })

  it('```json フェンス付きの応答も許容する', () => {
    const result = parseAiRefinementJson(
      '```json\n' + JSON.stringify({ due_prop_id: null, status_prop_id: null, done_option_ids: [] }) + '\n```',
    )
    expect(result).toEqual({ due_prop_id: null, status_prop_id: null, done_option_ids: [] })
  })

  it('壊れたJSONはnullを返す', () => {
    expect(parseAiRefinementJson('not json at all {')).toBeNull()
  })

  it('想定と違う形(due_prop_idが数値)はnullを返す', () => {
    expect(
      parseAiRefinementJson(JSON.stringify({ due_prop_id: 123, status_prop_id: null, done_option_ids: [] })),
    ).toBeNull()
  })

  it('done_option_idsが文字列配列でなければnullを返す', () => {
    expect(
      parseAiRefinementJson(
        JSON.stringify({ due_prop_id: null, status_prop_id: 'status-1', done_option_ids: [1, 2] }),
      ),
    ).toBeNull()
  })

  it('done_option_idsを省略しても既定の空配列で受理する', () => {
    expect(parseAiRefinementJson(JSON.stringify({ due_prop_id: null, status_prop_id: null }))).toEqual({
      due_prop_id: null,
      status_prop_id: null,
      done_option_ids: [],
    })
  })
})

const HEURISTIC = {
  due_prop_id: 'due-1',
  status: {
    prop_id: 'status-1',
    prop_type: 'status' as const,
    done_option_ids: ['opt-done'],
    write_done_option_id: 'opt-done',
  },
}

describe('applyAiRefinement', () => {
  it('AIが実在しないdue_prop_idを返したら採用せず、ヒューリスティックの値を維持する', () => {
    const result = applyAiRefinement(
      { due_prop_id: 'ghost-prop', status_prop_id: null, done_option_ids: [] },
      SCHEMA,
      HEURISTIC,
    )
    expect(result.due_prop_id).toBe(HEURISTIC.due_prop_id)
  })

  it('AIがdate型でないプロパティをdue_prop_idに指定したら採用しない', () => {
    const result = applyAiRefinement(
      { due_prop_id: 'title-1', status_prop_id: null, done_option_ids: [] },
      SCHEMA,
      HEURISTIC,
    )
    expect(result.due_prop_id).toBe(HEURISTIC.due_prop_id)
  })

  it('AIが妥当なdue_prop_idを返せば採用する', () => {
    const schema: NotionDatabaseSchema = [
      ...SCHEMA,
      { id: 'due-2', name: '作成日', type: 'date' },
    ]
    const result = applyAiRefinement(
      { due_prop_id: 'due-2', status_prop_id: null, done_option_ids: [] },
      schema,
      HEURISTIC,
    )
    expect(result.due_prop_id).toBe('due-2')
  })

  it('AIがdue_prop_id:nullを返せばnullを採用する(ヒューリスティックより優先)', () => {
    const result = applyAiRefinement(
      { due_prop_id: null, status_prop_id: null, done_option_ids: [] },
      SCHEMA,
      HEURISTIC,
    )
    expect(result.due_prop_id).toBeNull()
  })

  it('AIが実在しないoption idだけを返したらstatusはヒューリスティックを維持する', () => {
    const result = applyAiRefinement(
      { due_prop_id: null, status_prop_id: 'status-1', done_option_ids: ['ghost-option'] },
      SCHEMA,
      HEURISTIC,
    )
    expect(result.status).toEqual(HEURISTIC.status)
  })

  it('AIが妥当なstatus_prop_id/done_option_idsを返せば採用する', () => {
    const result = applyAiRefinement(
      { due_prop_id: null, status_prop_id: 'status-1', done_option_ids: ['opt-todo'] },
      SCHEMA,
      HEURISTIC,
    )
    expect(result.status).toEqual({
      prop_id: 'status-1',
      prop_type: 'status',
      done_option_ids: ['opt-todo'],
      write_done_option_id: 'opt-todo',
    })
  })

  it('checkbox型を指定されたらdone_option_ids/write_done_option_idはnull/空で組み立てる', () => {
    const schema: NotionDatabaseSchema = [...SCHEMA, { id: 'cb-1', name: '完了チェック', type: 'checkbox' }]
    const result = applyAiRefinement(
      { due_prop_id: null, status_prop_id: 'cb-1', done_option_ids: [] },
      schema,
      HEURISTIC,
    )
    expect(result.status).toEqual({
      prop_id: 'cb-1',
      prop_type: 'checkbox',
      done_option_ids: [],
      write_done_option_id: null,
    })
  })
})

describe('refineProposalWithAi', () => {
  it('LLMに渡すmessagesにレコード値・トークンを含めない(callLlmへの実引数を検査)', async () => {
    callLlmMock.mockResolvedValue({ content: JSON.stringify({ due_prop_id: null, status_prop_id: null }) })
    await refineProposalWithAi({ orgId: 'org-1', schema: SCHEMA, heuristic: HEURISTIC })

    expect(callLlmMock).toHaveBeenCalledTimes(1)
    const callArgs = callLlmMock.mock.calls[0][0] as { orgId: string; messages: unknown; purpose?: string }
    expect(callArgs.purpose).toBe('notion_mapping_propose')
    const serialized = JSON.stringify(callArgs.messages)
    expect(serialized).not.toContain('secret-token')
    expect(serialized).not.toContain('access_token')
  })

  it('AiConfigError(AI未設定・上限到達)ならヒューリスティックへフォールバックする(source:heuristic)', async () => {
    callLlmMock.mockRejectedValue(new AiConfigError('missing', 'AI未設定'))
    const result = await refineProposalWithAi({ orgId: 'org-1', schema: SCHEMA, heuristic: HEURISTIC })
    expect(result.source).toBe('heuristic')
    expect(result.aiUnavailableReason).toBe('ai_unconfigured')
    expect(result.due_prop_id).toBe(HEURISTIC.due_prop_id)
    expect(result.status).toEqual(HEURISTIC.status)
  })

  it('LLMが壊れたJSONを返してもヒューリスティックへフォールバックする', async () => {
    callLlmMock.mockResolvedValue({ content: 'this is not json' })
    const result = await refineProposalWithAi({ orgId: 'org-1', schema: SCHEMA, heuristic: HEURISTIC })
    expect(result.source).toBe('heuristic')
    expect(result.aiUnavailableReason).toBe('invalid_response')
  })

  it('LLM呼び出し自体がその他のエラーで失敗してもヒューリスティックへフォールバックする', async () => {
    callLlmMock.mockRejectedValue(new Error('OpenAI API エラー (500)'))
    const result = await refineProposalWithAi({ orgId: 'org-1', schema: SCHEMA, heuristic: HEURISTIC })
    expect(result.source).toBe('heuristic')
    expect(result.aiUnavailableReason).toBe('llm_error')
  })

  it('正常なAI応答はsource:aiで適用結果を返す', async () => {
    callLlmMock.mockResolvedValue({
      content: JSON.stringify({ due_prop_id: 'due-1', status_prop_id: 'status-1', done_option_ids: ['opt-done'] }),
    })
    const result = await refineProposalWithAi({ orgId: 'org-1', schema: SCHEMA, heuristic: HEURISTIC })
    expect(result.source).toBe('ai')
    expect(result.due_prop_id).toBe('due-1')
    expect(result.status).toEqual(HEURISTIC.status)
  })
})
