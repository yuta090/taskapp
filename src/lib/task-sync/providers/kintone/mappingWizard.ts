import { callLlm, type LlmOptions } from '@/lib/ai/client'
import { AiConfigError } from '@/lib/ai/errors'
import {
  validateMappingAgainstSchema,
  type KintoneMapping,
  type KintoneLiveField,
  type KintoneStatusMapping,
  type KintoneStatusFieldType,
} from '@/lib/task-sync/providers/kintone/mapping'

/**
 * マッピング提案API（/api/integrations/connections/kintone/mapping/propose）専用のロジック。
 *
 * notion/mappingWizard.ts と同じ設計（「AI提案＋人が1回確認」方式のうち、AIによる精緻化と
 * その出力をライブスキーマに対して安全に採否判定する部分をここにまとめる）。mapping.ts
 * （validateMappingAgainstSchema・型）と schema.ts（ヒューリスティック proposeMapping・
 * fetchAppFields）は既存実装のまま一切変更しない（このファイルはそれらの上に薄く載る新規ファイル）。
 *
 * ⚠ Notion との決定的な違い（kintone固有の制約。呼び出し側のAPIルートも参照）:
 *   1. title_field_code もAIに決めさせる対象に含む（kintoneには構造的なtitleが無いため必須）。
 *   2. 選択肢は名前で対応づける（安定IDが無い）。AIにも done_values（選択肢名の配列）を選ばせる。
 *   3. write_done_action（プロセス管理のアクション名）はAI/ヒューリスティックのどちらの経路でも
 *      一切提案しない（常にnull）。アクション名の一覧を検証できるAPIが無く(mapping.ts参照)、
 *      提案面を安全に保つため確認画面での手動設定に委ねる。
 *   4. fetchAppFields は既に KintoneLiveField[]（フラットな配列）を返すため、Notion の
 *      toLiveProperties のような「配列→名前キーのレコード」変換は不要（validateMappingAgainstSchema
 *      もそのまま配列を受け取る）。
 *
 * ⚠ 不変条件（絶対に破ってはいけない）: LLMに渡してよいのは fetchAppFields が返すフィールドの
 * メタデータ（code・label・type・選択肢名）だけ。レコードの値、アクセストークン、org/接続を
 * 特定する情報は一切渡さない。buildRefinePrompt はこの境界を守る唯一の関数なので、変更する際は
 * 必ず mappingWizard.test.ts の「レコード値・トークンを含まない」テストを確認すること。
 */

/** 「たたき台」または「AIの精緻化結果」を表す最小形（confirmed_at を持たない・保存前の状態）。 */
export interface MappingCandidate {
  title_field_code: string | null
  due_field_code: string | null
  status: KintoneStatusMapping | null
}

/** field_code で一致するフィールドを探す（mapping.ts は内部限定のため、ここに小さく複製する）。 */
function findFieldByCode(fields: readonly KintoneLiveField[], code: string): KintoneLiveField | null {
  return fields.find((f) => f.code === code) ?? null
}

/** status の対応づけに使える型（mapping.ts の非公開定数と同じ4種。ここに小さく複製する）。 */
const STATUS_FIELD_TYPES: readonly KintoneStatusFieldType[] = ['STATUS', 'DROP_DOWN', 'RADIO_BUTTON', 'CHECK_BOX']

// 検証専用のダミー値。validateMappingAgainstSchema は confirmed_at を一切読まないが、
// 型(KintoneMapping)が string を要求するために埋める。呼び出し元が返すレスポンスには含めない。
const VALIDATION_ONLY_CONFIRMED_AT = '1970-01-01T00:00:00.000Z'

/**
 * 提案の最終防衛線（最重要）: title_field_code・due_field_code・status を、それぞれ単独で
 * validateMappingAgainstSchema に通し、無効な側だけ null に落とす。
 * ヒューリスティック・AI精緻化のどちらの経路を通った値であっても、ユーザーに返す直前に
 * 必ずこれを通す（実装バグで壊れた値を提案してしまう事故を最後で止める）。
 *
 * due_field_code/status を単独検証する際、validateMappingAgainstSchema は title_field_code の
 * 実在も必ずチェックするため、実在するフィールドのコードを1つダミーの題名として使う
 * （候補自体の title_field_code とは無関係。フィールドが1つも無ければ何を候補にしても
 * 無効なので、その場合は検証を待たずに null にする）。
 */
