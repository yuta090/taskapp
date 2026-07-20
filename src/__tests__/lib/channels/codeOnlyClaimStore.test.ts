import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * 共有bot（platform account）code_only 紐付けの app 層（Stage 4 §3/§4/§7-5,7-8・PR3b）。
 *
 * - redeemCodeOnlyClaim: rpc_redeem_code_only_claim の薄いラッパ。GC404(not-found)は
 *   'rejected' に畳む（webhookはマッチ無効/コード不一致を同一の固定文言に畳むため）。
 * - isCodeOnlyEntitled: org_channel_policy.allow_code_only の読み取り（未設定行は既定false）。
 * - countOutstandingCodeOnlyCodes / createCodeOnlyClaimCodesBatch: 発行レート上限・バッチ発行。
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function chain(response: any) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const builder: any = {}
  for (const m of ['select', 'eq', 'insert', 'is', 'gt', 'order', 'limit', 'in']) {
    builder[m] = vi.fn(() => builder)
  }
  builder.single = vi.fn(() => Promise.resolve(response))
  builder.maybeSingle = vi.fn(() => Promise.resolve(response))
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
  process.env.SHARED_GROUP_CLAIM_PEPPER = 'test-pepper'
  fromResponses = {}
  fromCallCount = 0
  fromMock.mockImplementation((table: string) => {
    fromCallCount += 1
    const key = `${table}#${fromCallCount}`
    const response = fromResponses[key] ?? fromResponses[table] ?? { data: null, error: null }
    return chain(response)
  })
})

describe('redeemCodeOnlyClaim', () => {
  it('rpc_redeem_code_only_claimにcode_hash/account/group/表示名/上限を渡し、linkedをそのまま返す', async () => {
    rpcMock.mockResolvedValue({ data: 'linked', error: null })
    const result = await store.redeemCodeOnlyClaim('hash-1', 'acc-platform-1', 'G-1', 'ある会社', 50)
    expect(result).toBe('linked')
    expect(rpcMock).toHaveBeenCalledWith('rpc_redeem_code_only_claim', {
      p_code_hash: 'hash-1',
      p_account_id: 'acc-platform-1',
      p_external_group_id: 'G-1',
      p_group_display_name: 'ある会社',
      p_max_active_groups: 50,
    })
  })

  it('上限省略時は null（無制限＝現行挙動）を渡す', async () => {
    rpcMock.mockResolvedValue({ data: 'linked', error: null })
    await store.redeemCodeOnlyClaim('hash-1', 'acc-1', 'G-1', null)
    expect(rpcMock).toHaveBeenCalledWith(
      'rpc_redeem_code_only_claim',
      expect.objectContaining({ p_max_active_groups: null }),
    )
  })

  it('容量上限(GC402)のレースは rejected に畳む（今は確立させない＝無効文言）', async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { code: 'GC402', message: 'active group capacity reached (max 50)' },
    })
    expect(await store.redeemCodeOnlyClaim('hash-1', 'acc-1', 'G-1', null, 50)).toBe('rejected')
  })

  it('already_linkedをそのまま返す（別コード×同一グループの23505 graceful）', async () => {
    rpcMock.mockResolvedValue({ data: 'already_linked', error: null })
    expect(await store.redeemCodeOnlyClaim('hash-1', 'acc-1', 'G-1', null)).toBe('already_linked')
  })

  it('rejectedをそのまま返す（マッチした無効コード。content-free rejected claim記録済み）', async () => {
    rpcMock.mockResolvedValue({ data: 'rejected', error: null })
    expect(await store.redeemCodeOnlyClaim('hash-1', 'acc-1', 'G-1', null)).toBe('rejected')
  })

  it('GC404(code_hash不一致・記録対象なし)は rejected に畳む', async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { code: 'GC404', message: 'no matching link code for supplied hash' },
    })
    expect(await store.redeemCodeOnlyClaim('hash-unknown', 'acc-1', 'G-1', null)).toBe('rejected')
  })

  it('GC404以外のDBエラーは通常の例外として再送出する（握り潰さない）', async () => {
    rpcMock.mockResolvedValue({ data: null, error: { code: '55000', message: 'boom' } })
    await expect(store.redeemCodeOnlyClaim('hash-1', 'acc-1', 'G-1', null)).rejects.toThrow('boom')
  })

  it('想定外の戻り値文字列は例外を投げる（サイレントに握り潰さない）', async () => {
    rpcMock.mockResolvedValue({ data: 'unexpected', error: null })
    await expect(store.redeemCodeOnlyClaim('hash-1', 'acc-1', 'G-1', null)).rejects.toThrow()
  })
})

