import { createClient as createSupabaseClient, type SupabaseClient } from '@supabase/supabase-js'
import { verifySinkSignature } from '@/lib/sinks/signature'
import { enqueueConnectorJob } from './enqueue'
import { notifyChatOnCompletion } from './notifyChat'

/**
 * multica → TaskApp の受信Webhook(POST /api/connectors/multica/events)のオーケストレーション。
 * 契約: docs/spec/MULTICA_CONNECTOR_CONTRACT.md §4(受信)/§5(署名)/§6(冪等)/§7(拒否ケース)。
 *
 * 処理順(契約 §4.1/§7・変更しないこと):
 *   1. JSON パース(壊れていれば400)
 *   2. connection_id で接続解決(provider='multica'・status='active')
 *      + metadata.multica.receive_secret を取得(送信鍵 send_secret とは別鍵)。
 *      未知接続/secret未設定はどちらも同一の不透明401ボディで返す
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

/** 受信鍵は metadata.multica.receive_secret(送信鍵 send_secret とは方向別に別発行。契約 §5)。 */
function receiveSecretOf(conn: ConnectionRow): string | null {
  const raw = (conn.metadata?.multica as Record<string, unknown> | undefined) ?? undefined
  const secret = typeof raw?.receive_secret === 'string' ? raw.receive_secret : undefined
  return secret ?? null
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
 * 完了の0→1遷移が真のときだけ呼ばれる副作用(契約 §4.1-3):
 *   (a) origin=external(gtasks正本)なら gtasks へ op='complete' を enqueue して書き戻す
 *   (b) チャットへ完了を返信する(送信アダプタ層は別ストリームの成果物のため現状スタブ)
 *
 * (a)の enqueue失敗はここでは意図的に投げる(呼び出し元へ伝播させ500にする)。connector_inbound_events
 * への記録は本関数の呼び出し元がこの関数の成功後にのみ行うため(呼び出し元のdocstring参照)、
 * enqueue失敗時は記録されないままmulticaが同一event_idで再送し、rpc(既にdone→no-op)を経て
 * enqueueが再実行される。enqueueConnectorJobは(connection_id,task_id)につきpending1件へfoldする
 * ため、この再実行は安全(書き戻しの取りこぼしを防ぐ側)。
 * (b)のチャット通知の失敗はDB上の完了確定を巻き戻す必要が無い付随機能のため、ここでは握って
 * 処理を続ける(記録は行われ、再送されても通知は再試行されない=ベストエフォート)。
 */
async function propagateTaskCompleted(
  taskRef: string,
  result: { summary: string | null; artifactUrl: string | null },
): Promise<void> {
  const gtasksConnectionId = await findActiveGoogleTasksConnectionForTask(taskRef)
  if (gtasksConnectionId) {
    await enqueueConnectorJob(gtasksConnectionId, taskRef, 'complete', {})
  }

  try {
    await notifyChatOnCompletion(taskRef, result)
  } catch (error) {
    console.error('[connectors/inbound] notifyChatOnCompletion failed:', error)
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
  const receiveSecret = conn ? receiveSecretOf(conn) : null
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

    if (completed === true) {
      const rawResult = (parsed.result as Record<string, unknown> | undefined) ?? {}
      await propagateTaskCompleted(taskRef, {
        summary: typeof rawResult.summary === 'string' ? rawResult.summary : null,
        artifactUrl: typeof rawResult.artifact_url === 'string' ? rawResult.artifact_url : null,
      })
    }
    // completed===false(既にdone)は二重完了防止のno-op。どちらも副作用は成功として扱い記録する。
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
