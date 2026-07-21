import { createClient as createSupabaseClient, type SupabaseClient } from '@supabase/supabase-js'
import { getTaskSyncAdapter } from '@/lib/task-sync/adapters'
import { resolveCredentials, type ConnectionCredentialRow } from '@/lib/task-sync/credentials'
import { importConnection, type ImportTargets } from '@/lib/task-sync/engine'
import { createTaskSyncStore, validateImportTargets } from '@/lib/task-sync/store'

/**
 * タスク同期の取り込みランナー（cron から呼ばれる入口）。
 *
 * 役割は「接続を集めて、資格情報を解決して、アダプタとエンジンに繋ぐ」ことだけ。
 * 取り込みの制御は engine.ts、外部APIの叩き方は各アダプタ、DB操作は store.ts が持つ。
 * ここに条件分岐を溜めないのが、ツールが増えても壊れない前提（gtasks 専用の import.ts が
 * 1ファイルに全部持っていたのを、この4層に割った）。
 */

let _admin: SupabaseClient | null = null
function admin(): SupabaseClient {
  if (!_admin) {
    _admin = createSupabaseClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )
  }
  return _admin
}

/**
 * この経路の担当**外**であることが正常な provider。「アダプタが無い＝異常」と「担当外＝正常」を
 * 区別するための表。ここに載っていない未知の provider だけを異常として記録する。
 *   - google_tasks / multica: 既存の専用ワーカーが取り込む（ここで処理すると二重取り込み）
 *   - generic_inbound: 相手から送ってもらう受信型。こちらから取りに行く対象が無い
 *     （載せ忘れると、受信口を作った瞬間から毎サイクル「同期されない接続」として誤警告が出る）
 */
const OTHER_WORKER_PROVIDERS = new Set(['google_tasks', 'multica', 'generic_inbound'])

export interface TaskSyncRunSummary {
  connections: number
  created: number
  updated: number
  completed: number
  orphaned: number
  skipped: number
  /** provider ごとの skip 理由（運用ログ用。件数だけでは原因が分からないため）。 */
  reasons: string[]
}

/** 取り込み対象の接続行（必要な列だけ）。 */
interface ConnectionRow extends ConnectionCredentialRow {
  org_id: string
  provider: string
  import_config: Record<string, unknown> | null
  poll_cursor: string | null
  last_import_success_at: string | null
  last_poll_attempt_at: string | null
  /** 欠落台帳（jsonb）。形式は engine.ts 参照。DB由来の unknown として扱い、ここで検証する。 */
  import_missing_containers: unknown
}

/**
 * 欠落台帳(import_missing_containers)の生値(jsonbから来たunknown)を検証・正規化する。
 * 壊れた値（配列・非object・値が文字列でないエントリを含む等）はエンジンを落とさず空扱いに
 * フォールバックする。1行の壊れた値でその接続の取り込みが恒久停止するのを避けるため
 * （isPollDue の「壊れた時刻は叩く側に倒す」と同じ安全側の考え方）。
 */
function parseStoredMissing(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === 'string') out[key] = value
  }
  return out
}

/**
 * このサイクルでこの接続を叩いてよいか（ツール固有の呼び出し回数上限への配慮）。
 *
 * cron は全接続を同じ間隔で起こすが、ツールによっては呼び出し回数そのものに厳しい上限がある
 * （Jooto は標準プランで月100回）。上限を超えると以後まったく同期できなくなる。
 *
 * 判定には**成功時刻ではなく「試行時刻」**を使う。成功時刻だけで判定すると、失敗し続ける接続に
 * 間隔が一切効かず、失敗ループがそのまま上限の食い潰しになる（＝一番効かせたい場面で効かない）。
 * 見送りは失敗ではないので skip 件数にも数えない（毎サイクル積み上がると本当の異常が埋もれる）。
 */
function isPollDue(
  adapter: { minPollIntervalMinutes?: number },
  lastAttemptAt: string | null,
  now: Date,
  configuredFloorMinutes?: number,
): boolean {
  // 接続ごとに間隔を**延ばす**設定は許すが、縮める設定は許さない。上限はツール側の事実であり、
  // 設定で緩めると上限超過＝同期停止を運用者が自分で招くことになる。
  const floor = Math.max(adapter.minPollIntervalMinutes ?? 0, configuredFloorMinutes ?? 0)
  if (!floor || !lastAttemptAt) return true
  const elapsedMinutes = (now.getTime() - Date.parse(lastAttemptAt)) / 60_000
  // 時刻が壊れている（パース不能・未来＝負の経過）ときは叩く側に倒す。叩けない方に倒すと、
  // 1行の壊れた値でその接続が永久に同期されなくなる（沈黙して原因も分からない）。
  if (!Number.isFinite(elapsedMinutes) || elapsedMinutes < 0) return true
  return elapsedMinutes >= floor
}

