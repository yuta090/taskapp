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
 * Linear アダプタ。
 *
 * 調査で確定した事実（出典と確認方法。すべて Linear が公開しているGraphQLスキーマ
 * https://raw.githubusercontent.com/linear/linear/master/packages/sdk/src/schema.graphql
 * ＝公式SDKに同梱された実APIから自動生成されたスキーマ定義。2026-07-21取得）:
 *   - APIは単一エンドポイント `https://api.linear.app/graphql`。実際に匿名/不正キーで叩くと
 *     GraphQLの「200+errors」ではなく素の HTTP 401 が返ることを確認済み
 *     （`extensions.http.status` にも同じ値が載る）。認証失敗は res.ok=false で拾える一方、
 *     クエリ自体のバリデーションエラー等は 200+errors で返る可能性があるため、その場合も
 *     `errors[0].extensions.http.status` を拾って status 付き例外に正規化する
 *     （無ければ status なしの一時失敗＝エンジン既定の分類に委ねる）。
 *   - 認証ヘッダは個人APIキーの場合 `Authorization: <key>`（**Bearer接頭辞なし**）。
 *     OAuthアクセストークンの場合のみ `Bearer` が付く。公式SDK本体のソース
 *     (`packages/sdk/src/client.ts`)で
 *     `Authorization: accessToken ? Bearer... : apiKey` と実装されているのを確認
 *     （Backlog/Asanaは常にクエリキー/Bearerだが、Linearの個人APIキーはBearer無しという違い）。
 *   - 完了判定は `state.type === 'completed'`。`canceled` は別語彙として独立しており
 *     （schema: `WorkflowState.type` は "triage"/"backlog"/"unstarted"/"started"/"completed"/
 *     "canceled"/"duplicate" の固定語彙とコメントに明記）、完了とは別物として扱う
 *     （キャンセルされたIssueをTaskApp側で「完了」として書き戻すと実態と乖離するため）。
 *   - 期日は `dueDate`（スカラー `TimelessDate` = 時刻を持たない日付）。担当者は `assignee.id`。
 *   - 取り込み単位は **team**（`project` ではない）。`Issue.team: Team!` は必須(NOT NULL)だが
 *     `Issue.project: Project` は任意(NULL可)＝全Issueに必ず存在する入れ物はteamのみ。
 *     加えて「完了」状態のIDはteam単位（`Team.states`）で管理されており、書き戻しに使う
 *     stateIdの解決もteam単位でしかできないため、containerId=team.idにするのが自然。
 *   - ページングは `IssueConnection { edges, nodes, pageInfo }` /
 *     `PageInfo { hasNextPage, endCursor }`（cursorベース、`after`/`first`で前進）。
 *   - 差分は `IssueFilter.updatedAt: DateComparator` の `gt` で絞る（秒粒度のISO8601 = timestamp
 *     粒度）。対象team絞り込みは `IssueFilter.team.id.eq`。
 *   - 完了の書き戻しは `issueUpdate(id, input: { stateId })` → `IssuePayload { success, issue }`。
 *     `stateId` はteamごとに異なるため固定値を打てない。実行時に
 *     `team(id).states(filter: { type: { eq: "completed" } })` を引いて解決する。
 *   - 削除の検知: `Issue.trashed: Boolean`（"A flag that indicates whether the issue is in the
 *     trash bin."）が存在する。ただし `issues` クエリは既定で `includeArchived: false`
 *     （アーカイブ/トラッシュ済みは既定で除外される）ため、`includeArchived: true` を明示して
 *     差分に含め、`trashed` を tombstone として使う。
 *   - レート制限（429）: 公式SDKのエラー処理実装
 *     (`packages/sdk/src/error.ts` の `RatelimitedLinearError`)で確認。Linearは**リクエスト数**
 *     と**クエリ複雑度**の2軸で制限しており、429時に `retry-after`（秒）に加えて
 *     `x-ratelimit-requests-reset` / `x-ratelimit-complexity-reset`（どちらもUnix秒）が返る。
 *     429の原因がどちらの軸かはレスポンスから明示されないため、`retry-after` が無ければ両方の
 *     resetのうち**遅い方**を使う（早い方だけ見ると、まだ制限中のもう一方の軸で即座に叩き直して
 *     しまうため）。
 */

