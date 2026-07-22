import { assertAllowedHost } from '@/lib/task-sync/hostPolicy'
import {
  parseNotionMapping,
  validateMappingAgainstSchema,
  type NotionMapping,
  type NotionStatusMapping,
  type NotionLiveProperties,
  type NotionLiveProperty,
} from '@/lib/task-sync/providers/notion/mapping'
import { retryAfterMsFrom } from '@/lib/task-sync/providers/notion/retryAfter'
import { fetchDatabaseSchema, type NotionDatabaseSchema } from '@/lib/task-sync/providers/notion/schema'
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
 * Notion アダプタ — タスク同期の inbound（取り込み）＋ 完了の書き戻しのみ。
 *
 * Notion API（2022-06-28。既存 sink アダプタ src/lib/sinks/adapters/notion.ts と同じ
 * Notion-Version に揃える。エンドポイント形は developers.notion.com のリファレンスで確認）の
 * 性質と、ここで吸収している差異:
 *   - ホストは固定 `api.notion.com`。認証はワークスペース単位の無期限アクセストークン
 *     （既存 `src/lib/notion/client.ts` の OAuth で得たトークンをそのまま再利用。refreshは無い）。
 *     `Authorization: Bearer` ヘッダ＋固定の `Notion-Version` ヘッダで送る。
 *   - `POST /v1/search`（filter: {value:'database', property:'object'}）で接続先ワークスペース内の
 *     共有DB一覧を取得する（listContainers）。ページングは `has_more`/`next_cursor`。
 *   - `POST /v1/databases/{id}/query` で差分取得。`last_edited_time` の timestamp フィルタ
 *     （`{timestamp:'last_edited_time', last_edited_time:{on_or_after: since}}`）で絞り、
 *     昇順ソートする。ページングは `start_cursor`/`next_cursor`（timestamp 粒度＝秒精度のISO8601）。
 *   - Notion DB のプロパティ構造・名前はDBごと（ユーザーごと）に違うため固定名では読めない。
 *     `config.notion_mappings[databaseId]`（NotionMapping。mapping.ts）に接続時確定したマッピングを
 *     渡し、プロパティは常に **id で** 特定する（名前はリネームされ得るため使わない）。
 *     マッピングが無いDBは恒久エラーで止める（エンジンがコンテナ単位で停止しカーソル前進しない＝
 *     drift/未設定時の停止方針。マッピングの事前検証＝validateMappingAgainstSchemaは保存API側の責務で、
 *     ここでは「保存済みマッピングの形式が有効か」だけを parseNotionMapping（手書き検証）で再検証する）。
 *   - **実行時のスキーマdrift再検証**: 保存時の検証だけでは不変条件にならない。保存後に顧客が
 *     Notion 側でプロパティを削除・型変更しても TaskApp には何の通知も来ない（webhookではなく
 *     ポーリングのため）。放置すると `findPropertyById` が null を返すだけで、期日が無言でnullになり
 *     （AI秘書の期限リマインドが無言で止まる）、status も無言で completed=false 固定になる
 *     （完了が永久に取り込まれない）。これを防ぐため、**コンテナのポーリング初回ページ
 *     （`opts.cursor` 未指定のとき）に限り**1回だけ `fetchDatabaseSchema` で今のライブスキーマを取り、
 *     `validateMappingAgainstSchema` で照合する。不一致なら推測で続行せず恒久エラーでそのコンテナの
 *     取り込みを止める（エンジンは全ページ成功時のみカーソル前進するため、停止してもカーソルは
 *     進まず、再マッピング後に取りこぼしなく再開できる）。2ページ目以降（cursorあり）は
 *     再検証しない＝1ポーリングにつき1コンテナ1回に抑える。
 *   - title はマッピングに含めない。type==='title' のプロパティ値が1DBに1つだけ構造的に存在するため、
 *     ページの properties から毎回自動特定する。
 *   - 完了は status(option id)/select(option id)/checkbox(真偽) のいずれか、マッピングの
 *     prop_type に従って読み書きする。書き戻し先のキーは property **id**
 *     （Notion API はプロパティ名・IDのどちらでも properties オブジェクトのキーに使える。
 *     名前はユーザーがいつでも変えられるため、安定した id を使う）。
 *   - 削除の検知: query は削除済みページを返さない（tombstoneが無い）ため deletionMode='unsupported'。
 *   - createTask/updateTask は実装しない（取り込み専用＋完了の書き戻しのみ。契約上optional）。
 */

