import { describe, it, expect, vi, beforeEach } from 'vitest'
import { buildSignatureHeader } from '@/lib/sinks/signature'

/**
 * 汎用Webhook受信のオーケストレーション。
 *
 * 公開APIが無い/弱いツール（業界特化型の長尾）を面で取るための受け口。**こちらから取りに行かない**
 * ので SSRF が構造的に消え、資格情報も預からない。その代わり「誰が送ってきたか」は署名だけが
 * 根拠になるため、署名・冪等・テナント境界の3点がこのファイルの全て。
 *
 * 処理順は multica 受信（src/lib/connectors/inbound.ts）と同型にしてある:
 *   署名検証 → 早期dedup → 副作用 → **副作用が成功してから**記録。
 * 記録を先に確定すると、副作用が一時失敗したときに「記録済みだが未処理」が残り、送信側の再送が
 * dedupで握られて取り込みが恒久的に失われる。
 */

const SECRET = 'a'.repeat(64)
const CONNECTION_ID = '11111111-1111-4111-8111-111111111111'

const state = {
  connection: null as Record<string, unknown> | null,
  secret: SECRET as string | null,
  links: [] as Array<{ external_id: string; task_id: string }>,
  seenEvents: [] as string[],
  createdTasks: [] as Record<string, unknown>[],
  taskUpdates: [] as Record<string, unknown>[],
  recordedEvents: [] as string[],
  rpcCalls: [] as Array<{ name: string; args: unknown }>,
  completeResult: true,
}

vi.mock('@/lib/connectors/secrets', () => ({
  decryptConnectorSecret: async () => state.secret,
}))

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table: string) => ({
      select: () => ({
        eq: function eqChain() {
          return {
            eq: eqChain,
            maybeSingle: async () => {
              if (table === 'integration_connections') return { data: state.connection, error: null }
              if (table === 'connector_inbound_events') {
                return { data: state.seenEvents.length > 0 ? { event_id: state.seenEvents[0] } : null, error: null }
              }
              if (table === 'connector_task_links') {
                const row = state.links[0] ?? null
                return { data: row, error: null }
              }
              return { data: null, error: null }
            },
          }
        },
      }),
      insert: (payload: Record<string, unknown>) => {
        if (table === 'connector_inbound_events') state.recordedEvents.push(String(payload.event_id))
        return { then: (resolve: (v: unknown) => void) => resolve({ error: null }) }
      },
      update: (payload: Record<string, unknown>) => {
        if (table === 'tasks') state.taskUpdates.push(payload)
        return { eq: async () => ({ error: null }) }
      },
    }),
    rpc: async (name: string, args: unknown) => {
      state.rpcCalls.push({ name, args })
      if (name === 'rpc_connector_create_task') {
        state.createdTasks.push(args as Record<string, unknown>)
        return { data: 'task-new', error: null }
      }
      if (name === 'rpc_connector_complete_task') return { data: state.completeResult, error: null }
      return { data: null, error: null }
    },
  }),
}))

const { handleGenericInboundEvent } = await import('@/lib/connectors/genericInbound')

function payload(over: Record<string, unknown> = {}) {
  return JSON.stringify({
    event_id: 'evt-1',
    event_type: 'task.created',
    connection_id: CONNECTION_ID,
    external_id: 'ext-1',
    title: '請求書を送る',
    ...over,
  })
}

function signed(raw: string, secret = SECRET) {
  return buildSignatureHeader(secret, raw)
}

beforeEach(() => {
  state.connection = {
    id: CONNECTION_ID,
    metadata: { generic_inbound: { receive_secret_encrypted: 'enc' } },
    import_config: { target_space_id: '22222222-2222-4222-8222-222222222222' },
    org_id: 'org-1',
  }
  state.secret = SECRET
  state.links = []
  state.seenEvents = []
  state.createdTasks = []
  state.taskUpdates = []
  state.recordedEvents = []
  state.rpcCalls = []
  state.completeResult = true
})

describe('署名（誰が送ってきたかの唯一の根拠）', () => {
  it('正しい署名なら受理する', async () => {
    const raw = payload()
    const result = await handleGenericInboundEvent(raw, signed(raw))
    expect(result.status).toBe(200)
  })

  it('署名が無ければ401', async () => {
    const raw = payload()
    expect((await handleGenericInboundEvent(raw, null)).status).toBe(401)
  })

  it('別の鍵で署名されていれば401', async () => {
    const raw = payload()
    expect((await handleGenericInboundEvent(raw, signed(raw, 'b'.repeat(64)))).status).toBe(401)
  })

  it('ボディを改竄すると401（署名は生ボディに対して検証する）', async () => {
    const raw = payload()
    const header = signed(raw)
    const tampered = payload({ title: '差し替えられたタイトル' })
    expect((await handleGenericInboundEvent(tampered, header)).status).toBe(401)
  })

  it('未知の接続・鍵未設定・復号失敗はすべて同じ401にする（存在を教えるオラクルにしない）', async () => {
    const raw = payload()
    const header = signed(raw)

    state.connection = null
    const unknown = await handleGenericInboundEvent(raw, header)

    state.connection = { id: CONNECTION_ID, metadata: {}, import_config: {}, org_id: 'org-1' }
    const noSecret = await handleGenericInboundEvent(raw, header)

    state.connection = {
      id: CONNECTION_ID,
      metadata: { generic_inbound: { receive_secret_encrypted: 'enc' } },
      import_config: {},
      org_id: 'org-1',
    }
    state.secret = null
    const undecryptable = await handleGenericInboundEvent(raw, header)

    expect([unknown.status, noSecret.status, undecryptable.status]).toEqual([401, 401, 401])
    expect(new Set([JSON.stringify(unknown.body), JSON.stringify(noSecret.body), JSON.stringify(undecryptable.body)]).size).toBe(1)
  })
})