const GRAPHQL_ENDPOINT_PATH = '/graphql'

/** 1ページの取得件数。Linearの `first` 既定は50。他アダプタに合わせ明示的に100にする。 */
const PAGE_SIZE = 100

/** リクエストのタイムアウト。応答しないホストにワーカーを占有させない。 */
const REQUEST_TIMEOUT_MS = 20_000

/** ワークフロー非依存の「完了」状態タイプ。'canceled' は別物として扱う(完了とは乖離するため)。 */
const COMPLETED_STATE_TYPE = 'completed'

/** 接続先は固定ホスト1つだけ。判定は全アダプタ共通の hostPolicy.ts に集約。 */
const LINEAR_HOST_POLICY = { kind: 'fixed', host: 'api.linear.app' } as const satisfies HostPolicy

interface LinearPageInfo {
  hasNextPage: boolean
  endCursor: string | null
}

interface LinearTeamNode {
  id: string
  name?: string
  key?: string
}

interface LinearIssueNode {
  id: string
  title?: string
  description?: string | null
  dueDate?: string | null
  state?: { type?: string; name?: string } | null
  assignee?: { id?: string } | null
  updatedAt?: string | null
  trashed?: boolean | null
}

interface LinearWorkflowStateNode {
  id: string
  type?: string
}

/** GraphQLエラーの1件。Linearは `extensions.http.status` に実HTTPステータス相当の値を積む。 */
interface LinearGraphQLError {
  message: string
  extensions?: { http?: { status?: number } }
}

/** 個人APIキーは接頭辞なし。ヘッダ値は `Authorization: <token>` そのまま送る。 */
function authHeader(ctx: ProviderContext): string {
  return ctx.credentials.token
}

/** 固定ホスト配下のGraphQLエンドポイントURLを組み立てる。ホスト検証をここで必ず通す。 */
function endpointUrl(ctx: ProviderContext): string {
  const base = requireBaseUrl(LINEAR_HOST_POLICY, ctx.credentials.baseUrl, 'linear')
  const origin = assertAllowedHost(LINEAR_HOST_POLICY, base, 'linear')
  return new URL(GRAPHQL_ENDPOINT_PATH, origin.origin).toString()
}

/**
 * 429 の復帰時刻を ms に変換する。
 *   1. 標準の `Retry-After`（秒）を最優先（最も素直な値）。
 *   2. 無ければ `X-RateLimit-Requests-Reset` / `X-RateLimit-Complexity-Reset`
 *      （どちらもUnix秒。公式SDK `error.ts` の `RatelimitedLinearError` で確認）のうち
 *      **遅い方**を使う。429の原因（リクエスト数/クエリ複雑度のどちらの軸か）はレスポンスから
 *      明示されないため、早い方だけ見るとまだ制限中の軸で即座に叩き直してしまう。
 * 取れなければ undefined（呼び出し側の既定バックオフに委ねる）。
 */
function retryAfterMsFrom(headers: Headers | undefined): number | undefined {
  if (!headers) return undefined
  const retryAfter = headers.get('Retry-After')
  if (retryAfter) {
    const sec = Number(retryAfter)
    if (Number.isFinite(sec) && sec > 0) return sec * 1000
  }
  const resets = [
    Number(headers.get('X-RateLimit-Requests-Reset')),
    Number(headers.get('X-RateLimit-Complexity-Reset')),
  ].filter((sec) => Number.isFinite(sec) && sec > 0)
  if (resets.length > 0) {
    const ms = Math.max(...resets) * 1000 - Date.now()
    if (ms > 0) return ms
  }
  return undefined
}

