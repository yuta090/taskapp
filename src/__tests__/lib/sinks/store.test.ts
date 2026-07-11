import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * src/lib/sinks/store.ts — integration_sinks / sink_deliveries データアクセス層。
 * service role専用RPC/テーブル呼び出しの配線を検証する（実DBは使わずSupabaseクライアントをモック）。
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function chain(response: any) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const builder: any = {}
  for (const m of ['select', 'eq', 'in', 'order', 'limit', 'lt', 'insert', 'update']) {
    builder[m] = vi.fn(() => builder)
  }
  builder.single = vi.fn(() => Promise.resolve(response))
  builder.maybeSingle = vi.fn(() => Promise.resolve(response))
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  builder.then = (resolve: any, reject?: any) => Promise.resolve(response).then(resolve, reject)
  return builder
}

let fromResponses: Record<string, unknown>
let rpcResponses: Record<string, unknown>
const fromCalls: Array<{ table: string; args: unknown[] }> = []
const rpcCalls: Array<{ fn: string; args: unknown }> = []
const fromMock = vi.fn()
const rpcMock = vi.fn()

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => ({
    from: fromMock,
    rpc: rpcMock,
  })),
}))

const store = await import('@/lib/sinks/store')

const ORG_ID = 'org-1'
const SINK_ID = 'sink-1'

beforeEach(() => {
  vi.clearAllMocks()
  fromCalls.length = 0
  rpcCalls.length = 0
  fromResponses = {}
  rpcResponses = {}
  process.env.SYSTEM_ENCRYPTION_KEY = 'test-encryption-key'

  fromMock.mockImplementation((table: string) => {
    fromCalls.push({ table, args: [] })
    const response = fromResponses[table] ?? { data: null, error: null }
    return chain(response)
  })
  rpcMock.mockImplementation((fn: string, args: unknown) => {
    rpcCalls.push({ fn, args })
    const response = rpcResponses[fn] ?? { data: null, error: null }
    return Promise.resolve(response)
  })
})

describe('generateWebhookSecret', () => {
  it('produces a whsec_-prefixed random secret, different each call', () => {
    const a = store.generateWebhookSecret()
    const b = store.generateWebhookSecret()
    expect(a).toMatch(/^whsec_[0-9a-f]{48}$/)
    expect(a).not.toBe(b)
  })
})

describe('createWebhookSink', () => {
  it('encrypts the generated secret via encrypt_system_secret and returns the plaintext once', async () => {
    rpcResponses['encrypt_system_secret'] = { data: 'ENCRYPTED_BLOB', error: null }
    fromResponses['integration_sinks'] = {
      data: {
        id: SINK_ID,
        org_id: ORG_ID,
        group_id: null,
        provider: 'webhook',
        display_name: 'My Webhook',
        config: { url: 'https://example.com/hook' },
        connection_id: null,
        events: ['task.created'],
        status: 'active',
        consecutive_failures: 0,
        last_delivered_at: null,
        created_by: 'user-1',
        created_at: '2026-07-11T00:00:00.000Z',
        updated_at: '2026-07-11T00:00:00.000Z',
      },
      error: null,
    }

    const result = await store.createWebhookSink({
      orgId: ORG_ID,
      groupId: null,
      displayName: 'My Webhook',
      url: 'https://example.com/hook',
      events: ['task.created'],
      createdBy: 'user-1',
    })

    expect(rpcCalls[0].fn).toBe('encrypt_system_secret')
    expect((rpcCalls[0].args as { secret: string }).secret).toBe('test-encryption-key')
    expect(result.secret).toMatch(/^whsec_/)
    expect(result.sink.id).toBe(SINK_ID)
    // secretは戻り値のsinkオブジェクトには含まれない（一度だけ平文で別途返る）
    expect(result.sink).not.toHaveProperty('secretEncrypted')
    expect(result.sink).not.toHaveProperty('secret')
  })

  it('throws if SYSTEM_ENCRYPTION_KEY is missing', async () => {
    delete process.env.SYSTEM_ENCRYPTION_KEY
    await expect(
      store.createWebhookSink({
        orgId: ORG_ID,
        groupId: null,
        displayName: 'x',
        url: 'https://example.com/hook',
        events: ['task.created'],
        createdBy: 'user-1',
      }),
    ).rejects.toThrow('SYSTEM_ENCRYPTION_KEY')
  })
})

describe('listSinksForOrg', () => {
  it('selects the column allowlist that excludes secret_encrypted', async () => {
    fromResponses['integration_sinks'] = { data: [], error: null }
    await store.listSinksForOrg(ORG_ID)
    const call = fromMock.mock.results[0].value
    const selectArg = call.select.mock.calls[0][0] as string
    expect(selectArg).not.toContain('secret_encrypted')
    expect(selectArg).toContain('display_name')
  })
})

