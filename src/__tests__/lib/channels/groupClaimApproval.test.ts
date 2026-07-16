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

describe('findGroupClaimOrgId', () => {
  it('claimのorg_idを返す', async () => {
    fromResponses['channel_group_claims'] = { data: { org_id: 'org-1' }, error: null }
    expect(await store.findGroupClaimOrgId('claim-1')).toBe('org-1')
  })

  it('該当なしはnull', async () => {
    fromResponses['channel_group_claims'] = { data: null, error: null }
    expect(await store.findGroupClaimOrgId('claim-1')).toBeNull()
  })

  it('DBエラーもnull（他org 404 に丸めるための呼び出し側規約）', async () => {
    fromResponses['channel_group_claims'] = { data: null, error: { message: 'boom' } }
    expect(await store.findGroupClaimOrgId('claim-1')).toBeNull()
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

  it('unknown claim_id は GroupClaimActionError(not_found) を投げる', async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { message: 'rpc_approve_group_claim: unknown claim_id claim-1' },
    })
    await expect(store.approveGroupClaim('claim-1', 'user-1')).rejects.toMatchObject({
      name: 'GroupClaimActionError',
      reason: 'not_found',
    })
  })

  it('membership不足は GroupClaimActionError(forbidden) を投げる', async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { message: 'rpc_approve_group_claim: approver user-1 is not an internal member of org org-1' },
    })
    await expect(store.approveGroupClaim('claim-1', 'user-1')).rejects.toMatchObject({
      reason: 'forbidden',
    })
  })

  it.each([
    'rpc_approve_group_claim: claim claim-1 is not pending (status=approved)',
    'rpc_approve_group_claim: link_code already consumed',
    'rpc_approve_group_claim: link_code has been revoked',
    'rpc_approve_group_claim: link_code expired',
  ])('%s は GroupClaimActionError(conflict) を投げる', async (message) => {
    rpcMock.mockResolvedValue({ data: null, error: { message } })
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

  it('unknown claim_id は GroupClaimActionError(not_found)', async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { message: 'rpc_reject_group_claim: unknown claim_id claim-1' },
    })
    await expect(store.rejectGroupClaim('claim-1', 'user-1')).rejects.toMatchObject({
      reason: 'not_found',
    })
  })

  it('membership不足は GroupClaimActionError(forbidden)', async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { message: 'rpc_reject_group_claim: approver user-1 is not an internal member of org org-1' },
    })
    await expect(store.rejectGroupClaim('claim-1', 'user-1')).rejects.toMatchObject({
      reason: 'forbidden',
    })
  })
})

describe('findFirstPlatformAccountId', () => {
  it('owner_type=platform のaccountを1件返す', async () => {
    fromResponses['channel_accounts'] = { data: { id: 'acc-platform-1' }, error: null }
    const result = await store.findFirstPlatformAccountId()
    expect(result).toBe('acc-platform-1')

    const builder = fromMock.mock.results[0].value
    expect(fromMock).toHaveBeenCalledWith('channel_accounts')
    expect(builder.eq).toHaveBeenCalledWith('owner_type', 'platform')
    expect(builder.order).toHaveBeenCalledWith('created_at', { ascending: true })
    expect(builder.limit).toHaveBeenCalledWith(1)
  })

  it('platform accountが無ければnull（共有bot未設定）', async () => {
    fromResponses['channel_accounts'] = { data: null, error: null }
    expect(await store.findFirstPlatformAccountId()).toBeNull()
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