/** 例外の種別だけを安全に文字列化する（message に外部の応答本文が混ざり得るため使わない）。 */
function errName(err: unknown): string {
  return err instanceof Error ? err.name : 'UnknownError'
}

/**
 * 共通 GraphQL fetch。失敗時は status（と 429 の復帰時刻）を載せた ProviderError を投げる
 * （エンジンが 400/404/422=恒久失敗、それ以外=一時失敗に分類する。Backlog/Jiraと同じ流儀）。
 * HTTPレベルの失敗(res.ok=false、例: 認証エラーの401)と、200のままerrorsが積まれるGraphQL
 * レベルの失敗の両方をここで正規化する。応答本文はログに出さない（顧客データが載り得るため）。
 * `redirect: 'manual'` で転送を追わない。3xx は失敗として扱う。
 */
async function linearFetch<T>(
  ctx: ProviderContext,
  query: string,
  variables: Record<string, unknown>,
): Promise<T> {
  const authorization = authHeader(ctx)

  let res: Response
  try {
    res = await fetch(endpointUrl(ctx), {
      method: 'POST',
      redirect: 'manual',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: {
        Authorization: authorization,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query, variables }),
    })
  } catch (err) {
    throw providerError(`Linear API failed (network): ${errName(err)}`)
  }

  if (res.status >= 300 && res.status < 400) {
    throw providerError(`Linear API unexpected redirect (${res.status})`, { status: 400, permanent: true })
  }

  const body = (await res.json().catch(() => null)) as { data?: T; errors?: LinearGraphQLError[] } | null

  if (!res.ok) {
    console.error('Linear API error:', res.status) // 本文は出さない
    throw providerError(`Linear API failed (${res.status})`, {
      status: res.status,
      retryAfterMs: res.status === 429 ? retryAfterMsFrom(res.headers) : undefined,
    })
  }
  if (body?.errors && body.errors.length > 0) {
    // 200のままGraphQLエラーが返るケース。extensions.http.status があればそれをHTTP相当として使う。
    console.error('Linear GraphQL error, http-equivalent status:', body.errors[0].extensions?.http?.status)
    throw providerError('Linear API error (GraphQL)', { status: body.errors[0].extensions?.http?.status })
  }
  if (!body?.data) {
    throw providerError('Linear API error: レスポンスに data が含まれていない')
  }
  return body.data
}

/**
 * `dueDate` は時刻を持たない 'YYYY-MM-DD' 想定(スカラー TimelessDate)だが、防御的に先頭10文字を
 * 検証する（Backlog/Asana/Jiraと同じ考え方。Dateオブジェクトを経由しない＝toISOString由来の
 * タイムゾーンずれが原理的に起きない）。
 */
function toLocalDateString(due: string | null | undefined): string | null {
  if (!due) return null
  const head = due.slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(head) ? head : null
}

function normalizeIssue(node: LinearIssueNode, containerId: string): ExternalTask {
  return {
    externalId: node.id,
    containerId,
    title: node.title?.trim() || '(無題)',
    body: node.description?.trim() ? node.description : null,
    dueDate: toLocalDateString(node.dueDate),
    completed: node.state?.type === COMPLETED_STATE_TYPE,
    deleted: node.trashed === true,
    assigneeKey: node.assignee?.id ?? null,
    updatedAt: node.updatedAt ?? null,
  }
}

const TEAMS_QUERY = `
  query TaskSyncTeams($after: String) {
    teams(first: ${PAGE_SIZE}, after: $after) {
      nodes { id name key }
      pageInfo { hasNextPage endCursor }
    }
  }
`

const ISSUES_QUERY = `
  query TaskSyncIssues($filter: IssueFilter, $after: String) {
    issues(first: ${PAGE_SIZE}, after: $after, filter: $filter, includeArchived: true, orderBy: updatedAt) {
      nodes { id title description dueDate assignee { id } state { type name } updatedAt trashed }
      pageInfo { hasNextPage endCursor }
    }
  }
`

