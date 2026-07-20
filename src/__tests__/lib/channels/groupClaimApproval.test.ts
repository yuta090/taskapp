import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * 共有botグループ紐付け（web_approval）の承認コンソール向けデータアクセス（Stage 4 §3・PR3a）。
 *
 * - listPendingGroupClaimsForOrg: 自orgのpending claim一覧（space表示名付き）。
 * - findGroupClaimOrgId: 認可用（他org claimの早期404判定）。
 * - approveGroupClaim / rejectGroupClaim: rpc_approve_group_claim / rpc_reject_group_claim の
 *   薄いラッパ。RPCは検証失敗を例外(raise exception)で返す設計（PR1・変更不可）ため、ここで
 *   メッセージから reason を分類し GroupClaimActionError として投げ直す（route側の薄いHTTPマッピング用）。
 * - findFirstPlatformAccountId / createSharedGroupClaimCode: コード発行（issue route）用。
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function chain(response: any) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const builder: any = {}
  for (const m of ['select', 'eq', 'insert', 'order', 'limit']) {
    builder[m] = vi.fn(() => builder)
  }
  builder.single = vi.fn(() => Promise.resolve(response))
  builder.maybeSingle = vi.fn(() => Promise.resolve(response))
  // 一部のクエリ(例: listPendingGroupClaimsForOrg)は .single()/.maybeSingle() を呼ばず
  // .order(...) の戻り値を直接 await する。builder自体をthenableにして両方の書き方に対応する。
  builder.then = (resolve: (value: unknown) => void) => resolve(response)
  return builder
}

let fromResponses: Record<string, unknown>
let fromCallCount: number
const fromMock = vi.fn()
const rpcMock = vi.fn()

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => ({ from: fromMock, rpc: rpcMock })),
}))

const store = await import('@/lib/channels/store')

beforeEach(() => {
  vi.clearAllMocks()
  fromResponses = {}
  fromCallCount = 0
  fromMock.mockImplementation((table: string) => {
    fromCallCount += 1
    const key = `${table}#${fromCallCount}`
    const response = fromResponses[key] ?? fromResponses[table] ?? { data: null, error: null }
    return chain(response)
  })
})

describe('listPendingGroupClaimsForOrg', () => {
  it('自orgのpending claimをspace表示名付きで返す（created_at昇順）', async () => {
    fromResponses['channel_group_claims'] = {
      data: [
        {
          id: 'claim-1',
          external_group_id: 'G-1',
          space_id: 'space-1',
          challenge_label: 'AB12',
          group_display_name_snapshot: 'ある会社の相談グループ',
          created_at: '2026-07-15T00:00:00Z',
          spaces: { name: '山田商事' },
        },
      ],
      error: null,
    }

    const result = await store.listPendingGroupClaimsForOrg('org-1')

    expect(result).toEqual([
      {
        id: 'claim-1',
        externalGroupId: 'G-1',
        spaceId: 'space-1',
        spaceName: '山田商事',
        challengeLabel: 'AB12',
        groupDisplayNameSnapshot: 'ある会社の相談グループ',
        createdAt: '2026-07-15T00:00:00Z',
      },
    ])

    const builder = fromMock.mock.results[0].value
    expect(fromMock).toHaveBeenCalledWith('channel_group_claims')
    expect(builder.eq).toHaveBeenCalledWith('org_id', 'org-1')
    expect(builder.eq).toHaveBeenCalledWith('status', 'pending')
    expect(builder.order).toHaveBeenCalledWith('created_at', { ascending: true })
  })

  it('spacesが配列で返る場合も先頭要素から表示名を取る（PostgREST埋め込みの形状差異吸収）', async () => {
    fromResponses['channel_group_claims'] = {
      data: [
        {
          id: 'claim-1',
          external_group_id: 'G-1',
          space_id: 'space-1',
          challenge_label: null,
          group_display_name_snapshot: null,
          created_at: '2026-07-15T00:00:00Z',
          spaces: [{ name: '山田商事' }],
        },
      ],
      error: null,
    }
    const result = await store.listPendingGroupClaimsForOrg('org-1')
    expect(result[0].spaceName).toBe('山田商事')
  })

  it('0件なら空配列', async () => {
    fromResponses['channel_group_claims'] = { data: [], error: null }
    expect(await store.listPendingGroupClaimsForOrg('org-1')).toEqual([])
  })

  it('DBエラーは例外を投げる', async () => {
    fromResponses['channel_group_claims'] = { data: null, error: { message: 'boom' } }
    await expect(store.listPendingGroupClaimsForOrg('org-1')).rejects.toThrow('boom')
  })
})

