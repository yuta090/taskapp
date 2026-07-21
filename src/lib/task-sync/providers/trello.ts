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
 * Trello アダプタ。
 *
 * Trello REST API（OpenAPI定義 https://developer.atlassian.com/cloud/trello/swagger.v3.json
 * を2026-07-21に取得して確認。ただしこの公式定義自体が疎で、`/boards/{id}/cards` の
 * クエリパラメータ等は明記されていない箇所がある＝未確認の項目はコメントに明記する）の
 * 性質と、ここで吸収している差異:
 *
 *   - 認証は `key`(アプリのAPIキー)と`token`(ユーザートークン)の2つをクエリで渡す方式
 *     （securitySchemes.APIKey/APIToken ともに `{type: apiKey, in: query}` で確認）。
 *     ProviderCredentials は token を1本しか持たないため、以下のように対応させる:
 *       - credentials.token        = Trello のユーザートークン（秘匿値。アカウントへの
 *         アクセス権そのもの。復号済みの状態でここに渡ってくる契約＝types.tsの定義通り）
 *       - ctx.config.trello_api_key = Trello のAPIキー（アプリケーション識別子。Trello自身が
 *         クライアントID相当として扱う値であり、ProviderContext.config の「運用者が画面で
 *         設定する可視の値」という定義に素直に合致する）
 *     token に区切り文字でキーを埋め込む案は採らない: token は「暗号化列で保管される秘匿値」
 *     という契約に対し、区切り文字連結は複合値であることをコード全体に伝播させ、パース漏れや
 *     ログでの誤マスキングの温床になる。config分離の方が既存の秘匿/可視の境界に素直に乗る。
 *   - ホストは固定（https://api.trello.com/1）。
 *   - 差分取得: `/boards/{boardId}/actions` は `since`(ISO8601 or Mongo ObjectID) で絞れるが
 *     （公式定義で確認）、アクションは変更点の断片（例: updateCardアクションの旧新フィールド）
 *     しか持たずカードの完全な現在状態(due/desc等)を得るには結局カード個別GETが要りN+1になる。
 *     加えて全ての変更種別（チェックリスト変更等）がupdateCardアクションとして確実に拾える
 *     保証も無い。一方 `/boards/{id}/cards` 自体には差分フィルタが存在しない（公式定義に
 *     `since`/`before`/`limit` の記載なし＝未確認というより「無い」ことを確認した）ため、
 *     こちらを採用し cursorGranularity='none'（毎回全件取得）で宣言する。
 *   - 完了判定: Trelloに統一された「完了」概念は無い。既定は `dueComplete`(期日チェックボックス、
 *     Trelloの公式PUTパラメータとして存在を確認)を完了シグナルとする。`closed`(アーカイブ)は
 *     既定では完了とみなさない＝アーカイブは「完了」以外の意図（重複/中止で隠す等）もあり、
 *     混同すると誤って完了として書き戻ってしまうため。ただし現場の多くは期日を使わず
 *     「完了リストへのカード移動」で運用するため、接続設定 `config.trello_done_list_ids`
 *     （リストIDの配列）を指定すればリスト所属を優先する（Backlogのdone_status_idsと同じ流儀）。
 *   - 期日 `due` は実時刻を持つISO8601（公式スキーマは format:date だが実際は日時。日付のみの
 *     選択でも内部的には特定時刻のタイムスタンプとして返る＝未確認だが安全側に倒し常に
 *     実時刻とみなす）。素朴なUTC切り出しは日本時間で1日ずれうるため、Dateを経由し
 *     formatDateToLocalStringでローカル日付化する（toISOStringは使わない）。
 *   - 担当者 `idMembers` は複数を返す。ExternalTask.assigneeKey は単一のため先頭のみを採用する
 *     （将来のユーザー対応付けに使う程度の情報であり、複数対応は現状スコープ外という判断）。
 *   - `/members/me/boards` の `me` は「自分自身」を指すショートハンド（Trelloの長年の公開
 *     ドキュメントで確認済みの慣例だが、今回取得したOpenAPI定義自体には明記が無い＝未確認）。
 */

const API_BASE = 'https://api.trello.com/1'

/**
 * 接続先は固定ホスト1つだけ。資格情報をクエリで送るため（Trello）／ヘッダで送る場合でも、
 * 送信先が固定であることを実行時にも確かめる。判定は全アダプタ共通の hostPolicy.ts に集約。
 */
const TRELLO_HOST_POLICY = { kind: 'fixed', host: 'api.trello.com' } as const satisfies HostPolicy

/** リクエストのタイムアウト。応答しないホストにワーカーを占有させない。 */
const REQUEST_TIMEOUT_MS = 20_000

/** カード一覧取得で絞るフィールド。ペイロードを減らす。 */
const CARD_FIELDS = 'id,name,desc,due,dueComplete,closed,idList,idMembers,dateLastActivity'

interface TrelloBoard {
  id: string
  name?: string
  closed?: boolean
}

interface TrelloCard {
  id: string
  name?: string
  desc?: string | null
  due?: string | null
  dueComplete?: boolean
  closed?: boolean
  idList?: string
  idMembers?: string[]
  dateLastActivity?: string | null
}

/** 接続設定からAPIキーを取り出す。未設定は配線ミスとして弾く（Backlogのbaseurlガードと同じ流儀）。 */
function apiKey(ctx: ProviderContext): string {
  const raw = ctx.config?.trello_api_key
  if (typeof raw !== 'string' || raw.length === 0) {
    throw new Error('trello: config.trello_api_key が設定されていない接続です')
  }
  return raw
}

