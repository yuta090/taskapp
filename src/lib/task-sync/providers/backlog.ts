import {
  providerError,
  type ExternalContainer,
  type ExternalTask,
  type ProviderContext,
  type TaskPage,
  type TaskSyncAdapter,
} from '@/lib/task-sync/types'

/**
 * Backlog（ヌーラボ）アダプタ — タスク同期アダプタ層の第1実装。
 *
 * 日本のSMB・受託で最も普及しているプロジェクト管理ツールであり、APIも素直なため
 * 抽象（TaskSyncAdapter）の検証台にする。
 *
 * Backlog API v2 の性質と、ここで吸収している差異:
 *   - ホストがテナントごとに可変（https://<スペース>.backlog.jp / .com / .backlogtool.com）。
 *     接続時に運用者が入力したスペースURLを credentials.baseUrl で受け取る。
 *     ⚠ 任意URLへ鍵付きリクエストを飛ばすため、baseUrl の検証（SSRF境界）は接続を作る側の責務。
 *       このアダプタは検証済みの baseUrl が渡る前提で動く。
 *   - 認証は APIキーをクエリ `apiKey=` で渡す方式（OAuth2 も存在するが、運用者が自分で発行できる
 *     APIキー方式の方が導入が速い＝「既に使っているツールに繋ぐ」までの摩擦が小さい）。
 *   - 差分は `updatedSince` で絞れるが **日付粒度**（YYYY-MM-DD）。時刻で絞れないため、
 *     取りこぼし防止のカーソル補正（前日から取り直す等）はエンジン側の責務とし、
 *     アダプタは渡された日付をそのまま使う（cursorGranularity='date' で宣言する）。
 *   - ページングは offset/count（count 最大100）。nextCursor には次の offset を文字列で入れる。
 *   - 「完了」はステータスIDで表現され、プロジェクトごとにカスタムステータスを定義できるため
 *     固定値で決め打ちできない。既定は標準の 4（完了）とし、接続設定
 *     `config.backlog_done_status_ids` で置き換えられるようにする。
 */

/** Backlog 標準の「完了」ステータスID。カスタムステータス運用のプロジェクトは設定で足す。 */
const DEFAULT_DONE_STATUS_ID = 4

/** 1ページの取得件数（Backlog APIの上限）。満杯なら次ページがあるとみなす。 */
const PAGE_SIZE = 100

/** リクエストのタイムアウト。応答しないホストにワーカーを占有させない。 */
const REQUEST_TIMEOUT_MS = 20_000

/**
 * 接続先として許すドメイン。APIキーがURLのクエリに載る認証方式のため、**送信先を間違えることが
 * そのまま鍵の漏洩になる**。接続作成時の検証だけに頼らない（DNSの再解決・過去に保存された行・
 * 別経路からの呼び出しがあるため、実際にリクエストを出すこの層が最後の砦）。
 */
const ALLOWED_HOST_SUFFIXES = ['.backlog.jp', '.backlog.com', '.backlogtool.com'] as const

/**
 * baseUrl が Backlog のスペースURLとして妥当かを検証し、正規化した origin を返す。
 * 妥当でなければ permanent なエラー（再試行しても直らない設定不備）を投げる。
 *
 * 弾く対象と理由:
 *   - https 以外 … 平文で鍵が流れる。
 *   - userinfo 付き（https://real.backlog.jp@evil.example) … 実際の接続先は evil.example。
 *   - 許可サフィックス外 … evil-backlog.jp や backlog.jp.evil.com のような紛らわしいドメインを含む。
 *     必ずドット境界で判定する（末尾一致だけだと evil-backlog.jp が通る）。
 *   - 非標準ポート … 正規のBacklogは443のみ。ポート指定は内部ネットワーク探索の手口でもある。
 */
function assertAllowedBacklogOrigin(baseUrl: string): URL {
  let url: URL
  try {
    url = new URL(baseUrl)
  } catch {
    throw providerError('backlog: スペースURLの形式が不正です', { permanent: true, status: 400 })
  }
  if (url.protocol !== 'https:') {
    throw providerError('backlog: スペースURLは https のみ許可します', { permanent: true, status: 400 })
  }
  if (url.username || url.password) {
    throw providerError('backlog: スペースURLに認証情報を含めることはできません', {
      permanent: true,
      status: 400,
    })
  }
  if (url.port && url.port !== '443') {
    throw providerError('backlog: スペースURLに非標準ポートは指定できません', {
      permanent: true,
      status: 400,
    })
  }
  const host = url.hostname.toLowerCase()
  if (!ALLOWED_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix) && host.length > suffix.length)) {
    throw providerError('backlog: Backlog のスペースURLではありません', { permanent: true, status: 400 })
  }
  return url
}

interface BacklogProject {
  id: number
  name?: string
  projectKey?: string
  archived?: boolean
}

