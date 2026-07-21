import { formatDateToLocalString } from '@/lib/gantt/dateUtils'
import { assertAllowedHost } from '@/lib/task-sync/hostPolicy'
import { providerError } from '@/lib/task-sync/types'
import type {
  ExternalContainer,
  ExternalTask,
  HostPolicy,
  ProviderContext,
  TaskPage,
  TaskSyncAdapter,
} from '@/lib/task-sync/types'

/**
 * Asana アダプタ。
 *
 * Asana API（OpenAPI定義 https://raw.githubusercontent.com/Asana/openapi/master/defs/asana_oas.yaml
 * を2026-07-21に取得して確認）の性質と、ここで吸収している差異:
 *   - ホストは固定（https://app.asana.com/api/1.0）。OAuthも存在するが、多テナントSaaSから
 *     繋ぐ場合は運用者ごとに自分で発行できる個人アクセストークン(PAT)の方が導入が速い
 *     （Backlogと同じ理由。OAuthは本番公開に審査が要り「まず繋ぐ」までの摩擦が大きい）。
 *     PATは `Authorization: Bearer` ヘッダで送る
 *     （`securitySchemes.personalAccessToken: {type: http, scheme: bearer}` で確認）。
 *   - `GET /tasks` は `modified_since`(ISO8601 datetime) で絞れる＝秒粒度。よって
 *     cursorGranularity='timestamp'（エンジン側 cursor.ts のコメントの想定と一致）。
 *   - ページングは `limit`(最大100) + 不透明 `offset`。`next_page` は limit を渡した時だけ
 *     レスポンスに載る（"This property is only present when a limit query parameter is
 *     provided"）ため limit は必ず渡す。
 *   - 完了は `completed`(boolean) で表現され、Backlogのようなテナント定義ステータスではない
 *     ため接続設定での上書きは不要。
 *   - 期日は `due_on`('YYYY-MM-DD' の日付のみ) と `due_at`(実時刻を持つISO8601) の2種類があり、
 *     互いに排他（"should not be used together"）。`due_on` はそのままローカル日付として使えるが、
 *     `due_at` は実際の時刻を持つため素朴に先頭10文字を切るとUTC日付になり日本時間で1日ずれる
 *     （CLAUDE.md の toISOString 禁止と同じ理由）。`due_at` しか無い場合だけ Date を経由し
 *     formatDateToLocalString でローカル日付に変換する。
 *   - `GET /projects` はワークスペース単位。PATは複数ワークスペースに跨りうるため、
 *     どのワークスペースを見るかは接続ごとに固定する必要がある。ProviderCredentials に
 *     ワークスペースの置き場は無い（baseUrlはホスト可変ツール用でAsanaは固定ホスト）ため、
 *     接続ごとの可視設定である config.asana_workspace_gid で受ける。
 *   - 削除の検知: OpenAPI定義に tombstone / is_deleted 相当のフィールドが存在しない
 *     （grepで確認：ヒット無し）。削除されたタスクは `GET /tasks` の結果から単に消えるだけで
 *     判別できないため deletionMode='unsupported' と宣言する。
 *   - レート制限: SEO用meta description（`developers.asana.com/docs/rate-limits`、JSレンダリングで
 *     WebFetch非対応のため一次情報として採用）で「429 Too Many Requests のとき標準の Retry-After
 *     ヘッダ（秒）を返す」ことを確認。503は明記が無いが、一般的なHTTPの慣例として同じヘッダを
 *     見て安全側に倒す（有害な副作用は無い）。
 */

const API_BASE = 'https://app.asana.com/api/1.0'

/**
 * 接続先は固定ホスト1つだけ。資格情報をクエリで送るため（Trello）／ヘッダで送る場合でも、
 * 送信先が固定であることを実行時にも確かめる。判定は全アダプタ共通の hostPolicy.ts に集約。
 */
const ASANA_HOST_POLICY = { kind: 'fixed', host: 'app.asana.com' } as const satisfies HostPolicy