/** 接続設定から「完了とみなすリストID」を取り出す。未設定なら空配列＝dueCompleteに倒す。 */
function doneListIds(ctx: ProviderContext): string[] {
  const raw = ctx.config?.trello_done_list_ids
  if (!Array.isArray(raw)) return []
  return raw.filter((v): v is string => typeof v === 'string' && v.length > 0)
}

/** カードの期日をローカル日付 'YYYY-MM-DD' へ落とす。実時刻を持つためDateを経由する。 */
function toLocalDateString(due: string | null | undefined): string | null {
  if (!due) return null
  return formatDateToLocalString(new Date(due))
}

/** key/tokenをクエリに載せてURLを組み立てる。 */
function apiUrl(ctx: ProviderContext, path: string, params?: Record<string, string>): string {
  const url = new URL(`${API_BASE}${path}`)
  // 資格情報をクエリに載せる方式のため、送信先が固定ホストであることを実行時に必ず確かめる。
  assertAllowedHost(TRELLO_HOST_POLICY, url.toString(), 'trello')
  url.searchParams.set('key', apiKey(ctx))
  url.searchParams.set('token', ctx.credentials.token)
  for (const [key, value] of Object.entries(params ?? {})) {
    url.searchParams.set(key, value)
  }
  return url.toString()
}

/**
 * 共通 fetch。失敗時は providerError で status（と429の復帰時刻）を載せて throw する
 * （エンジンが 400/404/422=恒久失敗、他=一時失敗に分類する。Backlogアダプタと同じ流儀）。
 *
 * key/token がURLに載るため、**URLも応答本文もログにも例外メッセージにも出さない**
 * （外部が返す本文にはリクエストURL＝資格情報が echo され得る）。
 * `redirect: 'manual'` で転送を追わない（転送先へ資格情報を渡さないため）。
 */
async function trelloFetch(url: string, init?: RequestInit): Promise<unknown> {
  const method = init?.method ?? 'GET'
  let res: Response
  try {
    res = await fetch(url, {
      ...init,
      redirect: 'manual',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  } catch (err) {
    throw providerError(`Trello API ${method} failed (network): ${err instanceof Error ? err.name : 'Unknown'}`)
  }

  if (res.status >= 300 && res.status < 400) {
    throw providerError(`Trello API ${method} unexpected redirect (${res.status})`, {
      status: 400,
      permanent: true,
    })
  }
  if (!res.ok) {
    console.error('Trello API error:', method, res.status) // 本文とURLは出さない
    throw providerError(`Trello API ${method} failed (${res.status})`, {
      status: res.status,
      retryAfterMs: res.status === 429 ? retryAfterMsFrom(res.headers) : undefined,
    })
  }
  return res.json()
}

/** 429 の復帰待ち時間。Trello は `Retry-After`（秒）を返す場合がある。 */
function retryAfterMsFrom(headers: Headers | undefined): number | undefined {
  const raw = headers?.get('Retry-After')
  if (!raw) return undefined
  const sec = Number(raw)
  return Number.isFinite(sec) && sec > 0 ? sec * 1000 : undefined
}

function isCompleted(card: TrelloCard, doneIds: string[]): boolean {
  // 接続設定でリストIDが指定されていればそちらを優先（dueCompleteより優先度が高い）。
  if (doneIds.length > 0) return card.idList != null && doneIds.includes(card.idList)
  return card.dueComplete === true
}

function normalizeCard(card: TrelloCard, containerId: string, doneIds: string[]): ExternalTask {
  return {
    externalId: card.id,
    containerId,
    title: card.name?.trim() || '(無題)',
    body: card.desc?.trim() ? card.desc : null,
    dueDate: toLocalDateString(card.due),
    completed: isCompleted(card, doneIds),
    assigneeKey: card.idMembers?.[0] ?? null,
    updatedAt: card.dateLastActivity ?? null,
  }
}

export const trelloAdapter: TaskSyncAdapter = {
  id: 'trello',
  authKind: 'api_key',
  hostPolicy: TRELLO_HOST_POLICY,
  // /boards/{id}/cards に差分フィルタが無いため毎回全件取得（重複取得は連結先のunique制約で無害）。
  cursorGranularity: 'none',

  async listContainers(ctx: ProviderContext): Promise<ExternalContainer[]> {
    const boards = (await trelloFetch(
      apiUrl(ctx, '/members/me/boards', { filter: 'open', fields: 'id,name' }),
    )) as TrelloBoard[] | null
    return (boards ?? []).map((b) => ({ id: b.id, title: b.name ?? b.id }))
  },

  async listChangedTasks(ctx: ProviderContext, containerId: string): Promise<TaskPage> {
    // since/cursor は使わない（cursorGranularity='none'。差分APIが無いため引数を受けても無視する）。
    const cards = (await trelloFetch(
      apiUrl(ctx, `/boards/${encodeURIComponent(containerId)}/cards`, { fields: CARD_FIELDS }),
    )) as TrelloCard[] | null
    const doneIds = doneListIds(ctx)
    return {
      items: (cards ?? []).map((c) => normalizeCard(c, containerId, doneIds)),
      // 差分APIが無いため常に取り切り扱い。次回も全件を取り直す。
      nextCursor: null,
    }
  },

  async completeTask(ctx: ProviderContext, ref: { externalId: string; containerId: string }): Promise<void> {
    const doneIds = doneListIds(ctx)
    // 読み取りの完了判定と対称にする: リストID指定があれば移動、無ければdueCompleteを立てる。
    const params: Record<string, string> =
      doneIds.length > 0 ? { idList: doneIds[0] } : { dueComplete: 'true' }
    await trelloFetch(apiUrl(ctx, `/cards/${encodeURIComponent(ref.externalId)}`, params), {
      method: 'PUT',
    })
  },
}
