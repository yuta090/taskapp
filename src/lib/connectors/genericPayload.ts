/**
 * 汎用Webhook受信のペイロード契約（固定スキーマ）。
 *
 * なぜ「固定スキーマ」なのか:
 *   公開APIが無い/弱いツール（業界特化型の長尾）まで個別アダプタで取りに行くのは、
 *   API有無の調査・任意ホストへの認証付きアクセス（SSRF＋資格情報の預かり）・設定不具合の
 *   問い合わせが全部こちらに乗るため、現実的に持たない。
 *   一方で**受信は自分が取りに行かない**ので、SSRFが構造的に消え、資格情報も預からない。
 *   Zapier / Make / n8n などが「送る側」を担えるので、こちらは**受け口の形を1つに固定**して、
 *   それに合わせてもらう。これが長尾を面で取る唯一のスケールする方法。
 *
 * 送信側向けの正式な仕様書: docs/spec/GENERIC_INBOUND_WEBHOOK_v1.md
 *   （URL・署名の作り方・応答コードの意味・再送の指針・制限はそちらが正本。このファイルは
 *   その実装であって、顧客はこのTypeScriptを読まない）。
 *
 * 変えてはいけない理由:
 *   このスキーマは顧客側の送信設定（Zapierのマッピング等）が依存する外部仕様。壊すと、
 *   繋いだ相手全員の設定が一斉に無言で壊れる。拡張は「任意フィールドの追加」だけに留め、
 *   既存フィールドの意味・必須性は変えない。
 */

/** 受信イベントの種類。増やすときは既存の意味を変えないこと。 */
export type GenericInboundEventType = 'task.created' | 'task.updated' | 'task.completed'

export interface GenericInboundEvent {
  /** 再送の冪等キー。送信側が同じイベントに同じ値を付ける（無ければ拒否）。 */
  eventId: string
  eventType: GenericInboundEventType
  /** どの接続宛か。Webhook URL ではなくボディに入れる（multica の受信と同じ流儀）。 */
  connectionId: string
  /** 外部ツール側のタスクID。接続内で一意であること（対応表の鍵になる）。 */
  externalId: string
  title?: string
  body?: string | null
  /** 期日。ローカル日付 'YYYY-MM-DD' のみ受ける（時刻付きは曖昧なので拒否する）。 */
  dueDate?: string | null
  /** 本文を明示的に空にする指示（`body: null`）。未指定（undefined）と区別する。 */
  clearBody?: boolean
}

export type GenericPayloadResult =
  | { ok: true; event: GenericInboundEvent }
  | { ok: false; reason: string }

const EVENT_TYPES: readonly string[] = ['task.created', 'task.updated', 'task.completed']
const LOCAL_DATE = /^\d{4}-\d{2}-\d{2}$/
/** 1フィールドの長さ上限。無制限に受けるとDBと通知の両方が壊れるので入口で切る。 */
const MAX_TEXT = 4000
const MAX_ID = 255

/**
 * 形式だけでなく**実在する日付か**を見る。'2026-02-30' や '2026-99-99' は形式に合うが存在しない。
 * Date で往復させて一致するかで判定する（UTC固定の比較なのでローカル日付のずれは起きない）。
 */
function isRealCalendarDate(value: string): boolean {
  const [y, m, d] = value.split('-').map(Number)
  const date = new Date(Date.UTC(y, m - 1, d))
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

/**
 * 受信ボディを検証して正規化する。**曖昧なものは受け取らない**（受け入れてから困るより、
 * 入口で理由を返して送信側に直してもらう方が、結果的に繋がるまでが早い）。
 */
export function parseGenericInboundEvent(raw: unknown): GenericPayloadResult {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, reason: 'body must be a JSON object' }
  }
  const o = raw as Record<string, unknown>

  const eventId = str(o.event_id)
  if (!eventId || eventId.length > MAX_ID) {
    // 冪等キーが無いと再送で二重起票になる。送信側に必ず付けてもらう。
    return { ok: false, reason: 'event_id is required' }
  }

  const eventType = str(o.event_type)
  if (!eventType || !EVENT_TYPES.includes(eventType)) {
    return { ok: false, reason: `event_type must be one of ${EVENT_TYPES.join(', ')}` }
  }

  const connectionId = str(o.connection_id)
  if (!connectionId) return { ok: false, reason: 'connection_id is required' }

  const externalId = str(o.external_id)
  if (!externalId || externalId.length > MAX_ID) {
    return { ok: false, reason: 'external_id is required' }
  }

  const title = str(o.title)
  if (eventType === 'task.created' && !title) {
    // 起票にはタイトルが要る（「(無題)」で埋めると、後から本人にも何のタスクか分からない）。
    return { ok: false, reason: 'title is required for task.created' }
  }
  if (title && title.length > MAX_TEXT) return { ok: false, reason: 'title is too long' }

  // body は3状態ある: 未指定(変更しない) / 文字列(その内容にする) / null(空にする)。
  // 「変更しない」と「空にする」を同じ扱いにすると、外部で本文を消しても TaskApp に残り続ける。
  const bodyText = typeof o.body === 'string' ? o.body : null
  const clearBody = o.body === null
  if (bodyText && bodyText.length > MAX_TEXT) return { ok: false, reason: 'body is too long' }

  let dueDate: string | null | undefined
  if (o.due_date === null) {
    dueDate = null // 明示的な「期日なし」
  } else if (o.due_date !== undefined) {
    const value = str(o.due_date)
    if (!value || !LOCAL_DATE.test(value)) {
      // 日時を受けるとタイムゾーンの解釈で日付が1日ずれる。日付だけを受け取る。
      return { ok: false, reason: 'due_date must be YYYY-MM-DD' }
    }
    if (!isRealCalendarDate(value)) {
      // '2026-99-99' のような形だけ合っている値をDBまで通すと、そこで落ちて500→再送ループになる。
      return { ok: false, reason: 'due_date is not a valid calendar date' }
    }
    dueDate = value
  }

  return {
    ok: true,
    event: {
      eventId,
      eventType: eventType as GenericInboundEventType,
      connectionId,
      externalId,
      title: title ?? undefined,
      body: bodyText,
      clearBody,
      dueDate,
    },
  }
}