/**
 * 接続設定で指定された最短ポーリング間隔（分）。アダプタの宣言より**長い**ときだけ効く。
 *
 * 必要な理由: ツールの呼び出し上限は「回数」であって「間隔」ではない。1サイクルの消費量は
 * 取り込み対象の数に比例するため、対象が多い契約では宣言された間隔でも上限を超える
 * （例: Jooto 標準プランは月100回。1日1回でも対象ボードが3つあれば 30×(1+3)=120回で超過する）。
 * 対象数はテナントごとに違い、アダプタからは決められないので、運用側が延ばせる余地を残す。
 */
function configuredPollFloor(raw: Record<string, unknown> | null): number | undefined {
  const value = raw?.min_poll_interval_minutes
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined
}

/**
 * 外部を叩く権利を**条件付き更新で取り合う**（claim）。取れたときだけ true を返す。
 *
 * 単に「時刻を書く」だけでは同時実行を防げない: cron が重なると両方が同じ一括SELECTの結果
 * （古い試行時刻）を見て、両方とも叩いてしまう。1接続あたりの消費が読み取り回数に直結する
 * ツール（Jooto は月100回）では、これがそのまま上限の食い潰しになる。
 *
 * そこで「自分が見た試行時刻から変わっていないこと」を条件に更新し、更新できた1つだけが叩く。
 * 条件に合う行が無い＝他方が先に取った、なので見送る。
 *
 * 書き込みに失敗したときは**叩かない**（fail closed）。ここで通してしまうと、書き込みが
 * 恒常的に失敗する状況で cron のたびに外部を叩き続け、上限を数時間で使い切る。
 */
async function claimPollSlot(conn: ConnectionRow, at: Date): Promise<boolean> {
  const query = admin()
    .from('integration_connections')
    .update({ last_poll_attempt_at: at.toISOString() })
    .eq('id', conn.id)
  // 「自分が見た値のまま」を条件にする（null は is null で照合する必要がある）。
  const scoped = conn.last_poll_attempt_at
    ? query.eq('last_poll_attempt_at', conn.last_poll_attempt_at)
    : query.is('last_poll_attempt_at', null)

  const { data, error } = await scoped.select('id')
  if (error) {
    console.error('[task-sync] failed to claim poll slot:', conn.id, error.message)
    return false
  }
  return ((data as unknown[] | null) ?? []).length > 0
}

/**
 * import_config から共通の取り込み先設定を読む。
 *
 * `read_container_ids` は既存 gtasks の `read_list_ids` と同じ役割（取り込み対象の入れ物）。
 * 新しいキー名にしたのは、ツールによって「リスト/プロジェクト/ボード」と呼び名が違うため
 * 一般名に寄せたから。既存 gtasks の設定は触らない（別 provider なので衝突しない）。
 */
function parseTargets(raw: Record<string, unknown> | null): ImportTargets {
  const c = raw ?? {}
  const containers = c.read_container_ids ?? c.read_list_ids
  return {
    targetSpaceId: typeof c.target_space_id === 'string' ? c.target_space_id : undefined,
    readContainerIds: Array.isArray(containers)
      ? containers.filter((v): v is string => typeof v === 'string')
      : undefined,
    defaultAssigneeId: typeof c.default_assignee_id === 'string' ? c.default_assignee_id : null,
  }
}

/** provider 固有の設定（`<provider>_` 接頭辞のキー）だけをアダプタへ渡す。 */
function parseProviderConfig(raw: Record<string, unknown> | null, provider: string): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(raw ?? {})) {
    if (key.startsWith(`${provider}_`)) out[key] = value
  }
  return out
}

/**
 * 取り込み対象の接続を1バッチ処理する。
 *
 * 対象は「アダプタが実装済み・import_enabled・status=active」の接続のみ。
 * gtasks / multica は既存の専用ワーカー（google-tasks/import.ts・connectors/dispatch.ts）が
 * 引き続き担当する（二重に取り込まないよう、この経路はアダプタ登録表にあるものだけを見る）。
 */
