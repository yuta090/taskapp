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

const getValidTokenDetailedMock = vi.fn()
vi.mock('@/lib/integrations/token-manager', () => ({
  getValidTokenDetailed: (...args: unknown[]) => getValidTokenDetailedMock(...args),
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
  getValidTokenDetailedMock.mockReset()
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

describe('findExternalRef', () => {
  it('returns the external_ref when a row exists', async () => {
    fromResponses['sink_external_refs'] = { data: { external_ref: 'page-1' }, error: null }
    const ref = await store.findExternalRef(SINK_ID, 'task-1')
    expect(ref).toBe('page-1')
  })

  it('returns null when no row exists', async () => {
    fromResponses['sink_external_refs'] = { data: null, error: null }
    const ref = await store.findExternalRef(SINK_ID, 'task-1')
    expect(ref).toBeNull()
  })
})

describe('saveExternalRef', () => {
  it('inserts successfully', async () => {
    fromResponses['sink_external_refs'] = { data: null, error: null }
    const result = await store.saveExternalRef(SINK_ID, 'task-1', 'page-1')
    expect(result).toEqual({ outcome: 'inserted' })
  })

  it('falls back to reading the existing ref on a unique-constraint conflict (23505, concurrent delivery)', async () => {
    let callCount = 0
    fromMock.mockImplementation((table: string) => {
      fromCalls.push({ table, args: [] })
      if (table === 'sink_external_refs') {
        callCount += 1
        if (callCount === 1) {
          return chain({
            data: null,
            error: { code: '23505', message: 'duplicate key value violates unique constraint' },
          })
        }
        return chain({ data: { external_ref: 'page-winner' }, error: null })
      }
      return chain(fromResponses[table] ?? { data: null, error: null })
    })

    const result = await store.saveExternalRef(SINK_ID, 'task-1', 'page-orphan')
    expect(result).toEqual({ outcome: 'conflict', existingRef: 'page-winner' })
  })

  it('throws on a non-conflict insert error', async () => {
    fromResponses['sink_external_refs'] = { data: null, error: { code: '23503', message: 'fk violation' } }
    await expect(store.saveExternalRef(SINK_ID, 'task-1', 'page-1')).rejects.toThrow(
      'sink_external_refs: insert failed',
    )
  })
})

describe('findActiveNotionConnection', () => {
  it('returns the access token and workspace name for an active org connection', async () => {
    fromResponses['integration_connections'] = {
      data: { id: 'conn-1', access_token: 'secret_abc', metadata: { workspace_name: 'Acme Workspace' } },
      error: null,
    }
    const connection = await store.findActiveNotionConnection(ORG_ID)
    expect(connection).toEqual({ id: 'conn-1', accessToken: 'secret_abc', workspaceName: 'Acme Workspace' })
  })

  it('returns null when there is no active connection (not connected / revoked)', async () => {
    fromResponses['integration_connections'] = { data: null, error: null }
    expect(await store.findActiveNotionConnection(ORG_ID)).toBeNull()
  })
})

describe('createNotionSink', () => {
  it('inserts a notion sink with secret_encrypted null and connection_id set (no secret to leak)', async () => {
    fromResponses['integration_sinks'] = {
      data: {
        id: SINK_ID,
        org_id: ORG_ID,
        group_id: null,
        provider: 'notion',
        display_name: 'Notion連携',
        config: { database_id: '12345678-1234-1234-1234-123456789012' },
        connection_id: 'conn-1',
        events: ['task.created'],
        status: 'active',
        consecutive_failures: 0,
        last_delivered_at: null,
        created_by: 'user-1',
        created_at: '2026-07-12T00:00:00.000Z',
        updated_at: '2026-07-12T00:00:00.000Z',
      },
      error: null,
    }

    const sink = await store.createNotionSink({
      orgId: ORG_ID,
      groupId: null,
      displayName: 'Notion連携',
      databaseId: '12345678-1234-1234-1234-123456789012',
      connectionId: 'conn-1',
      events: ['task.created'],
      createdBy: 'user-1',
    })

    expect(sink.provider).toBe('notion')
    expect(sink.connectionId).toBe('conn-1')
    const call = fromMock.mock.results[0].value
    const insertArg = call.insert.mock.calls[0][0] as Record<string, unknown>
    expect(insertArg.secret_encrypted).toBeNull()
    expect(insertArg.connection_id).toBe('conn-1')
    expect(insertArg.provider).toBe('notion')
  })
})

describe('findDeliverableSink (notion)', () => {
  it('resolves a notion sink using the org active connection access token', async () => {
    fromMock.mockImplementation((table: string) => {
      fromCalls.push({ table, args: [] })
      if (table === 'integration_sinks') {
        return chain({
          data: {
            id: SINK_ID,
            org_id: ORG_ID,
            provider: 'notion',
            config: { database_id: '12345678-1234-1234-1234-123456789012' },
            secret_encrypted: null,
          },
          error: null,
        })
      }
      if (table === 'integration_connections') {
        return chain({
          data: { id: 'conn-1', access_token: 'secret_abc', metadata: { workspace_name: 'Acme' } },
          error: null,
        })
      }
      return chain({ data: null, error: null })
    })

    const sink = await store.findDeliverableSink(SINK_ID)
    expect(sink).toEqual({
      id: SINK_ID,
      provider: 'notion',
      accessToken: 'secret_abc',
      databaseId: '12345678-1234-1234-1234-123456789012',
    })
  })

  it('returns null when the org has no active notion connection (not connected / revoked)', async () => {
    fromMock.mockImplementation((table: string) => {
      fromCalls.push({ table, args: [] })
      if (table === 'integration_sinks') {
        return chain({
          data: {
            id: SINK_ID,
            org_id: ORG_ID,
            provider: 'notion',
            config: { database_id: '12345678-1234-1234-1234-123456789012' },
            secret_encrypted: null,
          },
          error: null,
        })
      }
      return chain({ data: null, error: null }) // integration_connections: none active
    })

    expect(await store.findDeliverableSink(SINK_ID)).toBeNull()
  })

  it('returns null when config.database_id is missing (invalid config shape)', async () => {
    fromResponses['integration_sinks'] = {
      data: { id: SINK_ID, org_id: ORG_ID, provider: 'notion', config: {}, secret_encrypted: null },
      error: null,
    }
    expect(await store.findDeliverableSink(SINK_ID)).toBeNull()
  })
})

describe('findActiveGoogleSheetsConnection', () => {
  it('returns the connection id and access token for an active org connection', async () => {
    fromResponses['integration_connections'] = {
      data: { id: 'conn-gs-1', access_token: 'access-abc' },
      error: null,
    }
    const connection = await store.findActiveGoogleSheetsConnection(ORG_ID)
    expect(connection).toEqual({ id: 'conn-gs-1', accessToken: 'access-abc' })
  })

  it('returns null when there is no active connection (not connected / revoked / expired)', async () => {
    fromResponses['integration_connections'] = { data: null, error: null }
    expect(await store.findActiveGoogleSheetsConnection(ORG_ID)).toBeNull()
  })
})

describe('createGoogleSheetsSink', () => {
  it('inserts a google_sheets sink with secret_encrypted null and connection_id set', async () => {
    fromResponses['integration_sinks'] = {
      data: {
        id: SINK_ID,
        org_id: ORG_ID,
        group_id: null,
        provider: 'google_sheets',
        display_name: 'Sheets連携',
        config: { spreadsheet_id: '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms', sheet_name: 'タスク' },
        connection_id: 'conn-gs-1',
        events: ['task.created'],
        status: 'active',
        consecutive_failures: 0,
        last_delivered_at: null,
        created_by: 'user-1',
        created_at: '2026-07-12T00:00:00.000Z',
        updated_at: '2026-07-12T00:00:00.000Z',
      },
      error: null,
    }

    const sink = await store.createGoogleSheetsSink({
      orgId: ORG_ID,
      groupId: null,
      displayName: 'Sheets連携',
      spreadsheetId: '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms',
      sheetName: 'タスク',
      connectionId: 'conn-gs-1',
      events: ['task.created'],
      createdBy: 'user-1',
    })

    expect(sink.provider).toBe('google_sheets')
    expect(sink.connectionId).toBe('conn-gs-1')
    const call = fromMock.mock.results[0].value
    const insertArg = call.insert.mock.calls[0][0] as Record<string, unknown>
    expect(insertArg.secret_encrypted).toBeNull()
    expect(insertArg.connection_id).toBe('conn-gs-1')
    expect(insertArg.provider).toBe('google_sheets')
    expect(insertArg.config).toEqual({
      spreadsheet_id: '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms',
      sheet_name: 'タスク',
    })
  })
})

describe('findDeliverableSink (google_sheets)', () => {
  const VALID_CONFIG = {
    spreadsheet_id: '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms',
    sheet_name: 'タスク',
  }

  function mockGoogleSheetsSinkRow() {
    fromMock.mockImplementation((table: string) => {
      fromCalls.push({ table, args: [] })
      if (table === 'integration_sinks') {
        return chain({
          data: { id: SINK_ID, org_id: ORG_ID, provider: 'google_sheets', config: VALID_CONFIG, secret_encrypted: null },
          error: null,
        })
      }
      if (table === 'integration_connections') {
        return chain({ data: { id: 'conn-gs-1', access_token: 'stale-token' }, error: null })
      }
      return chain({ data: null, error: null })
    })
  }

  it('resolves a google_sheets sink using token-manager.getValidTokenDetailed for the org active connection', async () => {
    mockGoogleSheetsSinkRow()
    getValidTokenDetailedMock.mockResolvedValue({ status: 'ok', token: 'fresh-access-token' })

    const sink = await store.findDeliverableSink(SINK_ID)

    expect(getValidTokenDetailedMock).toHaveBeenCalledWith('conn-gs-1', expect.any(Function))
    expect(sink).toEqual({
      id: SINK_ID,
      provider: 'google_sheets',
      accessToken: 'fresh-access-token',
      spreadsheetId: VALID_CONFIG.spreadsheet_id,
      sheetName: VALID_CONFIG.sheet_name,
    })
  })

  it('returns null when the org has no active google_sheets connection', async () => {
    fromMock.mockImplementation((table: string) => {
      fromCalls.push({ table, args: [] })
      if (table === 'integration_sinks') {
        return chain({
          data: { id: SINK_ID, org_id: ORG_ID, provider: 'google_sheets', config: VALID_CONFIG, secret_encrypted: null },
          error: null,
        })
      }
      return chain({ data: null, error: null }) // integration_connections: none active
    })

    expect(await store.findDeliverableSink(SINK_ID)).toBeNull()
    expect(getValidTokenDetailedMock).not.toHaveBeenCalled()
  })

  it('returns null when getValidTokenDetailed reports auth_failed (expired/revoked, no fallback token)', async () => {
    mockGoogleSheetsSinkRow()
    getValidTokenDetailedMock.mockResolvedValue({ status: 'auth_failed' })

    expect(await store.findDeliverableSink(SINK_ID)).toBeNull()
  })

  // レビュー回帰(Major修正2): refreshの一時障害(5xx/ネットワーク)はsink_not_deliverable(恒久)ではなく
  // dispatcher側でtemporary_fail(再試行)に落とすため、単発解決のfindDeliverableSinkではnullを返す
  // (このAPIは恒久/一時を区別しない。区別が要るのはfindDeliverableSinksByIds経由のdispatchのみ)。
  it('returns null when getValidTokenDetailed reports transient_error (does not throw)', async () => {
    mockGoogleSheetsSinkRow()
    getValidTokenDetailedMock.mockResolvedValue({ status: 'transient_error' })

    expect(await store.findDeliverableSink(SINK_ID)).toBeNull()
  })

  it('returns null when config.spreadsheet_id/sheet_name is missing or invalid (invalid config shape)', async () => {
    fromResponses['integration_sinks'] = {
      data: { id: SINK_ID, org_id: ORG_ID, provider: 'google_sheets', config: { spreadsheet_id: 'too-short' }, secret_encrypted: null },
      error: null,
    }
    expect(await store.findDeliverableSink(SINK_ID)).toBeNull()
    expect(getValidTokenDetailedMock).not.toHaveBeenCalled()
  })
})

describe('findDeliverableSinksByIds (google_sheets transient error handling)', () => {
  const VALID_CONFIG = {
    spreadsheet_id: '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms',
    sheet_name: 'タスク',
  }

  it('separates a transiently-failed google_sheets sink into transientSinkIds instead of dropping it silently', async () => {
    fromMock.mockImplementation((table: string) => {
      fromCalls.push({ table, args: [] })
      if (table === 'integration_sinks') {
        return chain({
          data: [
            { id: 'sink-ok', org_id: ORG_ID, provider: 'google_sheets', config: VALID_CONFIG, secret_encrypted: null },
            { id: 'sink-transient', org_id: ORG_ID, provider: 'google_sheets', config: VALID_CONFIG, secret_encrypted: null },
          ],
          error: null,
        })
      }
      if (table === 'integration_connections') {
        return chain({ data: { id: 'conn-gs-1', access_token: 'stale-token' }, error: null })
      }
      return chain({ data: null, error: null })
    })
    // 両sinkとも同じorg接続(conn-gs-1)を解決するが、2件目は呼び出しタイミングで一時障害が
    // 起きたことを模擬するため、呼び出し順に応じて結果を切り替える。
    getValidTokenDetailedMock
      .mockResolvedValueOnce({ status: 'ok', token: 'fresh-token' })
      .mockResolvedValueOnce({ status: 'transient_error' })

    const result = await store.findDeliverableSinksByIds(['sink-ok', 'sink-transient'])

    expect(result.sinks.has('sink-ok')).toBe(true)
    expect(result.sinks.has('sink-transient')).toBe(false)
    expect(result.transientSinkIds.has('sink-transient')).toBe(true)
    expect(result.transientSinkIds.has('sink-ok')).toBe(false)
  })

  it('does not add auth_failed/unavailable sinks to transientSinkIds (stays permanent)', async () => {
    fromMock.mockImplementation((table: string) => {
      fromCalls.push({ table, args: [] })
      if (table === 'integration_sinks') {
        return chain({
          data: [{ id: 'sink-auth-failed', org_id: ORG_ID, provider: 'google_sheets', config: VALID_CONFIG, secret_encrypted: null }],
          error: null,
        })
      }
      if (table === 'integration_connections') {
        return chain({ data: { id: 'conn-gs-1', access_token: 'stale-token' }, error: null })
      }
      return chain({ data: null, error: null })
    })
    getValidTokenDetailedMock.mockResolvedValue({ status: 'auth_failed' })

    const result = await store.findDeliverableSinksByIds(['sink-auth-failed'])

    expect(result.sinks.size).toBe(0)
    expect(result.transientSinkIds.size).toBe(0)
  })

  it('returns empty sinks/transientSinkIds when no ids are given', async () => {
    const result = await store.findDeliverableSinksByIds([])
    expect(result.sinks.size).toBe(0)
    expect(result.transientSinkIds.size).toBe(0)
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
