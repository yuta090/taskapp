import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * 共有bot（platform account）グループ紐付けコードの償還・claim登録（Stage 4 §1/§2/§3・PR2）。
 *
 * - findValidSharedGroupClaimCode: purpose=shared_group_claim・対象account一致・
 *   未消費/未失効/未revokeのみ有効として返す。理由の別は返さない。
 * - findOrCreatePendingGroupClaim: webhook再送では新規INSERTせず既存pendingを返す
 *   （findOrCreateActiveGroupと同型のレース処理）。
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function chain(response: any) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const builder: any = {}
  for (const m of ['select', 'eq', 'insert']) {
    builder[m] = vi.fn(() => builder)
  }
  builder.single = vi.fn(() => Promise.resolve(response))
  builder.maybeSingle = vi.fn(() => Promise.resolve(response))
  return builder
}

let fromResponses: Record<string, unknown>
let fromCallCount: number
const fromMock = vi.fn()

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => ({ from: fromMock })),
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

const NOW = Date.now()
const FUTURE_ISO = new Date(NOW + 60 * 60 * 1000).toISOString()
const PAST_ISO = new Date(NOW - 60 * 60 * 1000).toISOString()

describe('findValidSharedGroupClaimCode', () => {
  const VALID_ROW = {
    id: 'code-1',
    org_id: 'org-1',
    space_id: 'space-1',
    binding_mode: 'web_approval',
    target_account_id: 'acc-platform-1',
    consumed_at: null,
    revoked_at: null,
    expires_at: FUTURE_ISO,
  }

  it('有効なコードはorg/space/bindingModeを返す', async () => {
    fromResponses['channel_link_codes'] = { data: VALID_ROW, error: null }
    const result = await store.findValidSharedGroupClaimCode('hash-1', 'acc-platform-1')
    expect(result).toEqual({ id: 'code-1', orgId: 'org-1', spaceId: 'space-1', bindingMode: 'web_approval' })
  })

  it('purpose=shared_group_claimでフィルタする', async () => {
    fromResponses['channel_link_codes'] = { data: VALID_ROW, error: null }
    await store.findValidSharedGroupClaimCode('hash-1', 'acc-platform-1')
    const call = fromMock.mock.results[0].value
    expect(call.eq).toHaveBeenCalledWith('code_hash', 'hash-1')
    expect(call.eq).toHaveBeenCalledWith('purpose', 'shared_group_claim')
  })

  it('対象accountが異なればnull（他accountのコードを流用できない）', async () => {
    fromResponses['channel_link_codes'] = { data: { ...VALID_ROW, target_account_id: 'acc-OTHER' }, error: null }
    const result = await store.findValidSharedGroupClaimCode('hash-1', 'acc-platform-1')
    expect(result).toBeNull()
  })

  it('消費済み(consumed_at非null)はnull', async () => {
    fromResponses['channel_link_codes'] = { data: { ...VALID_ROW, consumed_at: PAST_ISO }, error: null }
    const result = await store.findValidSharedGroupClaimCode('hash-1', 'acc-platform-1')
    expect(result).toBeNull()
  })

  it('失効(revoked_at非null)はnull', async () => {
    fromResponses['channel_link_codes'] = { data: { ...VALID_ROW, revoked_at: PAST_ISO }, error: null }
    const result = await store.findValidSharedGroupClaimCode('hash-1', 'acc-platform-1')
    expect(result).toBeNull()
  })

  it('期限切れ(expires_at過去)はnull', async () => {
    fromResponses['channel_link_codes'] = { data: { ...VALID_ROW, expires_at: PAST_ISO }, error: null }
    const result = await store.findValidSharedGroupClaimCode('hash-1', 'acc-platform-1')
    expect(result).toBeNull()
  })

  it('該当行が無ければnull', async () => {
    fromResponses['channel_link_codes'] = { data: null, error: null }
    const result = await store.findValidSharedGroupClaimCode('hash-1', 'acc-platform-1')
    expect(result).toBeNull()
  })

  it('binding_mode=code_onlyも形状としては返す（呼び出し側がPR2では未対応として扱う）', async () => {
    fromResponses['channel_link_codes'] = { data: { ...VALID_ROW, binding_mode: 'code_only' }, error: null }
    const result = await store.findValidSharedGroupClaimCode('hash-1', 'acc-platform-1')
    expect(result?.bindingMode).toBe('code_only')
  })
})

describe('findOrCreatePendingGroupClaim', () => {
  const INPUT = {
    linkCodeId: 'code-1',
    accountId: 'acc-platform-1',
    externalGroupId: 'G-1',
    orgId: 'org-1',
    spaceId: 'space-1',
    challengeLabel: 'AB12',
    groupDisplayNameSnapshot: 'ある会社の相談グループ',
  }

  it('既存pendingが無ければINSERTする', async () => {
    fromResponses['channel_group_claims#1'] = { data: null, error: null } // 既存チェック(select)
    fromResponses['channel_group_claims#2'] = {
      data: { id: 'claim-1', org_id: 'org-1', space_id: 'space-1', challenge_label: 'AB12', status: 'pending' },
      error: null,
    } // insert

    const result = await store.findOrCreatePendingGroupClaim(INPUT)

    expect(result).toEqual({
      id: 'claim-1',
      orgId: 'org-1',
      spaceId: 'space-1',
      challengeLabel: 'AB12',
      status: 'pending',
    })
    const insertCall = fromMock.mock.results[1].value
    expect(insertCall.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        link_code_id: 'code-1',
        account_id: 'acc-platform-1',
        external_group_id: 'G-1',
        org_id: 'org-1',
        space_id: 'space-1',
        challenge_label: 'AB12',
        group_display_name_snapshot: 'ある会社の相談グループ',
      }),
    )
  })

  it('既存pendingがあればINSERTせずそれを返す（webhook再送の冪等化）', async () => {
    fromResponses['channel_group_claims#1'] = {
      data: { id: 'claim-existing', org_id: 'org-1', space_id: 'space-1', challenge_label: 'ZZ99', status: 'pending' },
      error: null,
    }

    const result = await store.findOrCreatePendingGroupClaim(INPUT)

    expect(result.id).toBe('claim-existing')
    expect(fromMock).toHaveBeenCalledTimes(1) // insertは呼ばれない
  })

  it('INSERTが23505（レース: 同時に他方が先にpending作成）なら既存を再取得して返す', async () => {
    fromResponses['channel_group_claims#1'] = { data: null, error: null } // 初回チェック: まだ無い
    fromResponses['channel_group_claims#2'] = { data: null, error: { code: '23505', message: 'duplicate' } } // insert衝突
    fromResponses['channel_group_claims#3'] = {
      data: { id: 'claim-raced', org_id: 'org-1', space_id: 'space-1', challenge_label: 'QQ11', status: 'pending' },
      error: null,
    } // 再取得

    const result = await store.findOrCreatePendingGroupClaim(INPUT)
    expect(result.id).toBe('claim-raced')
  })

  it('23505以外のDBエラーは例外を投げる', async () => {
    fromResponses['channel_group_claims#1'] = { data: null, error: null }
    fromResponses['channel_group_claims#2'] = { data: null, error: { code: '99999', message: 'boom' } }

    await expect(store.findOrCreatePendingGroupClaim(INPUT)).rejects.toThrow('boom')
  })
})