describe('findGroupClaimOrgAndChannel', () => {
  it('claimのorg_idと（account経由の）channelを返す', async () => {
    // channel は claim.account_id → channel_accounts.channel の join で解決する
    fromResponses['channel_group_claims'] = {
      data: { org_id: 'org-1', channel_accounts: { channel: 'discord' } },
      error: null,
    }
    expect(await store.findGroupClaimOrgAndChannel('claim-1')).toEqual({
      orgId: 'org-1',
      channel: 'discord',
    })
  })

  it('埋め込みが配列で返る形状差異も先頭要素から channel を取る', async () => {
    fromResponses['channel_group_claims'] = {
      data: { org_id: 'org-1', channel_accounts: [{ channel: 'line' }] },
      error: null,
    }
    expect(await store.findGroupClaimOrgAndChannel('claim-1')).toEqual({
      orgId: 'org-1',
      channel: 'line',
    })
  })

  it('該当なしはnull', async () => {
    fromResponses['channel_group_claims'] = { data: null, error: null }
    expect(await store.findGroupClaimOrgAndChannel('claim-1')).toBeNull()
  })

  it('DBエラーもnull（他org 404 に丸めるための呼び出し側規約）', async () => {
    fromResponses['channel_group_claims'] = { data: null, error: { message: 'boom' } }
    expect(await store.findGroupClaimOrgAndChannel('claim-1')).toBeNull()
  })
})

describe('orgLineGroupCapacity — channel=line に限定して数える', () => {
  it('channel_groups を channel=line/status=active で数える（他チャネルで汚染されない）', async () => {
    fromResponses['channel_groups'] = { data: null, error: null, count: 2 }
    fromResponses['org_billing'] = { data: null, error: null }
    const res = await store.orgLineGroupCapacity('org-1')
    const builder = fromMock.mock.results[0].value
    expect(fromMock).toHaveBeenCalledWith('channel_groups')
    expect(builder.eq).toHaveBeenCalledWith('org_id', 'org-1')
    expect(builder.eq).toHaveBeenCalledWith('channel', 'line')
    expect(builder.eq).toHaveBeenCalledWith('status', 'active')
    // free 既定は maxLineGroups を持つ（数値 or null）。ここでは活性数の集計経路だけ検証。
    expect(res).toHaveProperty('activeCount')
    expect(res).toHaveProperty('maxGroups')
  })
})

describe('orgExternalChatGroupCapacity — channel を指定して数える', () => {
  it('既定は channel=discord で数える', async () => {
    fromResponses['channel_groups'] = { data: null, error: null, count: 1 }
    fromResponses['org_billing'] = { data: null, error: null }
    await store.orgExternalChatGroupCapacity('org-1')
    const builder = fromMock.mock.results[0].value
    expect(builder.eq).toHaveBeenCalledWith('channel', 'discord')
    expect(builder.eq).toHaveBeenCalledWith('status', 'active')
  })

  it('channel 明示指定でそのチャネルに絞る', async () => {
    fromResponses['channel_groups'] = { data: null, error: null, count: 0 }
    fromResponses['org_billing'] = { data: null, error: null }
    await store.orgExternalChatGroupCapacity('org-1', 'slack')
    const builder = fromMock.mock.results[0].value
    expect(builder.eq).toHaveBeenCalledWith('channel', 'slack')
  })
})

describe('findOrCreateActiveGroup — channel をハードコードせず引数から採る', () => {
  const GROUP_ROW = {
    id: 'grp-new',
    org_id: 'org-1',
    space_id: null,
    account_id: 'acc-1',
    external_group_id: 'C1',
    display_name: null,
    status: 'active',
    pickup_mode: null,
    last_extracted_message_created_at: null,
    approver_user_id: null,
  }

  it('明示 channel=discord で INSERT する（line 固定でない）', async () => {
    fromResponses['channel_groups#1'] = { data: null, error: null } // findActiveGroup=なし
    fromResponses['channel_groups#2'] = { data: GROUP_ROW, error: null } // insert
    await store.findOrCreateActiveGroup({
      orgId: 'org-1',
      accountId: 'acc-1',
      externalGroupId: 'C1',
      displayName: null,
      channel: 'discord',
    })
    const insertBuilder = fromMock.mock.results[1].value
    expect(insertBuilder.insert).toHaveBeenCalledWith(
      expect.objectContaining({ channel: 'discord', account_id: 'acc-1' }),
    )
  })

  it('channel 省略時は line（後方互換の既定）', async () => {
    fromResponses['channel_groups#1'] = { data: null, error: null }
    fromResponses['channel_groups#2'] = { data: GROUP_ROW, error: null }
    await store.findOrCreateActiveGroup({
      orgId: 'org-1',
      accountId: 'acc-1',
      externalGroupId: 'C1',
      displayName: null,
    })
    const insertBuilder = fromMock.mock.results[1].value
    expect(insertBuilder.insert).toHaveBeenCalledWith(
      expect.objectContaining({ channel: 'line' }),
    )
  })
})

