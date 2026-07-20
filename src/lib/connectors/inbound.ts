import { createClient as createSupabaseClient, type SupabaseClient } from '@supabase/supabase-js'
import { verifySinkSignature } from '@/lib/sinks/signature'
import { decryptConnectorSecret } from '@/lib/connectors/secrets'
import { enqueueConnectorJob } from './enqueue'
import { notifyChatOnCompletion } from './notifyChat'

/**
 * multica → TaskApp の受信Webhook(POST /api/connectors/multica/events)のオーケストレーション。
 * 契約: docs/spec/MULTICA_CONNECTOR_CONTRACT.md §4(受信)/§5(署名)/§6(冪等)/§7(拒否ケース)。
 *
 * 処理順(契約 §4.1/§7・変更しないこと):
 *   1. JSON パース(壊れていれば400)
 *   2. connection_id で接続解決(provider='multica'・status='active')
 *      + metadata.multica.receive_secret_encrypted を復号して取得(送信鍵 send_secret とは別鍵。
 *      暗号化保存はsink(src/lib/sinks/store.ts)と同方式。src/lib/connectors/secrets.ts参照)。
 *      未知接続/secret未設定/復号失敗はどれも同一の不透明401ボディで返す
 *      (理由を出し分けると「この connection_id は存在する」というオラクルになるため)。
 *   3. 署名検証(X-AgentPM-Signature。rawBodyに対して検証。不正はいずれも401)
 *   4. 早期dedup(最適化。契約 §6/§7-3): connector_inbound_events を(connection_id,event_id)で
 *      SELECTし、既に処理済みなら副作用を一切呼ばず200 no-opで返す。
 *      ※ これは高速な短絡でしかない。冪等性の根拠は5・6の順序そのもの(下記参照)。
 *   5. event_type 分岐。副作用(RPC/enqueue/チャット通知)はここで実行し、まだ記録しない:
 *      - task.completed: task_ref がUUID形式でない/connector_task_links に存在しない→404
 *        (テナント境界。契約 §7-5) → rpc_connector_complete_task(0→1遷移の時だけtrue)
 *        → true の時だけ完了伝播(gtasks書き戻しenqueue + チャット通知)
 *      - task.progress: v1は保存/中継しない(200)
 *      - 未知: 400
 *   6. 5が例外を投げずに完了した場合だけ、connector_inbound_events に記録する
 *      (23505=並行/再送のinsert競合は無視)。
 *
 * なぜ「副作用の後に記録」が正しいか:
 *   記録を副作用より先に確定すると、副作用(RPC/enqueue)側で一時例外(DB瞬断等)が起きた場合に
 *   「記録済みだが未処理」の行が残ってしまい、multicaの再送(契約 §8)がdedupで無条件に握られ、
 *   完了・gtasksへの書き戻しが恒久的に失われる。逆に記録を副作用の後に置けば、
 *     - 途中失敗→非2xx→multicaが再送→(4のdedupに引っかからず)副作用が安全に再実行される
 *     - 全成功→再送は4の早期dedupで短絡される
 *   の両方が成立する。副作用の再実行が安全なのは各々が冪等だから:
 *     - rpc_connector_complete_task は status<>'done' の条件付き更新なので、再実行は0件no-op。
 *     - enqueueConnectorJob は(connection_id,task_id)につきpending1件へfoldするので、
 *       再実行は最新状態への上書きにしかならない。
 *     - notifyChatOnCompletion は rpcがtrueを返した(0→1遷移が起きた)ときだけ呼ばれ、
 *       その遷移はDBの条件付き更新によりプロセス全体でたかだか1回しか真にならない
 *       (並行再送があってもchatは最大1回)。
 *
 * LINE webhookと異なり、multicaは非2xxを受けて再送する契約(契約 §8)。よって拒否ケースは
 * 401/404/400をそのまま返す(LINE webhookのように包括的に200で握って無視する設計ではない)。
 */

