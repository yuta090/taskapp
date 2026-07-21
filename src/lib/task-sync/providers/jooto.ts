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
 * Jooto アダプタ。
 *
 * Jooto API（OpenAPI 3.0。公式リファレンス https://www.jooto.com/api/reference/ 配下、
 * 実体の仕様書は https://www.jooto.com/wp-content/uploads/2023/05/jooto-public-api.jp_.txt ）
 * の性質と、ここで吸収している差異:
 *   - ホストは固定 `https://api.jooto.com`（Backlog/Redmineと違いテナントごとに可変ではない）。
 *     `hostPolicy: { kind: 'fixed' }` で宣言し、接続時にURL入力は不要（credentials.baseUrl は無視）。
 *   - 認証は APIキー方式（ヘッダー `X-Jooto-Api-Key`）と OAuth2.0 の両方が提供されるが、
 *     運用者が自分で発行できるAPIキー方式の方が導入が速い（Backlogと同じ判断）ため、
 *     まずAPIキー方式のみ対応する。
 *   - コンテナは「プロジェクト」= `GET /v1/boards`。`archived` クエリで絞り込め、
 *     Backlogのアーカイブ済み除外と揃え `archived=false` を明示して未アーカイブのみ返す。
 *   - タスク一覧 `GET /v1/boards/{id}/tasks` には更新日時での差分取得パラメータが存在しない
 *     （締め切り日時の範囲 `deadline_since`/`deadline_until` はあるが、更新日時のフィルタは無い）。
 *     そのため `cursorGranularity='none'`（差分取得不可・毎回全件を取り直す）で宣言する。
 *     ソートを切り替える必要も無い（`order_by` パラメータ自体がこのエンドポイントには無く、
 *     Backlogのような「更新順ソートだと offset ページング中に取りこぼす」問題が起きる余地が無い）。
 *   - ページングは Backlogのoffsetと違い `page`/`per_page`。レスポンスの `total_pages` を見て
 *     現ページがそれ未満なら次ページありと判定する。
 *   - 「完了」は `status`（固定enum: to_do/done/cancel/pending/in_progress。Backlog/Redmineと
 *     違いプロジェクトごとの再定義ができない）で表現される。カスタマイズ不可のため config
 *     による上書き・追加は設けず `status==='done'` を完了と決め打ちする（'cancel' は
 *     「対応しない」であって「完了」ではないため含めない）。
 *   - タスクの `archived` は真の削除相当（API上「アーカイブ→削除」の2段階でしか消せない仕様）。
 *     毎回全件（アーカイブ済み含む）を取得しているため、この値は差分取得のたびに確実に得られる
 *     per-item の削除シグナルとして扱える → `deletionMode: 'tombstone'`。
 *     （ただしアーカイブは取り消し可能な操作であり、後で非アーカイブに戻る可能性がある点は
 *     エンジン側で「一度orphan化した対応の復活」を考慮する余地として残る）。
 *   - 期日は `deadline_date_time`（ISO8601日時）で返る。⚠ 未確認: この項目が常に日付相当
 *     （時刻部分に意味を持たない）なのか、実際に時刻を持つ締切なのかは公式ドキュメントに
 *     具体例が無く確認できていない。Google Tasks連携(`google-tasks/client.ts`)やBacklogと同じ
 *     「先頭10文字を切り出す」方式にするが、後者だった場合UTC変換で日本時間がずれる可能性が
 *     ある（要実機確認）。
 *   - レート制限ヘッダーは `X-RateLimit-Reset`（UNIX時間・秒）で、Backlogと同形式のため
 *     同じ変換ロジックを使う。
 *   - 書き込みは `application/json`（Backlogの`x-www-form-urlencoded`とは異なる）。
 *   - `listContainers`（ボード一覧）は `total_pages` を見て**全ページ**を取り切る。1ページ目
 *     しか取らないと、2ページ目以降のボードがエンジンに一度も渡らないまま「同期成功」として
 *     カーソルが前進し、特定プロジェクトだけ永久に取り込まれない事故になるため。
 */

