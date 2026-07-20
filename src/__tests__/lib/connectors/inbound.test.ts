import { describe, it, expect, vi, beforeEach } from 'vitest'
import { buildSignatureHeader } from '@/lib/sinks/signature'

/**
 * src/lib/connectors/inbound.ts — multica → TaskApp の受信Webhookハンドラ。
 * 契約: docs/spec/MULTICA_CONNECTOR_CONTRACT.md §4(受信)/§5(署名)/§6(冪等)/§7(拒否ケース)。
 */

const enqueueConnectorJobMock = vi.fn()
vi.mock('@/lib/connectors/enqueue', () => ({
  enqueueConnectorJob: (...a: unknown[]) => enqueueConnectorJobMock(...a),
}))

const notifyChatOnCompletionMock = vi.fn()
vi.mock('@/lib/connectors/notifyChat', () => ({
  notifyChatOnCompletion: (...a: unknown[]) => notifyChatOnCompletionMock(...a),
}))

// receive_secret_encrypted → 復号済み平文 のマッピング(署名検証の往復を通すため)。
const RECEIVE_SECRET_ENCRYPTED = 'enc_recv-secret-xyz'
const decryptConnectorSecretMock = vi.fn(async (encrypted: string) => {
  if (encrypted === RECEIVE_SECRET_ENCRYPTED) return SECRET
  return null
})
vi.mock('@/lib/connectors/secrets', () => ({
  decryptConnectorSecret: (...a: [string]) => decryptConnectorSecretMock(...a),
}))

interface ConnRow {
  id: string
  provider: string
  status: string
  metadata: Record<string, unknown> | null
  import_config?: Record<string, unknown> | null
}
interface LinkRow {
  connection_id: string
  task_id: string
}
interface InboundEventRow {
  connection_id: string
  event_id: string
  event_type: string
}

const rpcMock = vi.fn()
const state = {
  conns: [] as ConnRow[],
  inboundEvents: [] as InboundEventRow[],
  links: [] as LinkRow[],
}

function makeChain(table: string) {
  let mode: 'select' | 'insert' | null = null
  let insertPayload: Record<string, unknown> | null = null
  const eqFilters: Record<string, unknown> = {}
  let inFilter: { col: string; vals: unknown[] } | null = null

  function resolveNow(): { data: unknown; error: unknown } {
    if (table === 'integration_connections') {
      let rows = state.conns
      if (inFilter) rows = rows.filter((c) => inFilter!.vals.includes(c.id))
      for (const [k, v] of Object.entries(eqFilters)) {
        rows = rows.filter((c) => (c as unknown as Record<string, unknown>)[k] === v)
      }
      return { data: rows, error: null }
    }
    if (table === 'connector_inbound_events') {
      if (mode === 'insert') {
        const p = insertPayload as unknown as InboundEventRow
        const dup = state.inboundEvents.find(
          (e) => e.connection_id === p.connection_id && e.event_id === p.event_id,
        )
        if (dup) return { data: null, error: { code: '23505' } }
        state.inboundEvents.push(p)
        return { data: null, error: null }
      }
      // select モード: 早期dedupの (connection_id, event_id) 存在確認に使う。
      let rows = state.inboundEvents
      for (const [k, v] of Object.entries(eqFilters)) {
        rows = rows.filter((e) => (e as unknown as Record<string, unknown>)[k] === v)
      }
      return { data: rows, error: null }
    }
    if (table === 'connector_task_links') {
      let rows = state.links
      for (const [k, v] of Object.entries(eqFilters)) {
        rows = rows.filter((l) => (l as unknown as Record<string, unknown>)[k] === v)
      }
      return { data: rows, error: null }
    }
    return { data: null, error: null }
  }

  const chain: Record<string, unknown> = {}
  Object.assign(chain, {
    select: vi.fn(() => {
      if (!mode) mode = 'select'
      return chain
    }),
    insert: vi.fn((v: Record<string, unknown>) => {
      mode = 'insert'
      insertPayload = v
      return chain
    }),
    eq: vi.fn((col: string, val: unknown) => {
      eqFilters[col] = val
      return chain
    }),
    in: vi.fn((col: string, vals: unknown[]) => {
      inFilter = { col, vals }
      return chain
    }),
    maybeSingle: vi.fn(() => {
      const r = resolveNow()
      const data = Array.isArray(r.data) ? (r.data[0] ?? null) : r.data
      return Promise.resolve({ data, error: r.error })
    }),
    then: (resolve: (v: unknown) => unknown) => resolve(resolveNow()),
  })
  return chain
}

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({ rpc: rpcMock, from: vi.fn((t: string) => makeChain(t)) })),
}))

