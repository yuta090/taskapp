import { KINTONE_HOST_POLICY, apiUrl, kintoneFetch } from '@/lib/task-sync/providers/kintone/client'
import {
  normalizeKintoneAppIds,
  parseKintoneMapping,
  validateMappingAgainstSchema,
  type KintoneMapping,
  type KintoneStatusMapping,
} from '@/lib/task-sync/providers/kintone/mapping'
import { fetchAppFields } from '@/lib/task-sync/providers/kintone/schema'
import {
  providerError,
  type ExternalContainer,
  type ExternalTask,
  type ProviderContext,
  type ProviderError,
  type TaskPage,
  type TaskSyncAdapter,
} from '@/lib/task-sync/types'

/**
 * kintone アダプタ — タスク同期の inbound（取り込み）＋ 完了の書き戻しのみ。
 *
 * 公式ドキュメント（cybozu developer network / kintone.dev。2026-07 時点で確認したページを各所に
 * URLで明記する）の性質と、ここで吸収している差異:
 *
 *   - **アプリ単位トークンでは全アプリの列挙ができない**: kintoneのAPIトークンはアプリごとに
 *     発行され（公式: API Tokens tutorial https://kintone.dev/en/tutorials/introduction-to-kintone-customizations/api-tokens/ ）、
 *     「このドメインの全アプリ一覧」を返す横断APIには使えない。そのため listContainers は
 *     `ctx.config.kintone_app_ids`（接続時に運用者が指定したアプリID一覧。読み込み専用のUI
 *     （アプリURL貼り付け）は appUrl.ts が下敷き。別PRでウィザードに配線する）の各IDについて
 *     `GET /k/v1/app.json` を叩き、成功したものだけを返す。
 *   - **トークン未反映（「アプリを更新」漏れ）／権限不足の名指し**: providers/kintone/client.ts
 *     に集約。生成しただけのAPIトークンは運用環境に反映（kintone側で「アプリを更新」ボタンを押す）
 *     するまで機能せず、これを一般的な認証エラーに畳むと利用者が「壊れている」と誤解して離脱する。
 *     判定は**エラー応答の`code`**（表示言語に依存しない識別子。GAIA_IA02/GAIA_AP15/GAIA_NO01/
 *     GAIA_UN03）で行う。裏取りの範囲・限界（一次情報に到達できず第三者資料に基づく点、
 *     `code`不一致時のフォールバック設計）は client.ts のコメント参照。
 *   - **選択肢名で対応づける**: kintoneの選択肢系フィールドは option id が無く選択肢名がキー
 *     （公式: Get Form Fields の properties.{fieldcode}.options）。マッピングは
 *     フィールドコード＋選択肢名で持つ（mapping.ts 冒頭のコメント参照。選択肢名を変更すると
 *     対応が壊れる構造的な制約）。
 *   - **STATUS(プロセス管理)フィールドは通常のレコード更新では書けない**: 完了の書き戻しは
 *     常に Update Status API（プロセス管理のアクション実行。公式:
 *     https://kintone.dev/en/docs/kintone/rest-api/records/update-status/ ）を使う。
 *     `PUT /k/v1/record/status.json` は revision による楽観ロックに対応しており
 *     （公式ドキュメントに明記）、完了処理の直前に `GET /k/v1/record.json` でレコードを取り直し
 *     現在の $revision を渡す。
 *   - **差分取得**: `GET /k/v1/records.json` の query で絞り込む（公式:
 *     https://kintone.dev/en/docs/kintone/rest-api/records/get-records/ ）。更新日時での絞り込みに
 *     使うフィールドコードは UPDATED_TIME 型（既定表示名は「更新日時」だが、この既定名も含め
 *     フィールドコードはリネームされ得るため、固定文字列で決め打ちせず fields.json から
 *     UPDATED_TIME 型のフィールドを毎回探して使う）。limit最大500・offset上限10,000
 *     （同ドキュメントの Limitations 節）。
 *   - **実行時のスキーマdrift再検証**: Notion と同じ2段構え。コンテナのポーリング初回ページ
 *     （`opts.cursor` 未指定のとき）に限り1回だけ `fetchAppFields` で今のライブスキーマを取り、
 *     `validateMappingAgainstSchema` で照合する。不一致なら推測で続行せず恒久エラーで停止する。
 *     このとき解決した「更新日時フィールドのコード」は、同じポーリングサイクルの2ページ目以降でも
 *     必要なため、内部カーソル（不透明文字列。中身はJSON）に埋め込んで運ぶ
 *     （2ページ目以降は fields.json を叩き直さない＝1ポーリングにつき1コンテナ1回に抑える）。
 *   - **削除の検知**: `GET /k/v1/records.json` は削除済みレコードを返さない（tombstoneが無い）ため
 *     deletionMode='unsupported'。
 *   - createTask/updateTask は実装しない（取り込み専用＋完了の書き戻しのみ。契約上optional）。
 */