describe('isCodeOnlyEntitled', () => {
  it('allow_code_only=trueの行があればtrue', async () => {
    fromResponses['org_channel_policy'] = { data: { allow_code_only: true }, error: null }
    expect(await store.isCodeOnlyEntitled('org-1')).toBe(true)
  })

  it('allow_code_only=falseの行があればfalse', async () => {
    fromResponses['org_channel_policy'] = { data: { allow_code_only: false }, error: null }
    expect(await store.isCodeOnlyEntitled('org-1')).toBe(false)
  })

  it('行が無いorgは既定false（明示行の無いorgは暗黙false）', async () => {
    fromResponses['org_channel_policy'] = { data: null, error: null }
    expect(await store.isCodeOnlyEntitled('org-1')).toBe(false)
  })

  it('DBエラーは例外を投げる（false成功と区別する）', async () => {
    fromResponses['org_channel_policy'] = { data: null, error: { message: 'boom' } }
    await expect(store.isCodeOnlyEntitled('org-1')).rejects.toThrow('boom')
  })
})

describe('countOutstandingCodeOnlyCodes', () => {
  it('org単位の未消費/未失効/未revokeなcode_onlyコード数を返す', async () => {
    fromResponses['channel_link_codes'] = { count: 3, data: null, error: null }
    const result = await store.countOutstandingCodeOnlyCodes('org-1')
    expect(result).toBe(3)

    const builder = fromMock.mock.results[0].value
    expect(fromMock).toHaveBeenCalledWith('channel_link_codes')
    expect(builder.eq).toHaveBeenCalledWith('org_id', 'org-1')
    expect(builder.eq).toHaveBeenCalledWith('purpose', 'shared_group_claim')
    expect(builder.eq).toHaveBeenCalledWith('binding_mode', 'code_only')
    expect(builder.is).toHaveBeenCalledWith('consumed_at', null)
    expect(builder.is).toHaveBeenCalledWith('revoked_at', null)
  })

  it('countがnullなら0', async () => {
    fromResponses['channel_link_codes'] = { count: null, data: null, error: null }
    expect(await store.countOutstandingCodeOnlyCodes('org-1')).toBe(0)
  })

  it('DBエラーは例外を投げる', async () => {
    fromResponses['channel_link_codes'] = { count: null, data: null, error: { message: 'boom' } }
    await expect(store.countOutstandingCodeOnlyCodes('org-1')).rejects.toThrow('boom')
  })
})

describe('verifySpacesInOrg（バッチ発行の越境防止）', () => {
  it('全spaceIdが自org内ならtrue', async () => {
    fromResponses['spaces'] = {
      data: [{ id: 'space-1' }, { id: 'space-2' }],
      error: null,
    }
    expect(await store.verifySpacesInOrg('org-1', ['space-1', 'space-2'])).toBe(true)

    const builder = fromMock.mock.results[0].value
    expect(fromMock).toHaveBeenCalledWith('spaces')
    expect(builder.eq).toHaveBeenCalledWith('org_id', 'org-1')
    expect(builder.in).toHaveBeenCalledWith('id', ['space-1', 'space-2'])
  })

  it('1件でも他orgのspaceが混じっていればfalse（返ってくる行数が足りない）', async () => {
    fromResponses['spaces'] = { data: [{ id: 'space-1' }], error: null }
    expect(await store.verifySpacesInOrg('org-1', ['space-1', 'space-2'])).toBe(false)
  })

  it('重複spaceIdは重複排除して判定する', async () => {
    fromResponses['spaces'] = { data: [{ id: 'space-1' }], error: null }
    expect(await store.verifySpacesInOrg('org-1', ['space-1', 'space-1'])).toBe(true)
  })

  it('空配列はtrue（何も検証すべきものが無い）', async () => {
    expect(await store.verifySpacesInOrg('org-1', [])).toBe(true)
    expect(fromMock).not.toHaveBeenCalled()
  })

  it('DBエラーは例外を投げる', async () => {
    fromResponses['spaces'] = { data: null, error: { message: 'boom' } }
    await expect(store.verifySpacesInOrg('org-1', ['space-1'])).rejects.toThrow('boom')
  })
})

