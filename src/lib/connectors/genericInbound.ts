import { createClient as createSupabaseClient, type SupabaseClient } from '@supabase/supabase-js'
import { verifySinkSignature } from '@/lib/sinks/signature'
import { decryptConnectorSecret } from '@/lib/connectors/secrets'
import { parseGenericInboundEvent, type GenericInboundEvent } from './genericPayload'

/**
 * 汎用Webhook受信（POST /api/connectors/generic/events）のオーケストレーション。
 *
 * 何のためにあるか:
 *   公開APIが無い/弱いツール（業界特化型の長尾）まで個別アダプタで取りに行くのは、調査コストと
 *   任意ホストへの認証付きアクセス（SSRF＋資格情報の預かり）とサポート負荷で持たない。
 *   受信は**こちらから取りに行かない**のでその全部が消える。Zapier / Make / n8n などに
 *   「送る側」を担ってもらい、こちらは受け口の形を1つに固定する。
 *
 * 処理順（multica 受信 src/lib/connectors/inbound.ts と同型・変えないこと）:
 *   1. 接続を解決（provider='generic_inbound' かつ active）＋受信鍵を復号
 *      未知接続 / 鍵未設定 / 復号失敗は**すべて同一の不透明401**（理由を出し分けると
 *      「この接続IDは存在する」というオラクルになる）
 *   2. 署名検証（生ボディに対して）
 *   3. ペイロード検証（契約に合わなければ理由付き400。送信側が直せるように理由は返す）
 *   4. 早期dedup（記録済みなら副作用ゼロで200）
 *   5. 副作用（起票 / 更新 / 完了）
 *   6. **副作用が成功してから**記録する
 *
 * なぜ「副作用の後に記録」か:
 *   先に記録を確定すると、副作用が一時失敗（DB瞬断等）したときに「記録済みだが未処理」が残り、
 *   送信側の再送が dedup で握られて、その取り込みが恒久的に失われる。逆順なら、途中失敗は
 *   非2xx → 再送 → 副作用が再実行、で回復する。再実行が安全なのは各副作用が冪等だから
 *   （起票は (connection_id, external_id) 一意、完了は条件付き更新）。
 */

export interface GenericInboundResult {
  status: number
  body: Record<string, unknown>
}

/** 認証まわりの失敗は理由を明かさない（存在の有無を推測させない）。 */
const OPAQUE_UNAUTHORIZED: GenericInboundResult = { status: 401, body: { error: 'unauthorized' } }

/** 接続IDは uuid 列。形が違うものをDBに投げると型エラーで500になるため、手前で弾く。 */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/** 署名ヘッダの形（src/lib/sinks/signature.ts の正本と同じ形）。中身の検証は復号後に行う。 */
const SIGNATURE_HEADER_PATTERN = /^t=\d+,v1=[0-9a-f]+$/

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
  org_id: string
  metadata: Record<string, unknown> | null
  import_config: Record<string, unknown> | null
}

/**
 * 受け付ける接続の条件: provider が一致 かつ status='active' かつ **import_enabled=true**。
 *
 * import_enabled を見落とすと、作った直後（既定は無効）や運用者が意図的に止めた受信口が
 * イベントを受け付け続ける。「止めたのに止まらない」は、外部から書き込まれる面では
 * そのまま事故になる。
 */
async function loadActiveConnection(connectionId: string): Promise<ConnectionRow | null> {
  const { data, error } = await admin()
    .from('integration_connections')
    .select('id, org_id, metadata, import_config')
    .eq('id', connectionId)
    .eq('provider', 'generic_inbound')
    .eq('status', 'active')
    .eq('import_enabled', true)
    .maybeSingle()
  if (error) throw new Error(`integration_connections lookup failed: ${error.message}`)
  return (data as ConnectionRow | null) ?? null
}

/** 受信鍵は metadata.generic_inbound.receive_secret_encrypted（multica と同じ保存方式）。 */
async function receiveSecretOf(conn: ConnectionRow): Promise<string | null> {
  const raw = (conn.metadata?.generic_inbound as Record<string, unknown> | undefined) ?? undefined
  const encrypted = typeof raw?.receive_secret_encrypted === 'string' ? raw.receive_secret_encrypted : undefined
  if (!encrypted) return null
  return decryptConnectorSecret(encrypted)
}

function targetSpaceIdOf(conn: ConnectionRow): string | null {
  const raw = conn.import_config
  return typeof raw?.target_space_id === 'string' ? (raw.target_space_id as string) : null
}

