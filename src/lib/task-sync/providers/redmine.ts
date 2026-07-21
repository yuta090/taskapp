import { Agent, fetch as undiciFetch } from 'undici'
import ipaddr from 'ipaddr.js'
import { validateWebhookUrl } from '@/lib/sinks/ssrf'
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
 * Redmine アダプタ。
 *
 * Redmine REST API（公式 Wiki: https://www.redmine.org/projects/redmine/wiki/Rest_api ,
 * Rest_Issues, Rest_IssueStatuses, Rest_Projects）の性質と、ここで吸収している差異:
 *   - 接続先ホストは自ホストの任意URL（テナントごとに可変・顧客が立てた任意ホスト）。
 *     `hostPolicy: { kind: 'any-https' }` で宣言する。許可リストで守れない性質のため、
 *     実際のIP検査・DNSピン留めは下記の `fetchAnyHttps` が必ず経由する（後述）。
 *   - 認証はAPIアクセスキーを `key=` クエリ・Basic認証・ヘッダー `X-Redmine-API-Key` の
 *     いずれでも渡せるが、鍵をURLに残さないヘッダー方式を選ぶ。
 *   - 差分は `updated_on=>=<ISO8601>` で絞れ、**秒単位のタイムスタンプ粒度**（Backlogの
 *     日付粒度と違い時刻まで指定できる）。そのため cursorGranularity='timestamp' で宣言する。
 *   - 課題一覧は明示しない限り **openのステータスのみ**返る仕様
 *     （Rest_Issues: "By default, it returns open issues only."）。完了検知に closed も
 *     必要なため `status_id=*` を必ず指定する。
 *   - ページングは offset/limit（limit既定25・上限100。ドキュメント記載）。レスポンスの
 *     `total_count` を見て取り切ったか判定する。ソートは（Backlogのoffsetページング対策と
 *     同じ理由で）差分の起点(since)の有無で切り替える:
 *       - since あり: `updated_on` 昇順。対象が狭く、取りこぼしても次サイクルの重なりで拾い直せる。
 *       - since 無し(初回全件取得): `id` 昇順（不変・単調増加）。updated_on昇順だとページ送り中に
 *         更新された課題が後方へ移動し、その分だけ未取得の課題が offset の前へ詰めて飛ばされる。
 *         初回に飛ばした古い課題は以後の差分ウィンドウには二度と入らず恒久的に失われる。
 *   - 削除された課題を取得するAPIは無く（tombstoneなし）、Webhookもコアに存在しない
 *     （プラグイン依存）。差分取得（sinceあり）は全件ではなく変更分のみを返すため
 *     「今回の応答に無い＝削除された」とも断定できない。削除検知は定期フル突合(reconciliation)
 *     という、このアダプタの1呼び出しの外側にあるエンジン側の仕組みでしか成立しないため、
 *     `deletionMode: 'unsupported'` を宣言する。
 *   - 「完了」の表現: Redmineはステータスをインスタンス管理者が自由に定義できるため、
 *     Backlogのような固定デフォルト値を決め打ちできない。`/issue_statuses.json` が返す
 *     `is_closed` が公式の一次情報のため、これを完了**検知**の第一情報源にする。接続設定
 *     `config.redmine_done_status_ids` はこの結果に**合算**する（上書きではなく補助）。
 *     理由: is_closed=false のステータスでも運用上「もう対応しない」扱いにしたい
 *     （却下・重複など）ケースを拾うための追加であり、is_closed という公式判定を
 *     設定で消してしまうのは事故の元になるため。
 *     **書き戻し**（完了にする時に何を書き込むか）は検知とは別の関心事のため、専用設定
 *     `config.redmine_completion_status_id`（単一のステータスID）を持つ。未設定なら
 *     is_closed な先頭ステータスを使う（検知の合算配列の先頭を流用すると、無関係な並び順で
 *     書込先が決まってしまうため。Backlogの `backlog_completion_status_id` と同じ設計）。
 *   - 期日 `due_date` はAPIレスポンス例（Rest_Issues）で `start_date` と同様に日付のみ
 *     （時刻を持たない）ため、Backlog/Google Tasksと違い変換不要でそのまま使う。
 *   - `assigned_to`（担当者）のレスポンス構造(id+name)は公式ドキュメントのサンプルに
 *     直接の例示が無い（サンプルのissueにたまたま担当者が付いていない）。ただし
 *     project/tracker/status/priority/author/categoryが全て同じ`{id,name}`形式で
 *     一貫しているため、同じ形式だと推定してnull安全に読む（未確認事項として報告）。
 *   - レート制限: セルフホストのため公式な明文化は無い。標準の `Retry-After`（秒）のみ対応する。
 *   - 書き込みは `application/json`。
 */

