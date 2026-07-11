import { findExternalRef, saveExternalRef } from '@/lib/sinks/store'

/**
 * Notionアダプタ（AI_SECRETARY_STAGE3_INTEGRATIONS.md §2-3(Notion) / 受け入れ基準13）。
 *
 * refベースのupsert意味論（順序非依存）: sink_external_refs に (sink_id, digest_task_id) の
 * refがあればページ更新(PATCH)、なければページ作成(POST)→成功後にref保存。
 * done が created より先に届いても「done状態でページ作成」→後着createdはref存在により
 * 更新で吸収され、二重ページを作らない。
 *
 * 失敗分類はwebhookアダプタと同じ方針: adapterは{ok, permanent?, responseStatus?, error?}を
 * 返すだけで、HTTPステータスがある失敗はdispatcher側のclassifyDeliveryFailureに分類を委ねる
 * (401/403/404/400/422→permanent, 429/5xx→temporary は既存分類と一致するため重複させない)。
 * ローカル検証で弾く場合（不正なdatabase_id・タスクを伴わない配達）だけpermanent:trueを明示する。
 */

export interface NotionSink {
  id: string
  provider: 'notion'
  accessToken: string
  databaseId: string
}

export interface NotionDeliverableDelivery {
  id: string
  digestTaskId: string | null
  eventType: string
  eventKey: string
  payload: {
    occurredAt: string
    task: Record<string, unknown> | null
  }
}

export interface AdapterResult {
  ok: boolean
  /** trueなら恒久失敗（リトライしない）。undefinedならdispatcher側でレスポンスstatusから分類する */
  permanent?: boolean
  responseStatus?: number
  error?: string
}

const NOTION_API_BASE = 'https://api.notion.com/v1'
const NOTION_VERSION = '2022-06-28'

// database_idはユーザー入力（ユーザーが用意したNotion DBのID）。URLパスに埋め込む前に
// 形式検証する。Notion IDは32桁hexまたはUUID形式のみ（英数とハイフン以外は拒否）。
const HEX32_ID_REGEX = /^[0-9a-f]{32}$/i
const UUID_ID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isValidNotionDatabaseId(value: string): boolean {
  return HEX32_ID_REGEX.test(value) || UUID_ID_REGEX.test(value)
}

// レート制限3req/秒（§2-3）。dispatchは単一プロセス・逐次ループのため
// モジュールレベルの簡易throttleで足りる。
const MIN_INTERVAL_MS = 350
let lastCallAt = 0

/** テスト専用: モジュール状態(throttleのタイマー)をリセットする */
export function __resetNotionThrottleForTests(): void {
  lastCallAt = 0
}

async function throttle(): Promise<void> {
  const now = Date.now()
  const wait = lastCallAt + MIN_INTERVAL_MS - now
  if (wait > 0) {
    await new Promise((resolve) => setTimeout(resolve, wait))
  }
  lastCallAt = Date.now()
}

function notionHeaders(accessToken: string): Record<string, string> {
  return {
    Authorization: `Bearer ${accessToken}`,
    'Notion-Version': NOTION_VERSION,
    'Content-Type': 'application/json',
  }
}

interface NotionFetchResult {
  ok: boolean
  status: number
  json: unknown
  text: string
}

async function notionFetch(
  path: string,
  accessToken: string,
  init: { method: string; body?: unknown },
): Promise<NotionFetchResult> {
  await throttle()
  const response = await fetch(`${NOTION_API_BASE}${path}`, {
    method: init.method,
    headers: notionHeaders(accessToken),
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  })
  const text = await response.text().catch(() => '')
  let json: unknown = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    json = null
  }
  return { ok: response.ok, status: response.status, json, text }
}

function toAdapterResult(result: NotionFetchResult): AdapterResult {
  if (result.ok) return { ok: true, responseStatus: result.status }
  // レスポンスbodyは保存しない方針(last_errorへは先頭数百byteのみ切り詰め)。
  return { ok: false, responseStatus: result.status, error: result.text.slice(0, 500) }
}

