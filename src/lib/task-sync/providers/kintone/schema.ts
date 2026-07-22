import { apiUrl, kintoneFetch } from '@/lib/task-sync/providers/kintone/client'
import type { KintoneLiveField, KintoneStatusMapping } from '@/lib/task-sync/providers/kintone/mapping'

/**
 * kintone フィールド定義取得＋マッピング提案（純関数側）。
 *
 * ここは「kintoneアプリにどんなフィールドがあるか」を見に行くだけで、レコード値（実際の
 * レコードの内容）には触れない。接続のマッピングウィザード（次段のAPIエンドポイント。本PRの
 * スコープ外）から呼ばれる想定に加えて、TaskSyncAdapter（providers/kintone.ts の
 * listChangedTasks）からも、コンテナのポーリング初回ページ（cursor未指定のとき）に限り1回だけ
 * 実行時のdrift再検証のために呼ばれる。baseUrl/tokens/appId を直接受け取る形にしているのは、
 * まだ接続を保存する前のウィザード段階では ProviderContext（ctx）を組み立てられないため
 * （providers/kintone.ts 側は ctx.credentials.baseUrl/token を渡して呼ぶ。notion/schema.ts と
 * 同じ設計）。
 *
 * 公式: `GET /k/v1/app/form/fields.json?app=<appId>`
 * https://kintone.dev/en/docs/kintone/rest-api/apps/form/get-form-fields/ （2026-07 時点で確認）
 * レスポンス: `{ properties: { "<フィールドコード>": { label, code, type, required, options?:
 * { "<選択肢名>": { label, index } } } }, revision }`。
 */

const KINTONE_FIELDS_PATH = '/k/v1/app/form/fields.json'

interface RawKintoneOption {
  label: string
  index?: string
}

interface RawKintoneField {
  code: string
  label: string
  type: string
  required?: boolean
  options?: Record<string, RawKintoneOption>
}

interface RawKintoneFieldsResponse {
  properties?: Record<string, RawKintoneField>
  revision?: string
}

/**
 * アプリのフィールド定義（メタのみ）を取得する。レコード値は一切取得しない
 * （fields.json はそもそもレコードを返さないエンドポイントであることもここでの安全性の根拠）。
 */
export async function fetchAppFields(
  baseUrl: string | null | undefined,
  tokens: string,
  appId: string,
): Promise<KintoneLiveField[]> {
  const url = new URL(apiUrl(baseUrl, KINTONE_FIELDS_PATH))
  url.searchParams.set('app', appId)
  const res = (await kintoneFetch(
    url.toString(),
    tokens,
    { method: 'GET' },
    `フォームフィールド定義の取得(app=${appId})`,
  )) as RawKintoneFieldsResponse

  const properties = res.properties ?? {}
  return Object.entries(properties).map(([code, field]) => {
    const out: KintoneLiveField = {
      code: field.code ?? code,
      type: field.type,
      label: field.label ?? code,
    }
    if (field.options) {
      // options はキーが選択肢名そのもの（公式レスポンス形。ファイル冒頭コメント参照）。
      // .label は基本的にキーと同じ値が入るが、キーを正とする（レスポンスの構造上の識別子のため）。
      out.options = Object.keys(field.options)
    }
    return out
  })
}

/** 「完了」を示唆する語（選択肢名・チェックボックスの選択肢名の両方に使う）。 */
const DONE_KEYWORDS = ['完了', 'done', '済', 'クローズ', 'closed']

function looksLikeDone(name: string): boolean {
  const lower = name.toLowerCase()
  return DONE_KEYWORDS.some((kw) => lower.includes(kw.toLowerCase()))
}

/** タイトル候補として優先するフィールドコード名（大文字小文字を区別しない部分一致）。 */
const TITLE_CODE_HINTS = ['title', '件名', 'タスク名', '案件名', 'subject']

export type ProposalConfidence = 'high' | 'medium' | 'low' | 'none'

/** proposeMapping の返り値。KintoneMapping の該当フィールド＋各選択の信頼度/理由。 */
export interface KintoneMappingProposal {
  title_field_code: string | null
  title_field_code_confidence: ProposalConfidence
  title_field_code_reason: string
  due_field_code: string | null
  due_field_code_confidence: ProposalConfidence
  due_field_code_reason: string
  status: KintoneStatusMapping | null
  status_confidence: ProposalConfidence
  status_reason: string
}

function proposeTitle(fields: KintoneLiveField[]): Pick<
  KintoneMappingProposal,
  'title_field_code' | 'title_field_code_confidence' | 'title_field_code_reason'
