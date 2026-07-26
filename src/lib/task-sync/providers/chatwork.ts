import { assertAllowedHost, requireBaseUrl } from '@/lib/task-sync/hostPolicy'
import {
  providerError,
  type ExternalContainer,
  type ExternalTask,
  type HostPolicy,
  type ProviderContext,
  type TaskPage,
  type TaskSyncAdapter,
} from '@/lib/task-sync/types'

/**
 * Chatwork タスク アダプタ。
 *
 * 公式APIリファレンス（https://developer.chatwork.com/reference/ 配下。エンドポイント毎の
 * `.md` 版で応答スキーマまで確認済み）の性質と、ここで吸収している差異:
 *   - ホストは固定 `https://api.chatwork.com`（テナントごとに変わらない）。`hostPolicy: 'fixed'`
 *     で宣言し、接続時にURL入力は不要（credentials.baseUrl は無視）。
 *   - 認証はヘッダー `X-ChatworkToken` のAPIキー方式。OAuth2.0 も提供されるが、運用者が
 *     自分の画面から即発行できるAPIキーの方が導入が速い（Backlog/Jooto と同じ判断）。
 *     ⚠ APIキーは**個人のトークン**であり、そのアカウントが参加しているチャットしか見えない。
 *     「顧問先の部屋が候補に出ない」の原因はほぼこれ（権限の話であり不具合ではない）。
 *   - コンテナは「チャット」= `GET /rooms`。**role='readonly' は除外する**。閲覧のみの権限では
 *     完了の書き戻し（PUT .../status）が通らず、取り込めても必ず書き戻しで失敗する接続に
 *     なるため、そもそも候補に出さない。
 *   - タスク一覧 `GET /rooms/{room_id}/tasks` は **最大100件・ページング無し・更新日時での
 *     絞り込み無し**。したがって `cursorGranularity: 'none'`（毎回取り直し）とし、
 *     nextCursor は常に null を返す。
 *   - status を省略したときに未完了/完了のどちらが返るかは仕様上あいまいなため、
 *     `status=open` と `status=done` を**明示して2回**叩く。完了の取り込み（＝この連携の
 *     主目的）を「省略時の既定値」という不確かなものに賭けない。
 *   - ⚠ 未確認（実機で確かめる価値がある）: 100件を超えるチャットでどの100件が返るか
 *     （新しい順か古い順か）はドキュメントに明記が無い。古い順だと、新しく完了したタスクが
 *     100件の外に落ちて完了を取りこぼす可能性がある。`deletionMode` を 'unsupported' に
 *     しているのも同じ理由（100件で切られ得るため「応答に無い＝削除」と断定できない）。
 *   - タスクは**本文（body）だけでタイトルを持たない**。1行目をタイトル、全文を本文にする
 *     （1行しかないときは本文を null にして同じ文字列を二重に持たせない）。
 *   - 期限は `limit_time`（UNIX秒）＋ `limit_type`（none/date/time）。Chatworkは日本のサービスで
 *     期限はJSTで設定されるため、**JSTの暦日**へ落とす（CLAUDE.md の toISOString 禁止と同じ
 *     理由＝サーバやCIのTZで1日ずれるのを構造的に防ぐ）。
 *   - レート制限は `X-RateLimit-Reset`（UNIX秒）で復帰時刻が返る（Backlog/Jooto と同形式）。
 *   - 空のタスク一覧は **204 No Content**（本文が無い）で返る。`json()` を呼ぶと例外になるため
 *     status で分岐する（実際に踏む種類の罠なのでテストで固定している）。
 *
 * 提供しないもの:
 *   - `createTask`（TaskApp発のタスクをChatworkにも作る）。`POST /rooms/{id}/tasks` は担当者
 *     `to_ids` が必須で、TaskApp側の担当者をChatworkのアカウントIDへ対応付ける仕組みが
 *     まだ無い。誰かに勝手に割り当てるくらいなら作らない（＝取り込み＋完了の書き戻し専用）。
 */

/** ホストが固定であることの宣言。credentials.baseUrl は無視する（接続時に入力させない）。 */
const HOST_POLICY: HostPolicy = { kind: 'fixed', host: 'api.chatwork.com' }

/** リクエストのタイムアウト。応答しないホストにワーカーを占有させない。 */
const REQUEST_TIMEOUT_MS = 20_000

/** タスクのタイトル（本文1行目）の最大長。長文タスクで一覧が壊れないように切り詰める。 */
const TITLE_MAX_LENGTH = 120