/** 早期dedup。記録は副作用の後にのみ行うので、ここでは SELECT しかしない。 */
async function isDuplicate(connectionId: string, eventId: string): Promise<boolean> {
  const { data, error } = await admin()
    .from('connector_inbound_events')
    .select('event_id')
    .eq('connection_id', connectionId)
    .eq('event_id', eventId)
    .maybeSingle()
  if (error) throw new Error(`connector_inbound_events lookup failed: ${error.message}`)
  return !!data
}

async function recordEvent(connectionId: string, eventId: string, eventType: string): Promise<void> {
  const { error } = await admin()
    .from('connector_inbound_events')
    .insert({ connection_id: connectionId, event_id: eventId, event_type: eventType })
  // 23505 は並行・再送による競合＝既に処理済みなので無視してよい。
  if (error && (error as { code?: string }).code !== '23505') {
    throw new Error(`connector_inbound_events insert failed: ${error.message}`)
  }
}

/**
 * テナント境界: この接続に紐づく対応（connector_task_links）があるときだけ触る。
 * 外部IDは送信側が自由に付けられるので、対応の存在確認が「他テナントのタスクを触らせない」唯一の壁。
 */
async function findLinkedTaskId(connectionId: string, externalId: string): Promise<string | null> {
  const { data, error } = await admin()
    .from('connector_task_links')
    .select('task_id')
    .eq('connection_id', connectionId)
    .eq('external_id', externalId)
    .maybeSingle()
  if (error) throw new Error(`connector_task_links lookup failed: ${error.message}`)
  return (data as { task_id: string } | null)?.task_id ?? null
}

/**
 * 期日と「期限の正本」を書く。
 *
 * 正本をこの接続にするのが要点: null のままだと「TaskApp 内部で管理している期限」とみなされ、
 * 鮮度チェックが一切かからないまま催促が飛ぶ。受信型は次にいつ届くか保証できない（送信側次第）ので、
 * カタログ側で鮮度SLAを持たない宣言にしてあり、正本が立っていることで確実に抑止される。
 */
async function applyDueAndAuthority(
  taskId: string,
  connectionId: string,
  dueDate: string | null | undefined,
): Promise<boolean> {
  if (dueDate === undefined) return true
  // 更新できた行を必ず確認する。対応表は tasks への FK を張らないため、削除済みタスクを指す
  // 古い対応が残り得る。0件のまま200を返して記録すると、そのイベントは「適用済み」として
  // 二度と再送されないのに、実際には何も起きていない。
  const { data, error } = await admin()
    .from('tasks')
    .update({ due_date: dueDate, due_authority_connection_id: connectionId })
    .eq('id', taskId)
    .select('id')
  if (error) throw new Error(`apply due failed: ${error.message}`)
  return ((data as unknown[] | null) ?? []).length > 0
}

async function handleCreated(conn: ConnectionRow, event: GenericInboundEvent): Promise<GenericInboundResult> {
  const spaceId = targetSpaceIdOf(conn)
  if (!spaceId) {
    // 設定待ちであって送信側の誤りではない。再送しても設定されるまで直らないので理由を返す。
    return { status: 422, body: { error: 'target_space_id is not configured for this connection' } }
  }

  const { data, error } = await admin().rpc('rpc_connector_create_task', {
    p_connection_id: conn.id,
    p_external_id: event.externalId,
    p_space_id: spaceId,
    p_title: event.title ?? '(無題)',
    p_description: event.body ?? null,
  })
  if (error) throw new Error(`rpc_connector_create_task failed: ${error.message}`)

  const taskId = typeof data === 'string' ? data : null
  if (!taskId) throw new Error('rpc_connector_create_task returned no task id')
  if (!(await applyDueAndAuthority(taskId, conn.id, event.dueDate))) {
    // 対応は存在するのにタスクが無い＝対応が古い（タスクが削除済み）。記録して握ると
    // このイベントは永久に適用されない。送信側に再送させるため非2xxで返す。
    return { status: 409, body: { error: 'linked task no longer exists' } }
  }
  return { status: 200, body: { ok: true, task_id: taskId } }
}