describe('createCodeOnlyClaimCodesBatch（all-or-nothing: 単一INSERT文でN行を一括投入）', () => {
  const INPUT = {
    orgId: 'org-1',
    spaceIds: ['space-1', 'space-2'],
    targetAccountId: 'acc-platform-1',
    createdBy: 'user-1',
  }

  it('全spaceの行を単一INSERT呼び出し(配列)でまとめて渡し、成功したら表示コードを1回だけ返す', async () => {
    fromResponses['channel_link_codes'] = { data: [{ id: 'code-x1' }, { id: 'code-x2' }], error: null }

    const result = await store.createCodeOnlyClaimCodesBatch(INPUT)

    expect(result).toHaveLength(2)
    expect(result[0].spaceId).toBe('space-1')
    expect(result[1].spaceId).toBe('space-2')
    // 表示コードはGC-プレフィクス形式で、往復で正準形に戻せる
    expect(result[0].displayCode).toMatch(/^GC-/)
    expect(result[0].displayCode).not.toBe(result[1].displayCode)

    // ★アトミック性: channel_link_codesへは1回しか触れない（=1つのINSERT文。part途中コミットが起きない）
    expect(fromMock).toHaveBeenCalledTimes(1)
    expect(fromMock).toHaveBeenCalledWith('channel_link_codes')
    const builder = fromMock.mock.results[0].value
    expect(builder.insert).toHaveBeenCalledTimes(1)
    const rows = builder.insert.mock.calls[0][0] as Array<Record<string, unknown>>
    expect(Array.isArray(rows)).toBe(true)
    expect(rows).toHaveLength(2)
    expect(rows.map((r) => r.space_id)).toEqual(['space-1', 'space-2'])
    for (const payload of rows) {
      expect(payload).toMatchObject({
        org_id: 'org-1',
        channel: 'line',
        purpose: 'shared_group_claim',
        binding_mode: 'code_only',
        target_account_id: 'acc-platform-1',
        code: null,
        created_by: 'user-1',
      })
      expect(typeof payload.code_hash).toBe('string')
      expect((payload.code_hash as string).length).toBeGreaterThan(0)
      expect(typeof payload.batch_id).toBe('string')
      expect(typeof payload.expires_at).toBe('string')
    }
    // 同一バッチ内は共通のbatch_idでグルーピングされる
    expect(rows[0].batch_id).toBe(rows[1].batch_id)
    // TTLは既定7日（web_approvalの30分より大幅に長い）
    const ttlMs = new Date(rows[0].expires_at as string).getTime() - Date.now()
    expect(ttlMs).toBeGreaterThan(6 * 24 * 60 * 60 * 1000)
    expect(ttlMs).toBeLessThanOrEqual(7 * 24 * 60 * 60 * 1000 + 5000)
  })

  it('code_hash衝突(23505)はバッチ全体を再生成して単一INSERTでリトライする（orphanを作らない）', async () => {
    let call = 0
    fromMock.mockImplementation(() => {
      call += 1
      // 1回目のバッチ全体だけ衝突させ、2回目(再生成後)は成功させる
      const response =
        call === 1 ? { data: null, error: { code: '23505' } } : { data: [{ id: 'code-1' }, { id: 'code-2' }], error: null }
      return chain(response)
    })

    const result = await store.createCodeOnlyClaimCodesBatch(INPUT)
    expect(result).toHaveLength(2)
    // channel_link_codesへは2回（1回目失敗+2回目成功）。各回とも単一INSERT呼び出し
    expect(fromMock).toHaveBeenCalledTimes(2)
    for (const r of fromMock.mock.results) {
      expect(r.value.insert).toHaveBeenCalledTimes(1)
      expect(Array.isArray(r.value.insert.mock.calls[0][0])).toBe(true)
    }
  })

  it('23505以外のDBエラーはリトライせず例外を投げ、部分コミットが無い（単一INSERT呼び出しで完結・以後touchしない）', async () => {
    fromResponses['channel_link_codes'] = { data: null, error: { code: '99999', message: 'boom' } }
    await expect(store.createCodeOnlyClaimCodesBatch(INPUT)).rejects.toThrow('boom')

    // ★アトミック性: 1回の単一INSERT呼び出しだけで完結する。部分的な行単位のinsertは一切発生しない
    // （このtry自体が失敗しているため、DB上にbatch_idの行は0行のまま=orphanなし）
    expect(fromMock).toHaveBeenCalledTimes(1)
    const builder = fromMock.mock.results[0].value
    expect(builder.insert).toHaveBeenCalledTimes(1)
    expect(Array.isArray(builder.insert.mock.calls[0][0])).toBe(true)
    expect((builder.insert.mock.calls[0][0] as unknown[]).length).toBe(2)
  })

  it('3回連続で23505が続く場合はリトライ上限で例外を投げる（無限リトライしない）', async () => {
    fromResponses['channel_link_codes'] = { data: null, error: { code: '23505' } }
    await expect(store.createCodeOnlyClaimCodesBatch(INPUT)).rejects.toThrow()
    expect(fromMock).toHaveBeenCalledTimes(3)
  })

  it('空配列なら空配列を返す(insertを呼ばない)', async () => {
    const result = await store.createCodeOnlyClaimCodesBatch({ ...INPUT, spaceIds: [] })
    expect(result).toEqual([])
    expect(fromMock).not.toHaveBeenCalled()
  })
})