interface BacklogIssue {
  id: number
  projectId?: number
  summary?: string
  description?: string | null
  dueDate?: string | null
  status?: { id?: number; name?: string } | null
  assignee?: { id?: number; name?: string } | null
  updated?: string | null
}

/**
 * 「完了とみなす」ステータスIDの集合（取り込み時の判定用）。
 *
 * 設定値は標準の完了(4)を**置き換えず足す**。カスタムステータスを1つ登録しただけで、
 * 標準の「完了」課題が未完了扱いに化けると、期限リマインドが完了済みの相手を催促してしまう。
 * 「完了に見えるものを見落とさない」側に倒すのが安全。
 */
function doneStatusIds(ctx: ProviderContext): number[] {
  const raw = ctx.config?.backlog_done_status_ids
  const extra = Array.isArray(raw)
    ? raw.filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
    : []
  return [...new Set([DEFAULT_DONE_STATUS_ID, ...extra])]
}

/**
 * TaskApp で完了したときに Backlog へ書き込むステータスID（書き戻し先）。
 *
 * 「完了とみなす集合」とは別の関心事なので別設定にする。集合の先頭を流用すると、
 * 配列の並び順という無関係な事情で書き込み先が決まってしまう。
 * ⚠ カスタムステータスはプロジェクト単位で定義されるため、複数プロジェクトを1接続で同期する場合、
 *   ここで指定したIDが対象プロジェクトに存在せず PATCH が 400 で恒久失敗し得る。接続設定UIで
 *   プロジェクトのステータス一覧（GET /projects/:id/statuses）から選ばせる必要がある（後続PR）。
 */
function completionStatusId(ctx: ProviderContext): number {
  const raw = ctx.config?.backlog_completion_status_id
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : DEFAULT_DONE_STATUS_ID
}

/**
 * Backlog の dueDate（'2026-07-31T00:00:00Z' 形式で返る日付項目）をローカル日付 'YYYY-MM-DD' へ。
 * 日付のみの意味しか持たないため先頭10文字を切り出す（Date を経由しない＝UTC変換で日本時間が
 * 1日ずれる事故が原理的に起きない。CLAUDE.md の toISOString 禁止と同じ理由）。
 */
function toLocalDateString(due: string | null | undefined): string | null {
  if (!due) return null
  const head = due.slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(head) ? head : null
}

/** スペースURL配下のAPI URLを組み立て、APIキーをクエリに載せる。ホスト検証をここで必ず通す。 */
function apiUrl(ctx: ProviderContext, path: string, params?: Record<string, string | string[]>): string {
  const base = ctx.credentials.baseUrl
  if (!base) {
    // 接続作成時に必須入力のため、ここに来るのは配線ミス。鍵を意図しないホストへ送らないよう即失敗させる。
    throw providerError('backlog: baseUrl (スペースURL) が設定されていない接続です', {
      permanent: true,
      status: 400,
    })
  }
  const origin = assertAllowedBacklogOrigin(base)
  const url = new URL(`/api/v2${path}`, origin.origin)
  url.searchParams.set('apiKey', ctx.credentials.token)
  for (const [key, value] of Object.entries(params ?? {})) {
    if (Array.isArray(value)) {
      for (const v of value) url.searchParams.append(key, v)
    } else {
      url.searchParams.set(key, value)
    }
  }
  return url.toString()
}

/**
 * 429/503 の復帰時刻を ms に変換する。Backlog は `X-RateLimit-Reset`（epoch秒）を返す。
 * 標準の `Retry-After`（秒）にも対応する。取れなければ undefined（呼び出し側の既定バックオフに委ねる）。
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

/**
 * 共通 fetch。失敗時は status（と 429 の復帰時刻）を載せた ProviderError を投げる
 * （エンジンが 400/404/422=恒久失敗、それ以外=一時失敗に分類する。既存 connectors/dispatch.ts の
 * classifyError と同じ流儀）。
 *
 * 鍵の扱い:
 *   - APIキーはURLのクエリに載るため、**URLをログにも例外メッセージにも出さない**。
 *   - 応答本文もログに出さない（外部が返す本文にはリクエストURL（=鍵）や顧客データが載り得る）。
 *   - `redirect: 'manual'` で転送を追わない（転送先へ鍵を渡さないため）。3xx は失敗として扱う。
 */