describe('ペイロード', () => {
  it('壊れたJSONは400', async () => {
    const raw = '{not json'
    expect((await handleGenericInboundEvent(raw, signed(raw))).status).toBe(400)
  })

  it('契約に合わないボディは理由付きで400（送信側が直せるように）', async () => {
    const raw = payload({ due_date: '2026/07/31' })
    const result = await handleGenericInboundEvent(raw, signed(raw))
    expect(result.status).toBe(400)
    expect(JSON.stringify(result.body)).toContain('due_date')
  })
})

describe('冪等（再送で二重に起票しない）', () => {
  it('記録済みのイベントは副作用を一切呼ばず200で握る', async () => {
    state.seenEvents = ['evt-1']
    const raw = payload()
    const result = await handleGenericInboundEvent(raw, signed(raw))
    expect(result.status).toBe(200)
    expect(state.rpcCalls).toHaveLength(0)
  })

  it('副作用が成功してから記録する（先に記録すると失敗時に取り込みが永久に失われる）', async () => {
    const raw = payload()
    await handleGenericInboundEvent(raw, signed(raw))
    expect(state.createdTasks).toHaveLength(1)
    expect(state.recordedEvents).toEqual(['evt-1'])
  })
})

describe('task.created — 起票', () => {
  it('取り込み先スペース未設定なら422（設定待ちであって送信側の誤りではない）', async () => {
    state.connection = { id: CONNECTION_ID, metadata: { generic_inbound: { receive_secret_encrypted: 'enc' } }, import_config: {}, org_id: 'org-1' }
    const raw = payload()
    const result = await handleGenericInboundEvent(raw, signed(raw))
    expect(result.status).toBe(422)
    expect(state.rpcCalls).toHaveLength(0)
  })

  it('冪等な起票RPCを使う（再送や並行でも1件に収束する）', async () => {
    const raw = payload()
    await handleGenericInboundEvent(raw, signed(raw))
    expect(state.rpcCalls[0].name).toBe('rpc_connector_create_task')
  })

  it('期日が来ていれば設定し、期限の正本をこの接続にする', async () => {
    // 正本を立てないと「鮮度チェックのかからない内部期限」になり、古い期限で催促が飛ぶ。
    const raw = payload({ due_date: '2026-07-31' })
    await handleGenericInboundEvent(raw, signed(raw))
    expect(state.taskUpdates[0]).toMatchObject({
      due_date: '2026-07-31',
      due_authority_connection_id: CONNECTION_ID,
    })
  })
})

describe('task.updated / task.completed — 対応が要る', () => {
  it('対応の無い外部IDへの更新は404（他テナントのタスクを触らせない）', async () => {
    state.links = []
    const raw = payload({ event_type: 'task.updated', title: '新しいタイトル' })
    const result = await handleGenericInboundEvent(raw, signed(raw))
    expect(result.status).toBe(404)
    expect(state.taskUpdates).toHaveLength(0)
  })

  it('対応があれば内容を更新する', async () => {
    state.links = [{ external_id: 'ext-1', task_id: 'task-1' }]
    const raw = payload({ event_type: 'task.updated', title: '新しいタイトル', due_date: '2026-08-01' })
    const result = await handleGenericInboundEvent(raw, signed(raw))
    expect(result.status).toBe(200)
    expect(state.taskUpdates[0]).toMatchObject({ title: '新しいタイトル', due_date: '2026-08-01' })
  })

  it('完了は条件付き更新RPCで吸収する（既に完了なら何も起きない）', async () => {
    state.links = [{ external_id: 'ext-1', task_id: 'task-1' }]
    const raw = payload({ event_type: 'task.completed' })
    const result = await handleGenericInboundEvent(raw, signed(raw))
    expect(result.status).toBe(200)
    expect(state.rpcCalls[0].name).toBe('rpc_connector_complete_task')
  })

  it('対応の無い外部IDの完了は404', async () => {
    state.links = []
    const raw = payload({ event_type: 'task.completed' })
    expect((await handleGenericInboundEvent(raw, signed(raw))).status).toBe(404)
  })
})