const KINTONE_APP_PATH = '/k/v1/app.json'
const KINTONE_FIELDS_UPDATED_TYPE = 'UPDATED_TIME'
const KINTONE_RECORDS_PATH = '/k/v1/records.json'
const KINTONE_RECORD_PATH = '/k/v1/record.json'
const KINTONE_STATUS_PATH = '/k/v1/record/status.json'

/** 1ページの取得件数。kintoneのGet Records APIの上限(500)まで使う（APIトークンは呼び出し回数に
 * 実務上の上限が無いわけではないため、ページ数を減らせるだけ減らす）。 */
const PAGE_SIZE = 500

/** offset の上限（公式: Get Records の Limitations「The maximum offset value...is 10000」）。 */
const MAX_OFFSET = 10_000

// ---- config.kintone_app_ids / kintone_mappings の読み取り ----

/** 接続設定で指定されたアプリID一覧（数値文字列のみ）。raw な値を信用せず、ここで検証する。 */
function configuredAppIds(ctx: ProviderContext): string[] {
  return normalizeKintoneAppIds(ctx.config?.kintone_app_ids)
}

/** appId に対応するマッピングを取り出す。未設定/形式不正なら null（呼び出し側がエラーに変える）。 */
function readMapping(ctx: ProviderContext, appId: string): KintoneMapping | null {
  const raw = ctx.config?.kintone_mappings
  if (!raw || typeof raw !== 'object') return null
  const candidate = (raw as Record<string, unknown>)[appId]
  if (candidate === undefined) return null
  const parsed = parseKintoneMapping(candidate)
  return parsed.ok ? parsed.data : null
}

/**
 * appId が kintone_mappings に**エントリとして存在するか**（値の妥当性は問わない）。
 * readMapping は「無い」と「あるが不正」を区別せず null に潰すため、requireMapping が
 * 「未マッピング(設定途中の正常な状態)」と「マッピングが壊れている(異常)」を分けるために使う。
 */
function hasMappingEntry(ctx: ProviderContext, appId: string): boolean {
  const raw = ctx.config?.kintone_mappings
  if (!raw || typeof raw !== 'object') return false
  return Object.prototype.hasOwnProperty.call(raw as Record<string, unknown>, appId)
}

/**
 * マッピング必須の操作(listChangedTasks)用。無ければ再試行しても直らない設定不備として止める。
 *
 * ⚠ 「未マッピング」と「マッピングが壊れている」は別物として区別する(エンジン engine.ts の
 * 対応と対で読む): アプリを追加した直後、マッピングウィザードをまだ完了していない状態
 * （kintone_mappings に appId のエントリ自体が無い）は**設定途中の正常な状態**であり、
 * このアプリ単体だけを今回のポーリング対象から静かに外せば十分で、接続全体（他の
 * 設定済みアプリ）まで止める理由が無い。`pendingConfig: true` を立てて区別する。
 * 一方、エントリはあるのに parseKintoneMapping が拒否する（構造が壊れている）場合は
 * 「設定途中」ではなく想定外の異常なので、従来どおり `pendingConfig` を立てず接続全体を止める。
 */
function requireMapping(ctx: ProviderContext, appId: string): KintoneMapping {
  const mapping = readMapping(ctx, appId)
  if (!mapping) {
    if (!hasMappingEntry(ctx, appId)) {
      throw providerError(`kintone: appId=${appId} のマッピングが未設定です(設定待ち)`, {
        permanent: true,
        status: 400,
        pendingConfig: true,
      })
    }
    throw providerError(`kintone: appId=${appId} のマッピングが不正な接続です`, {
      permanent: true,
      status: 400,
    })
  }
  return mapping
}