/** JSTのUTCオフセット（秒）。Chatworkの期限はJSTで設定される前提の変換に使う。 */
const JST_OFFSET_SECONDS = 9 * 60 * 60

interface ChatworkRoom {
  room_id: number
  name?: string
  type?: 'my' | 'direct' | 'group'
  role?: 'admin' | 'member' | 'readonly'
}

interface ChatworkTask {
  task_id: number
  account?: { account_id?: number }
  assigned_by_account?: { account_id?: number }
  message_id?: string
  body?: string
  limit_time?: number
  limit_type?: 'none' | 'date' | 'time'
  status?: 'open' | 'done'
}

/**
 * `limit_time`(UNIX秒) を **JSTの暦日** 'YYYY-MM-DD' に落とす。
 *
 * オフセットを足してから UTC 成分を読む（`toISOString` の先頭10文字）ことで、実行環境の
 * タイムゾーンに一切依存させない。本番(UTC)とローカル(JST)で結果が変わらないことが要点で、
 * ローカル時刻APIを使うとCI(UTC)で1日ずれる（[[jst-date-needs-jstnow]] と同じ罠）。
 */
function toJstDateString(limitTime: number | undefined, limitType: string | undefined): string | null {
  if (limitType === 'none' || limitType === undefined) return null
  if (!limitTime || !Number.isFinite(limitTime) || limitTime <= 0) return null
  return new Date((limitTime + JST_OFFSET_SECONDS) * 1000).toISOString().slice(0, 10)
}

/** ホストポリシーを通した固定ホスト配下のURLを組み立てる。 */
function buildUrl(path: string, params?: Record<string, string>): string {
  const base = requireBaseUrl(HOST_POLICY, null, 'chatwork')
  const url = new URL(path, base)
  for (const [key, value] of Object.entries(params ?? {})) url.searchParams.set(key, value)
  assertAllowedHost(HOST_POLICY, url.toString(), 'chatwork')
  return url.toString()
}

/**
 * 429/503 の復帰時刻を ms に変換する。Chatworkは `X-RateLimit-Reset`（UNIX秒）を返す。
 * 標準の `Retry-After`（秒）にも対応する。
 */
function retryAfterMsFrom(headers: Headers | undefined): number | undefined {
  if (!headers) return undefined
  const reset = headers.get('X-RateLimit-Reset')
  if (reset) {
    const ms = Number(reset) * 1000 - Date.now()
    if (Number.isFinite(ms) && ms > 0) return ms
  }
  const retryAfter = headers.get('Retry-After')
  if (retryAfter) {
    const sec = Number(retryAfter)
    if (Number.isFinite(sec) && sec > 0) return sec * 1000
  }
  return undefined
}

/** 例外の種別だけを安全に文字列化する（message に外部情報が混ざり得るため使わない）。 */
function errName(err: unknown): string {
  return err instanceof Error ? err.name : 'UnknownError'
}

/**
 * 共通 fetch。失敗時は status（と 429 の復帰時刻）を載せた ProviderError を投げる
 * （エンジンが 400/404/422=恒久失敗、それ以外=一時失敗に分類する。Backlog/Jooto と同じ流儀）。
 * 応答本文はログに出さない（顧客データが載り得るため）。`redirect: 'manual'` で転送を追わない。
 *
 * 204 No Content は本文が無いので `null` を返す（呼び出し側が空として扱う）。
 */