export interface InboundHandleResult {
  status: number
  body: Record<string, unknown>
}

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

interface ConnectionRow {
  id: string
  metadata: Record<string, unknown> | null
}

/** provider='multica'・status='active' の接続だけを解決する(無効化/削除済み接続は401扱い)。 */
async function loadActiveMulticaConnection(connectionId: string): Promise<ConnectionRow | null> {
  const { data, error } = await admin()
    .from('integration_connections')
    .select('id, metadata')
    .eq('id', connectionId)
    .eq('provider', 'multica')
    .eq('status', 'active')
    .maybeSingle()
  if (error) throw new Error(`integration_connections lookup failed: ${error.message}`)
  return (data as ConnectionRow | null) ?? null
}

/**
 * 受信鍵は metadata.multica.receive_secret_encrypted(送信鍵 send_secret とは方向別に別発行。
 * 契約 §5)。暗号化保存されているため decryptConnectorSecret で都度復号する。
 * 平文フォールバックは持たない(本ブランチ未マージ=既存データ無し。クリーンカット)。
 */
async function receiveSecretOf(conn: ConnectionRow): Promise<string | null> {
  const raw = (conn.metadata?.multica as Record<string, unknown> | undefined) ?? undefined
  const encrypted =
    typeof raw?.receive_secret_encrypted === 'string' ? raw.receive_secret_encrypted : undefined
  if (!encrypted) return null
  return decryptConnectorSecret(encrypted)
}

/**
 * 早期dedup(最適化。契約 §6/§7-3): (connection_id,event_id) が既に記録済みかをSELECTだけで見る。
 * insertはしない(記録は副作用が成功した後にのみ行う。理由は本ファイル冒頭のdocstring参照)。
 */
async function isDuplicateInboundEvent(connectionId: string, eventId: string): Promise<boolean> {
  const { data, error } = await admin()
    .from('connector_inbound_events')
    .select('event_id')
    .eq('connection_id', connectionId)
    .eq('event_id', eventId)
    .maybeSingle()
  if (error) throw new Error(`connector_inbound_events lookup failed: ${error.message}`)
  return !!data
}

/**
 * 冪等記録(契約 §6): PK(connection_id,event_id)の insert。副作用(RPC/enqueue/通知)が成功した
 * 後にのみ呼ぶこと。23505(並行/再送によるinsert競合)は無視して良い(既に処理済みという意味)。
 */
async function recordInboundEventOnce(
  connectionId: string,
  eventId: string,
  eventType: string,
): Promise<'new' | 'duplicate'> {
  const { error } = await admin().from('connector_inbound_events').insert({
    connection_id: connectionId,
    event_id: eventId,
    event_type: eventType,
  })
  if (!error) return 'new'
  if ((error as { code?: string }).code === '23505') return 'duplicate'
  throw new Error(`connector_inbound_events insert failed: ${error.message}`)
}

/** UUID v1-v5 形式のゆるい判定。task_id列はuuid型のため、非UUIDを素通しすると
 *  PostgRESTが"invalid input syntax for type uuid"で500を返してしまう。DB問い合わせ前に弾く。 */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
function isValidUuid(value: string): boolean {
  return UUID_PATTERN.test(value)
}

/** テナント境界(契約 §7-5): この接続に対する task_ref の link が存在するかだけを見る。 */
async function hasTaskLink(connectionId: string, taskId: string): Promise<boolean> {
  const { data, error } = await admin()
    .from('connector_task_links')
    .select('task_id')
    .eq('connection_id', connectionId)
    .eq('task_id', taskId)
    .maybeSingle()
  if (error) throw new Error(`connector_task_links lookup failed: ${error.message}`)
  return !!data
}