/** リクエストのタイムアウト。応答しないホストにワーカーを占有させない。 */
const REQUEST_TIMEOUT_MS = 20_000

/** 1ページの取得件数上限（Asana APIの上限）。 */
const PAGE_SIZE = 100

/**
 * listContainers のページ数上限（安全弁）。エンジン側 engine.ts の MAX_PAGES_PER_CONTAINER と
 * 同じ考え方: 異常応答でのカーソル無限前進/無限ループを防ぐ。listContainers はエンジンが
 * 「全部」として扱う（一部だけ返すと、そのプロジェクトは永久に取り込まれないまま接続は
 * 成功扱いになる）ため、素朴な1ページ目だけの実装は不可（codexレビュー指摘: 2ページ目以降の
 * プロジェクトが一度もエンジンに渡らない）。
 */
const MAX_CONTAINER_PAGES = 100

/** listChangedTasks で取得するフィールド。opt_fieldsを絞ってペイロードを減らす。 */
const TASK_OPT_FIELDS = 'name,notes,due_on,due_at,completed,assignee,modified_at'

interface AsanaProject {
  gid: string
  name?: string
  archived?: boolean
}

interface AsanaTask {
  gid: string
  name?: string
  notes?: string | null
  due_on?: string | null
  due_at?: string | null
  completed?: boolean
  assignee?: { gid?: string } | null
  modified_at?: string | null
}

interface AsanaListResponse<T> {
  data: T[]
  next_page?: { offset?: string } | null
}

/** 接続設定から見るべきワークスペースGIDを取り出す。未設定は配線ミスとして弾く（Backlogのbaseurlガードと同じ流儀）。 */
function workspaceGid(ctx: ProviderContext): string {
  const raw = ctx.config?.asana_workspace_gid
  if (typeof raw !== 'string' || raw.length === 0) {
    // 設定不備は再試行しても直らない＝permanent。バックオフで叩き続けさせない。
    throw providerError('asana: config.asana_workspace_gid が設定されていない接続です', {
      permanent: true,
      status: 400,
    })
  }
  return raw
}

/**
 * 期日を必ずローカル日付 'YYYY-MM-DD' へ落とす。`due_on` は日付のみの値なのでそのまま使う。
 * `due_at` は実時刻を持つため Date を経由して formatDateToLocalString でローカル日付化する
 * （toISOString().slice(0,10) は使わない＝UTC切り出しで日本時間の日付とずれる事故を防ぐ）。
 */
function toLocalDateString(dueOn: string | null | undefined, dueAt: string | null | undefined): string | null {
  if (dueOn) return dueOn
  if (!dueAt) return null
  return formatDateToLocalString(new Date(dueAt))
}

function apiUrl(path: string, params?: Record<string, string>): string {
  const url = new URL(`${API_BASE}${path}`)
  // 固定ホストであることを実行時にも確認する（定数の書き換えや将来の設定化に対する保険）。
  assertAllowedHost(ASANA_HOST_POLICY, url.toString(), 'asana')
  for (const [key, value] of Object.entries(params ?? {})) {
    url.searchParams.set(key, value)
  }
  return url.toString()
}

/**
 * 共通 fetch。失敗時は providerError で status（と429の復帰時刻）を載せて throw する
 * （エンジンが 400/404/422=恒久失敗、他=一時失敗に分類する。Backlogアダプタと同じ流儀）。
 *
 * トークンはヘッダに載るためURL自体に秘密は無いが、URLにはプロジェクトIDなど顧客の情報が乗る。
 * 応答本文はさらに顧客データそのものなので、どちらもログにも例外メッセージにも出さない。
 * `redirect: 'manual'` で転送を追わない（転送先へ Authorization ヘッダを渡さないため）。
 */