// ---- kintone REST API のレスポンス形（メタ最小限） ----

interface KintoneFieldValue {
  type: string
  value: unknown
}

type KintoneRecord = Record<string, KintoneFieldValue>

interface RawRecordsResponse {
  records?: KintoneRecord[]
  /** `totalCount=true` を付けたときだけ返る、クエリ条件に合致するレコードの総件数（文字列）。
   * 公式: Get Records の Response Parameters（2026-07 時点で確認）。 */
  totalCount?: string
}

interface RawGetRecordResponse {
  record?: KintoneRecord
}

interface RawAppResponse {
  appId?: string
  name?: string
}

// ---- 内部カーソル（不透明文字列。中身はJSON。エンジンには形式を漏らさない契約） ----

interface KintoneCursorState {
  offset: number
  /** UPDATED_TIME型フィールドのコード。初回ページで解決し、2ページ目以降はここから運ぶ。 */
  updatedFieldCode: string | null
}

function encodeCursor(state: KintoneCursorState): string {
  return JSON.stringify(state)
}

function decodeCursor(cursor: string): KintoneCursorState {
  try {
    const parsed: unknown = JSON.parse(cursor)
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      typeof (parsed as { offset?: unknown }).offset === 'number' &&
      Number.isFinite((parsed as { offset: number }).offset) &&
      (parsed as { offset: number }).offset >= 0 &&
      ((parsed as { updatedFieldCode?: unknown }).updatedFieldCode === null ||
        typeof (parsed as { updatedFieldCode?: unknown }).updatedFieldCode === 'string')
    ) {
      const p = parsed as KintoneCursorState
      return { offset: p.offset, updatedFieldCode: p.updatedFieldCode }
    }
  } catch {
    // fallthrough: 不正なJSON
  }
  throw providerError('kintone: 内部カーソルの形式が不正です(データ破損の疑い)', {
    permanent: true,
    status: 400,
  })
}

// ---- 暦日の実在判定（表示・生成ではなく応答検証。CLAUDE.md の toISOString 禁止には抵触しない） ----

function isRealCalendarDate(head: string): boolean {
  const [y, m, d] = head.split('-').map(Number)
  const date = new Date(Date.UTC(y, m - 1, d))
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d
}

/**
 * kintoneのDATE型の値は既にローカル日付 'YYYY-MM-DD' そのもの（公式: Field Types の Date
 * `"value": "2015-04-15"`。時刻を経由しないためNotion/Backlogのような先頭10文字切り出しは不要）。
 * 形式と暦日の実在の両方を確認する。
 */
function isValidCalendarDateString(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && isRealCalendarDate(value)
}

// ---- レコード値の読み取り(信頼境界。Notionアダプタと同じ「無言で握り潰さない」方針) ----

function resolveTitle(mapping: KintoneMapping, record: KintoneRecord): string {
  const prop = record[mapping.title_field_code]
  if (!prop) {
    throw providerError(
      `kintone: title_field_code=${mapping.title_field_code} のフィールドがレコード応答に存在しません(スキーマ変更の疑い)`,
    )
  }
  const text = typeof prop.value === 'string' ? prop.value.trim() : String(prop.value ?? '').trim()
  return text || '(無題)'
}

/**
 * ⚠ 信頼境界: due_field_code が設定されている(＝期日を取り込む契約の)アプリで、次のいずれかが
 * 起きたら「無言で期日なし」にせず一時失敗として throw する(初回ページのライブスキーマ検証を
 * 通った後でも、ユーザーがそのすぐ後にフィールドを削除/型変更すればレコード応答は不整合になり
 * 得るため、レコード単位でも防御する。Notionアダプタの resolveDueDate と同じ設計):
 *   (a) フィールド自体がレコード応答に無い(削除された疑い)
 *   (b) フィールドはあるが type が 'DATE' でない(型変更された疑い)
 *   (c) value が日付として不正な形式
 * 唯一の正常な「期日なし」は (d) value が null のときだけ(公式: Empty Value Responses の Date行)。
 */