/** ホストが固定であることの宣言。credentials.baseUrl は無視する（接続時に入力させない）。 */
const HOST_POLICY: HostPolicy = { kind: 'fixed', host: 'api.jooto.com' }

/** 1ページの取得件数。ドキュメントに上限記載は無いが、他アダプタと揃えて100件にする。 */
const PAGE_SIZE = 100

/** リクエストのタイムアウト。応答しないホストにワーカーを占有させない。 */
const REQUEST_TIMEOUT_MS = 20_000

/** listContainers の全ページ取得における安全弁（無限ループ防止。10万件相当まで許容）。 */
const MAX_CONTAINER_PAGES = 1000

interface JootoBoard {
  id: number
  title?: string
  archived?: boolean
}

interface JootoTask {
  id: number
  name?: string
  description?: string | null
  assigned_user_ids?: number[]
  deadline_date_time?: string | null
  status?: 'to_do' | 'done' | 'cancel' | 'pending' | 'in_progress'
  archived?: boolean
  updated_at?: string | null
}

/**
 * Jooto の deadline_date_time（ISO8601日時）をローカル日付 'YYYY-MM-DD' へ。
 * 先頭10文字を切り出すだけ（Date を経由しない＝ CLAUDE.md の toISOString 禁止と同じ理由）。
 */
function toLocalDateString(due: string | null | undefined): string | null {
  if (!due) return null
  const head = due.slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(head) ? head : null
}

/** ホストポリシーを通した固定ホスト配下のURLを組み立てる。 */
function buildUrl(path: string, params?: Record<string, string>): string {
  const base = requireBaseUrl(HOST_POLICY, null, 'jooto')
  const url = new URL(path, base)
  for (const [key, value] of Object.entries(params ?? {})) url.searchParams.set(key, value)
  assertAllowedHost(HOST_POLICY, url.toString(), 'jooto')
  return url.toString()
}

/**
 * 429/503 の復帰時刻を ms に変換する。Jootoは `X-RateLimit-Reset`（UNIX時間・秒）を返す
 * （Backlogと同形式）。標準の `Retry-After`（秒）にも対応する。
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
 * （エンジンが 400/404/422=恒久失敗、それ以外=一時失敗に分類する。Backlogと同じ流儀）。
 * ホストは固定のため鍵の誤送信リスクは無いが、応答本文はログに出さない
 * （顧客データが載り得るため）。`redirect: 'manual'` で転送を追わない。
 */