const TEAM_STATES_QUERY = `
  query TaskSyncTeamStates($teamId: String!) {
    team(id: $teamId) {
      states(filter: { type: { eq: "${COMPLETED_STATE_TYPE}" } }) {
        nodes { id type }
      }
    }
  }
`

const ISSUE_UPDATE_MUTATION = `
  mutation TaskSyncCompleteIssue($id: String!, $input: IssueUpdateInput!) {
    issueUpdate(id: $id, input: $input) {
      success
    }
  }
`

export const linearAdapter: TaskSyncAdapter = {
  id: 'linear',
  authKind: 'api_key',
  hostPolicy: LINEAR_HOST_POLICY,
  // updatedAt が秒粒度のISO8601で絞れるため。
  cursorGranularity: 'timestamp',
  // Issue.trashed をトゥームストーンとして使える（includeArchived:true で差分に含める）。
  deletionMode: 'tombstone',

  async listContainers(ctx: ProviderContext): Promise<ExternalContainer[]> {
    const containers: ExternalContainer[] = []
    let after: string | undefined
    for (;;) {
      const data = await linearFetch<{
        teams: { nodes: LinearTeamNode[]; pageInfo: LinearPageInfo }
      }>(ctx, TEAMS_QUERY, { after })
      const { nodes, pageInfo } = data.teams
      containers.push(...nodes.map((t) => ({ id: t.id, title: t.name || t.key || t.id })))
      if (!pageInfo.hasNextPage || !pageInfo.endCursor) break
      after = pageInfo.endCursor
    }
    return containers
  },

  async listChangedTasks(
    ctx: ProviderContext,
    containerId: string,
    opts: { since?: string; cursor?: string },
  ): Promise<TaskPage> {
    const filter: Record<string, unknown> = { team: { id: { eq: containerId } } }
    if (opts.since) filter.updatedAt = { gt: opts.since }

    const data = await linearFetch<{
      issues: { nodes: LinearIssueNode[]; pageInfo: LinearPageInfo }
    }>(ctx, ISSUES_QUERY, { filter, after: opts.cursor })

    const { nodes, pageInfo } = data.issues
    return {
      items: nodes.map((n) => normalizeIssue(n, containerId)),
      nextCursor: pageInfo.hasNextPage ? pageInfo.endCursor : null,
    }
  },

  async completeTask(ctx: ProviderContext, ref: { externalId: string; containerId: string }): Promise<void> {
    const stateData = await linearFetch<{
      team: { states: { nodes: LinearWorkflowStateNode[] } }
    }>(ctx, TEAM_STATES_QUERY, { teamId: ref.containerId })

    const doneState = stateData.team.states.nodes.find((s) => s.type === COMPLETED_STATE_TYPE)
    if (!doneState) {
      // team.states に type='completed' の状態が1つも無い＝ワークフロー設定として異常なケース。
      // 通常のteamには必ず1つ以上存在するため、statusを付けずそのまま投げる
      // （エンジン既定の一時失敗としてリトライされる。設定側の不備は人がLinear側のワークフローを
      // 直すまで解決しないため、本来は恒久失敗が適切かもしれないが、Jiraの遷移不在
      // (=正常運用で頻発しうる)と違いこちらは異常系のため permanent を決め打ちしない）。
      throw providerError(`linear: team ${ref.containerId} に completed 状態が見つからない(ワークフロー設定を確認)`)
    }

    const data = await linearFetch<{ issueUpdate: { success: boolean } }>(ctx, ISSUE_UPDATE_MUTATION, {
      id: ref.externalId,
      input: { stateId: doneState.id },
    })
    if (!data.issueUpdate.success) {
      throw providerError(`linear: issue ${ref.externalId} の完了更新が success:false を返した`)
    }
  },
}