function resolveDueDate(mapping: KintoneMapping, record: KintoneRecord): string | null {
  if (!mapping.due_field_code) return null
  const prop = record[mapping.due_field_code]
  if (!prop) {
    throw providerError(
      `kintone: due_field_code=${mapping.due_field_code} のフィールドがレコード応答に存在しません(スキーマ変更の疑い)`,
    )
  }
  if (prop.type !== 'DATE') {
    throw providerError(
      `kintone: due_field_code=${mapping.due_field_code} の型がDATEではありません(実際=${prop.type})`,
    )
  }
  if (prop.value === null) return null // (d) 正常: 期日未設定
  if (typeof prop.value !== 'string' || !isValidCalendarDateString(prop.value)) {
    throw providerError(`kintone: due_field_code=${mapping.due_field_code} の値が不正な日付形式です`)
  }
  return prop.value
}

/**
 * ⚠ 信頼境界: status マッピングがあるのに、プロパティ自体がレコード応答に無い／型が食い違う場合は
 * completed=false に無言で倒さず一時失敗として throw する(resolveDueDateと同じ理由)。
 * 未選択(DROP_DOWN/RADIO_BUTTONのvalue=null)は正常な「未完了」として false を返す。
 */
function isCompleted(status: KintoneStatusMapping | null, record: KintoneRecord): boolean {
  if (!status) return false
  const prop = record[status.field_code]
  if (!prop) {
    throw providerError(
      `kintone: status.field_code=${status.field_code} のフィールドがレコード応答に存在しません(スキーマ変更の疑い)`,
    )
  }
  if (prop.type !== status.field_type) {
    throw providerError(
      `kintone: status.field_code=${status.field_code} の型が想定と異なります(想定=${status.field_type}, 実際=${prop.type})`,
    )
  }
  if (status.field_type === 'CHECK_BOX') {
    if (!Array.isArray(prop.value)) {
      throw providerError(`kintone: status.field_code=${status.field_code} の値が配列ではありません(CHECK_BOX型)`)
    }
    return (prop.value as unknown[]).some((v) => typeof v === 'string' && status.done_values.includes(v))
  }
  if (prop.value === null) return false // 未選択 = 未完了(正常)
  if (typeof prop.value !== 'string') {
    throw providerError(`kintone: status.field_code=${status.field_code} の値が文字列ではありません`)
  }
  return status.done_values.includes(prop.value)
}

function normalizeRecord(
  record: KintoneRecord,
  containerId: string,
  mapping: KintoneMapping,
  updatedFieldCode: string | null,
): ExternalTask {
  const idValue = record.$id?.value
  const externalId = typeof idValue === 'string' ? idValue : idValue != null ? String(idValue) : ''
  if (!externalId) {
    throw providerError('kintone: レコード応答に$idが存在しません(応答不整合)')
  }
  const updatedValue = updatedFieldCode ? record[updatedFieldCode]?.value : undefined
  const updatedAt = typeof updatedValue === 'string' ? updatedValue : null

  return {
    externalId,
    containerId,
    title: resolveTitle(mapping, record),
    // 本文はマッピング対象外(取り込まない契約)。
    body: null,
    dueDate: resolveDueDate(mapping, record),
    completed: isCompleted(mapping.status, record),
    updatedAt,
  }
}

/** kintoneフィールド定義から UPDATED_TIME 型のフィールドコードを探す(固定名で決め打ちしない)。 */
function findUpdatedFieldCode(fields: Awaited<ReturnType<typeof fetchAppFields>>): string | null {
  return fields.find((f) => f.type === KINTONE_FIELDS_UPDATED_TYPE)?.code ?? null
}

/**
 * `totalCount=true` を付けて取得したレコード総件数(文字列)を数値化する。
 * ⚠ 信頼境界: totalCount=trueを明示的に指定しているため、応答にtotalCountが無い/数値化できない
 * のは応答不整合(無言でページングを打ち切る/続けるのどちらにも倒さず一時失敗として顕在化させる。
 * 他のレコード単位の信頼境界(resolveDueDate等)と同じ「無言で握り潰さない」方針)。
 */
function parseTotalCount(raw: string | undefined, containerId: string): number {
  const n = typeof raw === 'string' ? Number(raw) : NaN
  if (!Number.isFinite(n) || n < 0) {
    throw providerError(`kintone: appId=${containerId} のtotalCountを取得できませんでした(応答不整合)`)
  }
  return n
}