export async function runTaskSyncImport(): Promise<TaskSyncRunSummary> {
  const summary: TaskSyncRunSummary = {
    connections: 0,
    created: 0,
    updated: 0,
    completed: 0,
    orphaned: 0,
    skipped: 0,
    reasons: [],
  }

  const { data, error } = await admin()
    .from('integration_connections')
    .select(
      // refresh_token_encrypted/refresh_token は resolveCredentials が「更新可能なOAuthか」を
      // 判定するために必須（無ければ更新不能なOAuth＝Notion等として扱う。credentials.ts 参照）。
      'id, org_id, provider, auth_kind, base_url, access_token_encrypted, refresh_token_encrypted, refresh_token, import_config, poll_cursor, last_import_success_at, last_poll_attempt_at, import_missing_containers',
    )
    .eq('import_enabled', true)
    .eq('status', 'active')
  if (error) {
    console.error('[task-sync] connection fetch failed:', error)
    return summary
  }

  for (const conn of (data as ConnectionRow[] | null) ?? []) {
    const adapter = getTaskSyncAdapter(conn.provider)
    if (!adapter) {
      // gtasks/multica は既存の専用ワーカーが担当するため、ここで落ちるのが正しい（二重取り込み防止）。
      if (OTHER_WORKER_PROVIDERS.has(conn.provider)) continue
      // それ以外の未知 provider は「接続済みに見えるのに永久に同期されない」状態。
      // DBの provider 列は形式チェックのみになったので、黙って飛ばすと誰も気づけない。
      // 件数と理由を必ず記録する（運用が原因に辿り着けるようにするのが目的）。
      console.error('[task-sync] no adapter for provider (connection will never sync):', conn.provider, conn.id)
      summary.skipped++
      summary.reasons.push(`${conn.provider}: unknown_provider`)
      continue
    }

    // ツール固有の呼び出し上限に配慮して、まだ叩いてよい時刻でなければ静かに見送る。
    const startedAt = new Date()
    if (!isPollDue(adapter, conn.last_poll_attempt_at, startedAt, configuredPollFloor(conn.import_config)))
      continue

    summary.connections++
    try {
      await runOne(conn, adapter, summary, startedAt)
    } catch (err) {
      // 1接続の想定外エラーで他の接続の取り込みまで止めない。カーソルは前進していないので
      // 次サイクルで同じ範囲を取り直す。
      console.error('[task-sync] connection failed:', conn.id, err)
      summary.skipped++
      summary.reasons.push(`${conn.provider}: unexpected_error`)
    }
  }
  return summary
}

async function runOne(
  conn: ConnectionRow,
  adapter: NonNullable<ReturnType<typeof getTaskSyncAdapter>>,
  summary: TaskSyncRunSummary,
  startedAt: Date,
): Promise<void> {
  const targets = parseTargets(conn.import_config)

  // ローカルで完結する検証は claim の**前**に済ませる。claim してから落ちると、設定を直した
  // 直後でも次の間隔まで（Jooto なら丸一日）待たされる — 外部を1回も叩いていないのに。
  // クロステナント境界: 別orgのスペースへ取り込ませない（実行時検証が真の境界）。
  const validated = await validateImportTargets(admin(), conn.org_id, targets)
  if (!validated.ok) {
    summary.skipped++
    summary.reasons.push(`${conn.provider}: ${validated.reason}`)
    return
  }

  const cred = await resolveCredentials(conn)
  if (cred.status !== 'ok') {
    // 失効・設定不備はここで静かに skip する。毒にはしない（再接続すれば直る）。
    summary.skipped++
    summary.reasons.push(`${conn.provider}: credentials_${cred.status}`)
    return
  }

  // 外部を叩く直前に権利を取る。取れなければ（＝実行が重なって他方が先に取った）見送る。
  if (!(await claimPollSlot(conn, startedAt))) {
    summary.connections--
    return
  }

  const result = await importConnection({
    connectionId: conn.id,
    adapter,
    ctx: {
      credentials: cred.credentials,
      config: parseProviderConfig(conn.import_config, conn.provider),
    },
    targets: { ...targets, defaultAssigneeId: validated.assigneeId },
    store: createTaskSyncStore({ admin: admin(), orgId: conn.org_id }),
    storedCursor: conn.poll_cursor,
    storedMissing: parseStoredMissing(conn.import_missing_containers),
    now: new Date(),
  })

  summary.created += result.created
  summary.updated += result.updated
  summary.completed += result.completed
  summary.orphaned += result.orphaned
  if (result.skipped) {
    summary.skipped++
    summary.reasons.push(`${conn.provider}: ${result.reason ?? 'skipped'}`)
  }
}