/**
 * この task_ref に紐づく provider='google_tasks' の active な接続IDを探す(完了の書き戻し先)。
 * 1つの task_id は接続ごとに別々の connector_task_links 行を持つ(ハブ&スポーク・契約 §2)ため、
 * まず全 link から connection_id 候補を集め、その中から gtasks 接続を絞り込む。
 * gtasks link が無ければ null(書き戻し不要。no-op)。
 */
async function findActiveGoogleTasksConnectionForTask(taskId: string): Promise<string | null> {
  const { data: linkRows, error: linkErr } = await admin()
    .from('connector_task_links')
    .select('connection_id')
    .eq('task_id', taskId)
  if (linkErr) throw new Error(`connector_task_links lookup(gtasks) failed: ${linkErr.message}`)
  const connectionIds = ((linkRows as Array<{ connection_id: string }> | null) ?? []).map(
    (l) => l.connection_id,
  )
  if (connectionIds.length === 0) return null

  const { data: connRows, error: connErr } = await admin()
    .from('integration_connections')
    .select('id')
    .in('id', connectionIds)
    .eq('provider', 'google_tasks')
    .eq('status', 'active')
  if (connErr) throw new Error(`integration_connections lookup(gtasks) failed: ${connErr.message}`)
  const row = ((connRows as Array<{ id: string }> | null) ?? [])[0]
  return row?.id ?? null
}

/**
 * 完了イベント受理時の副作用(契約 §4.1-3)。呼び出し元は rpc 成功後・記録の前に呼ぶ。
 *
 *   (a) gtasks 書き戻し(origin=external の正本 gtasks へ op='complete'):
 *       **この配信が 0→1 遷移を起こしたか(transitioned)に依存せず** enqueue する。
 *       理由(取りこぼし防止): rpc_connector_complete_task は「既に done」だと false を返す。
 *       もし enqueue を transitioned に条件付けると、「初回配信で遷移は起きたが enqueue が例外
 *       → 未記録 → multica が同一 event_id で再送」という経路で、再送時は rpc=false となり
 *       propagate 自体が呼ばれない/enqueue が再駆動されず、書き戻しが silent lost する
 *       (実際 rpc の返りは v_updated>0、= 遷移した時だけ true)。enqueueConnectorJob は
 *       (connection_id,task_id) 単位で pending 1件へ fold し、gtasks complete 自体も冪等なので、
 *       無条件 enqueue でも重複は畳まれ at-least-once を満たす。enqueue 失敗は投げて呼び出し元を
 *       500 にし(未記録)、再送で再駆動させる。
 *   (b) チャット完了返信: **真の 0→1 遷移(transitioned)のときだけ**・ベストエフォート。
 *       送信アダプタに冪等キー(event_id)を渡せるようになるまでは、再送での二重送信を避けるため
 *       遷移を条件にする(現状スタブ)。失敗は握ってログのみ(DB上の完了確定は巻き戻さない)。
 */
async function propagateTaskCompleted(
  taskRef: string,
  result: { summary: string | null; artifactUrl: string | null },
  transitioned: boolean,
  eventId: string,
): Promise<void> {
  const gtasksConnectionId = await findActiveGoogleTasksConnectionForTask(taskRef)
  if (gtasksConnectionId) {
    await enqueueConnectorJob(gtasksConnectionId, taskRef, 'complete', {})
  }

  if (transitioned) {
    try {
      // idempotencyKey に event_id を渡す(送信側/アダプタで二重送信を弾く土台)。
      await notifyChatOnCompletion(taskRef, result, eventId)
    } catch (error) {
      console.error('[connectors/inbound] notifyChatOnCompletion failed:', error)
    }
  }
}

interface MulticaInboundBody {
  connection_id?: unknown
  event_id?: unknown
  event_type?: unknown
  task_ref?: unknown
  result?: { summary?: unknown; artifact_url?: unknown } | unknown
}