export const kintoneAdapter: TaskSyncAdapter = {
  id: 'kintone',
  authKind: 'api_key',
  hostPolicy: KINTONE_HOST_POLICY,
  // 更新日時(UPDATED_TIME型)は秒精度のISO8601(公式: Field Types の Updated datetime)。
  cursorGranularity: 'timestamp',
  // records.json は削除済みレコードを返さない(tombstone相当が無い)。
  deletionMode: 'unsupported',

  async listContainers(ctx: ProviderContext): Promise<ExternalContainer[]> {
    const appIds = configuredAppIds(ctx)
    const out: ExternalContainer[] = []
    for (const appId of appIds) {
      try {
        const url = new URL(apiUrl(ctx.credentials.baseUrl, KINTONE_APP_PATH))
        url.searchParams.set('id', appId)
        const res = (await kintoneFetch(
          url.toString(),
          ctx.credentials.token,
          { method: 'GET' },
          `アプリ情報の取得(app=${appId})`,
        )) as RawAppResponse
        out.push({ id: res.appId ?? appId, title: res.name?.trim() || appId })
      } catch (err) {
        const status = (err as ProviderError | undefined)?.status
        // ⚠ 既知の制約（未対応。今回のCodexレビューで指摘済みだが、意図的にスコープ外とする）:
        // 403(このトークンにアクセス権が無い)と404(アプリ自体が削除された)を区別せず、どちらも
        // 「このアプリは返さない」に握り潰している。この結果、トークンが失効した接続は
        // listContainers が空配列を返すだけになり、エンジン(engine.ts)からは
        // 「正常に空のコンテナ一覧を持つ接続」に見えてしまう（本来は再接続が必要な異常なのに、
        // エラーとして顕在化しない）。
        // 直さない理由: 正しく直すには「一時的にアクセス不能（後で復活しうる）」と
        // 「恒久的に消えた（二度と戻らない）」を区別する必要があり、これは欠落コンテナ台帳
        // (import_missing_containers。engine.ts の updateMissingMap 参照)の設計に踏み込む
        // 判断が要る（このPRのスコープ外）。後続の課題として残す。
        if (status === 403 || status === 404) continue // トークンが無効/剥奪。このアプリは返さない。
        throw err
      }
    }
    return out
  },

  async listChangedTasks(
    ctx: ProviderContext,
    containerId: string,
    opts: { since?: string; cursor?: string },
  ): Promise<TaskPage> {
    // マッピングが無い/不正なアプリは fetch する前に止める(コンテナ単位で恒久停止)。
    const mapping = requireMapping(ctx, containerId)

    let updatedFieldCode: string | null
    let offset: number

    if (!opts.cursor) {
      // 初回ページ: 今のライブスキーマに対してマッピングを再検証する(1ポーリングにつき1回)。
      const fields = await fetchAppFields(ctx.credentials.baseUrl, ctx.credentials.token, containerId)
      const result = validateMappingAgainstSchema(mapping, fields)
      if (!result.valid) {
        throw providerError(
          `kintone: appId=${containerId} のkintone側フィールド構成が変わったため取り込みを停止しました。再マッピングが必要です(${result.reason})`,
          { permanent: true, status: 400 },
        )
      }
      updatedFieldCode = findUpdatedFieldCode(fields)
      if (opts.since && !updatedFieldCode) {
        throw providerError(
          `kintone: appId=${containerId} で更新日時フィールド(UPDATED_TIME型)が見つからないため差分取得できません`,
          { permanent: true, status: 400 },
        )
      }
      offset = 0
    } else {
      const state = decodeCursor(opts.cursor)
      updatedFieldCode = state.updatedFieldCode
      offset = state.offset
    }

    if (offset > MAX_OFFSET) {
      throw providerError(
        `kintone: appId=${containerId} のoffset上限(${MAX_OFFSET})を超えました。レコード件数が多すぎて全件取り込めません`,
        { permanent: true, status: 400 },
      )
    }

    // 差分取得(sinceあり): 更新日時フィールドで絞り込み、同フィールドの昇順にする。
    //   ⚠ 同一更新日時のレコードが複数あると、その値だけの order by ではページ間の順序が
    //   保証されず、ページ境界をまたいで同順位のレコードの重複/欠落が起こり得る（公式ドキュメント
    //   のQuery Stringに「order byを複数指定するにはカンマで区切る」「orderby省略時は$idの降順」の
    //   記載があり、$idはレコードごとに一意かつ不変のため、確定的な第2ソートキーとして安全に使える。
    //   https://kintone.dev/en/docs/kintone/overview/query-string/ 2026-07時点で確認）。
    //   `$id asc` を第2キーに加えて順序を一意に固定する。
    // 初回全件取得(sinceなし): $id昇順(不変の作成順相当。単独で既に一意)にする。ページ送り中の
    // 更新による並び替えで取りこぼしても、次サイクルの重なりで拾い直せる(backlogアダプタと同じ考え方)。
    const query =
      opts.since && updatedFieldCode
        ? `${updatedFieldCode} > "${opts.since}" order by ${updatedFieldCode} asc, $id asc limit ${PAGE_SIZE} offset ${offset}`
        : `order by $id asc limit ${PAGE_SIZE} offset ${offset}`

    const url = new URL(apiUrl(ctx.credentials.baseUrl, KINTONE_RECORDS_PATH))
    url.searchParams.set('app', containerId)
    url.searchParams.set('query', query)
    // totalCount=true: 総件数を毎回取得する(公式: Get Records の Response Parameters。
    // https://kintone.dev/en/docs/kintone/rest-api/records/get-records/ 2026-07時点で確認)。
    // 「500件返ってきたら次ページがある」という決め打ちだけでは、ちょうどoffset上限
    // (10,000)の直前のページが偶然ぴったり500件だった場合に、実際には続きが無いのに
    // 次ページを要求してしまい(offset=10,500はoffset上限超過で必ず失敗する)、エンジンが
    // カーソルを進められないまま同じ場所で失敗し続ける恐れがある。総件数と突き合わせて
    // 「本当に続きがあるか」を判定する。
    url.searchParams.set('totalCount', 'true')
    const res = (await kintoneFetch(
      url.toString(),
      ctx.credentials.token,
      { method: 'GET' },
      `レコード一覧の取得(app=${containerId})`,
    )) as RawRecordsResponse

    const records = res.records ?? []
    const items = records.map((r) => normalizeRecord(r, containerId, mapping, updatedFieldCode))
    const fetchedSoFar = offset + records.length

    // records.length が PAGE_SIZE 未満なら、それだけで「もう続きが無い」と確定できる
    // (総件数を見るまでもない安全な事実)。ちょうど PAGE_SIZE 件返ってきたときだけ、次ページの
    // 有無が records.length だけでは決められない(それが偶然ぴったり終端という可能性がある)ため
    // totalCount で判定する。
    let nextCursor: string | null = null
    if (records.length === PAGE_SIZE) {
      const totalCount = parseTotalCount(res.totalCount, containerId)
      if (fetchedSoFar < totalCount) {
        if (fetchedSoFar > MAX_OFFSET) {
          // 続きは確かにあるが、次に必要なoffsetが上限を超える＝offset方式では原理的に
          // 全件を取り切れない。黙って打ち切らず、恒久失敗として明示する
          // (将来的にはCursor API(https://kintone.dev/en/docs/kintone/rest-api/records/get-records-cursor/
          // 相当)への移行で解消できる想定。今回のスコープ外)。
          throw providerError(
            `kintone: appId=${containerId} は対象レコードが${totalCount}件あり、offset方式の上限` +
              `(offset<=${MAX_OFFSET})では全件を取り込めません。取り込み範囲(query)を絞ってください`,
            { permanent: true, status: 400 },
          )
        }
        nextCursor = encodeCursor({ offset: fetchedSoFar, updatedFieldCode })
      }
    }

    return { items, nextCursor }
  },

  /**
   * ⚠ 既知の制約(未対応。設計判断がスコープ外のため次段のPRへ送る):
   *   プロセス管理のワークフローで、現在のステータスの「次の作業者(Assignee)」を
   *   ユーザーに選ばせる設定（公式: Update Status の Request Parameters「assignee: Conditionally
   *   required. Required if the "Assignee List" of the current status is set to "User chooses one
   *   assignee from the list to take action"」。2026-07時点で確認: 該当ページに missing-assignee
   *   専用のエラー`code`の記載は無く、レスポンスのError Response(`{code, id, message}`)の一般形
   *   以上の情報が公式ドキュメントから確認できなかったため、専用の分類は追加しない
   *   (裏取りできない`code`を推測で決め打ちしない)）では、この実装は `assignee` を一切渡さない
   *   ため Update Status API 呼び出しが必ず失敗する。次の作業者の指定をマッピングに追加し、
   *   ウィザードでユーザーに選ばせる設計が必要（設計判断が要るため本PRのスコープ外）。
   *   該当ワークフローでは client.ts の汎用エラー分類（未知code・非認証系statusは汎用エラー
   *   メッセージ）にそのまま落ち、`res.status`（kintoneはこの種の入力エラーを400系で返す想定）は
   *   運用者に伝わるが、原因(assignee不足)を名指しはできない。
   */
  async completeTask(ctx: ProviderContext, ref: { externalId: string; containerId: string }): Promise<void> {
    const mapping = readMapping(ctx, ref.containerId)
    if (!mapping?.status) {
      // マッピング自体が無い／あっても完了同期(status)が未設定＝書き戻し先が無い。
      throw providerError('kintone: 完了同期未設定の接続です(マッピングにstatusがありません)', {
        permanent: true,
        status: 400,
      })
    }
    if (!mapping.status.write_done_action) {
      // 検知(done_values)は設定されていても書き戻し先(プロセス管理アクション)が無い＝読み専用の接続。
      // field_type!=='STATUS' のマッピングは write_done_action が常に null になる契約
      // (parseKintoneMapping/validateMappingAgainstSchemaがSTATUS型以外への設定を拒否するため)。
      // その場合は「なぜ書き戻せないか」を名指しする(選択肢フィールドの検知のみで書き戻しには
      // プロセス管理(STATUS型)が要ることを伝える。単なる「未設定です」より運用者が次に何を
      // すればいいか分かる)。
      if (mapping.status.field_type !== 'STATUS') {
        throw providerError(
          'kintone: このアプリは完了の書き戻しに対応していません(プロセス管理のステータス(STATUS型)を完了判定に使う設定が必要です。現在は選択肢フィールドの検知のみで書き戻しはできません)',
          { permanent: true, status: 400 },
        )
      }
      throw providerError(
        'kintone: 完了の書き戻し先(write_done_action)が未設定の接続です(選択肢の検知のみで書き戻しはできません)',
        { permanent: true, status: 400 },
      )
    }

    // revisionによる楽観ロックのため、Update Status実行の直前に現在のrevisionを取り直す
    // (completeTaskのrefにはrevisionが渡されない契約のため、ここで自前取得する)。
    const recordUrl = new URL(apiUrl(ctx.credentials.baseUrl, KINTONE_RECORD_PATH))
    recordUrl.searchParams.set('app', ref.containerId)
    recordUrl.searchParams.set('id', ref.externalId)
    const recordRes = (await kintoneFetch(
      recordUrl.toString(),
      ctx.credentials.token,
      { method: 'GET' },
      `レコード取得(完了処理前のrevision確認。app=${ref.containerId})`,
    )) as RawGetRecordResponse

    const revisionValue = recordRes.record?.['$revision']?.value
    const revision = typeof revisionValue === 'string' ? Number(revisionValue) : NaN
    if (!Number.isFinite(revision)) {
      throw providerError(
        `kintone: appId=${ref.containerId} id=${ref.externalId} のレコードから$revisionを取得できませんでした(応答不整合)`,
      )
    }

    // revision競合時(楽観ロック)は kintoneFetch 側で code=GAIA_UN03 を判定し、permanentを
    // 付けない一時失敗として throw する(client.ts のコメント参照。このコード自体は一次情報で
    // 再確認できていないため、フォールバック(401/403/520かつ未知コード時の3候補案内)が
    // 別途効くようになっている)。
    await kintoneFetch(
      apiUrl(ctx.credentials.baseUrl, KINTONE_STATUS_PATH),
      ctx.credentials.token,
      {
        method: 'PUT',
        body: JSON.stringify({
          app: Number(ref.containerId),
          id: Number(ref.externalId),
          action: mapping.status.write_done_action,
          revision,
        }),
      },
      `プロセス管理の実行(完了の書き戻し。app=${ref.containerId})`,
    )
  },
}