describe('approveGroupClaim', () => {
  it('rpc_approve_group_claim に claim_id/approver_user_id を渡し、成功(true)を返す', async () => {
    rpcMock.mockResolvedValue({ data: true, error: null })
    const result = await store.approveGroupClaim('claim-1', 'user-1')
    expect(rpcMock).toHaveBeenCalledWith('rpc_approve_group_claim', {
      p_claim_id: 'claim-1',
      p_approver_user_id: 'user-1',
    })
    expect(result).toBe(true)
  })

  it('graceful reject（同時承認の敗者）は false を返す（例外にしない）', async () => {
    rpcMock.mockResolvedValue({ data: false, error: null })
    expect(await store.approveGroupClaim('claim-1', 'user-1')).toBe(false)
  })

  it('unknown claim_id(GC404) は GroupClaimActionError(not_found) を投げる', async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { code: 'GC404', message: 'rpc_approve_group_claim: unknown claim_id claim-1' },
    })
    await expect(store.approveGroupClaim('claim-1', 'user-1')).rejects.toMatchObject({
      name: 'GroupClaimActionError',
      reason: 'not_found',
    })
  })

  it('membership不足(GC403) は GroupClaimActionError(forbidden) を投げる', async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: {
        code: 'GC403',
        message: 'rpc_approve_group_claim: approver user-1 is not an internal member of org org-1',
      },
    })
    await expect(store.approveGroupClaim('claim-1', 'user-1')).rejects.toMatchObject({
      reason: 'forbidden',
    })
  })

  it.each(['rpc_approve_group_claim: claim claim-1 is not pending (status=approved)', 'rpc_approve_group_claim: link_code already consumed'])(
    '%s (GC409) は GroupClaimActionError(conflict) を投げる',
    async (message) => {
      rpcMock.mockResolvedValue({ data: null, error: { code: 'GC409', message } })
      await expect(store.approveGroupClaim('claim-1', 'user-1')).rejects.toMatchObject({
        reason: 'conflict',
      })
    },
  )

  it.each([
    'rpc_approve_group_claim: link_code has been revoked',
    'rpc_approve_group_claim: link_code expired',
    'rpc_approve_group_claim: link_code purpose must be shared_group_claim (got group_link)',
  ])('%s (GC422) は GroupClaimActionError(invalid) を投げる', async (message) => {
    rpcMock.mockResolvedValue({ data: null, error: { code: 'GC422', message } })
    await expect(store.approveGroupClaim('claim-1', 'user-1')).rejects.toMatchObject({
      reason: 'invalid',
    })
  })

  it('未分類のSQLSTATE(またはcode無し)は conflict にフォールバックする（安全側デフォルト）', async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: 'unexpected failure' } })
    await expect(store.approveGroupClaim('claim-1', 'user-1')).rejects.toMatchObject({
      reason: 'conflict',
    })
  })
})

describe('rejectGroupClaim', () => {
  it('rpc_reject_group_claim に claim_id/approver_user_id を渡し、boolean をそのまま返す', async () => {
    rpcMock.mockResolvedValue({ data: true, error: null })
    expect(await store.rejectGroupClaim('claim-1', 'user-1')).toBe(true)
    expect(rpcMock).toHaveBeenCalledWith('rpc_reject_group_claim', {
      p_claim_id: 'claim-1',
      p_approver_user_id: 'user-1',
    })
  })

  it('既に処理済み(0行更新)は false', async () => {
    rpcMock.mockResolvedValue({ data: false, error: null })
    expect(await store.rejectGroupClaim('claim-1', 'user-1')).toBe(false)
  })

  it('unknown claim_id(GC404) は GroupClaimActionError(not_found)', async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { code: 'GC404', message: 'rpc_reject_group_claim: unknown claim_id claim-1' },
    })
    await expect(store.rejectGroupClaim('claim-1', 'user-1')).rejects.toMatchObject({
      reason: 'not_found',
    })
  })

  it('membership不足(GC403) は GroupClaimActionError(forbidden)', async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: {
        code: 'GC403',
        message: 'rpc_reject_group_claim: approver user-1 is not an internal member of org org-1',
      },
    })
    await expect(store.rejectGroupClaim('claim-1', 'user-1')).rejects.toMatchObject({
      reason: 'forbidden',
    })
  })
})

