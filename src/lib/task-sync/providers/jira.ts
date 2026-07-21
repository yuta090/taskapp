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
 * Jira Cloud アダプタ。
 *
 * 調査で確定した事実（出典と確認方法）:
 *   - 検索は新エンドポイント `/rest/api/3/search/jql` を使う。旧 `/rest/api/{2,3}/search` は
 *     公式OpenAPI仕様(https://developer.atlassian.com/cloud/jira/platform/swagger.v3.json、
 *     2026-07-21取得)で `deprecated: true`（削除告知 CHANGE-2046 へのリンク付き）。
 *     ページングは `startAt` ではなく不透明な `nextPageToken`
 *     （レスポンス `{ issues, isLast, nextPageToken }`。`nextPageToken` は7日で失効）。
 *     ⚠未確認: `/rest/api/2/search/jql` は実インスタンス(jira.atlassian.com)で404だったが
 *     `/rest/api/3/search/jql` はパーミッションリダイレクト(302, 404ではない=ルート自体は存在)
 *     だったため、本アダプタは一貫して `/rest/api/3/` を使う（v2は使わない）。
 *   - 差分の起点(since)はJQLの**相対期間リテラル**('-NNm')で渡す。絶対日時リテラル
 *     ('yyyy-MM-dd HH:mm')はタイムゾーン表記を受け付けず、サフィックス無しの文字列は
 *     Jiraサイト/ユーザーのタイムゾーンの壁時計時刻として解釈される。保存カーソルはUTCのため、
 *     サイトがUTCより西だと実効下限が数時間「後ろ」へずれ、その間の更新を恒久的に取りこぼす
 *     （codexレビューで指摘・実インスタンスで再現確認）。相対期間リテラルは「クエリ実行時の
 *     nowからの経過時間」で評価されタイムゾーンを経由しないため、これで取りこぼしを解消した
 *     （詳細は `toJqlRelativeMinutes` のコメント参照）。
 *   - 完了判定は `fields.status.statusCategory.key === 'done'`。実運用インスタンス
 *     (https://jira.atlassian.com、匿名アクセス可能な公開Jira)の
 *     `/rest/api/2/statuscategory` を実クエリして確認: undefined(1)/new(2)/indeterminate(4)/
 *     done(3) の4種がテナント非依存の固定語彙。ステータス"名前"はワークフローごとに自由定義の
 *     ため名前での判定は不可（Backlogのカスタムステータスとは違い、こちらは真にテナント非依存
 *     なので接続設定での上書きは用意しない）。
 *   - `fields.duedate` は実データ確認(jira.atlassian.com CONFCLOUD-83942, duedate:"2026-04-28")
 *     の通り、時刻を持たない 'YYYY-MM-DD' 文字列。Dateを経由しない防御的な検証だけ行う
 *     （toISOString の禁止と同じ理由）。
 *   - 担当者は `fields.assignee.accountId`（公式スキーマ `User.accountId` で確認）。
 *     ⚠未確認: ごく古い/GDPR移行前のテナントでは `accountId` が無く `name`/`key` のみの
 *     場合が実データで観測できた（jira.atlassian.comの一部レガシー課題）。フォールバックする。
 *   - 完了の書き戻しは transition API。遷移IDはワークフロー依存で固定値を打てないため、
 *     `GET /issue/{id}/transitions` で使える遷移一覧を取得し、
 *     `to.statusCategory.key === 'done'` な遷移を実行時に選んで `POST { transition: { id } }`
 *     する（公式スキーマ `IssueUpdateDetails.transition` で確認、成功時 204）。現在のワーク
 *     フロー上「完了」へ直接遷移できる経路が無い場合は、リトライしても解決しない
 *     （人がJira側で一段階進めるまで待つしかない）ため permanent な例外にして恒久失敗として扱う。
 *   - 認証は Basic（メール + APIトークン）。運用者が管理画面で自分で発行できるAPIトークン方式の
 *     方が「既存ツールに繋ぐ」までの摩擦が小さいため既定にした（OAuth 2.0(3LO)も存在し、
 *     cloudId解決 `GET https://api.atlassian.com/oauth/token/accessible-resources`（匿名で
 *     401が返ることを確認=エンドポイント自体は存在）や、ベースURLが
 *     `https://api.atlassian.com/ex/jira/{cloudId}` になること（公式仕様の例示URLで確認）は
 *     裏取りできたが、本アダプタでは未実装＝将来の拡張）。
 *   - `ProviderCredentials` にBasic認証のユーザー名(メール)を置く場所が無いため、秘匿値ではない
 *     可視設定として `config.jira_email` に置く契約にした（Asanaアダプタの
 *     `config.asana_workspace_gid` と同じ考え方。接続作成UI側でこの値を import_config に
 *     書く配線が別途必要＝未実装・要フォロー）。
 *   - 削除の検知: `/search/jql` のレスポンススキーマに tombstone / trashed 相当のフィールドが
 *     存在しない（削除された課題は結果から単に消えるだけ）。判別できないため `deletionMode` は
 *     'unsupported' とする。
 */

/** 1ページの取得件数。Jira `/search/jql` の既定は50だが、他アダプタ(Backlog/Asana)に合わせ100にする。 */
const PAGE_SIZE = 100

/** リクエストのタイムアウト。応答しないホストにワーカーを占有させない。 */
const REQUEST_TIMEOUT_MS = 20_000

/** ワークフロー非依存の「完了」ステータスカテゴリキー。 */
const DONE_STATUS_CATEGORY_KEY = 'done'

/** listChangedTasks で取得するフィールド。fieldsを絞ってペイロードを減らす。 */
const ISSUE_FIELDS = ['summary', 'description', 'duedate', 'assignee', 'status', 'updated']

/**
 * 接続先として許すドメイン。*.atlassian.net 配下のみ。判定（ドット境界一致・https限定・
 * userinfo拒否・ポート制限）は全アダプタ共通の hostPolicy.ts に集約してある。
 */
const JIRA_HOST_POLICY = {
  kind: 'vendor-domain',
  allowedSuffixes: ['.atlassian.net'],
} as const satisfies HostPolicy

interface JiraProject {
  id: string
  key?: string
  name?: string
  archived?: boolean
}

interface JiraProjectSearchResponse {
  values?: JiraProject[]
  isLast?: boolean
}

interface JiraUser {
  accountId?: string
  key?: string
  name?: string
}

interface JiraIssueFields {
  summary?: string
  description?: string | null
  duedate?: string | null
  assignee?: JiraUser | null
  status?: { statusCategory?: { key?: string } } | null
  updated?: string | null
}

interface JiraIssue {
  id: string
  fields: JiraIssueFields
}

interface JiraSearchResponse {
  issues?: JiraIssue[]
  isLast?: boolean
  nextPageToken?: string | null
}

interface JiraTransition {
  id: string
  to?: { statusCategory?: { key?: string } }
}

interface JiraTransitionsResponse {
  transitions?: JiraTransition[]
}

/** Basic認証のユーザー名(メール)を接続設定から取り出す。未設定は配線ミスとして弾く。 */
function jiraEmail(ctx: ProviderContext): string {
  const raw = ctx.config?.jira_email
  if (typeof raw !== 'string' || raw.length === 0) {
    throw providerError('jira: config.jira_email (Basic認証のメールアドレス) が設定されていない接続です', {
      status: 400,
      permanent: true,
    })
  }
  return raw
}

/** `Basic base64(email:apiToken)` ヘッダ値を組み立てる。 */
function authHeader(ctx: ProviderContext): string {
  const basic = Buffer.from(`${jiraEmail(ctx)}:${ctx.credentials.token}`).toString('base64')
  return `Basic ${basic}`
}

/** サイトURL配下の `/rest/api/3` 配下URLを組み立てる。ホスト検証をここで必ず通す。 */
function apiUrl(ctx: ProviderContext, path: string, params?: Record<string, string>): string {
  const base = requireBaseUrl(JIRA_HOST_POLICY, ctx.credentials.baseUrl, 'jira')
  const origin = assertAllowedHost(JIRA_HOST_POLICY, base, 'jira')
  const url = new URL(`/rest/api/3${path}`, origin.origin)
  for (const [key, value] of Object.entries(params ?? {})) {
    url.searchParams.set(key, value)
  }
  return url.toString()
}

/**
 * 429 の復帰時刻を ms に変換する。標準の `Retry-After`（秒）に対応する
 * （Jira固有のレート制限ヘッダは未確認のため、汎用ヘッダのみ対応する）。
 * 取れなければ undefined（呼び出し側の既定バックオフに委ねる）。
 */
function retryAfterMsFrom(headers: Headers | undefined): number | undefined {
  if (!headers) return undefined
  const retryAfter = headers.get('Retry-After')
  if (retryAfter) {
    const sec = Number(retryAfter)
    if (Number.isFinite(sec) && sec > 0) return sec * 1000
  }
  return undefined
}

/** 例外の種別だけを安全に文字列化する（message に外部の応答本文が混ざり得るため使わない）。 */
function errName(err: unknown): string {
  return err instanceof Error ? err.name : 'UnknownError'
}

/**
 * 共通 fetch。失敗時は status（と 429 の復帰時刻）を載せた ProviderError を投げる
 * （エンジンが 400/404/422=恒久失敗、それ以外=一時失敗に分類する。Backlogアダプタと同じ流儀）。
 * 応答本文はログに出さない（本文に顧客の課題データが載り得るため）。
 * `redirect: 'manual'` で転送を追わない。3xx は失敗として扱う。
 */
async function jiraFetch(ctx: ProviderContext, url: string, init?: RequestInit): Promise<unknown> {
  const method = init?.method ?? 'GET'
  // config.jira_email 不備はここで同期的に投げる(ネットワーク層のtry/catchに混ぜて
  // temporary_fail化させない。requireBaseUrl/assertAllowedHostも同様に事前検証)。
  const authorization = authHeader(ctx)

  let res: Response
  try {
    res = await fetch(url, {
      ...init,
      redirect: 'manual',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: {
        Authorization: authorization,
        Accept: 'application/json',
        ...init?.headers,
      },
    })
  } catch (err) {
    throw providerError(`Jira API ${method} failed (network): ${errName(err)}`)
  }

  if (res.status >= 300 && res.status < 400) {
    // 正規のJira APIはリダイレクトを返さない。設定ミスか介在者であり、恒久失敗として止める。
    throw providerError(`Jira API ${method} unexpected redirect (${res.status})`, {
      status: 400,
      permanent: true,
    })
  }

  if (!res.ok) {
    console.error('Jira API error:', method, res.status) // 本文は出さない
    throw providerError(`Jira API ${method} failed (${res.status})`, {
      status: res.status,
      retryAfterMs: res.status === 429 ? retryAfterMsFrom(res.headers) : undefined,
    })
  }
  if (res.status === 204) return null
  return res.json()
}

/**
 * `fields.duedate` は既に時刻を持たない 'YYYY-MM-DD' 文字列で返る想定だが、防御的に先頭10文字を
 * 検証する（Backlog/Asanaと同じ考え方。Dateオブジェクトを経由しない＝toISOString由来の
 * タイムゾーンずれが原理的に起きない）。
 */
function toLocalDateString(due: string | null | undefined): string | null {
  if (!due) return null
  const head = due.slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(head) ? head : null
}

/**
 * エンジンから渡される `since`(UTCのISO8601、`cursorGranularity='timestamp'`)を、JQLの
 * **相対期間リテラル**('-NNm'。「クエリ実行時のnowからNN分前」)へ変換する。
 *
 * 【なぜ絶対日時リテラルを使わないか】JQLの絶対日時リテラル('yyyy-MM-dd HH:mm')は
 * **タイムゾーン表記を一切受け付けない**（実インスタンスで確認: '+0000'サフィックスを付けると
 * "Date value ... is invalid" で拒否される）。かつ、サフィックス無しの文字列は**Jiraサイト/
 * ユーザーのタイムゾーンの壁時計時刻**として解釈される。保存カーソルはUTCのため、サイトが
 * UTCより西（例: US/Pacific, UTC-8）だと実効下限が「後ろ」へ数時間ずれ、その間に更新された
 * 課題を取りこぼす。カーソルは前進する一方なので、この取りこぼしは**恒久的**（二度と拾えない）。
 *
 * 一方、JQLの相対期間リテラルは「クエリ実行時のnowからの経過時間」で評価され、タイムゾーンの
 * 概念を一切経由しない（実インスタンスで検証: '-10080m'（7日相当を分指定）と '-7d' が完全に
 * 同じ件数を返すことを確認済み＝壁時計変換を通っていない証拠）。絶対時刻の代わりにこちらを
 * 使うことで、タイムゾーン解釈の余地そのものを無くす。
 *
 * 経過分数は切り上げる（切り捨て/四捨五入だと、ネットワーク遅延やクロックずれで実際の経過分数
 * より短く見積もった場合にその差分だけ取りこぼす方向に倒れるため、常に多め＝安全側に倒す）。
 *
 * ⚠ ここで使う `Date.parse`/`Date.now()` は「絶対エポック値どうしの差分（経過時間）」の計算にの
 *   み使っており、CLAUDE.mdが禁止する「ローカル日付を文字列として切り出す」用途
 *   （toISOString().slice(0,10)等）ではない。経過時間の算出はタイムゾーンに依存しないため、
 *   toISOString禁止の趣旨（UTC変換によるローカル日付のずれ）には抵触しない。
 */
function toJqlRelativeMinutes(since: string): string {
  const elapsedMs = Math.max(0, Date.now() - Date.parse(since))
  const minutes = Math.max(1, Math.ceil(elapsedMs / 60_000))
  return `-${minutes}m`
}

/** プロジェクトを絞り込み、更新日時の昇順で取るJQLを組み立てる。 */
function buildJql(containerId: string, since?: string): string {
  const clauses = [`project = ${containerId}`]
  if (since) clauses.push(`updated >= "${toJqlRelativeMinutes(since)}"`)
  return `${clauses.join(' AND ')} ORDER BY updated ASC`
}

function normalizeIssue(issue: JiraIssue, containerId: string): ExternalTask {
  const categoryKey = issue.fields.status?.statusCategory?.key
  const assignee = issue.fields.assignee
  return {
    externalId: issue.id,
    containerId,
    title: issue.fields.summary?.trim() || '(無題)',
    body: issue.fields.description?.trim() ? issue.fields.description : null,
    dueDate: toLocalDateString(issue.fields.duedate),
    completed: categoryKey === DONE_STATUS_CATEGORY_KEY,
    assigneeKey: assignee?.accountId ?? assignee?.key ?? assignee?.name ?? null,
    updatedAt: issue.fields.updated ?? null,
  }
}

export const jiraAdapter: TaskSyncAdapter = {
  id: 'jira',
  authKind: 'api_key',
  hostPolicy: JIRA_HOST_POLICY,
  // updated が分粒度の日時で絞れるため。
  cursorGranularity: 'timestamp',
  // `/search/jql` は削除済み課題を単に返さなくなるだけで tombstone を返さない。
  deletionMode: 'unsupported',

  async listContainers(ctx: ProviderContext): Promise<ExternalContainer[]> {
    const containers: ExternalContainer[] = []
    let startAt = 0
    for (;;) {
      const page = (await jiraFetch(
        ctx,
        apiUrl(ctx, '/project/search', { startAt: String(startAt), maxResults: String(PAGE_SIZE) }),
      )) as JiraProjectSearchResponse
      const values = page.values ?? []
      for (const p of values) {
        // アーカイブ済みは運用が終わったプロジェクト。取り込み候補に出しても混乱するだけなので除く。
        if (p.archived) continue
        containers.push({ id: String(p.id), title: p.name || p.key || String(p.id) })
      }
      if (page.isLast || values.length === 0) break
      startAt += PAGE_SIZE
    }
    return containers
  },

  async listChangedTasks(
    ctx: ProviderContext,
    containerId: string,
    opts: { since?: string; cursor?: string },
  ): Promise<TaskPage> {
    const params: Record<string, string> = {
      jql: buildJql(containerId, opts.since),
      maxResults: String(PAGE_SIZE),
      fields: ISSUE_FIELDS.join(','),
    }
    if (opts.cursor) params.nextPageToken = opts.cursor

    const page = (await jiraFetch(ctx, apiUrl(ctx, '/search/jql', params))) as JiraSearchResponse
    const issues = page.issues ?? []
    return {
      items: issues.map((issue) => normalizeIssue(issue, containerId)),
      nextCursor: page.isLast ? null : (page.nextPageToken ?? null),
    }
  },

  async completeTask(ctx: ProviderContext, ref: { externalId: string; containerId: string }): Promise<void> {
    const transitionsRes = (await jiraFetch(
      ctx,
      apiUrl(ctx, `/issue/${encodeURIComponent(ref.externalId)}/transitions`),
    )) as JiraTransitionsResponse
    // 候補が複数(例:「完了」「対応不要」など done カテゴリの遷移が複数登録されたワークフロー)
    // あっても先頭を採用する。どれを選んでも遷移後の statusCategory は等しく 'done' になり、
    // 以後の完了判定(normalizeIssueの categoryKey==='done')には影響しないため、順序に実害は無い。
    // 候補が0件のときだけ後段で恒久失敗にする。
    const doneTransition = (transitionsRes.transitions ?? []).find(
      (t) => t.to?.statusCategory?.key === DONE_STATUS_CATEGORY_KEY,
    )
    if (!doneTransition) {
      // 現在のワークフロー上、いま居るステータスから直接「完了」へ遷移できる経路が無い
      // （例: 未着手→完了へは直接遷移できず、着手中を経由する必要があるワークフロー）。
      // リトライしても自動では解決しない(人がJira側で一段階進めるまで待つしかない)ため、
      // permanent な恒久失敗として扱う。
      throw providerError(
        `jira: issue ${ref.externalId} を完了にする遷移が見つからない（現在のステータスから「完了」へ直接遷移できないワークフロー）`,
        { status: 422, permanent: true },
      )
    }
    await jiraFetch(ctx, apiUrl(ctx, `/issue/${encodeURIComponent(ref.externalId)}/transitions`), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transition: { id: doneTransition.id } }),
    })
  },
}