/**
 * ページpropertyマッピング(v1固定スキーマ、database側は顧客が用意する前提):
 * 名前(title)=タイトル、ステータス(rich_text)=status、担当(rich_text)=assignee_hint、
 * 出典(rich_text)=group/space名、発生時刻(date)=occurred_at。
 * 存在しないpropertyによる400は恒久失敗として扱う(受信側ガイドに記載)。
 */
function buildProperties(task: Record<string, unknown>, occurredAt: string): Record<string, unknown> {
  const title = typeof task.title === 'string' ? task.title : ''
  const status = typeof task.status === 'string' ? task.status : ''
  const assigneeHint = typeof task.assignee_hint === 'string' ? task.assignee_hint : ''
  const group = typeof task.group === 'string' ? task.group : ''
  const space = typeof task.space === 'string' ? task.space : ''
  const source = task.source as { channel?: string } | undefined
  const origin = [group, space].filter(Boolean).join(' / ') || (source?.channel ?? '')

  return {
    名前: { title: [{ text: { content: title } }] },
    ステータス: { rich_text: [{ text: { content: status } }] },
    担当: { rich_text: [{ text: { content: assigneeHint } }] },
    出典: { rich_text: [{ text: { content: origin } }] },
    発生時刻: { date: { start: occurredAt } },
  }
}

export async function deliverNotion(
  sink: NotionSink,
  delivery: NotionDeliverableDelivery,
): Promise<AdapterResult> {
  if (!isValidNotionDatabaseId(sink.databaseId)) {
    return { ok: false, permanent: true, error: 'invalid_database_id' }
  }
  if (!delivery.digestTaskId || !delivery.payload.task) {
    // ping等タスクに紐づかない配達はNotionアダプタの対象外(呼び出し側の実装ミス)。
    return { ok: false, permanent: true, error: 'notion_adapter: delivery has no task' }
  }

  const task = delivery.payload.task
  const properties = buildProperties(task, delivery.payload.occurredAt)

  const existingRef = await findExternalRef(sink.id, delivery.digestTaskId)
  if (existingRef) {
    const result = await notionFetch(`/pages/${existingRef}`, sink.accessToken, {
      method: 'PATCH',
      body: { properties },
    })
    return toAdapterResult(result)
  }

  const createResult = await notionFetch('/pages', sink.accessToken, {
    method: 'POST',
    body: { parent: { database_id: sink.databaseId }, properties },
  })
  if (!createResult.ok) {
    return toAdapterResult(createResult)
  }

  const pageId = (createResult.json as { id?: string } | null)?.id
  if (!pageId) {
    return { ok: false, permanent: true, error: 'notion_adapter: create response missing id' }
  }

  const saveResult = await saveExternalRef(sink.id, delivery.digestTaskId, pageId)
  if (saveResult.outcome === 'conflict') {
    // 並行配達でrefが先に確定していた場合: そちらのページを正としてこのイベントの
    // 新しいスナップショットでPATCHする。作成したページは孤児になり得るが、
    // ref一意性(sink_id, digest_task_id)を保ち二重ページの参照を作らないことを優先する。
    const fallbackResult = await notionFetch(`/pages/${saveResult.existingRef}`, sink.accessToken, {
      method: 'PATCH',
      body: { properties },
    })
    return toAdapterResult(fallbackResult)
  }

  return { ok: true, responseStatus: createResult.status }
}

/**
 * テスト配達用: databaseへのquery1件(page_size:1)で接続とdatabaseアクセスを検証する。
 * ping用のページを作らない(§3)。
 */
export async function testNotionConnection(sink: NotionSink): Promise<AdapterResult> {
  if (!isValidNotionDatabaseId(sink.databaseId)) {
    return { ok: false, permanent: true, error: 'invalid_database_id' }
  }
  const result = await notionFetch(`/databases/${sink.databaseId}/query`, sink.accessToken, {
    method: 'POST',
    body: { page_size: 1 },
  })
  return toAdapterResult(result)
}
