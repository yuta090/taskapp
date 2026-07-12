/**
 * Google Sheetsアダプタ（AI_SECRETARY_STAGE3_INTEGRATIONS.md §2-3(Google Sheets) / PR-4）。
 *
 * 全イベントを行appendのみで配達するログ方式（行更新はしない・sink_external_refsは使わない）。
 * at-least-onceの再配達により重複行が入り得ることを受信側ドキュメントに明記する
 * （台帳ではなくログである）。
 *
 * 失敗分類はwebhook/notionアダプタと同じ方針: adapterは{ok, permanent?, responseStatus?, error?}を
 * 返すだけで、HTTPステータスがある失敗はdispatcher側のclassifyDeliveryFailureに分類を委ねる。
 * ローカル検証で弾く場合（不正なspreadsheet_id/sheet_name・タスクを伴わない配達）だけ
 * permanent:trueを明示する。
 */

export interface GoogleSheetsSink {
  id: string
  provider: 'google_sheets'
  accessToken: string
  spreadsheetId: string
  sheetName: string
}

export interface GoogleSheetsDeliverableDelivery {
  id: string
  eventType: string
  eventKey: string
  payload: {
    occurred_at: string
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

const SHEETS_API_BASE = 'https://sheets.googleapis.com/v4/spreadsheets'
const DEFAULT_TIMEOUT_MS = 10_000

// spreadsheet_idはユーザー入力（ユーザーが用意したGoogle SheetsのID）。URLパスに埋め込む前に
// 形式検証する。Google SheetsのIDは英数・アンダースコア・ハイフンのみ、20〜100文字。
const SPREADSHEET_ID_REGEX = /^[a-zA-Z0-9_-]{20,100}$/
// sheet_nameは1〜100文字・制御文字なし。
const CONTROL_CHAR_REGEX = /[\x00-\x1f\x7f]/

export function isValidSpreadsheetId(value: string): boolean {
  return SPREADSHEET_ID_REGEX.test(value)
}

export function isValidSheetName(value: string): boolean {
  return value.length > 0 && value.length <= 100 && !CONTROL_CHAR_REGEX.test(value)
}

// 書込quota 60req/分/user（§2-3）。dispatchは単一プロセス・逐次ループのため
// モジュールレベルの簡易throttleで足りる（notion.tsの350msと同じパターン、間隔だけ広い）。
const MIN_INTERVAL_MS = 1000
let lastCallAt = 0

/** テスト専用: モジュール状態(throttleのタイマー)をリセットする */
export function __resetGoogleSheetsThrottleForTests(): void {
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

function sheetsHeaders(accessToken: string): Record<string, string> {
  return {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
  }
}

interface SheetsFetchResult {
  ok: boolean
  status: number
  text: string
}

interface SheetsFetchOptions {
  timeoutMs?: number
}

async function sheetsFetch(
  path: string,
  accessToken: string,
  init: { method: string; body?: unknown },
  options: SheetsFetchOptions = {},
): Promise<SheetsFetchResult> {
  await throttle()

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS)

  try {
    const response = await fetch(`${SHEETS_API_BASE}${path}`, {
      method: init.method,
      headers: sheetsHeaders(accessToken),
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal: controller.signal,
    })
    const text = await response.text().catch(() => '')
    return { ok: response.ok, status: response.status, text }
  } finally {
    clearTimeout(timeout)
  }
}

function toAdapterResult(result: SheetsFetchResult): AdapterResult {
  if (result.ok) return { ok: true, responseStatus: result.status }
  // レスポンスbodyは保存しない方針(last_errorへは先頭数百byteのみ切り詰め)。
  return { ok: false, responseStatus: result.status, error: result.text.slice(0, 500) }
}

/**
 * A1記法のrangeを組み立てる: '<sheetName>'!A1。sheet_name内の ' は '' にエスケープする
 * (defense-in-depth。呼び出し側は事前にisValidSheetNameで制御文字を弾いているが、
 * シングルクォート自体は許可される正当な文字のため、range構文を壊さないためにエスケープする)。
 * 全体はURLパスへ埋め込む前にencodeURIComponentを通す(呼び出し側で行う)。
 */
function buildRange(sheetName: string): string {
  const escaped = sheetName.replace(/'/g, "''")
  return `'${escaped}'!A1`
}

function valuesAppendPath(spreadsheetId: string, sheetName: string): string {
  const range = encodeURIComponent(buildRange(sheetName))
  return `/${encodeURIComponent(spreadsheetId)}/values/${range}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`
}

function toCell(value: unknown): string {
  return typeof value === 'string' ? value : value == null ? '' : String(value)
}

/**
 * 行の固定スキーマ(v1): [occurred_at, event, task.title, task.status, task.assignee_hint,
 * task.group, task.space, event_key, delivery id]。null/未設定は空文字にする。
 */
function buildRow(
  task: Record<string, unknown>,
  delivery: GoogleSheetsDeliverableDelivery,
): string[] {
  return [
    delivery.payload.occurred_at,
    delivery.eventType,
    toCell(task.title),
    toCell(task.status),
    toCell(task.assignee_hint),
    toCell(task.group),
    toCell(task.space),
    delivery.eventKey,
    delivery.id,
  ]
}

export async function deliverGoogleSheets(
  sink: GoogleSheetsSink,
  delivery: GoogleSheetsDeliverableDelivery,
  options: SheetsFetchOptions = {},
): Promise<AdapterResult> {
  if (!isValidSpreadsheetId(sink.spreadsheetId)) {
    return { ok: false, permanent: true, error: 'invalid_spreadsheet_id' }
  }
  if (!isValidSheetName(sink.sheetName)) {
    return { ok: false, permanent: true, error: 'invalid_sheet_name' }
  }
  if (!delivery.payload.task) {
    // ping等タスクに紐づかない配達はGoogle Sheetsアダプタの対象外(行として書く内容がない)。
    return { ok: false, permanent: true, error: 'google_sheets_adapter: delivery has no task' }
  }

  const row = buildRow(delivery.payload.task, delivery)

  try {
    const result = await sheetsFetch(
      valuesAppendPath(sink.spreadsheetId, sink.sheetName),
      sink.accessToken,
      { method: 'POST', body: { values: [row] } },
      options,
    )
    return toAdapterResult(result)
  } catch (error) {
    // タイムアウト(AbortError)・接続エラー等はresponseStatusを持たない一時失敗として
    // dispatcher側のclassifyDeliveryFailure(isNetworkError=true)に委ねる。
    const message = error instanceof Error ? error.message : String(error)
    return { ok: false, error: message }
  }
}

/**
 * テスト配達用: スプレッドシートのメタデータ取得(fields=spreadsheetId)で接続とアクセスを検証する。
 * 行を書き込まない(§3: notionのdatabase query同様、テスト送信で実データを汚さない)。
 */
export async function testGoogleSheetsConnection(
  sink: GoogleSheetsSink,
  options: SheetsFetchOptions = {},
): Promise<AdapterResult> {
  if (!isValidSpreadsheetId(sink.spreadsheetId)) {
    return { ok: false, permanent: true, error: 'invalid_spreadsheet_id' }
  }
  try {
    const result = await sheetsFetch(
      `/${encodeURIComponent(sink.spreadsheetId)}?fields=spreadsheetId`,
      sink.accessToken,
      { method: 'GET' },
      options,
    )
    return toAdapterResult(result)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { ok: false, error: message }
  }
}