export function sanitizeProposalAgainstSchema(
  candidate: MappingCandidate,
  liveFields: readonly KintoneLiveField[],
): MappingCandidate {
  const anyFieldCode = liveFields[0]?.code ?? null

  let title_field_code = candidate.title_field_code
  if (title_field_code !== null) {
    const check = validateMappingAgainstSchema(
      { title_field_code, due_field_code: null, status: null, confirmed_at: VALIDATION_ONLY_CONFIRMED_AT },
      liveFields,
    )
    if (!check.valid) title_field_code = null
  }

  let due_field_code = candidate.due_field_code
  if (due_field_code !== null) {
    if (anyFieldCode === null) {
      due_field_code = null
    } else {
      const check = validateMappingAgainstSchema(
        {
          title_field_code: anyFieldCode,
          due_field_code,
          status: null,
          confirmed_at: VALIDATION_ONLY_CONFIRMED_AT,
        },
        liveFields,
      )
      if (!check.valid) due_field_code = null
    }
  }

  let status = candidate.status
  if (status !== null) {
    if (anyFieldCode === null) {
      status = null
    } else {
      const check = validateMappingAgainstSchema(
        {
          title_field_code: anyFieldCode,
          due_field_code: null,
          status,
          confirmed_at: VALIDATION_ONLY_CONFIRMED_AT,
        } satisfies KintoneMapping,
        liveFields,
      )
      if (!check.valid) status = null
    }
  }

  return { title_field_code, due_field_code, status }
}

// ---- AIへの精緻化依頼(プロンプト構築・応答パース) ----

/**
 * LLMに渡すプロンプトを組み立てる。渡すのはフィールドのメタデータのみ
 * （code・label・type・選択肢名）。レコード値・トークン・org特定情報は含めない。
 */
export function buildRefinePrompt(fields: readonly KintoneLiveField[]): LlmOptions['messages'] {
  const properties = fields.map((f) => ({
    code: f.code,
    label: f.label,
    type: f.type,
    options: f.options,
  }))

  const system =
    'あなたはkintoneアプリのフィールド構成から、タスク管理ツールとの連携設定を推定するアシスタントです。' +
    '与えられるのはフィールドのコード・表示名・型・選択肢名だけです（実際のレコードデータは一切含まれません）。' +
    '出力は必ず次の形式のJSONのみとし、他の説明文は一切出力しないでください: ' +
    '{"title_field_code": "タイトルとして使うフィールドコード、無ければnull", ' +
    '"due_field_code": "期日として使うフィールドコード(DATE型)、無ければnull", ' +
    '"status_field_code": "完了状態として使うフィールドコード、無ければnull", ' +
    '"done_values": ["status_field_codeが選択肢系(DROP_DOWN/RADIO_BUTTON/CHECK_BOX)のとき、完了とみなす選択肢名の配列"]}'

  const user = JSON.stringify({ fields: properties })

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ]
}

/** buildRefinePrompt に対する期待される応答の生の形（スキーマ検証前）。 */
export interface AiRefinementRaw {
  title_field_code: string | null
  due_field_code: string | null
  status_field_code: string | null
  done_values: string[]
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === 'string')
}