async function handleUpdated(conn: ConnectionRow, event: GenericInboundEvent): Promise<GenericInboundResult> {
  const taskId = await findLinkedTaskId(conn.id, event.externalId)
  if (!taskId) return { status: 404, body: { error: 'unknown external_id for this connection' } }

  const patch: Record<string, unknown> = {}
  if (event.title) patch.title = event.title
  // description は NOT NULL default '' なので、空にする指示は null ではなく空文字で表す
  // （明示 null は NOT NULL 違反で取り込みが止まる）。「変更しない」と「空にする」は別物。
  if (event.clearBody) patch.description = ''
  else if (event.body !== null && event.body !== undefined) patch.description = event.body
  if (event.dueDate !== undefined) {
    patch.due_date = event.dueDate
    patch.due_authority_connection_id = conn.id
  }
  if (Object.keys(patch).length === 0) return { status: 200, body: { ok: true, task_id: taskId } }

  const { data, error } = await admin().from('tasks').update(patch).eq('id', taskId).select('id')
  if (error) throw new Error(`update task failed: ${error.message}`)
  if (((data as unknown[] | null) ?? []).length === 0) {
    // 0件＝対応が指すタスクが既に無い（上の applyDueAndAuthority と同じ理由）。
    return { status: 409, body: { error: 'linked task no longer exists' } }
  }
  return { status: 200, body: { ok: true, task_id: taskId } }
}

async function handleCompleted(conn: ConnectionRow, event: GenericInboundEvent): Promise<GenericInboundResult> {
  const taskId = await findLinkedTaskId(conn.id, event.externalId)
  if (!taskId) return { status: 404, body: { error: 'unknown external_id for this connection' } }

  // 条件付き更新。既に done なら0件で、tasks トリガーも発火せず反響が物理的に止まる。
  const { data, error } = await admin().rpc('rpc_connector_complete_task', {
    p_connection_id: conn.id,
    p_task_id: taskId,
  })
  if (error) throw new Error(`rpc_connector_complete_task failed: ${error.message}`)
  return { status: 200, body: { ok: true, task_id: taskId, transitioned: data === true } }
}

/**
 * 受信イベントを1件処理する。ルートは生ボディと署名ヘッダを渡すだけ（署名は生ボディに対して
 * 検証するため、ルート側でJSONパースしてはいけない）。
 */
export async function handleGenericInboundEvent(
  rawBody: string,
  signatureHeader: string | null,
): Promise<GenericInboundResult> {
  // 接続IDはボディにあるため、署名検証の前に一度だけ形だけ読む（この時点では信用しない）。
  let peeked: unknown
  try {
    peeked = JSON.parse(rawBody)
  } catch {
    return { status: 400, body: { error: 'invalid JSON' } }
  }
  const connectionId =
    peeked && typeof peeked === 'object' && !Array.isArray(peeked)
      ? (peeked as Record<string, unknown>).connection_id
      : null
  if (typeof connectionId !== 'string' || connectionId.length === 0) {
    return { status: 400, body: { error: 'connection_id is required' } }
  }

  // DBに触る前に、明らかに認証を通り得ないものを落とす。狙いは2つ:
  //   - 未認証の相手にDB問い合わせ・復号を走らせない（費用を負担しない）
  //   - 接続IDの形が不正なだけで500＋ログを出さない（不正入力で運用ログを溢れさせない・
  //     500と401の出し分けが「この形式なら存在し得る」というヒントになるのも避ける）
  if (!UUID_PATTERN.test(connectionId)) return OPAQUE_UNAUTHORIZED
  if (!signatureHeader || !SIGNATURE_HEADER_PATTERN.test(signatureHeader)) return OPAQUE_UNAUTHORIZED

  const conn = await loadActiveConnection(connectionId)
  if (!conn) return OPAQUE_UNAUTHORIZED
  const secret = await receiveSecretOf(conn)
  if (!secret) return OPAQUE_UNAUTHORIZED
  if (!verifySinkSignature(secret, rawBody, signatureHeader).ok) return OPAQUE_UNAUTHORIZED

  // ここから先は「正当な送信元」が確定している。契約違反は理由を返してよい。
  const parsed = parseGenericInboundEvent(peeked)
  if (!parsed.ok) return { status: 400, body: { error: parsed.reason } }
  const event = parsed.event

  if (await isDuplicate(conn.id, event.eventId)) {
    return { status: 200, body: { ok: true, deduplicated: true } }
  }

  let result: GenericInboundResult
  if (event.eventType === 'task.created') result = await handleCreated(conn, event)
  else if (event.eventType === 'task.updated') result = await handleUpdated(conn, event)
  else result = await handleCompleted(conn, event)

  // 副作用が成功したときだけ記録する。失敗（4xx/5xx）は記録せず、再送で再実行させる。
  if (result.status >= 200 && result.status < 300) {
    await recordEvent(conn.id, event.eventId, event.eventType)
  }
  return result
}