> {
  const textFields = fields.filter((f) => f.type === 'SINGLE_LINE_TEXT')
  const hinted = textFields.find((f) => TITLE_CODE_HINTS.some((h) => f.code.toLowerCase().includes(h.toLowerCase())))
  if (hinted) {
    return {
      title_field_code: hinted.code,
      title_field_code_confidence: 'high',
      title_field_code_reason: `フィールドコード「${hinted.code}」がタイトルらしい名前のため検出しました`,
    }
  }
  if (textFields.length > 0) {
    return {
      title_field_code: textFields[0].code,
      title_field_code_confidence: 'low',
      title_field_code_reason: `文字列(1行)型の先頭フィールド「${textFields[0].code}」を仮のタイトル候補にしました（手動確認を推奨）`,
    }
  }
  return {
    title_field_code: null,
    title_field_code_confidence: 'none',
    title_field_code_reason: '文字列(1行)型のフィールドが見つかりません。タイトルに使うフィールドを手動で選択してください',
  }
}

function proposeDue(fields: KintoneLiveField[]): Pick<
  KintoneMappingProposal,
  'due_field_code' | 'due_field_code_confidence' | 'due_field_code_reason'
> {
  const dateField = fields.find((f) => f.type === 'DATE')
  if (!dateField) {
    return {
      due_field_code: null,
      due_field_code_confidence: 'none',
      due_field_code_reason: 'DATE型のフィールドが見つかりません',
    }
  }
  return {
    due_field_code: dateField.code,
    due_field_code_confidence: 'high',
    due_field_code_reason: `DATE型のフィールド「${dateField.code}」を検出しました`,
  }
}

/** 選択肢名から「完了らしい」ものだけを取り出す。 */
function doneOptionsOf(field: KintoneLiveField): string[] {
  return (field.options ?? []).filter((name) => looksLikeDone(name))
}

function proposeStatus(fields: KintoneLiveField[]): Pick<
  KintoneMappingProposal,
  'status' | 'status_confidence' | 'status_reason'
> {
  // 優先順位: STATUS型（プロセス管理。専用の完了ワークフロー） > DROP_DOWN > RADIO_BUTTON >
  // CHECK_BOX。STATUS はアプリの意図した業務フローを反映するため最優先だが、fields.json には
  // 選択肢名（プロセス管理のステータス名）が現れないため、ここでは検出だけ行い
  // done_values/write_done_action は空のまま「手動で選択してください」に倒す
  // （mapping.ts の validateMappingAgainstSchema と同じ理由・同じ限界）。
  const statusField = fields.find((f) => f.type === 'STATUS')
  if (statusField) {
    return {
      status: {
        field_code: statusField.code,
        field_type: 'STATUS',
        done_values: [],
        write_done_action: null,
      },
      status_confidence: 'low',
      status_reason: `プロセス管理のステータスフィールド「${statusField.code}」を検出しましたが、取り得るステータス名とアクション名はこの画面からは分からないため未設定です（手動で選択してください）`,
    }
  }

  for (const type of ['DROP_DOWN', 'RADIO_BUTTON', 'CHECK_BOX'] as const) {
    const field = fields.find((f) => f.type === type)
    if (!field) continue
    const doneOptions = doneOptionsOf(field)
    if (doneOptions.length > 0) {
      return {
        status: {
          field_code: field.code,
          field_type: type,
          done_values: doneOptions,
          write_done_action: null, // 書き戻し(プロセス管理アクション)は別途手動設定が必要
        },
        status_confidence: 'medium',
        status_reason: `${type}型「${field.code}」の選択肢から完了候補(${doneOptions.join(', ')})を検出しました。書き戻し先のアクション名は手動で設定してください`,
      }
    }
  }

  return {
    status: null,
    status_confidence: 'none',
    status_reason: '完了に使えそうなフィールドが見つかりません',
  }
}

/**
 * フィールド定義からマッピングの「たたき台」を決定的ヒューリスティックで作る（LLM不使用）。
 * AI（LLM）による提案の上乗せは次段のAPIエンドポイントで薄く被せる想定で、ここは
 * テスト可能性を優先した決定的な推定に留める（notion/schema.ts の proposeMapping と同じ設計）。
 */
export function proposeMapping(fields: KintoneLiveField[]): KintoneMappingProposal {
  return { ...proposeTitle(fields), ...proposeDue(fields), ...proposeStatus(fields) }
}
