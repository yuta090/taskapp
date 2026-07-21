import type {
  ExternalContainer,
  ExternalTask,
  ProviderContext,
  TaskPage,
  TaskSyncAdapter,
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

/** Backlog 標準の「完了」ステータスID。カスタムステータス運用のプロジェクトは設定で上書きする。 */
const DEFAULT_DONE_STATUS_ID = 4

/** 1ページの取得件数（Backlog APIの上限）。満杯なら次ページがあるとみなす。 */
const PAGE_SIZE = 100

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

/** 接続設定から「完了とみなすステータスID」を解決する。未設定・不正値なら標準の 4 に倒す。 */
function doneStatusIds(ctx: ProviderContext): number[] {
  const raw = ctx.config?.backlog_done_status_ids
  if (!Array.isArray(raw)) return [DEFAULT_DONE_STATUS_ID]
  const ids = raw.filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
  return ids.length > 0 ? ids : [DEFAULT_DONE_STATUS_ID]
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

/** スペースURL配下のAPI URLを組み立て、APIキーをクエリに載せる。 */
function apiUrl(ctx: ProviderContext, path: string, params?: Record<string, string | string[]>): string {
  const base = ctx.credentials.baseUrl
  if (!base) {
    // 接続作成時に必須入力のため、ここに来るのは配線ミス。鍵を意図しないホストへ送らないよう即失敗させる。
    throw new Error('backlog: baseUrl (スペースURL) が設定されていない接続です')
  }
  const url = new URL(`/api/v2${path}`, base)
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
 * 共通 fetch。失敗時は HTTP status を載せた例外を投げる（エンジンが 400/404/422=恒久失敗、
 * それ以外=一時失敗に分類する。既存 connectors/dispatch.ts の classifyError と同じ流儀）。
 * APIキーはURLに載るため、エラーログにURLを出さない。
 */
async function backlogFetch(url: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(url, init)
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    const err = new Error(`Backlog API ${init?.method ?? 'GET'} failed (${res.status})`) as Error & {
      status?: number
    }
    err.status = res.status
    console.error('Backlog API error:', res.status, body.slice(0, 200))
    throw err
  }
  return res.json()
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
      // 更新日時の昇順で取る。途中で失敗しても再開位置が単調に進む（カーソル前進の前提）。
      sort: 'updated',
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
    // 書き戻しに使う「完了」ステータスは、設定があればその先頭（運用上の完了状態）を使う。
    const statusId = doneStatusIds(ctx)[0]
    await backlogFetch(apiUrl(ctx, `/issues/${encodeURIComponent(ref.externalId)}`), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ statusId: String(statusId) }).toString(),
    })
  },
}
