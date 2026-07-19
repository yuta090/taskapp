/**
 * Google Tasks OAuth設定。
 *
 * 既存のGoogle OAuth基盤(google-calendar/client.tsのトークン交換・refresh)を再利用しつつ、
 * scope を tasks のみに絞ったOAuth開始URLを生成する。google_calendar と同じく **user 単位**接続。
 *
 * scope は `auth/tasks`(個人の全ToDoの読み書き)。sensitive scope で OAuth 審査対象。
 * 読み取り専用の tasks.readonly では逆流(完了検知)＋順方向書き込みが両立しないためフルスコープが要る。
 */

export const GOOGLE_TASKS_SCOPES = ['https://www.googleapis.com/auth/tasks']

const GOOGLE_OAUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'

/** ミラー先タスクリストの表示名。ユーザーの Google Tasks にこの名前のリストが1つ作られる。 */
export const GOOGLE_TASKS_LIST_TITLE = 'TaskApp'

/** OAuth クライアント資格情報(google_calendar/sheets と同じ Google クライアントを共用)。都度 env を読む。 */
export function getGoogleTasksCredentials(): { clientId: string; clientSecret: string } {
  return {
    clientId: process.env.GOOGLE_CLIENT_ID || '',
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
  }
}

export function isGoogleTasksOAuthConfigured(): boolean {
  const { clientId, clientSecret } = getGoogleTasksCredentials()
  return !!(clientId && clientSecret)
}

/**
 * UI表示のフィーチャーフラグ(client-side)。OAuth審査(sensitive scope)が通るまで本番では
 * NEXT_PUBLIC_GOOGLE_TASKS_ENABLED を立てず、接続UIを出さない。開発/テストでのみ有効化する。
 */
export function isGoogleTasksFeatureEnabled(): boolean {
  return process.env.NEXT_PUBLIC_GOOGLE_TASKS_ENABLED === 'true'
}

export function getGoogleTasksRedirectUri(): string {
  return `${process.env.NEXT_PUBLIC_APP_URL}/api/integrations/callback/google_tasks`
}

export function getGoogleTasksOAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: getGoogleTasksCredentials().clientId,
    redirect_uri: getGoogleTasksRedirectUri(),
    response_type: 'code',
    scope: GOOGLE_TASKS_SCOPES.join(' '),
    state,
    access_type: 'offline',
    prompt: 'consent',
  })
  return `${GOOGLE_OAUTH_URL}?${params.toString()}`
}