describe('findFirstPlatformAccountId（L2ガード: 複数activeは明示エラー）', () => {
  it('owner_type=platform かつ status=active のaccountが1件ならそのidを返す', async () => {
    fromResponses['channel_accounts'] = { data: [{ id: 'acc-platform-1' }], error: null }
    const result = await store.findFirstPlatformAccountId()
    expect(result).toBe('acc-platform-1')

    const builder = fromMock.mock.results[0].value
    expect(fromMock).toHaveBeenCalledWith('channel_accounts')
    expect(builder.eq).toHaveBeenCalledWith('owner_type', 'platform')
    // 既定は channel='line'（複数チャネルの共有bot併存で L2ガードが誤発火しないようscope）
    expect(builder.eq).toHaveBeenCalledWith('channel', 'line')
    // disabled な共有botへ「死にコード」を発行しないよう active に限定する
    expect(builder.eq).toHaveBeenCalledWith('status', 'active')
    expect(builder.order).toHaveBeenCalledWith('created_at', { ascending: true })
    // 2件以上の存在を判定できれば十分なので limit(2) に絞る（全件走査しない）
    expect(builder.limit).toHaveBeenCalledWith(2)
  })

  it('channel を渡すとそのチャネルの platform account に絞る（discord受信の解決用）', async () => {
    fromResponses['channel_accounts'] = { data: [{ id: 'acc-discord-plat' }], error: null }
    const result = await store.findFirstPlatformAccountId('discord')
    expect(result).toBe('acc-discord-plat')
    const builder = fromMock.mock.results[0].value
    expect(builder.eq).toHaveBeenCalledWith('channel', 'discord')
  })

  it('platform accountが0件ならnull（共有bot未設定）', async () => {
    fromResponses['channel_accounts'] = { data: [], error: null }
    expect(await store.findFirstPlatformAccountId()).toBeNull()
  })

  it('platform accountが2件以上なら MultiplePlatformAccountsError を投げる（沈黙のdead-end防止）', async () => {
    fromResponses['channel_accounts'] = {
      data: [{ id: 'acc-platform-1' }, { id: 'acc-platform-2' }],
      error: null,
    }
    await expect(store.findFirstPlatformAccountId()).rejects.toThrow(
      store.MultiplePlatformAccountsError,
    )
  })

  it('DBエラーは例外を投げる', async () => {
    fromResponses['channel_accounts'] = { data: null, error: { message: 'boom' } }
    await expect(store.findFirstPlatformAccountId()).rejects.toThrow('boom')
  })
})

describe('createSharedGroupClaimCode', () => {
  const INPUT = {
    orgId: 'org-1',
    spaceId: 'space-1',
    targetAccountId: 'acc-platform-1',
    codeHash: 'hash-abc',
    createdBy: 'user-1',
    expiresAt: '2026-07-15T00:30:00.000Z',
  }

  it('purpose/binding_mode/target_account_id/code_hash/code=nullで発行する', async () => {
    fromResponses['channel_link_codes'] = {
      data: { id: 'code-1', expires_at: INPUT.expiresAt },
      error: null,
    }

    const result = await store.createSharedGroupClaimCode(INPUT)

    expect(result).toEqual({ id: 'code-1', expiresAt: INPUT.expiresAt })
    const builder = fromMock.mock.results[0].value
    expect(fromMock).toHaveBeenCalledWith('channel_link_codes')
    expect(builder.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        org_id: 'org-1',
        space_id: 'space-1',
        channel: 'line',
        purpose: 'shared_group_claim',
        binding_mode: 'web_approval',
        target_account_id: 'acc-platform-1',
        code_hash: 'hash-abc',
        code: null,
        expires_at: INPUT.expiresAt,
        created_by: 'user-1',
      }),
    )
  })

  it('code_hashの衝突(23505)は DuplicateSharedGroupClaimCodeError を投げる', async () => {
    fromResponses['channel_link_codes'] = { data: null, error: { code: '23505', message: 'duplicate' } }
    await expect(store.createSharedGroupClaimCode(INPUT)).rejects.toThrow(
      store.DuplicateSharedGroupClaimCodeError,
    )
  })

  it('23505以外のDBエラーは通常の例外', async () => {
    fromResponses['channel_link_codes'] = { data: null, error: { code: '99999', message: 'boom' } }
    await expect(store.createSharedGroupClaimCode(INPUT)).rejects.toThrow('boom')
  })
})