async function backlogFetch(url: string, init?: RequestInit): Promise<unknown> {
  const method = init?.method ?? 'GET'
  let res: Response
  try {
    res = await fetch(url, {
      ...init,
      redirect: 'manual',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  } catch (err) {
    // ネットワーク断・タイムアウト。status を持たないため一時失敗として再試行に回る。
    // 例外の message に URL が含まれ得る実装があるため、こちらで作り直して鍵の露出経路を断つ。
    throw providerError(`Backlog API ${method} failed (network): ${errName(err)}`)
  }

  if (res.status >= 300 && res.status < 400) {
    // 正規のBacklog APIはリダイレクトを返さない。返るのは設定ミスか介在者であり、追跡すると
    // 鍵を転送先へ渡すことになる。恒久失敗として止める。
    throw providerError(`Backlog API ${method} unexpected redirect (${res.status})`, {
      status: 400,
      permanent: true,
    })
  }

  if (!res.ok) {
    console.error('Backlog API error:', method, res.status) // 本文とURLは出さない
    throw providerError(`Backlog API ${method} failed (${res.status})`, {
      status: res.status,
      retryAfterMs: res.status === 429 || res.status === 503 ? retryAfterMsFrom(res.headers) : undefined,
    })
  }
  return res.json()
}

/** 例外の種別だけを安全に文字列化する（message に外部URLや鍵が混ざり得るため使わない）。 */
function errName(err: unknown): string {
  return err instanceof Error ? err.name : 'UnknownError'
}

function normalizeIssue(issue: BacklogIssue, containerId: string, doneIds: number[]): ExternalTask {
  const statusId = issue.status?.id
  return {
    externalId: String(issue.id),
    containerId,
    title: issue.summary?.trim() || '(無題)',
    body: issue.description?.trim() ? issue.description : null,
    dueDate: toLocalDateString(issue.dueDate),
    completed: typeof statusId === 'number' && doneIds.includes(statusId),
    assigneeKey: issue.assignee?.id != null ? String(issue.assignee.id) : null,
    updatedAt: issue.updated ?? null,
  }
}

export const backlogAdapter: TaskSyncAdapter = {
  id: 'backlog',
  authKind: 'api_key',
  requiresBaseUrl: true,
  // updatedSince が日付粒度のため。エンジンは「前日から取り直す」補正でこの粒度を吸収する。
  cursorGranularity: 'date',
  // Backlog の課題一覧APIは削除済み課題を返さない（tombstone が無い）。差分に出てこないことを
  // 削除とみなすと、単に更新が無いだけの課題まで対応を切ってしまうため「知る手段なし」と宣言する。
  deletionMode: 'unsupported',

  async listContainers(ctx: ProviderContext): Promise<ExternalContainer[]> {
    const projects = (await backlogFetch(apiUrl(ctx, '/projects'))) as BacklogProject[] | null
    return (projects ?? [])
      // アーカイブ済みは運用が終わったプロジェクト。取り込み候補に出しても混乱するだけなので除く。
      .filter((p) => !p.archived)
      .map((p) => ({ id: String(p.id), title: p.name ?? p.projectKey ?? String(p.id) }))
  },

  async listChangedTasks(
    ctx: ProviderContext,
    containerId: string,
    opts: { since?: string; cursor?: string },
  ): Promise<TaskPage> {
    const params: Record<string, string | string[]> = {
      'projectId[]': [containerId],
      count: String(PAGE_SIZE),
      // ソート順の使い分け（offsetページングは「並びが動かない」前提が要るため）:
      //   - 差分取得(since あり): 更新日時の昇順。対象が狭く、ページ送り中の並び替えで
      //     取りこぼしても次サイクルの重なり(前日から再取得)で必ず拾い直せる。
      //   - 初回の全件取得(since なし): 作成順(=不変)の昇順。updated 昇順だとページ送り中に
      //     更新された課題が後方へ移動し、その分だけ未取得の課題が offset の前へ詰めて飛ばされる。
      //     初回に飛ばした古い課題は、以後の差分ウィンドウには二度と入らず恒久的に失われる。
      sort: opts.since ? 'updated' : 'created',
      order: 'asc',
    }
    if (opts.since) params.updatedSince = opts.since
    if (opts.cursor) params.offset = opts.cursor

    const issues = ((await backlogFetch(apiUrl(ctx, '/issues', params))) as BacklogIssue[] | null) ?? []
    const doneIds = doneStatusIds(ctx)
    const offset = opts.cursor ? Number(opts.cursor) : 0
    return {
      items: issues.map((i) => normalizeIssue(i, containerId, doneIds)),
      // 満杯なら次ページがある可能性がある。満たなければ取り切りとして打ち切る。
      nextCursor: issues.length === PAGE_SIZE ? String(offset + PAGE_SIZE) : null,
    }
  },

  async completeTask(ctx: ProviderContext, ref: { externalId: string; containerId: string }): Promise<void> {
    // 書き戻し先は専用設定（未設定なら標準の完了=4）。検知用の集合とは別物なので流用しない。
    const statusId = completionStatusId(ctx)
    await backlogFetch(apiUrl(ctx, `/issues/${encodeURIComponent(ref.externalId)}`), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ statusId: String(statusId) }).toString(),
    })
  },
}
