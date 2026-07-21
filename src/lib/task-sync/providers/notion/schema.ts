import { assertAllowedHost } from '@/lib/task-sync/hostPolicy'
import { providerError, type HostPolicy } from '@/lib/task-sync/types'
import type { NotionStatusMapping } from '@/lib/task-sync/providers/notion/mapping'
import { retryAfterMsFrom } from '@/lib/task-sync/providers/notion/retryAfter'

/**
 * Notion DB スキーマ取得＋マッピング提案（純関数側）。
 *
 * ここは「Notionにどんなプロパティがあるか」を見に行くだけで、レコード値（実際のページの内容）
 * には触れない。接続のマッピングウィザード（次段のAPIエンドポイント）から呼ばれる想定に加えて、
 * TaskSyncAdapter（providers/notion.ts の listChangedTasks）からも、コンテナのポーリング初回ページ
 * （cursor未指定のとき）に限り1回だけ実行時のdrift再検証のために呼ばれる。token/databaseId を
 * 直接受け取る形にしているのは、まだ接続を保存する前のウィザード段階では ProviderContext（ctx）を
 * 組み立てられないため（providers/notion.ts 側は ctx.credentials.token を渡して呼ぶ）。
 *
 * `Notion API `GET /v1/databases/{id}`（2022-06-28 で確認。既存 sink アダプタ
 * src/lib/sinks/adapters/notion.ts と同じ Notion-Version に揃える）。
 */

const NOTION_API_BASE = 'https://api.notion.com/v1'
/**
 * ⚠ providers/notion.ts の NOTION_VERSION と必ず同じ値に揃えること（同じ接続のスキーマ取得と
 * 取り込み実行が別バージョンを喋ると挙動が食い違う）。固定理由・上げるときの注意も
 * providers/notion.ts 側のコメントに詳しく書いてある: Notion API 2025-09-03 で databases が
 * data sources へ移行しており、providers/notion.ts の `POST /v1/search` の
 * `filter:{value:'database', ...}` がその版では無効になる（listContainers が無言で空配列を
 * 返す silent failure）。ここ(databases.retrieve)は search を使わないため直接は影響しないが、
 * バージョンを上げるときは必ず providers/notion.ts 側のトリップワイヤーテスト
 * （src/__tests__/lib/task-sync/providers/notion.test.ts）を先に確認すること。
 */
const NOTION_VERSION = '2022-06-28'
const REQUEST_TIMEOUT_MS = 20_000

/** 固定ホストの決め打ち。ctx 由来の任意URLは扱わない（token/databaseId のみを受け取る設計のため）。 */
const NOTION_HOST_POLICY = { kind: 'fixed', host: 'api.notion.com' } as const satisfies HostPolicy

/** Notion の選択肢（status/select の option）。名前は表示用、同一性は id で見る。 */
export interface NotionSchemaPropertyOption {
  id: string
  name: string
}

/** レコード値を含まない、プロパティのメタだけの正規化形。 */
export interface NotionSchemaProperty {
  id: string
  name: string
  type: string
  /** status/select のときだけ選択肢を持つ。 */
  options?: NotionSchemaPropertyOption[]
}

export type NotionDatabaseSchema = NotionSchemaProperty[]

interface RawNotionOption {
  id: string
  name: string
}

interface RawNotionProperty {
  id: string
  name?: string
  type: string
  status?: { options?: RawNotionOption[] }
  select?: { options?: RawNotionOption[] }
}

interface RawNotionDatabase {
  properties?: Record<string, RawNotionProperty>
}

function apiUrl(path: string): string {
  const url = new URL(`${NOTION_API_BASE}${path}`)
  assertAllowedHost(NOTION_HOST_POLICY, url.toString(), 'notion')
  return url.toString()
}

/**
 * databases.retrieve への GET。失敗は providerError で status を載せて投げる（エンジンが
 * 400/404/422=恒久失敗、他=一時失敗に分類する。既存アダプタと同じ流儀）。
 * トークン・応答本文はログに出さない（応答本文には顧客のDB構造が載る）。
 */
