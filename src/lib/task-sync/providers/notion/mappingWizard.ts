import { callLlm, type LlmOptions } from '@/lib/ai/client'
import { AiConfigError } from '@/lib/ai/errors'
import {
  validateMappingAgainstSchema,
  type NotionMapping,
  type NotionLiveProperties,
  type NotionLiveProperty,
  type NotionStatusMapping,
} from '@/lib/task-sync/providers/notion/mapping'
import type { NotionDatabaseSchema } from '@/lib/task-sync/providers/notion/schema'

/**
 * マッピング提案API（/api/integrations/connections/notion/mapping/propose）専用のロジック。
 *
 * 「AI提案＋人が1回確認」方式のうち、AIによる精緻化（ヒューリスティックのたたき台をLLMで
 * 上書き候補を出させる部分）と、その出力をライブスキーマに対して安全に採否判定する部分をここに
 * まとめる。mapping.ts（validateMappingAgainstSchema・型）と schema.ts（ヒューリスティック
 * proposeMapping・fetchDatabaseSchema）は既存実装のまま一切変更しない（このファイルはそれらの
 * 上に薄く載る新規ファイル）。
 *
 * ⚠ 不変条件（絶対に破ってはいけない）: LLMに渡してよいのは fetchDatabaseSchema が返す
 * プロパティのメタデータ（id・名前・型・status/selectのoption名/id）だけ。レコード（ページ）の
 * 値・本文・タイトル等の実データ、アクセストークン、org/DBを特定する情報は一切渡さない。
 * buildRefinePrompt はこの境界を守る唯一の関数なので、変更する際は必ず
 * mappingWizard.test.ts の「レコード値・トークンを含まない」テストを確認すること。
 */

/** 「たたき台」または「AIの精緻化結果」を表す最小形（confirmed_at を持たない・保存前の状態）。 */
export interface MappingCandidate {
  due_prop_id: string | null
  status: NotionStatusMapping | null
}

// ---- schema配列(NotionDatabaseSchema) -> validateMappingAgainstSchemaが要求する形への変換 ----

/**
 * fetchDatabaseSchema の返り値（プロパティのフラットな配列）を、validateMappingAgainstSchema が
 * 要求する NotionLiveProperties（プロパティ名をキーにしたレコード）へ変換する。
 * mapping.ts 側の型に手を入れず、ここで橋渡しする。
 */
export function toLiveProperties(schema: NotionDatabaseSchema): NotionLiveProperties {
  const out: NotionLiveProperties = {}
  for (const prop of schema) {
    const entry: NotionLiveProperty = { id: prop.id, type: prop.type }
    if (prop.type === 'status' && prop.options) entry.status = { options: prop.options }
    if (prop.type === 'select' && prop.options) entry.select = { options: prop.options }
    out[prop.name] = entry
  }
  return out
}

// 検証専用のダミー値。validateMappingAgainstSchema は confirmed_at を一切読まないが、
// 型(NotionMapping)が string を要求するために埋める。呼び出し元が返すレスポンスには含めない。
const VALIDATION_ONLY_CONFIRMED_AT = '1970-01-01T00:00:00.000Z'

/**
 * 提案の最終防衛線（最重要）: due_prop_id と status を、それぞれ単独で
 * validateMappingAgainstSchema に通し、無効な側だけ null に落とす。
 * ヒューリスティック・AI精緻化のどちらの経路を通った値であっても、ユーザーに返す直前に
 * 必ずこれを通す（実装バグで壊れた値を提案してしまう事故を最後で止める）。
 */
export function sanitizeProposalAgainstSchema(
  candidate: MappingCandidate,
  liveProps: NotionLiveProperties,
): MappingCandidate {
  let due_prop_id = candidate.due_prop_id
  if (due_prop_id !== null) {
    const check = validateMappingAgainstSchema(
      { due_prop_id, status: null, confirmed_at: VALIDATION_ONLY_CONFIRMED_AT },
      liveProps,
    )
    if (!check.valid) due_prop_id = null
  }

  let status = candidate.status
  if (status !== null) {
    const check = validateMappingAgainstSchema(
      { due_prop_id: null, status, confirmed_at: VALIDATION_ONLY_CONFIRMED_AT } satisfies NotionMapping,
      liveProps,
    )
    if (!check.valid) status = null
  }

  return { due_prop_id, status }
}

// ---- AIへの精緻化依頼(プロンプト構築・応答パース) ----

/**
 * LLMに渡すプロンプトを組み立てる。渡すのはプロパティのメタデータのみ
 * （id・名前・型・status/selectのoption名/id）。レコード値・トークン・org特定情報は含めない。
 */
export function buildRefinePrompt(schema: NotionDatabaseSchema): LlmOptions['messages'] {
  const properties = schema.map((prop) => ({
    id: prop.id,
    name: prop.name,
    type: prop.type,
    options: prop.options?.map((o) => ({ id: o.id, name: o.name })),
  }))

  const system =
    'あなたはNotionデータベースのプロパティ構成から、タスク管理ツールとの連携設定を推定するアシスタントです。' +
    '与えられるのはプロパティの名前・型・選択肢名だけです（実際のタスクデータは一切含まれません）。' +
    '出力は必ず次の形式のJSONのみとし、他の説明文は一切出力しないでください: ' +
    '{"due_prop_id": "期日として使うプロパティのid、無ければnull", ' +
    '"status_prop_id": "完了状態として使うプロパティのid、無ければnull", ' +
    '"done_option_ids": ["status_prop_idがstatus/select型のとき、完了とみなす選択肢のidの配列"]}'

  const user = JSON.stringify({ properties })

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ]
}