async function chatworkFetch(ctx: ProviderContext, url: string, init?: RequestInit): Promise<unknown> {
  const method = init?.method ?? 'GET'
  const headers: Record<string, string> = { 'X-ChatworkToken': ctx.credentials.token }
  if (init?.body) headers['Content-Type'] = 'application/x-www-form-urlencoded'

  let res: Response
  try {
    res = await fetch(url, {
      ...init,
      headers: { ...headers, ...(init?.headers as Record<string, string> | undefined) },
      redirect: 'manual',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  } catch (err) {
    throw providerError(`Chatwork API ${method} failed (network): ${errName(err)}`)
  }

  if (res.status >= 300 && res.status < 400) {
    // 正規のChatwork APIはリダイレクトを返さない。設定ミスか介在者であり、恒久失敗として止める。
    throw providerError(`Chatwork API ${method} unexpected redirect (${res.status})`, {
      status: 400,
      permanent: true,
    })
  }

  if (!res.ok) {
    console.error('Chatwork API error:', method, res.status) // 本文は出さない（顧客データが載り得る）
    throw providerError(`Chatwork API ${method} failed (${res.status})`, {
      status: res.status,
      retryAfterMs: res.status === 429 || res.status === 503 ? retryAfterMsFrom(res.headers) : undefined,
    })
  }

  // タスクが1件も無いチャットは 204（本文なし）。json() を呼ぶと例外になるためここで打ち切る。
  if (res.status === 204) return null

  return res.json()
}

/** 本文の1行目をタイトルにする（Chatworkのタスクはタイトルを持たないため）。 */
function toTitle(body: string): string {
  const firstLine = body.split('\n')[0]?.trim() ?? ''
  if (!firstLine) return '(無題)'
  return firstLine.length > TITLE_MAX_LENGTH ? firstLine.slice(0, TITLE_MAX_LENGTH) : firstLine
}

function normalizeTask(task: ChatworkTask, containerId: string): ExternalTask {
  const raw = typeof task.body === 'string' ? task.body : ''
  // 行ごとに末尾の空白を落としてから繋ぎ直す（Chatworkの本文は自由入力で末尾空白が入りやすい）
  const normalizedBody = raw
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .trim()
  const title = toTitle(normalizedBody)
  const assigneeId = task.account?.account_id

  return {
    externalId: String(task.task_id),
    containerId,
    title,
    // 1行だけのタスクはタイトルと同じ内容になるため本文を持たせない
    body: normalizedBody.includes('\n') ? normalizedBody : null,
    dueDate: toJstDateString(task.limit_time, task.limit_type),
    completed: task.status === 'done',
    assigneeKey: assigneeId != null ? String(assigneeId) : null,
    // 更新日時を返すフィールドがAPIに無い。「無い」ことを null で正直に表す。
    updatedAt: null,
  }
}

/** 指定ステータスのタスクを取得する（最大100件・ページング無し）。 */
async function fetchTasksByStatus(
  ctx: ProviderContext,
  containerId: string,
  status: 'open' | 'done',
): Promise<ChatworkTask[]> {
  const url = buildUrl(`/v2/rooms/${encodeURIComponent(containerId)}/tasks`, { status })
  const data = (await chatworkFetch(ctx, url)) as ChatworkTask[] | null
  return Array.isArray(data) ? data : []
}

export const chatworkTaskAdapter: TaskSyncAdapter = {
  id: 'chatwork',
  authKind: 'api_key',
  hostPolicy: HOST_POLICY,
  // 更新日時での絞り込みパラメータが無いため、エンジンは毎回取り直す前提になる。
  cursorGranularity: 'none',
  // 1回の応答が100件で打ち切られ得るため「今回の応答に無い＝削除された」と断定できない。
  // snapshot と宣言すると、101件目以降のタスクの対応をエンジンが誤って切ってしまう。
  deletionMode: 'unsupported',

  async listContainers(ctx: ProviderContext): Promise<ExternalContainer[]> {
    const url = buildUrl('/v2/rooms')
    const data = (await chatworkFetch(ctx, url)) as ChatworkRoom[] | null
    const rooms = Array.isArray(data) ? data : []
    return rooms
      // 閲覧のみの権限では完了の書き戻しができない＝必ず失敗する接続を作らせないため候補に出さない
      .filter((room) => room.role !== 'readonly')
      .map((room) => ({ id: String(room.room_id), title: room.name ?? String(room.room_id) }))
  },

  // 差分の起点(since)もページカーソルも使わない（APIに該当パラメータが無い）ため引数を受け取らない
  async listChangedTasks(ctx: ProviderContext, containerId: string): Promise<TaskPage> {
    // 未完了・完了を明示して2回取得する（省略時にどちらが返るかが仕様上あいまいなため、
    // 完了の取り込みを既定値任せにしない）。
    const open = await fetchTasksByStatus(ctx, containerId, 'open')
    const done = await fetchTasksByStatus(ctx, containerId, 'done')

    return {
      items: [...open, ...done].map((task) => normalizeTask(task, containerId)),
      // ページングが存在しないため次ページは常に無い
      nextCursor: null,
    }
  },

  async completeTask(ctx: ProviderContext, ref: { externalId: string; containerId: string }): Promise<void> {
    const url = buildUrl(
      `/v2/rooms/${encodeURIComponent(ref.containerId)}/tasks/${encodeURIComponent(ref.externalId)}/status`,
    )
    // このエンドポイントだけ JSON ではなくフォーム形式（body=done）
    await chatworkFetch(ctx, url, { method: 'PUT', body: 'body=done' })
  },
}