async function jootoFetch(ctx: ProviderContext, url: string, init?: RequestInit): Promise<unknown> {
  const method = init?.method ?? 'GET'
  const headers: Record<string, string> = { 'X-Jooto-Api-Key': ctx.credentials.token }
  if (init?.body) headers['Content-Type'] = 'application/json'

  let res: Response
  try {
    res = await fetch(url, {
      ...init,
      headers: { ...headers, ...(init?.headers as Record<string, string> | undefined) },
      redirect: 'manual',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  } catch (err) {
    throw providerError(`Jooto API ${method} failed (network): ${errName(err)}`)
  }

  if (res.status >= 300 && res.status < 400) {
    // 正規のJooto APIはリダイレクトを返さない。設定ミスか介在者であり、恒久失敗として止める。
    throw providerError(`Jooto API ${method} unexpected redirect (${res.status})`, {
      status: 400,
      permanent: true,
    })
  }

  if (!res.ok) {
    console.error('Jooto API error:', method, res.status) // 本文は出さない（顧客データが載り得る）
    throw providerError(`Jooto API ${method} failed (${res.status})`, {
      status: res.status,
      retryAfterMs: res.status === 429 || res.status === 503 ? retryAfterMsFrom(res.headers) : undefined,
    })
  }
  return res.json()
}

function normalizeTask(task: JootoTask, containerId: string): ExternalTask {
  const assigneeId = task.assigned_user_ids?.[0]
  return {
    externalId: String(task.id),
    containerId,
    title: task.name?.trim() || '(無題)',
    body: task.description?.trim() ? task.description : null,
    dueDate: toLocalDateString(task.deadline_date_time),
    completed: task.status === 'done',
    // 真の削除相当が無いツールのため、アーカイブを削除の代理指標として扱う。
    deleted: task.archived === true,
    assigneeKey: assigneeId != null ? String(assigneeId) : null,
    updatedAt: task.updated_at ?? null,
  }
}

export const jootoAdapter: TaskSyncAdapter = {
  id: 'jooto',
  authKind: 'api_key',
  hostPolicy: HOST_POLICY,
  // 更新日時での差分取得パラメータが存在しないため。エンジンは毎回全件を取り直す前提になる。
  cursorGranularity: 'none',
  // 毎回全件（アーカイブ済み含む）を取得しており、archived フラグが per-item の削除シグナルとして
  // 確実に得られるため 'tombstone' で宣言する。
  deletionMode: 'tombstone',
  // Jooto は無料プランでAPI不可、標準プランは**月100回**が上限（ビジネスプランは無制限）。
  // 差分APIが無く毎回全件取得するため、1サイクルで 1(ボード一覧)+コンテナ数 回を消費する。
  // cron の既定(15分=月約2900回)で回すと数日で上限に達し、以後まったく同期できなくなる。
  // 1日1回（月約30回＋コンテナ数分）に抑えて、標準プランでも1か月持たせる。
  minPollIntervalMinutes: 24 * 60,

  async listContainers(ctx: ProviderContext): Promise<ExternalContainer[]> {
    // 全ページ取得する: 1ページ目だけだと2ページ目以降のボードがエンジンに一度も渡らないまま
    // 「同期成功」としてカーソルが前進し、特定プロジェクトだけ永久に取り込まれない事故になる
    // （codexレビュー指摘）。
    const boards: JootoBoard[] = []
    for (let page = 1; page <= MAX_CONTAINER_PAGES; page++) {
      const url = buildUrl('/v1/boards', { archived: 'false', per_page: String(PAGE_SIZE), page: String(page) })
      const data = (await jootoFetch(ctx, url)) as { boards?: JootoBoard[]; total_pages?: number } | null
      const batch = data?.boards ?? []
      // 空バッチは total_pages が不整合(異常応答)でも打ち切る合図にする。pageが進んでも
      // 中身が伸びない異常応答で無限ループしないための安全弁。
      if (batch.length === 0) break
      boards.push(...batch)
      const totalPages = data?.total_pages ?? page
      if (page >= totalPages) break
    }
    return boards.map((b) => ({ id: String(b.id), title: b.title ?? String(b.id) }))
  },

  async listChangedTasks(
    ctx: ProviderContext,
    containerId: string,
    opts: { since?: string; cursor?: string },
  ): Promise<TaskPage> {
    const page = opts.cursor ? Number(opts.cursor) : 1
    const url = buildUrl(`/v1/boards/${encodeURIComponent(containerId)}/tasks`, {
      per_page: String(PAGE_SIZE),
      page: String(page),
    })

    const data = (await jootoFetch(ctx, url)) as { tasks?: JootoTask[]; total_pages?: number } | null
    const tasks = data?.tasks ?? []
    const totalPages = data?.total_pages ?? 1
    return {
      items: tasks.map((t) => normalizeTask(t, containerId)),
      nextCursor: page < totalPages ? String(page + 1) : null,
    }
  },

  async completeTask(ctx: ProviderContext, ref: { externalId: string; containerId: string }): Promise<void> {
    const url = buildUrl(`/v1/boards/${encodeURIComponent(ref.containerId)}/tasks/${encodeURIComponent(ref.externalId)}`)
    await jootoFetch(ctx, url, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'done' }),
    })
  },
}
