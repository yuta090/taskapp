import { getGoogleTasksCredentials, getGoogleTasksRedirectUri } from './config'
import { refreshAccessToken } from '@/lib/google-calendar/client'

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const TASKS_API = 'https://tasks.googleapis.com/tasks/v1'

/** refresh は token endpoint が redirect_uri 非依存のため google-calendar の実装を再利用する。 */
export { refreshAccessToken }

interface GoogleTokenResponse {
  access_token: string
  refresh_token?: string
  expires_in: number
  scope: string
  token_type: string
}

/** Google Tasks の task リソース(必要フィールドのみ)。 */
export interface GoogleTask {
  id: string
  title?: string
  notes?: string
  status?: 'needsAction' | 'completed'
  due?: string
  completed?: string
  updated?: string
  deleted?: boolean
}

/**
 * 認可コードをトークンに交換。google-sheets/client と同形で redirect_uri のみ google_tasks 用。
 * トークンはログ出力しない。
 */
export async function exchangeGoogleTasksCode(code: string): Promise<{
  accessToken: string
  refreshToken: string | null
  expiresAt: Date
  scopes: string
}> {
  const { clientId, clientSecret } = getGoogleTasksCredentials()
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      grant_type: 'authorization_code',
      redirect_uri: getGoogleTasksRedirectUri(),
    }),
  })

  if (!response.ok) {
    const errorBody = await response.text()
    console.error('Google Tasks token exchange failed:', response.status, errorBody)
    throw new Error(`Google Tasks token exchange failed (${response.status})`)
  }

  const data: GoogleTokenResponse = await response.json()
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? null,
    expiresAt: new Date(Date.now() + data.expires_in * 1000),
    scopes: data.scope,
  }
}

/** date列(YYYY-MM-DD)を Google Tasks の due(RFC3339・UTC0時)へ。時刻はどのみち破棄される。 */
export function dateToGoogleDue(date: string | null | undefined): string | null {
  if (!date) return null
  return `${date}T00:00:00.000Z`
}

/**
 * 共通 fetch。失効(401/403)と一時障害(5xx等)を呼び出し側(token-manager)が分類できるよう、
 * 失敗時は HTTP status を error.status に載せて throw する(google-calendar/client と同じ流儀)。
 */
async function tasksFetch(accessToken: string, path: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(`${TASKS_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...init?.headers,
    },
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    const err = new Error(`Google Tasks API ${init?.method ?? 'GET'} ${path} failed (${res.status})`) as Error & {
      status?: number
    }
    err.status = res.status
    console.error('Google Tasks API error:', res.status, body.slice(0, 200))
    throw err
  }
  return res
}

/**
 * 指定名のタスクリストを確保する(あれば既存ID、無ければ作成)。ミラー先は専用リスト1つ。
 * 同名が複数あった場合は先頭(最古)を採用する。
 */
export async function ensureTaskList(accessToken: string, title: string): Promise<string> {
  const res = await tasksFetch(accessToken, `/users/@me/lists?maxResults=100`)
  const data = (await res.json()) as { items?: Array<{ id: string; title: string }> }
  const found = (data.items ?? []).find((l) => l.title === title)
  if (found) return found.id

  const created = await tasksFetch(accessToken, `/users/@me/lists`, {
    method: 'POST',
    body: JSON.stringify({ title }),
  })
  const list = (await created.json()) as { id: string }
  return list.id
}

/**
 * タスクリスト内のタスクを取得する。逆流ポーリング用に updatedMin/showCompleted/showHidden を使う。
 * 完了タスクや隠しタスクも取りたいので showCompleted/showHidden は既定 true。
 */
export async function listTasks(
  accessToken: string,
  tasklistId: string,
  opts: { updatedMin?: string; pageToken?: string; maxResults?: number },
): Promise<{ items: GoogleTask[]; nextPageToken: string | null }> {
  const params = new URLSearchParams({
    showCompleted: 'true',
    showHidden: 'true',
    maxResults: String(opts.maxResults ?? 100),
  })
  if (opts.updatedMin) params.set('updatedMin', opts.updatedMin)
  if (opts.pageToken) params.set('pageToken', opts.pageToken)

  const res = await tasksFetch(accessToken, `/lists/${tasklistId}/tasks?${params.toString()}`)
  const data = (await res.json()) as { items?: GoogleTask[]; nextPageToken?: string }
  return { items: data.items ?? [], nextPageToken: data.nextPageToken ?? null }
}

export interface TaskWriteFields {
  title?: string
  notes?: string
  due?: string | null
  status?: 'needsAction' | 'completed'
}

/** タスクを作成する。 */
export async function insertTask(
  accessToken: string,
  tasklistId: string,
  fields: TaskWriteFields,
): Promise<GoogleTask> {
  const res = await tasksFetch(accessToken, `/lists/${tasklistId}/tasks`, {
    method: 'POST',
    body: JSON.stringify(pruneUndefined(fields as Record<string, unknown>)),
  })
  return (await res.json()) as GoogleTask
}

/** タスクを部分更新する(渡したフィールドだけ)。 */
export async function patchTask(
  accessToken: string,
  tasklistId: string,
  taskId: string,
  patch: TaskWriteFields,
): Promise<GoogleTask> {
  const res = await tasksFetch(accessToken, `/lists/${tasklistId}/tasks/${taskId}`, {
    method: 'PATCH',
    body: JSON.stringify(pruneUndefined(patch as Record<string, unknown>)),
  })
  return (await res.json()) as GoogleTask
}

/** タスクを削除する。既に無い(404)場合は冪等に成功扱いする。 */
export async function deleteTask(accessToken: string, tasklistId: string, taskId: string): Promise<void> {
  const res = await fetch(`${TASKS_API}/lists/${tasklistId}/tasks/${taskId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (res.ok || res.status === 404) return
  const body = await res.text().catch(() => '')
  const err = new Error(`Google Tasks API DELETE failed (${res.status})`) as Error & { status?: number }
  err.status = res.status
  console.error('Google Tasks API error:', res.status, body.slice(0, 200))
  throw err
}

/** undefined のキーを落とす(JSON に undefined を送らないため)。 */
function pruneUndefined(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v
  }
  return out
}