/** ホストが顧客の任意httpsホストであることの宣言。IP検査・DNSピン留めは fetchAnyHttps が行う。 */
const HOST_POLICY: HostPolicy = { kind: 'any-https' }

/** 1ページの取得件数（Redmine APIの上限）。満杯なら次ページがあるとみなす。 */
const PAGE_SIZE = 100

/** リクエストのタイムアウト。応答しないホストにワーカーを占有させない。 */
const REQUEST_TIMEOUT_MS = 20_000

interface RedmineRef {
  id: number
  name?: string
}

interface RedmineIssue {
  id: number
  subject?: string
  description?: string | null
  due_date?: string | null
  status?: RedmineRef | null
  assigned_to?: RedmineRef | null
  updated_on?: string | null
}

interface RedmineProject {
  id: number
  name?: string
  identifier?: string
}

interface RedmineIssueStatus {
  id: number
  name?: string
  is_closed?: boolean
}

/** 接続設定から「完了検知に合算するステータスID」を取り出す。未設定・不正値なら空配列。 */
function configuredDoneStatusIds(ctx: ProviderContext): number[] {
  const raw = ctx.config?.redmine_done_status_ids
  if (!Array.isArray(raw)) return []
  return raw.filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
}

/** 接続設定から「完了にする時の書き戻し先ステータスID」を取り出す。検知の集合とは別の設定。 */
function configuredCompletionStatusId(ctx: ProviderContext): number | undefined {
  const raw = ctx.config?.redmine_completion_status_id
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : undefined
}

/** ホストポリシーを通した自ホスト配下のURLを組み立てる（形式検証のみ。IP検査はfetchAnyHttpsが行う）。 */
function buildUrl(ctx: ProviderContext, path: string, params?: Record<string, string>): string {
  const base = requireBaseUrl(HOST_POLICY, ctx.credentials.baseUrl, 'redmine')
  const url = new URL(path, base)
  for (const [key, value] of Object.entries(params ?? {})) url.searchParams.set(key, value)
  assertAllowedHost(HOST_POLICY, url.toString(), 'redmine')
  return url.toString()
}