const NOTION_API_BASE = 'https://api.notion.com/v1'
/**
 * ⚠ このバージョンに固定している理由（安易に上げないこと）:
 * listContainers は `POST /v1/search` を `filter:{value:'database', property:'object'}` で叩いて
 * 共有DB一覧を取っているが、この `value:'database'` は Notion API 2022-06-28 でのみ有効。
 * Notion は API version 2025-09-03 で databases を data sources へ移行しており、その版では
 * search の filter は `page` / `data_source` のみが有効で `database` は無効になる
 * （= 同じ書き方のままバージョンだけ上げると、search が何もマッチしなくなる）。
 * その結果 listContainers が例外を出さずに空配列を返し、「接続先ワークスペースに取り込み対象が
 * 0件」という**エラーの出ない無言の同期停止**に見える（silent failure）。engine 側もこれを
 * 正常応答として扱うため、誰も気づかないまま同期が止まり得る。
 * バージョンを上げる場合は、上げること自体を禁じているわけではなく、上げる前に必ず
 * (1) search の filter 形（value:'database' → data_source へ書き換えが要るか）、
 * (2) databases.query と pages PATCH（書き戻し）の互換、
 * の2点を Notion の変更履歴で確認してから、この定数と下のトリップワイヤーテストの期待値を
 * 一緒に更新すること（src/__tests__/lib/task-sync/providers/notion.test.ts）。
 */
export const NOTION_VERSION = '2022-06-28'
const REQUEST_TIMEOUT_MS = 20_000
const PAGE_SIZE = 100

/** listContainers のページ数上限（安全弁）。異常応答でのカーソル無限前進を防ぐ（asanaと同じ考え方）。 */
const MAX_CONTAINER_PAGES = 100

const NOTION_HOST_POLICY = { kind: 'fixed', host: 'api.notion.com' } as const satisfies HostPolicy

function apiUrl(path: string): string {
  const url = new URL(`${NOTION_API_BASE}${path}`)
  // 固定ホストであることを実行時にも確認する（定数の書き換えに対する保険。asanaアダプタと同じ流儀）。
  assertAllowedHost(NOTION_HOST_POLICY, url.toString(), 'notion')
  return url.toString()
}

/**
 * 共通 fetch。失敗時は providerError で status（と429の復帰時刻）を載せて throw する
 * （エンジンが 400/404/422=恒久失敗、他=一時失敗に分類する。他アダプタと同じ流儀）。
 *
 * トークンはヘッダに載るためURL自体に秘密は無いが、応答本文には顧客のタスク内容が乗るため
 * ログにも例外メッセージにも出さない。`redirect: 'manual'` で転送を追わない
 * （転送先へ Authorization ヘッダを渡さないため）。
 */