describe('rotateWebhookSecret', () => {
  it('generates a new secret and scopes the update to provider=webhook', async () => {
    rpcResponses['encrypt_system_secret'] = { data: 'NEW_ENCRYPTED', error: null }
    fromResponses['integration_sinks'] = {
      data: {
        id: SINK_ID,
        org_id: ORG_ID,
        group_id: null,
        provider: 'webhook',
        display_name: 'x',
        config: {},
        connection_id: null,
        events: [],
        status: 'active',
        consecutive_failures: 0,
        last_delivered_at: null,
        created_by: 'user-1',
        created_at: '2026-07-11T00:00:00.000Z',
        updated_at: '2026-07-11T00:00:00.000Z',
      },
      error: null,
    }

    const result = await store.rotateWebhookSecret(SINK_ID)
    expect(result?.secret).toMatch(/^whsec_/)

    const call = fromMock.mock.results[0].value
    expect(call.eq).toHaveBeenNthCalledWith(1, 'id', SINK_ID)
    expect(call.eq).toHaveBeenNthCalledWith(2, 'provider', 'webhook')
  })

  it('returns null when no row matched (e.g. non-webhook sink)', async () => {
    rpcResponses['encrypt_system_secret'] = { data: 'X', error: null }
    fromResponses['integration_sinks'] = { data: null, error: null }
    const result = await store.rotateWebhookSecret(SINK_ID)
    expect(result).toBeNull()
  })
})

describe('findDeliverableSink', () => {
  it('decrypts the secret for a webhook sink', async () => {
    fromResponses['integration_sinks'] = {
      data: { id: SINK_ID, provider: 'webhook', config: { url: 'https://example.com/hook' }, secret_encrypted: 'ENC' },
      error: null,
    }
    rpcResponses['decrypt_system_secret'] = { data: 'plaintext-secret', error: null }

    const sink = await store.findDeliverableSink(SINK_ID)
    expect(sink).toEqual({
      id: SINK_ID,
      provider: 'webhook',
      config: { url: 'https://example.com/hook' },
      secret: 'plaintext-secret',
    })
  })

  it('returns null for a non-webhook provider (not implemented in PR-1)', async () => {
    fromResponses['integration_sinks'] = {
      data: { id: SINK_ID, provider: 'notion', config: {}, secret_encrypted: null },
      error: null,
    }
    const sink = await store.findDeliverableSink(SINK_ID)
    expect(sink).toBeNull()
  })

  it('returns null when decryption fails', async () => {
    fromResponses['integration_sinks'] = {
      data: { id: SINK_ID, provider: 'webhook', config: {}, secret_encrypted: 'ENC' },
      error: null,
    }
    rpcResponses['decrypt_system_secret'] = { data: null, error: { message: 'bad key' } }
    const sink = await store.findDeliverableSink(SINK_ID)
    expect(sink).toBeNull()
  })
})

describe('claimSinkDeliveries', () => {
  it('calls rpc_claim_sink_deliveries with limits and maps rows', async () => {
    rpcResponses['rpc_claim_sink_deliveries'] = {
      data: [
        {
          id: 'd1',
          org_id: ORG_ID,
          sink_id: SINK_ID,
          digest_task_id: 'task-1',
          event_type: 'task.created',
          event_key: 'task.created:task-1:evt-1',
          payload: { occurred_at: '2026-07-11T00:00:00.000Z', task: { id: 'task-1' } },
          attempts: 0,
        },
      ],
      error: null,
    }

    const claimed = await store.claimSinkDeliveries(50, 5)
    expect(rpcCalls[0]).toEqual({
      fn: 'rpc_claim_sink_deliveries',
      args: { p_total_limit: 50, p_per_sink_limit: 5 },
    })
    expect(claimed).toHaveLength(1)
    expect(claimed[0].sinkId).toBe(SINK_ID)
    expect(claimed[0].eventType).toBe('task.created')
  })

  it('throws on RPC error', async () => {
    rpcResponses['rpc_claim_sink_deliveries'] = { data: null, error: { message: 'boom' } }
    await expect(store.claimSinkDeliveries()).rejects.toThrow('rpc_claim_sink_deliveries failed')
  })
})

describe('completeSinkDelivery', () => {
  it('maps the returned row (snake_case -> camelCase)', async () => {
    rpcResponses['rpc_complete_sink_delivery'] = {
      data: [
        { delivery_status: 'sent', sink_status: 'active', consecutive_failures: 0, just_became_error: false },
      ],
      error: null,
    }

    const result = await store.completeSinkDelivery({
      deliveryId: 'd1',
      outcome: 'sent',
      responseStatus: 200,
      countsTowardFailures: false,
    })

    expect(rpcCalls[0].args).toEqual({
      p_delivery_id: 'd1',
      p_outcome: 'sent',
      p_response_status: 200,
      p_error: null,
      p_counts_toward_failures: false,
    })
    expect(result).toEqual({
      deliveryStatus: 'sent',
      sinkStatus: 'active',
      consecutiveFailures: 0,
      justBecameError: false,
    })
  })

  it('surfaces justBecameError=true so the caller can notify', async () => {
    rpcResponses['rpc_complete_sink_delivery'] = {
      data: [
        { delivery_status: 'failed', sink_status: 'error', consecutive_failures: 20, just_became_error: true },
      ],
      error: null,
    }
    const result = await store.completeSinkDelivery({
      deliveryId: 'd1',
      outcome: 'temporary_fail',
      error: 'timeout',
      countsTowardFailures: true,
    })
    expect(result.justBecameError).toBe(true)
    expect(result.sinkStatus).toBe('error')
  })
})