export async function handleMulticaInboundEvent(
  rawBody: string,
  signatureHeader: string | null,
): Promise<InboundHandleResult> {
  let parsed: MulticaInboundBody
  try {
    parsed = JSON.parse(rawBody) as MulticaInboundBody
  } catch {
    return { status: 400, body: { error: 'malformed_json' } }
  }

  const connectionId = typeof parsed.connection_id === 'string' ? parsed.connection_id : null
  const eventId = typeof parsed.event_id === 'string' ? parsed.event_id : null
  const eventType = typeof parsed.event_type === 'string' ? parsed.event_type : null
  if (!connectionId || !eventId || !eventType) {
    return { status: 400, body: { error: 'malformed_body' } }
  }

  // 接続解決(§7-4): 未知/非active/provider不一致/secret未設定はすべて同一の不透明401にまとめる
  // (理由を出し分けると「この connection_id は存在する」というオラクルになるため)。
  const conn = await loadActiveMulticaConnection(connectionId)
  const receiveSecret = conn ? await receiveSecretOf(conn) : null
  if (!conn || !receiveSecret) {
    return { status: 401, body: { error: 'unauthorized' } }
  }

  if (!signatureHeader) {
    return { status: 401, body: { error: 'malformed_header' } }
  }
  const verified = verifySinkSignature(receiveSecret, rawBody, signatureHeader)
  if (!verified.ok) {
    return { status: 401, body: { error: verified.reason } }
  }

  // 早期dedup(最適化。§6/§7-3): 既に処理済みならここで200 no-opにし、以降の副作用を一切発火させない。
  if (await isDuplicateInboundEvent(connectionId, eventId)) {
    return { status: 200, body: { ok: true, duplicate: true } }
  }

  if (eventType === 'task.completed') {
    const taskRef = typeof parsed.task_ref === 'string' ? parsed.task_ref : null
    if (!taskRef) {
      return { status: 400, body: { error: 'malformed_body' } }
    }
    if (!isValidUuid(taskRef)) {
      // 契約 §7-5: 存在しない task_ref → 404。UUID形式でない値はlink/DB問い合わせをせずに
      // ここで404確定する(素通しするとtask_id列(uuid型)への不正リテラルでPostgRESTが500を返す)。
      return { status: 404, body: { error: 'unknown_task_ref' } }
    }

    // テナント境界(§7-5): この接続に対する link が無ければ404(未知/別テナントの task_ref)。
    const linked = await hasTaskLink(connectionId, taskRef)
    if (!linked) {
      return { status: 404, body: { error: 'unknown_task_ref' } }
    }

    const { data: completed, error: rpcError } = await admin().rpc('rpc_connector_complete_task', {
      p_connection_id: connectionId,
      p_task_id: taskRef,
    })
    if (rpcError) throw new Error(`rpc_connector_complete_task failed: ${rpcError.message}`)

    // rpc 成功後、この時点でタスクは必ず done(この配信で遷移 or 既に done)。gtasks 書き戻しは
    // 遷移有無に依存せず at-least-once で駆動し(取りこぼし防止・propagateTaskCompleted 参照)、
    // チャット返信のみ真の 0→1 遷移(completed===true)のときに行う。
    const rawResult = (parsed.result as Record<string, unknown> | undefined) ?? {}
    await propagateTaskCompleted(
      taskRef,
      {
        summary: typeof rawResult.summary === 'string' ? rawResult.summary : null,
        artifactUrl: typeof rawResult.artifact_url === 'string' ? rawResult.artifact_url : null,
      },
      completed === true,
      eventId,
    )
    await recordInboundEventOnce(connectionId, eventId, eventType)
    return { status: 200, body: { ok: true } }
  }

  if (eventType === 'task.progress') {
    // v1スコープ外(契約 §4.2/§9): 保存・チャット中継はしない。受理だけして200を返す。
    await recordInboundEventOnce(connectionId, eventId, eventType)
    return { status: 200, body: { ok: true } }
  }

  return { status: 400, body: { error: 'unknown_event_type' } }
}