const { handleMulticaInboundEvent } = await import('@/lib/connectors/inbound')

const SECRET = 'recv-secret-xyz'
// task_id 列は uuid 型のため、非UUIDを渡すと本番では PostgREST が 500 を返す。
// 正常系テストは実際の運用値に近い有効なUUID形式を使う(非UUIDの拒否は専用テストで検証する)。
const TASK_REF = '11111111-1111-1111-1111-111111111111'
const CONN: ConnRow = {
  id: 'conn-1',
  provider: 'multica',
  status: 'active',
  metadata: { multica: { receive_secret_encrypted: RECEIVE_SECRET_ENCRYPTED } },
}

function body(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    event_id: 'evt-1',
    event_type: 'task.completed',
    connection_id: 'conn-1',
    task_ref: TASK_REF,
    result: { summary: '完了しました', artifact_url: null },
    ...overrides,
  })
}

function sign(raw: string, secret: string = SECRET, tsSeconds?: number): string {
  return buildSignatureHeader(secret, raw, tsSeconds)
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://supabase.example.com'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key'
  state.conns = [CONN]
  state.inboundEvents = []
  state.links = [{ connection_id: 'conn-1', task_id: TASK_REF }]
  rpcMock.mockResolvedValue({ data: true, error: null })
})

describe('handleMulticaInboundEvent', () => {
  it('署名不正(v1不一致) → 401', async () => {
    const raw = body()
    const bad = sign(raw).replace(/v1=[0-9a-f]+/, `v1=${'0'.repeat(64)}`)
    const res = await handleMulticaInboundEvent(raw, bad)
    expect(res.status).toBe(401)
    expect(rpcMock).not.toHaveBeenCalled()
  })

  it('timestampが窓外(300秒超) → 401', async () => {
    const raw = body()
    const oldTs = Math.floor(Date.now() / 1000) - 3600
    const header = sign(raw, SECRET, oldTs)
    const res = await handleMulticaInboundEvent(raw, header)
    expect(res.status).toBe(401)
  })

  it('署名ヘッダが無い → 401', async () => {
    const raw = body()
    const res = await handleMulticaInboundEvent(raw, null)
    expect(res.status).toBe(401)
  })

  it('未知のconnection_id → 401', async () => {
    const raw = body({ connection_id: 'conn-unknown' })
    const header = sign(raw)
    const res = await handleMulticaInboundEvent(raw, header)
    expect(res.status).toBe(401)
  })

  it('receive_secretが未設定の接続 → 401', async () => {
    state.conns = [{ ...CONN, metadata: {} }]
    const raw = body()
    const header = sign(raw)
    const res = await handleMulticaInboundEvent(raw, header)
    expect(res.status).toBe(401)
  })

  it('pre-auth 401: 未知connection_idとreceive_secret未設定は同一の不透明ボディを返す(接続存在オラクルを消す)', async () => {
    const rawUnknown = body({ connection_id: 'conn-unknown' })
    const resUnknown = await handleMulticaInboundEvent(rawUnknown, sign(rawUnknown))

    state.conns = [{ ...CONN, metadata: {} }]
    const rawNoSecret = body()
    const resNoSecret = await handleMulticaInboundEvent(rawNoSecret, sign(rawNoSecret))

    expect(resUnknown.status).toBe(401)
    expect(resNoSecret.status).toBe(401)
    expect(resUnknown.body).toEqual(resNoSecret.body)
    expect(resUnknown.body).toEqual({ error: 'unauthorized' })
  })

  it('send_secretで署名しても検証できない(受信/送信は別鍵) → 401', async () => {
    state.conns = [
      {
        ...CONN,
        metadata: {
          multica: { receive_secret_encrypted: RECEIVE_SECRET_ENCRYPTED, send_secret_encrypted: 'enc_other-send-secret' },
        },
      },
    ]
    const raw = body()
    const header = sign(raw, 'other-send-secret')
    const res = await handleMulticaInboundEvent(raw, header)
    expect(res.status).toBe(401)
  })

  it('receive_secretの復号に失敗(nullを返す)接続 → 401(平文フォールバックはしない)', async () => {
    state.conns = [{ ...CONN, metadata: { multica: { receive_secret_encrypted: 'enc_broken' } } }]
    const raw = body()
    const header = sign(raw)
    const res = await handleMulticaInboundEvent(raw, header)
    expect(res.status).toBe(401)
  })

  it('event_idの再送(重複) → 200・副作用なし(RPC/enqueue未呼び出し)', async () => {
    state.inboundEvents = [{ connection_id: 'conn-1', event_id: 'evt-1', event_type: 'task.completed' }]
    const raw = body()
    const header = sign(raw)
    const res = await handleMulticaInboundEvent(raw, header)
    expect(res.status).toBe(200)
    expect(rpcMock).not.toHaveBeenCalled()
    expect(enqueueConnectorJobMock).not.toHaveBeenCalled()
  })

  it('task_refに紐づくlinkが無い(別テナント/未知) → 404', async () => {
    state.links = []
    const raw = body()
    const header = sign(raw)
    const res = await handleMulticaInboundEvent(raw, header)
    expect(res.status).toBe(404)
    expect(rpcMock).not.toHaveBeenCalled()
  })

  it('task_refがUUID形式でない → 404(500ではない。DB問い合わせ前に弾く)', async () => {
    const raw = body({ task_ref: 'not-a-uuid' })
    const header = sign(raw)
    const res = await handleMulticaInboundEvent(raw, header)
    expect(res.status).toBe(404)
    expect(rpcMock).not.toHaveBeenCalled()
    expect(enqueueConnectorJobMock).not.toHaveBeenCalled()
  })

  it('正常なtask.completed(link有り・rpc true) → 200・gtasks接続へop=completeをenqueue・チャット通知を呼ぶ', async () => {
    state.conns = [CONN, { id: 'conn-gtasks', provider: 'google_tasks', status: 'active', metadata: {} }]
    state.links = [
      { connection_id: 'conn-1', task_id: TASK_REF },
      { connection_id: 'conn-gtasks', task_id: TASK_REF },
    ]
    rpcMock.mockResolvedValue({ data: true, error: null })
    const raw = body()
    const header = sign(raw)
    const res = await handleMulticaInboundEvent(raw, header)

    expect(res.status).toBe(200)
    expect(rpcMock).toHaveBeenCalledWith('rpc_connector_complete_task', {
      p_connection_id: 'conn-1',
      p_task_id: TASK_REF,
    })
    expect(enqueueConnectorJobMock).toHaveBeenCalledWith('conn-gtasks', TASK_REF, 'complete', {})
    // event_id を idempotencyKey として渡す(送信側/アダプタで二重送信を弾く土台)。
    expect(notifyChatOnCompletionMock).toHaveBeenCalledWith(
      TASK_REF,
      { summary: '完了しました', artifactUrl: null },
      'evt-1',
    )
  })

  it('既にdone(rpcがfalse) → 200・enqueueされない(二重完了防止)', async () => {
    rpcMock.mockResolvedValue({ data: false, error: null })
    const raw = body()
    const header = sign(raw)
    const res = await handleMulticaInboundEvent(raw, header)
    expect(res.status).toBe(200)
    expect(enqueueConnectorJobMock).not.toHaveBeenCalled()
    expect(notifyChatOnCompletionMock).not.toHaveBeenCalled()
  })

  it('gtasks linkが無い(multica linkのみ) → 完了はするがgtasks enqueueはno-op', async () => {
    rpcMock.mockResolvedValue({ data: true, error: null })
    const raw = body()
    const header = sign(raw)
    const res = await handleMulticaInboundEvent(raw, header)
    expect(res.status).toBe(200)
    expect(enqueueConnectorJobMock).not.toHaveBeenCalled()
    expect(notifyChatOnCompletionMock).toHaveBeenCalled()
  })

  it('gtasks接続がactiveでない(disabled等) → enqueueしない', async () => {
    state.conns = [CONN, { id: 'conn-gtasks', provider: 'google_tasks', status: 'disabled', metadata: {} }]
    state.links = [
      { connection_id: 'conn-1', task_id: TASK_REF },
      { connection_id: 'conn-gtasks', task_id: TASK_REF },
    ]
    rpcMock.mockResolvedValue({ data: true, error: null })
    const raw = body()
    const header = sign(raw)
    const res = await handleMulticaInboundEvent(raw, header)
    expect(res.status).toBe(200)
    expect(enqueueConnectorJobMock).not.toHaveBeenCalled()
  })

  it('壊れたJSON → 400', async () => {
    const raw = '{not json'
    const res = await handleMulticaInboundEvent(raw, 'whatever')
    expect(res.status).toBe(400)
  })

  it('必須フィールド欠落(connection_id無し) → 400', async () => {
    const raw = JSON.stringify({ event_id: 'evt-1', event_type: 'task.completed', task_ref: 'task-1' })
    const res = await handleMulticaInboundEvent(raw, 'whatever')
    expect(res.status).toBe(400)
  })

  it('未知のevent_type → 400', async () => {
    const raw = body({ event_type: 'task.unknown' })
    const header = sign(raw)
    const res = await handleMulticaInboundEvent(raw, header)
    expect(res.status).toBe(400)
  })

  it('task.progress → 200(v1では保存/中継しない)', async () => {
    const raw = body({ event_type: 'task.progress', note: '進捗です' })
    const header = sign(raw)
    const res = await handleMulticaInboundEvent(raw, header)
    expect(res.status).toBe(200)
    expect(rpcMock).not.toHaveBeenCalled()
  })

  // --- task.created(multica起点の新規起票。契約 §4.3) -----------------------------------
  function createdBody(overrides: Record<string, unknown> = {}): string {
    return JSON.stringify({
      event_id: 'evt-created-1',
      event_type: 'task.created',
      connection_id: 'conn-1',
      external_id: 'multica-issue-1',
      title: '新規Issueのタスク',
      description: '本文です',
      ...overrides,
    })
  }

  it('正常なtask.created(target_space_id設定済み) → 200・rpc_connector_create_taskを正しい引数で呼ぶ・記録する・enqueueは一切しない(エコー防止)', async () => {
    state.conns = [{ ...CONN, import_config: { target_space_id: 'space-1' } }]
    rpcMock.mockResolvedValue({ data: 'new-task-id-1', error: null })
    const raw = createdBody()
    const header = sign(raw)
    const res = await handleMulticaInboundEvent(raw, header)

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ok: true })
    expect(rpcMock).toHaveBeenCalledWith('rpc_connector_create_task', {
      p_connection_id: 'conn-1',
      p_external_id: 'multica-issue-1',
      p_space_id: 'space-1',
      p_title: '新規Issueのタスク',
      p_description: '本文です',
    })
    expect(enqueueConnectorJobMock).not.toHaveBeenCalled()
    expect(notifyChatOnCompletionMock).not.toHaveBeenCalled()
    expect(state.inboundEvents).toContainEqual({
      connection_id: 'conn-1',
      event_id: 'evt-created-1',
      event_type: 'task.created',
    })
  })

  it('冪等: 既存external_idでrpcが既存task_idを返す再送 → 200(rpc呼び出しと記録のみ確認。重複起票しない旨はrpc自体の責務)', async () => {
    state.conns = [{ ...CONN, import_config: { target_space_id: 'space-1' } }]
    rpcMock.mockResolvedValue({ data: 'existing-task-id', error: null })
    const raw = createdBody({ event_id: 'evt-created-dup' })
    const header = sign(raw)
    const res = await handleMulticaInboundEvent(raw, header)
    expect(res.status).toBe(200)
    expect(rpcMock).toHaveBeenCalledTimes(1)
  })

  it('external_id欠落 → 400・rpc未呼び出し', async () => {
    state.conns = [{ ...CONN, import_config: { target_space_id: 'space-1' } }]
    const raw = createdBody({ external_id: undefined })
    const header = sign(raw)
    const res = await handleMulticaInboundEvent(raw, header)
    expect(res.status).toBe(400)
    expect(rpcMock).not.toHaveBeenCalled()
  })

  it('title欠落 → 400・rpc未呼び出し', async () => {
    state.conns = [{ ...CONN, import_config: { target_space_id: 'space-1' } }]
    const raw = createdBody({ title: undefined })
    const header = sign(raw)
    const res = await handleMulticaInboundEvent(raw, header)
    expect(res.status).toBe(400)
    expect(rpcMock).not.toHaveBeenCalled()
  })

  it('接続のimport_config.target_space_idが未設定 → 422・rpc未呼び出し(設定待ちの恒久エラー)', async () => {
    state.conns = [{ ...CONN, import_config: null }]
    const raw = createdBody()
    const header = sign(raw)
    const res = await handleMulticaInboundEvent(raw, header)
    expect(res.status).toBe(422)
    expect(res.body).toEqual({ error: 'target_space_unconfigured' })
    expect(rpcMock).not.toHaveBeenCalled()
  })

  // --- 冪等記録の順序バグに対する回帰テスト -----------------------------------------
  // 旧実装は「記録(connector_inbound_events insert)→副作用(RPC/enqueue)」の順だったため、
  // 副作用側の一時例外(DB瞬断等)後の再送がdedupで無条件に握られ、完了・書き戻しが
  // 恒久的に失われるバグがあった。新実装は「副作用が成功してから記録」する。

  it('RPCが一時例外(throw) → 500。再送(同一event_id)はdedupで握られずRPCが再実行され最終的に200になる', async () => {
    rpcMock.mockRejectedValueOnce(new Error('temporary db error'))
    const raw = body()
    const header = sign(raw)

    await expect(handleMulticaInboundEvent(raw, header)).rejects.toThrow('temporary db error')
    // 記録が先行していないことの検証: 失敗後もdedupレコードは残っていない。
    expect(state.inboundEvents).toHaveLength(0)

    rpcMock.mockResolvedValueOnce({ data: true, error: null })
    const res = await handleMulticaInboundEvent(raw, header)
    expect(res.status).toBe(200)
    expect(rpcMock).toHaveBeenCalledTimes(2)
    expect(state.inboundEvents).toHaveLength(1)
  })

  it('初回で遷移(rpc true)後にenqueueが例外→未記録→再送はrpc false(既にdone)でも書き戻しが再駆動される(消失なし)', async () => {
    state.conns = [CONN, { id: 'conn-gtasks', provider: 'google_tasks', status: 'active', metadata: {} }]
    state.links = [
      { connection_id: 'conn-1', task_id: TASK_REF },
      { connection_id: 'conn-gtasks', task_id: TASK_REF },
    ]
    // 実RPCの遷移意味論を忠実にモデル化する: 初回は 0→1 遷移で true、
    // 再送時は既に done なので false(v_updated=0)。書き戻し enqueue はこの false でも
    // 再駆動されねばならない(遷移に条件付けると silent lost する回帰の砦)。
    rpcMock.mockResolvedValueOnce({ data: true, error: null }).mockResolvedValue({ data: false, error: null })
    enqueueConnectorJobMock.mockRejectedValueOnce(new Error('temporary enqueue error'))
    const raw = body()
    const header = sign(raw)

    await expect(handleMulticaInboundEvent(raw, header)).rejects.toThrow('temporary enqueue error')
    expect(state.inboundEvents).toHaveLength(0)

    enqueueConnectorJobMock.mockResolvedValueOnce(undefined)
    const res = await handleMulticaInboundEvent(raw, header)
    expect(res.status).toBe(200)
    // rpc は再送で false を返すが、enqueue は無条件駆動なので2回目も呼ばれ書き戻しが確定する。
    expect(enqueueConnectorJobMock).toHaveBeenCalledTimes(2)
    expect(state.inboundEvents).toHaveLength(1)
  })

  it('チャット返信は真の0→1遷移(rpc true)のときだけ発火し、既にdone(rpc false)では発火しない', async () => {
    state.conns = [CONN, { id: 'conn-gtasks', provider: 'google_tasks', status: 'active', metadata: {} }]
    state.links = [
      { connection_id: 'conn-1', task_id: TASK_REF },
      { connection_id: 'conn-gtasks', task_id: TASK_REF },
    ]
    // 既にdoneのタスクに対する(別event_idの)完了通知: rpc は false。
    rpcMock.mockResolvedValue({ data: false, error: null })
    const raw = body()
    const header = sign(raw)

    const res = await handleMulticaInboundEvent(raw, header)
    expect(res.status).toBe(200)
    // 書き戻しは冪等に確定(fold)されるが、チャット返信は遷移していないので二重送信を避けて発火しない。
    expect(enqueueConnectorJobMock).toHaveBeenCalledTimes(1)
    expect(notifyChatOnCompletionMock).not.toHaveBeenCalled()
  })

  it('全成功後の同一event_id再送 → 200・副作用ゼロ(早期dedupで短絡)', async () => {
    state.conns = [CONN, { id: 'conn-gtasks', provider: 'google_tasks', status: 'active', metadata: {} }]
    state.links = [
      { connection_id: 'conn-1', task_id: TASK_REF },
      { connection_id: 'conn-gtasks', task_id: TASK_REF },
    ]
    rpcMock.mockResolvedValue({ data: true, error: null })
    const raw = body()
    const header = sign(raw)

    const first = await handleMulticaInboundEvent(raw, header)
    expect(first.status).toBe(200)
    expect(rpcMock).toHaveBeenCalledTimes(1)
    expect(enqueueConnectorJobMock).toHaveBeenCalledTimes(1)
    expect(notifyChatOnCompletionMock).toHaveBeenCalledTimes(1)

    const second = await handleMulticaInboundEvent(raw, header)
    expect(second.status).toBe(200)
    expect(second.body).toEqual({ ok: true, duplicate: true })
    // 副作用は再送で増えない(早期dedupで短絡された)。
    expect(rpcMock).toHaveBeenCalledTimes(1)
    expect(enqueueConnectorJobMock).toHaveBeenCalledTimes(1)
    expect(notifyChatOnCompletionMock).toHaveBeenCalledTimes(1)
  })
})