/**
 * LLM応答を厳格にパースする。想定形以外・未知フィールドは自然に落ちる（既知フィールドだけ組み立てる）。
 * JSON自体が壊れている/形が想定と違う場合は null（呼び出し側はヒューリスティックへフォールバックする）。
 * ```json フェンス付きの応答も許容する（既存 parseLlmDigestExtraction・notion/mappingWizard と同じ作法）。
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

  if (obj.title_field_code !== null && typeof obj.title_field_code !== 'string') return null
  if (obj.due_field_code !== null && typeof obj.due_field_code !== 'string') return null
  if (obj.status_field_code !== null && typeof obj.status_field_code !== 'string') return null
  const doneValuesRaw = obj.done_values ?? []
  if (!isStringArray(doneValuesRaw)) return null

  return {
    title_field_code: (obj.title_field_code as string | null) ?? null,
    due_field_code: obj.due_field_code as string | null,
    status_field_code: obj.status_field_code as string | null,
    done_values: doneValuesRaw,
  }
}

/**
 * パース済みのAI応答を、ライブスキーマに対して**フィールド単位**で適用する。
 * AIが返した field_code/選択肢名が実在しない、または型が想定と異なる場合、そのフィールドは
 * 採用せず、ヒューリスティックの値を維持する（他のフィールドは影響を受けない）。
 *
 * write_done_action はこの関数では一切設定しない（常に null。ファイル冒頭コメント参照）。
 */
export function applyAiRefinement(
  parsed: AiRefinementRaw,
  fields: readonly KintoneLiveField[],
  heuristic: MappingCandidate,
): MappingCandidate {
  let title_field_code = heuristic.title_field_code
  if (parsed.title_field_code === null) {
    title_field_code = null
  } else {
    const field = findFieldByCode(fields, parsed.title_field_code)
    if (field) title_field_code = field.code
    // 実在しない指定は採用しない(ヒューリスティックの値を維持)
  }

  let due_field_code = heuristic.due_field_code
  if (parsed.due_field_code === null) {
    due_field_code = null
  } else {
    const field = findFieldByCode(fields, parsed.due_field_code)
    if (field && field.type === 'DATE') due_field_code = field.code
    // 実在しない/DATE型でない指定は採用しない(ヒューリスティックの値を維持)
  }

  let status = heuristic.status
  if (parsed.status_field_code === null) {
    status = null
  } else {
    const field = findFieldByCode(fields, parsed.status_field_code)
    if (field && STATUS_FIELD_TYPES.includes(field.type as KintoneStatusFieldType)) {
      if (field.type === 'STATUS') {
        // STATUS型の取り得る値(プロセス管理のステータス名)は fields.json に現れないため、
        // AIが返したdone_valuesが実在するかは検証できない(mapping.ts冒頭コメントと同じ限界)。
        // 検証できない値を信用せず、ヒューリスティックのSTATUS検出と同じく「検出はしたが
        // done_valuesは未設定(手動確認が必要)」に倒す。write_done_actionも設定しない。
        status = { field_code: field.code, field_type: 'STATUS', done_values: [], write_done_action: null }
      } else {
        const validNames = new Set(field.options ?? [])
        const doneValues = parsed.done_values.filter((v) => validNames.has(v))
        // 実在する選択肢が1件も無ければこの指定は採用せずヒューリスティックの値を維持する
        // (mapping.tsの契約: done_valuesが空の設定は保存できない)。
        if (doneValues.length > 0) {
          status = {
            field_code: field.code,
            field_type: field.type as KintoneStatusFieldType,
            done_values: doneValues,
            write_done_action: null,
          }
        }
      }
    }
    // 実在しない/未対応型の指定は採用しない(ヒューリスティックの値を維持)
  }

  return { title_field_code, due_field_code, status }
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
  fields: readonly KintoneLiveField[]
  heuristic: MappingCandidate
}): Promise<RefineWithAiResult> {
  const { orgId, fields, heuristic } = params

  let content: string
  try {
    const messages = buildRefinePrompt(fields)
    const response = await callLlm({ orgId, messages, maxTokens: 500, purpose: 'kintone_mapping_propose' })
    content = response.content
  } catch (err) {
    const reason: AiUnavailableReason = err instanceof AiConfigError ? 'ai_unconfigured' : 'llm_error'
    return { ...heuristic, source: 'heuristic', aiUnavailableReason: reason }
  }

  const parsed = parseAiRefinementJson(content)
  if (!parsed) {
    return { ...heuristic, source: 'heuristic', aiUnavailableReason: 'invalid_response' }
  }

  return { ...applyAiRefinement(parsed, fields, heuristic), source: 'ai' }
}