/** 429/503 の復帰時刻を ms に変換する。標準の `Retry-After`（秒）のみ対応（Redmine独自ヘッダーは不明）。 */
function retryAfterMsFrom(headers: { get(name: string): string | null } | undefined): number | undefined {
  if (!headers) return undefined
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

/** providerError（{status, permanent, retryAfterMs} 付きの Error）かどうかを判定する。 */
function isProviderError(err: unknown): boolean {
  return err instanceof Error && ('status' in err || 'permanent' in err || 'retryAfterMs' in err)
}

interface AnyHttpsResponse {
  status: number
  headers: { get(name: string): string | null }
  text: string
}

/**
 * any-https（自ホスト任意URL）用のSSRF安全fetch。
 *
 * ⚠ 設計判断（重要・要レビュー / team-leadへ報告済み）: `src/lib/sinks/ssrf.ts` の `safeFetch` を
 * そのまま呼ぶ形にはしていない。`safeFetch` は応答本文を**500byteに打ち切って**返す設計
 * （webhook配送・multica連携の小さな確認レスポンス向け。`src/lib/connectors/multica/client.ts`
 * の利用箇所を参照）で、Redmineの `/issues.json?limit=100` のような一覧取得（容易に数十KBを
 * 超える）には使えない（正当なJSONが途中で切られてパースに失敗する）。
 * そのためSSRFの実際の判定ロジック（`validateWebhookUrl`＝https限定・ポート443限定・DNS解決・
 * private/内部IP拒否。IPv4-mapped IPv6も透過的に判定）はそのまま再利用しつつ、
 * `safeFetch` 内部と同じDNSピン留め手法（検証で確定したIPへ接続を固定し、検証後にDNSが
 * 差し替えられる rebinding を防ぐ）で応答本文を全て読み切る薄いfetchラッパーをここに用意する。
 * 「どのホスト/IPを許すか」という実際のセキュリティ判定は増やしておらず、引き続き ssrf.ts に
 * 一本化されている。恒久対応としては ssrf.ts 側に「本文を打ち切らない一覧取得向けバリアント」を
 * 用意して共通化するのが望ましく、この設計判断自体をteam-leadへ報告している。
 */
async function fetchAnyHttps(
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string },
): Promise<AnyHttpsResponse> {
  const validation = await validateWebhookUrl(url)
  if (!validation.ok) {
    // 接続作成後のDNS再指定(rebinding)や保存済み不正値を、実際に叩く直前にもう一度弾く。
    throw providerError(`redmine: 接続先ホストの検証に失敗しました(${validation.reason})`, {
      permanent: true,
      status: 400,
    })
  }

  const pinnedIp = validation.resolvedIps[0]
  const family = ipaddr.process(pinnedIp).kind() === 'ipv6' ? 6 : 4
  const dispatcher = new Agent({
    connect: {
      lookup: (_hostname, lookupOptions, callback) => {
        if ((lookupOptions as { all?: boolean } | undefined)?.all) {
          callback(null, [{ address: pinnedIp, family }])
        } else {
          callback(null, pinnedIp, family)
        }
      },
    },
  })

  try {
    const res = await undiciFetch(url, {
      ...init,
      // 正規のRedmineインスタンスがリダイレクトを返すことは想定しない。転送先へ鍵を渡さないため追わない。
      redirect: 'manual',
      dispatcher,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    const text = await res.text()
    return { status: res.status, headers: res.headers, text }
  } finally {
    await dispatcher.close().catch(() => {})
  }
}

/**
 * 共通 fetch。失敗時は status（と 429/503 の復帰時刻）を載せた ProviderError を投げる
 * （エンジンが 400/404/422=恒久失敗、それ以外=一時失敗に分類する。Backlogと同じ流儀）。
 * 応答本文・URLはログにも例外メッセージにも出さない（顧客データ・自ホストの内部構成が載り得るため）。
 */
async function redmineFetch(ctx: ProviderContext, url: string, init?: { method?: string; body?: string }): Promise<unknown> {
  const method = init?.method ?? 'GET'
  const headers: Record<string, string> = { 'X-Redmine-API-Key': ctx.credentials.token }
  if (init?.body) headers['Content-Type'] = 'application/json'

  let res: AnyHttpsResponse
  try {
    res = await fetchAnyHttps(url, { method, headers, body: init?.body })
  } catch (err) {
    // ホスト検証の恒久失敗(providerError)はそのまま伝える。それ以外はネットワーク断・タイムアウト
    // であり status を持たないため一時失敗として再試行に回す。
    if (isProviderError(err)) throw err
    throw providerError(`Redmine API ${method} failed (network): ${errName(err)}`)
  }

  if (res.status >= 300 && res.status < 400) {
    throw providerError(`Redmine API ${method} unexpected redirect (${res.status})`, {
      status: 400,
      permanent: true,
    })
  }
  if (res.status < 200 || res.status >= 300) {
    console.error('Redmine API error:', method, res.status) // 本文とURLは出さない
    throw providerError(`Redmine API ${method} failed (${res.status})`, {
      status: res.status,
      retryAfterMs: res.status === 429 || res.status === 503 ? retryAfterMsFrom(res.headers) : undefined,
    })
  }
  return res.text ? JSON.parse(res.text) : null
}

/** is_closed なステータスIDの一覧を取得する（プロジェクトごとの再定義に対応するため毎回取り直す）。 */
async function closedStatusIds(ctx: ProviderContext): Promise<number[]> {
  const url = buildUrl(ctx, '/issue_statuses.json')
  const data = (await redmineFetch(ctx, url)) as { issue_statuses?: RedmineIssueStatus[] } | null
  return (data?.issue_statuses ?? []).filter((s) => s.is_closed === true).map((s) => s.id)
}

function normalizeIssue(issue: RedmineIssue, containerId: string, doneIds: Set<number>): ExternalTask {
  const statusId = issue.status?.id
  return {
    externalId: String(issue.id),
    containerId,
    title: issue.subject?.trim() || '(無題)',
    body: issue.description?.trim() ? issue.description : null,
    // due_date は日付のみのため（時刻を持たない）、Date を経由せずそのまま使う。
    dueDate: issue.due_date ?? null,
    completed: typeof statusId === 'number' && doneIds.has(statusId),
    assigneeKey: issue.assigned_to?.id != null ? String(issue.assigned_to.id) : null,
    updatedAt: issue.updated_on ?? null,
  }
}

export const redmineAdapter: TaskSyncAdapter = {
  id: 'redmine',
  authKind: 'api_key',
  hostPolicy: HOST_POLICY,
  // updated_on が秒単位のタイムスタンプで絞り込めるため（Backlogの日付粒度と違い時刻まで指定可能）。
  cursorGranularity: 'timestamp',
  // 削除済み課題を返すAPIが無く、Webhookもコアには無い。差分取得は全件ではなく変更分のみのため
  // 「応答に無い＝削除された」とも断定できない。削除検知は定期フル突合というアダプタの外側の
  // 仕組みでしか成立しないため 'unsupported' を宣言する。
  deletionMode: 'unsupported',

  async listContainers(ctx: ProviderContext): Promise<ExternalContainer[]> {
    // ⚠ 未確認: Redmineのproject.statusの列挙値(有効/アーカイブ等)は公式ドキュメントに
    // 記載が無いため、Backlogのようなアーカイブ除外はせず全件を返す（推測で絞り込まない）。
    const url = buildUrl(ctx, '/projects.json', { limit: String(PAGE_SIZE) })
    const data = (await redmineFetch(ctx, url)) as { projects?: RedmineProject[] } | null
    return (data?.projects ?? []).map((p) => ({ id: String(p.id), title: p.name ?? p.identifier ?? String(p.id) }))
  },

  async listChangedTasks(
    ctx: ProviderContext,
    containerId: string,
    opts: { since?: string; cursor?: string },
  ): Promise<TaskPage> {
    const offset = opts.cursor ? Number(opts.cursor) : 0
    const params: Record<string, string> = {
      project_id: containerId,
      // 既定はopenのみ返る仕様のため、完了検知に必要な closed も含め全件取る。
      status_id: '*',
      // ソートの使い分け（offsetページングは「並びが動かない」前提が要るため。Backlogと同じ理由）:
      //   - 差分取得(since あり): 更新日時の昇順。対象が狭く、取りこぼしても次サイクルの重なりで拾い直せる。
      //   - 初回の全件取得(since なし): id(=不変・単調増加)の昇順。updated_on昇順だとページ送り中に
      //     更新された課題が後方へ移動し、その分だけ未取得の課題が offset の前へ詰めて飛ばされる。
      //     初回に飛ばした古い課題は以後の差分ウィンドウには二度と入らず恒久的に失われる。
      sort: opts.since ? 'updated_on' : 'id',
      limit: String(PAGE_SIZE),
      offset: String(offset),
    }
    if (opts.since) params.updated_on = `>=${opts.since}`

    const url = buildUrl(ctx, '/issues.json', params)
    const data = (await redmineFetch(ctx, url)) as { issues?: RedmineIssue[]; total_count?: number } | null
    const issues = data?.issues ?? []
    const doneIds = new Set([...(await closedStatusIds(ctx)), ...configuredDoneStatusIds(ctx)])
    const nextOffset = offset + issues.length
    const total = data?.total_count ?? nextOffset
    return {
      items: issues.map((i) => normalizeIssue(i, containerId, doneIds)),
      nextCursor: nextOffset < total ? String(nextOffset) : null,
    }
  },

  async completeTask(ctx: ProviderContext, ref: { externalId: string; containerId: string }): Promise<void> {
    // 書き戻し先は専用設定（未設定なら is_closed な先頭ステータス）。検知用の合算集合とは
    // 別の関心事なので流用しない（Backlogの backlog_completion_status_id と同じ設計）。
    const configured = configuredCompletionStatusId(ctx)
    const statusId = configured ?? (await closedStatusIds(ctx))[0]
    if (statusId === undefined) {
      throw providerError(
        'redmine: 完了として書き戻すステータスIDを解決できません(is_closedなステータスも設定も無い接続です)',
        { permanent: true, status: 400 },
      )
    }
    const url = buildUrl(ctx, `/issues/${encodeURIComponent(ref.externalId)}.json`)
    await redmineFetch(ctx, url, {
      method: 'PUT',
      body: JSON.stringify({ issue: { status_id: statusId } }),
    })
  },
}