async function notionFetch(
  ctx: ProviderContext,
  path: string,
  init: { method: string; body?: string },
): Promise<unknown> {
  let res: Response
  try {
    res = await fetch(apiUrl(path), {
      method: init.method,
      headers: {
        Authorization: `Bearer ${ctx.credentials.token}`,
        'Notion-Version': NOTION_VERSION,
        'Content-Type': 'application/json',
      },
      body: init.body,
      redirect: 'manual',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  } catch (err) {
    throw providerError(
      `Notion API ${init.method} failed (network): ${err instanceof Error ? err.name : 'UnknownError'}`,
    )
  }

  if (res.status >= 300 && res.status < 400) {
    throw providerError(`Notion API ${init.method} unexpected redirect (${res.status})`, {
      status: 400,
      permanent: true,
    })
  }
  if (!res.ok) {
    console.error('Notion API error:', init.method, res.status) // 本文は出さない
    throw providerError(`Notion API ${init.method} failed (${res.status})`, {
      status: res.status,
      retryAfterMs: res.status === 429 || res.status === 503 ? retryAfterMsFrom(res.headers) : undefined,
    })
  }
  return res.json()
}

// ---- config.notion_mappings の読み取り（rawな値を信用せず、ここで1度だけ検証する） ----

/** databaseId に対応するマッピングを取り出す。未設定/形式不正なら null（呼び出し側がエラーに変える）。 */
function readMapping(ctx: ProviderContext, databaseId: string): NotionMapping | null {
  const raw = ctx.config?.notion_mappings
  if (!raw || typeof raw !== 'object') return null
  const candidate = (raw as Record<string, unknown>)[databaseId]
  if (candidate === undefined) return null
  const parsed = parseNotionMapping(candidate)
  return parsed.ok ? parsed.data : null
}

/** マッピング必須の操作(listChangedTasks)用。無ければ再試行しても直らない設定不備として止める。 */
function requireMapping(ctx: ProviderContext, databaseId: string): NotionMapping {
  const mapping = readMapping(ctx, databaseId)
  if (!mapping) {
    throw providerError(`notion: databaseId=${databaseId} のマッピングが未設定/不正な接続です`, {
      permanent: true,
      status: 400,
    })
  }
  return mapping
}

/**
 * fetchDatabaseSchema が返す配列形（NotionDatabaseSchema）を、validateMappingAgainstSchema が
 * 求める「プロパティ名をキーにした Record」（NotionLiveProperties。databases.retrieve の
 * 生レスポンス形と同じ）へ組み立て直す。同一性判定は呼び出し先が id で行うため、ここでの
 * キー（名前）自体はリネームされていても構わない（値の id/type/options だけが意味を持つ）。
 */
function toLiveProperties(schema: NotionDatabaseSchema): NotionLiveProperties {
  const out: NotionLiveProperties = {}
  for (const prop of schema) {
    const live: NotionLiveProperty = { id: prop.id, type: prop.type }
    if (prop.type === 'status') live.status = { options: prop.options ?? [] }
    if (prop.type === 'select') live.select = { options: prop.options ?? [] }
    out[prop.name] = live
  }
  return out
}

/**
 * 保存済みマッピングを「今のNotionライブスキーマ」に対して再検証する（実行時のdrift検知）。
 * コンテナのポーリング初回ページ（呼び出し側が cursor 未指定のときだけ呼ぶ）に限定することで、
 * 1ポーリングにつき1コンテナ1回の GET /v1/databases/{id} に抑える。
 *
 * fetchDatabaseSchema 自体が投げる providerError（429/5xx等の一時失敗を含む）はここで
 * 握りつぶさずそのまま伝播させる（一時的なAPI障害を恒久失敗に化けさせない）。
 * 検証そのものが不合格のときだけ、ここで恒久エラー(permanent, status:400)を新たに投げる。
 */
async function assertMappingMatchesLiveSchema(
  ctx: ProviderContext,
  databaseId: string,
  mapping: NotionMapping,
): Promise<void> {
  const schema = await fetchDatabaseSchema(ctx.credentials.token, databaseId)
  const result = validateMappingAgainstSchema(mapping, toLiveProperties(schema))
  if (!result.valid) {
    throw providerError(
      `notion: databaseId=${databaseId} のNotion側プロパティ構成が変わったため取り込みを停止しました。再マッピングが必要です(${result.reason})`,
      { permanent: true, status: 400 },
    )
  }
}

// ---- Notion API のレスポンス形（メタ最小限。公開ドキュメントの Page/Database/Search で確認） ----

interface NotionRichText {
  plain_text?: string
}

interface NotionPropertyValue {
  id: string
  type: string
  title?: NotionRichText[]
  date?: { start: string; end?: string | null } | null
  status?: { id: string; name: string } | null
  select?: { id: string; name: string } | null
  checkbox?: boolean
}

interface NotionPage {
  id: string
  properties: Record<string, NotionPropertyValue>
  last_edited_time?: string | null
}

interface NotionQueryResponse {
  results?: NotionPage[]
  next_cursor?: string | null
  has_more?: boolean
}

interface NotionSearchDatabase {
  id: string
  title?: NotionRichText[]
}

interface NotionSearchResponse {
  results?: NotionSearchDatabase[]
  next_cursor?: string | null
  has_more?: boolean
}

function richTextToPlain(rich: NotionRichText[] | undefined): string {
  return (rich ?? []).map((rt) => rt.plain_text ?? '').join('')
}

/** id で一致するプロパティ値を探す（プロパティ名はリネームされ得るため使わない）。 */
function findPropertyById(properties: Record<string, NotionPropertyValue>, propId: string): NotionPropertyValue | null {
  for (const prop of Object.values(properties)) {
    if (prop.id === propId) return prop
  }
  return null
}

/**
 * 暦日として実在するか（形式だけでなく）を見る。'2026-99-99' や '2026-02-30'（3月2日への
 * 自動繰り上げ）は正規表現には合致するが実在しない。Date.UTC に通して年月日が変わらないかで
 * 判定する（UTC固定の比較なのでローカル日付のずれは起きない。既存の
 * src/lib/connectors/genericPayload.ts の isRealCalendarDate と同じ手書きの往復判定）。
 * ここはページ応答という信頼境界の検証であり、日付の生成・表示ではないため
 * CLAUDE.md の toISOString 禁止には抵触しない。
 */
function isRealCalendarDate(head: string): boolean {
  const [y, m, d] = head.split('-').map(Number)
  const date = new Date(Date.UTC(y, m - 1, d))
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d
}

/**
 * 期日を必ずローカル日付 'YYYY-MM-DD' へ落とす。date プロパティの `start` は日付のみ
 * （'2026-07-31'）か、時刻付き（'2026-07-31T23:00:00.000+09:00'）のいずれかで返る。
 * 先頭10文字は常に暦日の表現であるため、そのまま切り出す（Dateを経由しない＝UTC変換で
 * 日本時間が1日ずれる事故が原理的に起きない。CLAUDE.md の toISOString 禁止と同じ理由）。
 *
 * 戻り値 null は「date.start が日付として不正」（形式不正・存在しない暦日のいずれも含む。
 * 呼び出し側が恒久停止扱いに変える）。「期日が設定されていない」（date自体が null）とは
 * 呼び出し側で区別すること。
 */
function toLocalDateString(start: string): string | null {
  const head = start.slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(head)) return null
  return isRealCalendarDate(head) ? head : null
}

/**
 * マッピングされた期日プロパティをページ応答から読む。
 *
 * ⚠ 信頼境界: due_prop_id が設定されている（＝期日を取り込む契約の）ページで、次のいずれかが
 * 起きたら「無言で期日なし」にせず一時失敗として throw する（初回ページのライブスキーマ検証
 * （assertMappingMatchesLiveSchema）を通った後でも、ユーザーがそのすぐ後にプロパティを
 * 削除/型変更すればページ応答は不整合になり得るため、ページ単位でも防御する）:
 *   (a) プロパティ自体がページ応答に無い（削除された疑い）
 *   (b) プロパティはあるが type が 'date' でない（型変更された疑い）
 *   (c) date.start が日付として不正な形式
 * 唯一の正常な「期日なし」は (d) `date` プロパティが存在し type='date' で値が null のときだけ。
 * ここを黙って null に潰すと、期日を正本とする AI秘書の期限リマインドが無言で止まる。
 */
function resolveDueDate(mapping: NotionMapping, properties: Record<string, NotionPropertyValue>): string | null {
  if (!mapping.due_prop_id) return null
  const prop = findPropertyById(properties, mapping.due_prop_id)
  if (!prop) {
    throw providerError(
      `notion: due_prop_id=${mapping.due_prop_id} のプロパティがページ応答に存在しません(スキーマ変更の疑い)`,
    )
  }
  if (prop.type !== 'date') {
    throw providerError(
      `notion: due_prop_id=${mapping.due_prop_id} の型がdateではありません(実際=${prop.type})`,
    )
  }
  if (prop.date === undefined) {
    throw providerError(`notion: due_prop_id=${mapping.due_prop_id} のdate値がページ応答に欠落しています`)
  }
  if (prop.date === null) return null // (d) 正常: 期日未設定
  const parsed = toLocalDateString(prop.date.start)
  if (parsed === null) {
    throw providerError(`notion: due_prop_id=${mapping.due_prop_id} のdate.startが不正な日付形式です`)
  }
  return parsed
}

/**
 * マッピングされた完了プロパティから completed を判定する。マッピングが無ければ常に false。
 *
 * ⚠ 信頼境界: status マッピングがあるのに、プロパティ自体がページ応答に無い／型が食い違う場合は
 * completed=false に無言で倒さず一時失敗として throw する（resolveDueDate と同じ理由。
 * 完了が永久に取り込まれない無言の失敗を防ぐ）。プロパティは存在するが値が空/未選択
 * （checkbox=false・status/select が null）は正常な「未完了」として false を返す。
 */
function isCompleted(status: NotionStatusMapping | null, properties: Record<string, NotionPropertyValue>): boolean {
  if (!status) return false
  const prop = findPropertyById(properties, status.prop_id)
  if (!prop) {
    throw providerError(
      `notion: status.prop_id=${status.prop_id} のプロパティがページ応答に存在しません(スキーマ変更の疑い)`,
    )
  }
  if (prop.type !== status.prop_type) {
    throw providerError(
      `notion: status.prop_id=${status.prop_id} の型が想定と異なります(想定=${status.prop_type}, 実際=${prop.type})`,
    )
  }
  if (status.prop_type === 'checkbox') return prop.checkbox === true
  if (status.prop_type === 'status') return prop.status ? status.done_option_ids.includes(prop.status.id) : false
  return prop.select ? status.done_option_ids.includes(prop.select.id) : false
}

function normalizePage(page: NotionPage, containerId: string, mapping: NotionMapping): ExternalTask {
  const titleProp = Object.values(page.properties ?? {}).find((p) => p.type === 'title')
  const title = richTextToPlain(titleProp?.title).trim() || '(無題)'

  return {
    externalId: page.id,
    containerId,
    title,
    // 本文はマッピング対象外（取り込まない契約）。
    body: null,
    dueDate: resolveDueDate(mapping, page.properties ?? {}),
    completed: isCompleted(mapping.status, page.properties ?? {}),
    updatedAt: page.last_edited_time ?? null,
  }
}

/** 完了時に Notion へ書き込む properties（キーは property id）。checkbox以外はwrite_done_option_id必須。 */
function completionProperties(status: NotionStatusMapping): Record<string, unknown> {
  if (status.prop_type === 'checkbox') {
    return { [status.prop_id]: { checkbox: true } }
  }
  if (!status.write_done_option_id) {
    // 検知(done_option_ids)は設定されていても書き戻し先が無い＝読み専用の接続。設定不備として止める。
    throw providerError('notion: 完了の書き戻し先(write_done_option_id)が未設定の接続です', {
      permanent: true,
      status: 400,
    })
  }
  if (status.prop_type === 'status') {
    return { [status.prop_id]: { status: { id: status.write_done_option_id } } }
  }
  return { [status.prop_id]: { select: { id: status.write_done_option_id } } }
}

export const notionAdapter: TaskSyncAdapter = {
  id: 'notion',
  authKind: 'oauth',
  hostPolicy: NOTION_HOST_POLICY,
  // last_edited_time は秒精度のISO8601（timestampフィルタで確認）。
  cursorGranularity: 'timestamp',
  // databases.query は削除済みページを返さない（tombstone相当が無い）。
  deletionMode: 'unsupported',

  async listContainers(ctx: ProviderContext): Promise<ExternalContainer[]> {
    const databases: NotionSearchDatabase[] = []
    let cursor: string | undefined
    for (let page = 0; page < MAX_CONTAINER_PAGES; page++) {
      const body: Record<string, unknown> = {
        filter: { value: 'database', property: 'object' },
        page_size: PAGE_SIZE,
      }
      if (cursor) body.start_cursor = cursor
      const res = (await notionFetch(ctx, '/search', {
        method: 'POST',
        body: JSON.stringify(body),
      })) as NotionSearchResponse
      databases.push(...(res.results ?? []))

      if (!res.has_more) break // 取り切り

      // Notion 仕様では has_more===true なら next_cursor が来る。無ければ応答不整合であり、
      // 「取り切った」ものとして黙って打ち切ると一部のDBが対象から静かに漏れる。
      if (!res.next_cursor) {
        throw providerError(
          'notion: listContainers の応答が不整合です(has_more=trueなのにnext_cursorが空)',
        )
      }
      // 次カーソルが現在と同じ＝前進しない異常応答。打ち切ると「全件取れた」ように見えてしまうため
      // エラーにする（無限ループも防ぐ）。
      if (res.next_cursor === cursor) {
        throw providerError('notion: listContainers の応答が不整合です(next_cursorが前進していません)')
      }
      cursor = res.next_cursor
    }
    return databases.map((db) => ({ id: db.id, title: richTextToPlain(db.title).trim() || db.id }))
  },

  async listChangedTasks(
    ctx: ProviderContext,
    containerId: string,
    opts: { since?: string; cursor?: string },
  ): Promise<TaskPage> {
    // マッピングが無い/不正なDBは fetch する前に止める（コンテナ単位で恒久停止＝drift/未設定の方針）。
    const mapping = requireMapping(ctx, containerId)

    // cursor 未指定＝そのコンテナのポーリング初回ページのときだけ、今のライブスキーマに対して
    // マッピングを再検証する（1ポーリングにつき1コンテナ1回。2ページ目以降は再検証しない）。
    if (!opts.cursor) {
      await assertMappingMatchesLiveSchema(ctx, containerId, mapping)
    }

    const body: Record<string, unknown> = {
      page_size: PAGE_SIZE,
      // last_edited_time 昇順。差分ウィンドウが狭いためページ送り中の更新による取りこぼしは
      // 次サイクルの重なりで拾い直せる（Backlog差分取得と同じ考え方）。
      sorts: [{ timestamp: 'last_edited_time', direction: 'ascending' }],
    }
    if (opts.since) {
      body.filter = { timestamp: 'last_edited_time', last_edited_time: { on_or_after: opts.since } }
    }
    if (opts.cursor) body.start_cursor = opts.cursor

    const res = (await notionFetch(ctx, `/databases/${encodeURIComponent(containerId)}/query`, {
      method: 'POST',
      body: JSON.stringify(body),
    })) as NotionQueryResponse

    // Notion 仕様では has_more===true なら next_cursor が来る。無ければ応答不整合であり、
    // 「取り切った」ものとしてカーソルを前進させてしまうと、まだ残っているはずのページを
    // 二度と取りに行かない(取りこぼし)。
    if (res.has_more && !res.next_cursor) {
      throw providerError(
        'notion: listChangedTasks の応答が不整合です(has_more=trueなのにnext_cursorが空)',
      )
    }

    return {
      items: (res.results ?? []).map((p) => normalizePage(p, containerId, mapping)),
      nextCursor: res.has_more ? (res.next_cursor ?? null) : null,
    }
  },

  async completeTask(ctx: ProviderContext, ref: { externalId: string; containerId: string }): Promise<void> {
    const mapping = readMapping(ctx, ref.containerId)
    if (!mapping?.status) {
      // マッピング自体が無い／あっても完了同期(status)が未設定＝書き戻し先が無い。
      throw providerError('notion: 完了同期未設定の接続です(マッピングにstatusがありません)', {
        permanent: true,
        status: 400,
      })
    }
    const properties = completionProperties(mapping.status)
    await notionFetch(ctx, `/pages/${encodeURIComponent(ref.externalId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ properties }),
    })
  },
}