async function notionGet(token: string, path: string): Promise<unknown> {
  let res: Response
  try {
    res = await fetch(apiUrl(path), {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}`, 'Notion-Version': NOTION_VERSION },
      redirect: 'manual',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  } catch (err) {
    throw providerError(`Notion API GET failed (network): ${err instanceof Error ? err.name : 'Unknown'}`)
  }

  if (res.status >= 300 && res.status < 400) {
    throw providerError(`Notion API GET unexpected redirect (${res.status})`, { status: 400, permanent: true })
  }
  if (!res.ok) {
    console.error('Notion API error:', 'GET', path.split('/')[1] ?? 'GET', res.status) // 本文は出さない
    // query 側(providers/notion.ts)と同じ扱いに揃える: 429/503 は Retry-After を retryAfterMs に
    // 載せる。ここで読み落とすと、レート制限中でもスキーマ取得だけ復帰時刻を無視して叩き続け、
    // 制限を延長してしまう。
    throw providerError(`Notion API GET failed (${res.status})`, {
      status: res.status,
      retryAfterMs: res.status === 429 || res.status === 503 ? retryAfterMsFrom(res.headers) : undefined,
    })
  }
  return res.json()
}

/**
 * DB スキーマ（プロパティのメタのみ）を取得する。レコード値は一切取得しない
 * （databases.retrieve はそもそもレコードを返さないエンドポイントであることもここでの安全性の根拠）。
 */
export async function fetchDatabaseSchema(token: string, databaseId: string): Promise<NotionDatabaseSchema> {
  const res = (await notionGet(token, `/databases/${encodeURIComponent(databaseId)}`)) as RawNotionDatabase
  const properties = res.properties ?? {}
  return Object.entries(properties).map(([name, prop]) => {
    const options = prop.status?.options ?? prop.select?.options
    const out: NotionSchemaProperty = {
      id: prop.id,
      name: prop.name ?? name,
      type: prop.type,
    }
    if (options) out.options = options.map((o) => ({ id: o.id, name: o.name }))
    return out
  })
}

/** 「完了」を示唆する語（status/select の option 名・checkbox のプロパティ名の両方に使う）。 */
const DONE_KEYWORDS = ['完了', 'done', '済', 'クローズ', 'closed']

function looksLikeDone(name: string): boolean {
  const lower = name.toLowerCase()
  return DONE_KEYWORDS.some((kw) => lower.includes(kw.toLowerCase()))
}

export type ProposalConfidence = 'high' | 'medium' | 'low' | 'none'

/** proposeMapping の返り値。NotionMapping の該当フィールド＋各選択の信頼度/理由。 */
export interface NotionMappingProposal {
  due_prop_id: string | null
  due_prop_id_confidence: ProposalConfidence
  due_prop_id_reason: string
  status: NotionStatusMapping | null
  status_confidence: ProposalConfidence
  status_reason: string
}

function proposeDue(schema: NotionDatabaseSchema): Pick<
  NotionMappingProposal,
  'due_prop_id' | 'due_prop_id_confidence' | 'due_prop_id_reason'
> {
  const dateProp = schema.find((p) => p.type === 'date')
  if (!dateProp) {
    return {
      due_prop_id: null,
      due_prop_id_confidence: 'none',
      due_prop_id_reason: 'date型のプロパティが見つかりません',
    }
  }
  return {
    due_prop_id: dateProp.id,
    due_prop_id_confidence: 'high',
    due_prop_id_reason: `date型のプロパティ「${dateProp.name}」を検出しました`,
  }
}

/** status/select 用: 完了らしき option を集める（複数あり得るため全部拾う。書き戻し先は先頭）。 */
function doneOptionsOf(prop: NotionSchemaProperty): NotionSchemaPropertyOption[] {
  return (prop.options ?? []).filter((o) => looksLikeDone(o.name))
}

function proposeStatus(schema: NotionDatabaseSchema): Pick<
  NotionMappingProposal,
  'status' | 'status_confidence' | 'status_reason'
> {
  // 優先順位: status型（Notionの完了ワークフロー専用型） > select型 > checkbox（名前だけが手がかり）。
  // status/select は「型として選択肢の集合を持つ」ため option 名からの推定精度が高く、
  // checkbox は true/false しか持たずプロパティ名だけが手がかりのため信頼度を一段落とす。
  const statusProp = schema.find((p) => p.type === 'status')
  if (statusProp) {
    const doneOptions = doneOptionsOf(statusProp)
    if (doneOptions.length > 0) {
      return {
        status: {
          prop_id: statusProp.id,
          prop_type: 'status',
          done_option_ids: doneOptions.map((o) => o.id),
          write_done_option_id: doneOptions[0].id,
        },
        status_confidence: 'high',
        status_reason: `status型「${statusProp.name}」の選択肢から完了候補(${doneOptions
          .map((o) => o.name)
          .join(', ')})を検出しました`,
      }
    }
    return {
      status: {
        prop_id: statusProp.id,
        prop_type: 'status',
        done_option_ids: [],
        write_done_option_id: null,
      },
      status_confidence: 'low',
      status_reason: `status型「${statusProp.name}」を検出しましたが、完了とみなせる選択肢が無いため未設定です（手動で選択してください）`,
    }
  }

  const selectProp = schema.find((p) => p.type === 'select')
  if (selectProp) {
    const doneOptions = doneOptionsOf(selectProp)
    if (doneOptions.length > 0) {
      return {
        status: {
          prop_id: selectProp.id,
          prop_type: 'select',
          done_option_ids: doneOptions.map((o) => o.id),
          write_done_option_id: doneOptions[0].id,
        },
        status_confidence: 'high',
        status_reason: `select型「${selectProp.name}」の選択肢から完了候補(${doneOptions
          .map((o) => o.name)
          .join(', ')})を検出しました`,
      }
    }
    return {
      status: {
        prop_id: selectProp.id,
        prop_type: 'select',
        done_option_ids: [],
        write_done_option_id: null,
      },
      status_confidence: 'low',
      status_reason: `select型「${selectProp.name}」を検出しましたが、完了とみなせる選択肢が無いため未設定です（手動で選択してください）`,
    }
  }

  const checkboxProp = schema.find((p) => p.type === 'checkbox' && looksLikeDone(p.name))
  if (checkboxProp) {
    return {
      status: {
        prop_id: checkboxProp.id,
        prop_type: 'checkbox',
        done_option_ids: [],
        write_done_option_id: null,
      },
      // checkbox はプロパティ名だけが手がかり（構造化された選択肢が無い）ため中信頼度に留める。
      status_confidence: 'medium',
      status_reason: `チェックボックス「${checkboxProp.name}」の名前から完了フラグ候補と推定しました`,
    }
  }

  return {
    status: null,
    status_confidence: 'none',
    status_reason: 'ステータスに使えそうなプロパティが見つかりません',
  }
}

/**
 * スキーマからマッピングの「たたき台」を決定的ヒューリスティックで作る（LLM不使用）。
 * AI（LLM）による提案の上乗せは次段のAPIエンドポイントで薄く被せる想定で、ここは
 * テスト可能性を優先した決定的な推定に留める。
 */
export function proposeMapping(schema: NotionDatabaseSchema): NotionMappingProposal {
  return { ...proposeDue(schema), ...proposeStatus(schema) }
}