describe('reactivateSink / redeliverDelivery / redeliverSink', () => {
  it('reactivateSink calls rpc_reactivate_sink then re-fetches meta', async () => {
    rpcResponses['rpc_reactivate_sink'] = { data: null, error: null }
    fromResponses['integration_sinks'] = {
      data: {
        id: SINK_ID,
        org_id: ORG_ID,
        group_id: null,
        provider: 'webhook',
        display_name: 'x',
        config: {},
        connection_id: null,
        events: [],
        status: 'active',
        consecutive_failures: 0,
        last_delivered_at: null,
        created_by: 'user-1',
        created_at: '2026-07-11T00:00:00.000Z',
        updated_at: '2026-07-11T00:00:00.000Z',
      },
      error: null,
    }
    const sink = await store.reactivateSink(SINK_ID)
    expect(rpcCalls[0]).toEqual({ fn: 'rpc_reactivate_sink', args: { p_sink_id: SINK_ID } })
    expect(sink?.status).toBe('active')
  })

  it('redeliverDelivery returns the RPC boolean', async () => {
    rpcResponses['rpc_redeliver_sink_delivery'] = { data: true, error: null }
    expect(await store.redeliverDelivery('d1')).toBe(true)
  })

  it('redeliverSink returns the RPC count', async () => {
    rpcResponses['rpc_redeliver_sink'] = { data: 3, error: null }
    expect(await store.redeliverSink(SINK_ID)).toBe(3)
  })
})

describe('disableStaleGroupSinks', () => {
  it('calls rpc_disable_stale_group_sinks and maps out_* columns to camelCase', async () => {
    rpcResponses['rpc_disable_stale_group_sinks'] = {
      data: [
        { out_sink_id: 'sink-old-1', out_org_id: ORG_ID, out_display_name: 'Notion連携' },
        { out_sink_id: 'sink-old-2', out_org_id: ORG_ID, out_display_name: '自社Webhook' },
      ],
      error: null,
    }

    const result = await store.disableStaleGroupSinks('group-new-1')

    expect(rpcCalls[0]).toEqual({
      fn: 'rpc_disable_stale_group_sinks',
      args: { p_new_group_id: 'group-new-1' },
    })
    expect(result).toEqual([
      { sinkId: 'sink-old-1', orgId: ORG_ID, displayName: 'Notion連携' },
      { sinkId: 'sink-old-2', orgId: ORG_ID, displayName: '自社Webhook' },
    ])
  })

  it('returns an empty array when there is no stale generation', async () => {
    rpcResponses['rpc_disable_stale_group_sinks'] = { data: [], error: null }
    expect(await store.disableStaleGroupSinks('group-new-1')).toEqual([])
  })

  it('throws with the RPC error message on failure', async () => {
    rpcResponses['rpc_disable_stale_group_sinks'] = { data: null, error: { message: 'boom' } }
    await expect(store.disableStaleGroupSinks('group-new-1')).rejects.toThrow(
      'rpc_disable_stale_group_sinks failed: boom',
    )
  })
})

describe('insertPingDelivery', () => {
  it('generates a unique event_key per call (unique(sink_id, event_key) safety)', async () => {
    fromResponses['sink_deliveries'] = {
      data: {
        id: 'd1',
        org_id: ORG_ID,
        sink_id: SINK_ID,
        digest_task_id: null,
        event_type: 'ping',
        event_key: 'ping:whatever',
        payload: { occurred_at: '2026-07-11T00:00:00.000Z', task: null },
        attempts: 0,
      },
      error: null,
    }
    await store.insertPingDelivery({ id: SINK_ID, orgId: ORG_ID })
    const call = fromMock.mock.results[0].value
    const insertArg = call.insert.mock.calls[0][0] as { event_type: string; event_key: string }
    expect(insertArg.event_type).toBe('ping')
    expect(insertArg.event_key).toMatch(/^ping:/)
  })
})

describe('listDeliveries', () => {
  it('applies sinkId/taskId/beforeCreatedAt filters when provided', async () => {
    fromResponses['sink_deliveries'] = { data: [], error: null }
    await store.listDeliveries({
      orgId: ORG_ID,
      sinkId: SINK_ID,
      taskId: 'task-1',
      beforeCreatedAt: '2026-07-10T00:00:00.000Z',
      limit: 10,
    })
    const call = fromMock.mock.results[0].value
    expect(call.eq).toHaveBeenCalledWith('org_id', ORG_ID)
    expect(call.eq).toHaveBeenCalledWith('sink_id', SINK_ID)
    expect(call.eq).toHaveBeenCalledWith('digest_task_id', 'task-1')
    expect(call.lt).toHaveBeenCalledWith('created_at', '2026-07-10T00:00:00.000Z')
    expect(call.limit).toHaveBeenCalledWith(10)
  })
})