/** buildRefinePrompt に対する期待される応答の生の形（スキーマ検証前）。 */
export interface AiRefinementRaw {
  due_prop_id: string | null
  status_prop_id: string | null
  done_option_ids: string[]
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === 'string')
}

/**
 * LLM応答を厳格にパースする。想定形以外・未知フィールドは自然に落ちる（既知フィールドだけ組み立てる）。
 * JSON自体が壊れている/形が想定と違う場合は null（呼び出し側はヒューリスティックへフォールバックする）。
 * ```json フェンス付きの応答も許容する（既存 parseLlmDigestExtraction と同じ作法）。
 */
export function parseAiRefinementJson(raw: string): AiRefinementRaw | null {
  const unfenced = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/, '')
    .trim()

  let parsed: unknown
  try {
    parsed = JSON.parse(unfenced)
  } catch {
    return null
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null
  const obj = parsed as Record<string, unknown>

  if (obj.due_prop_id !== null && typeof obj.due_prop_id !== 'string') return null
  if (obj.status_prop_id !== null && typeof obj.status_prop_id !== 'string') return null
  const doneOptionIdsRaw = obj.done_option_ids ?? []
  if (!isStringArray(doneOptionIdsRaw)) return null

  return {
    due_prop_id: obj.due_prop_id as string | null,
    status_prop_id: obj.status_prop_id as string | null,
    done_option_ids: doneOptionIdsRaw,
  }
}

/**
 * パース済みのAI応答を、ライブスキーマに対して**フィールド単位**で適用する。
 * AIが返した prop_id/option_id が実在しない、または型が想定と異なる場合、そのフィールドは
 * 採用せず、ヒューリスティックの値を維持する（他方のフィールドは影響を受けない）。
 */
export function applyAiRefinement(
  parsed: AiRefinementRaw,
  schema: NotionDatabaseSchema,
  heuristic: MappingCandidate,
): MappingCandidate {
  let due_prop_id = heuristic.due_prop_id
  if (parsed.due_prop_id === null) {
    // AIが「期日として使えるプロパティは無い」と明示的に判断した場合はそれを採用する
    // （ヒューリスティックは型だけで機械的に選ぶため、複数date列があるときの意味的な判断はAIに委ねる）。
    due_prop_id = null
  } else {
    const prop = schema.find((p) => p.id === parsed.due_prop_id)
    if (prop && prop.type === 'date') due_prop_id = prop.id
    // 実在しない/型不一致の指定は採用しない(ヒューリスティックの値を維持)
  }

  let status = heuristic.status
  if (parsed.status_prop_id === null) {
    status = null
  } else {
    const prop = schema.find((p) => p.id === parsed.status_prop_id)
    if (prop && (prop.type === 'status' || prop.type === 'select' || prop.type === 'checkbox')) {
      if (prop.type === 'checkbox') {
        status = { prop_id: prop.id, prop_type: 'checkbox', done_option_ids: [], write_done_option_id: null }
      } else {
        const validOptionIds = new Set((prop.options ?? []).map((o) => o.id))
        const doneOptionIds = parsed.done_option_ids.filter((id) => validOptionIds.has(id))
        // status/selectは完了とみなせる選択肢が最低1件無いと無効(mapping.ts契約)。
        // 実在するoptionが1件も無ければ、この指定は採用せずヒューリスティックの値を維持する。
        if (doneOptionIds.length > 0) {
          status = {
            prop_id: prop.id,
            prop_type: prop.type,
            done_option_ids: doneOptionIds,
            write_done_option_id: doneOptionIds[0],
          }
        }
      }
    }
    // 実在しない/未対応型の指定は採用しない(ヒューリスティックの値を維持)
  }

  return { due_prop_id, status }
}

/** AIによる精緻化が使えなかった理由（観測用・ユーザー向けの詳細説明ではない）。 */
export type AiUnavailableReason = 'ai_unconfigured' | 'llm_error' | 'invalid_response'

export interface RefineWithAiResult extends MappingCandidate {
  source: 'ai' | 'heuristic'
  aiUnavailableReason?: AiUnavailableReason
}

/**
 * ヒューリスティックの「たたき台」をLLMで精緻化する。
 *
 * AI呼び出しの失敗（AI未設定・上限到達=AiConfigError・LLM API障害）や、応答が厳格パースを
 * 通らない場合は、例外を投げずヒューリスティック提案へフォールバックする(source:'heuristic')。
 * ユーザーは手動で選べば導線が進むため、AIの不調で提案APIそのものを失敗させない。
 */
export async function refineProposalWithAi(params: {
  orgId: string
  schema: NotionDatabaseSchema
  heuristic: MappingCandidate
}): Promise<RefineWithAiResult> {
  const { orgId, schema, heuristic } = params

  let content: string
  try {
    const messages = buildRefinePrompt(schema)
    const response = await callLlm({ orgId, messages, maxTokens: 500, purpose: 'notion_mapping_propose' })
    content = response.content
  } catch (err) {
    const reason: AiUnavailableReason = err instanceof AiConfigError ? 'ai_unconfigured' : 'llm_error'
    return { ...heuristic, source: 'heuristic', aiUnavailableReason: reason }
  }

  const parsed = parseAiRefinementJson(content)
  if (!parsed) {
    return { ...heuristic, source: 'heuristic', aiUnavailableReason: 'invalid_response' }
  }

  return { ...applyAiRefinement(parsed, schema, heuristic), source: 'ai' }
}