async function asanaFetch(ctx: ProviderContext, url: string, init?: RequestInit): Promise<unknown> {
  const method = init?.method ?? 'GET'
  let res: Response
  try {
    res = await fetch(url, {
      ...init,
      redirect: 'manual',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: {
        Authorization: `Bearer ${ctx.credentials.token}`,
        ...init?.headers,
      },
    })
  } catch (err) {
    throw providerError(`Asana API ${method} failed (network): ${err instanceof Error ? err.name : 'Unknown'}`)
  }

  if (res.status >= 300 && res.status < 400) {
    throw providerError(`Asana API ${method} unexpected redirect (${res.status})`, {
      status: 400,
      permanent: true,
    })
  }
  if (!res.ok) {
    console.error('Asana API error:', method, res.status) // 本文とURLは出さない
    throw providerError(`Asana API ${method} failed (${res.status})`, {
      status: res.status,
      retryAfterMs: res.status === 429 || res.status === 503 ? retryAfterMsFrom(res.headers) : undefined,
    })
  }
  return res.json()
}

/** 429/503 の復帰待ち時間。Asana は `Retry-After`（秒）を返す（rate-limits doc で確認）。 */
function retryAfterMsFrom(headers: Headers | undefined): number | undefined {
  const raw = headers?.get('Retry-After')
  if (!raw) return undefined
  const sec = Number(raw)
  return Number.isFinite(sec) && sec > 0 ? sec * 1000 : undefined
}

function normalizeTask(task: AsanaTask, containerId: string): ExternalTask {
  return {
    externalId: task.gid,
    containerId,
    title: task.name?.trim() || '(無題)',
    body: task.notes?.trim() ? task.notes : null,
    dueDate: toLocalDateString(task.due_on, task.due_at),
    completed: task.completed === true,
    assigneeKey: task.assignee?.gid ?? null,
    updatedAt: task.modified_at ?? null,
  }
}

export const asanaAdapter: TaskSyncAdapter = {
  id: 'asana',
  authKind: 'api_key',
  hostPolicy: ASANA_HOST_POLICY,
  // modified_since が秒粒度のISO8601のため（エンジン側 cursor.ts の想定と一致）。
  cursorGranularity: 'timestamp',
  // tombstone/is_deleted相当のフィールドが定義に存在しない（削除タスクは一覧から単に消える）。
  deletionMode: 'unsupported',

  async listContainers(ctx: ProviderContext): Promise<ExternalContainer[]> {
    const workspace = workspaceGid(ctx)
    const projects: AsanaProject[] = []
    let offset: string | undefined
    for (let page = 0; page < MAX_CONTAINER_PAGES; page++) {
      const params: Record<string, string> = {
        workspace,
        archived: 'false',
        // next_page は limit を渡した時だけレスポンスに載る（listChangedTasksと同じ理由）。
        limit: String(PAGE_SIZE),
      }
      if (offset) params.offset = offset
      const res = (await asanaFetch(ctx, apiUrl('/projects', params))) as AsanaListResponse<AsanaProject>
      projects.push(...(res.data ?? []))

      const nextOffset = res.next_page?.offset
      if (!nextOffset || nextOffset === offset) break // 取り切り、または前進しない異常応答＝打ち切る
      offset = nextOffset
    }
    return projects.map((p) => ({ id: p.gid, title: p.name ?? p.gid }))
  },

  async listChangedTasks(
    ctx: ProviderContext,
    containerId: string,
    opts: { since?: string; cursor?: string },
  ): Promise<TaskPage> {
    const params: Record<string, string> = {
      project: containerId,
      limit: String(PAGE_SIZE),
      opt_fields: TASK_OPT_FIELDS,
    }
    if (opts.since) params.modified_since = opts.since
    if (opts.cursor) params.offset = opts.cursor

    const res = (await asanaFetch(ctx, apiUrl('/tasks', params))) as AsanaListResponse<AsanaTask>
    return {
      items: (res.data ?? []).map((t) => normalizeTask(t, containerId)),
      nextCursor: res.next_page?.offset ?? null,
    }
  },

  async completeTask(ctx: ProviderContext, ref: { externalId: string; containerId: string }): Promise<void> {
    await asanaFetch(ctx, apiUrl(`/tasks/${encodeURIComponent(ref.externalId)}`), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: { completed: true } }),
    })
  },
}
