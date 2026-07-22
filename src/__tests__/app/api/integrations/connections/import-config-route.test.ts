import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * PATCH /api/integrations/connections/[id]/import-config
 *
 * - owner/adminのみ(接続のorg_idから解決)
 * - import_config( { target_space_id, read_list_ids?, default_assignee_id? } )を**部分更新**する
 * - 更新は RPC(rpc_import_config_merge)で原子的に行う。ルートは import_config 全体を組み立てない
 *   (read-modify-write だと、読みと書きの間にマッピング保存RPCが走ったとき古い mappings を
 *    書き戻して確定済みマッピングを消す＝lost update)
 * - org境界検証はDBトリガー(integration_connections_validate_import_config)が担う。
 *   トリガー例外(P0001)は422+ユーザー向けメッセージに変換する。
 */

const getUserMock = vi.fn()
const membershipSingleMock = vi.fn()
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: getUserMock },
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          eq: vi.fn(() => ({ single: membershipSingleMock })),
        })),
      })),
    })),
  })),
}))

const findResultMock = vi.fn()
const rpcResultMock = vi.fn()
let rpcName: string | null = null
let rpcArgs: Record<string, unknown> | null = null

function makeSelectChain() {
  const chain: Record<string, unknown> = {}
  Object.assign(chain, {
    eq: vi.fn(() => chain),
    maybeSingle: vi.fn(() => Promise.resolve(findResultMock())),
  })
  return chain
}

const createAdminClientMock = vi.fn(() => ({
  from: vi.fn(() => ({
    select: vi.fn(() => makeSelectChain()),
    // update は使わない（使ったら即座に失敗させ、read-modify-write への逆戻りを検出する）。
    update: vi.fn(() => {
      throw new Error('import_config must be updated through rpc_import_config_merge, not a table update')
    }),
  })),
  rpc: vi.fn((name: string, args: Record<string, unknown>) => {
    rpcName = name
    rpcArgs = args
    return Promise.resolve(rpcResultMock())
  }),
}))
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => createAdminClientMock(),
}))

const { PATCH } = await import('@/app/api/integrations/connections/[id]/import-config/route')

const ORG_ID = '11111111-1111-4111-8111-111111111111'
const CONNECTION_ID = '22222222-2222-4222-8222-222222222222'
const SPACE_ID = '33333333-3333-4333-8333-333333333333'
const NEW_SPACE_ID = '55555555-5555-4555-8555-555555555555'
const NOTION_DATABASE_ID = '44444444-4444-4444-8444-444444444444'

function callPatch(id: string, body: Record<string, unknown>) {
  const request = new NextRequest(`http://localhost:3000/api/integrations/connections/${id}/import-config`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return PATCH(request, { params: Promise.resolve({ id }) })
}

const validBody = { import_config: { target_space_id: SPACE_ID } }

beforeEach(() => {
  vi.clearAllMocks()
  rpcName = null
  rpcArgs = null
  getUserMock.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
  membershipSingleMock.mockResolvedValue({ data: { role: 'owner' }, error: null })
  findResultMock.mockReturnValue({ data: { org_id: ORG_ID }, error: null })
  rpcResultMock.mockReturnValue({
    data: { id: CONNECTION_ID, import_config: validBody.import_config, import_enabled: false },
    error: null,
  })
})

describe('PATCH /api/integrations/connections/[id]/import-config', () => {
  it('400 for an invalid connection id', async () => {
    const response = await callPatch('not-a-uuid', validBody)
    expect(response.status).toBe(400)
  })

  it('404 when the connection does not belong to any org', async () => {
    findResultMock.mockReturnValue({ data: null, error: null })
    const response = await callPatch(CONNECTION_ID, validBody)
    expect(response.status).toBe(404)
  })

  it('403 for members (owner/admin only)', async () => {
    membershipSingleMock.mockResolvedValue({ data: { role: 'member' }, error: null })
    const response = await callPatch(CONNECTION_ID, validBody)
    expect(response.status).toBe(403)
  })

  it('400 when import_config is missing or not an object', async () => {
    const response = await callPatch(CONNECTION_ID, { import_config: 'nope' })
    expect(response.status).toBe(400)
  })

  it('200 updates import_config via rpc_import_config_merge', async () => {
    const response = await callPatch(CONNECTION_ID, validBody)
    const data = await response.json()
    expect(response.status).toBe(200)
    expect(data.import_config).toEqual(validBody.import_config)
    expect(rpcName).toBe('rpc_import_config_merge')
    expect(rpcArgs).toEqual({
      p_connection_id: CONNECTION_ID,
      p_patch: validBody.import_config,
      p_import_enabled: null,
    })
  })

  /**
   * import_enabled を同じ PATCH で受ける理由: 2回に分けると片方だけ成功して状態が中途半端に残る
   * （取り込み先は設定されたのに無効のまま＝永久に同期されない／取り込み先が消えたのに有効のまま）。
   */
  it('import_enabled を同じ更新で変更できる', async () => {
    const response = await callPatch(CONNECTION_ID, { ...validBody, import_enabled: true })
    expect(response.status).toBe(200)
    expect(rpcArgs!.p_import_enabled).toBe(true)
  })

  it('import_enabled を省略したときは触らない（RPCへ null＝据え置きを渡す・後方互換）', async () => {
    await callPatch(CONNECTION_ID, validBody)
    expect(rpcArgs!.p_import_enabled).toBeNull()
  })

  it('import_enabled が boolean でなければ 400（曖昧な値で同期の有無を決めない）', async () => {
    const response = await callPatch(CONNECTION_ID, { ...validBody, import_enabled: 'yes' })
    expect(response.status).toBe(400)
  })

  it('422 when the DB trigger (P0001) rejects an out-of-org target_space_id (user-facing message)', async () => {
    rpcResultMock.mockReturnValue({
      data: null,
      error: {
        code: 'P0001',
        message: 'import_config.target_space_id must reference a space in the connection\'s org',
      },
    })
    const response = await callPatch(CONNECTION_ID, validBody)
    const data = await response.json()
    expect(response.status).toBe(422)
    expect(typeof data.error).toBe('string')
    expect(data.error.length).toBeGreaterThan(0)
  })

  it('404 when the RPC reports the connection vanished (P0002 no_data_found)', async () => {
    rpcResultMock.mockReturnValue({
      data: null,
      error: { code: 'P0002', message: 'connection not found' },
    })
    const response = await callPatch(CONNECTION_ID, validBody)
    expect(response.status).toBe(404)
  })

  it('422 when the stored import_config is structurally broken (22023) — retrying will not fix it', async () => {
    rpcResultMock.mockReturnValue({
      data: null,
      error: { code: '22023', message: 'import_config is not a JSON object (found array)' },
    })
    const response = await callPatch(CONNECTION_ID, validBody)
    const data = await response.json()
    expect(response.status).toBe(422)
    expect(data.error).not.toContain('JSON object')
  })

  it('400 when a UUID cast fails (22P02) for target_space_id/default_assignee_id', async () => {
    rpcResultMock.mockReturnValue({
      data: null,
      error: { code: '22P02', message: 'invalid input syntax for type uuid: "not-a-uuid"' },
    })
    const response = await callPatch(CONNECTION_ID, validBody)
    expect(response.status).toBe(400)
  })

  it('500 (not 422) for a transient/unknown DB error — never mislabeled as a permanent input error', async () => {
    rpcResultMock.mockReturnValue({
      data: null,
      error: { code: '08006', message: 'connection failure' },
    })
    const response = await callPatch(CONNECTION_ID, validBody)
    const data = await response.json()
    expect(response.status).toBe(500)
    // 内部エラー文言は返さない
    expect(data.error).not.toContain('connection failure')
  })

  it('400 when the JSON body itself is a valid `null` literal (no 500 from body.import_config on null)', async () => {
    const request = new NextRequest(`http://localhost:3000/api/integrations/connections/${CONNECTION_ID}/import-config`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: 'null',
    })
    const response = await PATCH(request, { params: Promise.resolve({ id: CONNECTION_ID }) })
    expect(response.status).toBe(400)
  })

  /**
   * ⚠ 最重要の回帰テスト(lost update の防止): ルートは import_config 全体を組み立てて置換しない。
   * 現在値を読んで組み立てると、読みと書きの間にマッピング保存RPCが走ったときに古い mappings を
   * 書き戻して確定済みマッピングを消す。クライアントが指定したキーだけを p_patch として渡す。
   */
  it('import_config 全体を組み立てず、クライアント指定キーだけを p_patch として渡す', async () => {
    const response = await callPatch(CONNECTION_ID, { import_config: { target_space_id: NEW_SPACE_ID } })
    expect(response.status).toBe(200)
    expect(rpcArgs!.p_patch).toEqual({ target_space_id: NEW_SPACE_ID })
    // テーブル直 update(read-modify-write)へ戻ると createAdminClient の update が throw する。
    expect(rpcName).toBe('rpc_import_config_merge')
  })

  /**
   * PATCHが指定していないキーは保持される（部分更新セマンティクス）。ルート側は「送らない」ことで
   * それを表現する＝p_patch に現れないキーは RPC 側で現在値のまま残る。
   */
  it('PATCHが指定していないキーは p_patch に現れない（＝現在値が保持される）', async () => {
    await callPatch(CONNECTION_ID, { import_config: { read_container_ids: [NOTION_DATABASE_ID] } })
    const patch = rpcArgs!.p_patch as Record<string, unknown>
    expect(patch).toEqual({ read_container_ids: [NOTION_DATABASE_ID] })
    expect(patch).not.toHaveProperty('target_space_id')
    expect(patch).not.toHaveProperty('default_assignee_id')
  })

  /**
   * ⚠ 最重要の回帰テスト(迂回の防止): notion_mappings はサーバ管理フィールド。汎用PATCHが
   * クライアントの送信値をそのまま採用すると、保存API(mapping/route.ts)のライブスキーマ検証を
   * 迂回して実在しないprop_idを永続化できてしまう。DBへ一切送らないことを確認する。
   */
  it('汎用PATCHで実在しないprop_idを含むnotion_mappingsを送ってもDBへ送られない', async () => {
    const maliciousMappings = {
      [NOTION_DATABASE_ID]: {
        due_prop_id: 'ghost-prop-that-does-not-exist',
        status: null,
        confirmed_at: '2026-07-01T00:00:00.000Z',
      },
    }
    const response = await callPatch(CONNECTION_ID, {
      import_config: { target_space_id: SPACE_ID, notion_mappings: maliciousMappings },
    })

    expect(response.status).toBe(200)
    const patch = rpcArgs!.p_patch as Record<string, unknown>
    expect(patch).not.toHaveProperty('notion_mappings')
    expect(patch).toEqual({ target_space_id: SPACE_ID })
  })

  /**
   * ⚠ 最重要の回帰テスト(迂回の防止・kintone版): kintone_mappings/kintone_app_ids も
   * notion_mappings と同じサーバ管理フィールド。実在しないフィールドコード・アプリIDを
   * この経路から永続化できてはならない。
   */
  it('汎用PATCHで実在しないフィールドコード/アプリIDを含むkintone設定を送ってもDBへ送られない', async () => {
    const maliciousMappings = {
      '5': {
        title_field_code: 'ghost-field-that-does-not-exist',
        due_field_code: null,
        status: null,
        confirmed_at: '2026-07-01T00:00:00.000Z',
      },
    }
    const response = await callPatch(CONNECTION_ID, {
      import_config: {
        target_space_id: SPACE_ID,
        kintone_mappings: maliciousMappings,
        kintone_app_ids: ['999'],
      },
    })

    expect(response.status).toBe(200)
    const patch = rpcArgs!.p_patch as Record<string, unknown>
    expect(patch).not.toHaveProperty('kintone_mappings')
    expect(patch).not.toHaveProperty('kintone_app_ids')
    expect(patch).toEqual({ target_space_id: SPACE_ID })
  })

  it('read_container_idsを明示的に送った場合はその値でDBを上書きする(意図的なクリアも許す)', async () => {
    rpcResultMock.mockReturnValue({
      data: {
        id: CONNECTION_ID,
        import_config: { target_space_id: SPACE_ID, read_container_ids: [] },
        import_enabled: false,
      },
      error: null,
    })

    const response = await callPatch(CONNECTION_ID, {
      import_config: { target_space_id: SPACE_ID, read_container_ids: [] },
    })

    expect(response.status).toBe(200)
    expect((rpcArgs!.p_patch as Record<string, unknown>).read_container_ids).toEqual([])
    const data = await response.json()
    expect(data.import_config.read_container_ids).toEqual([])
  })

  it('null を送ったキーはそのまま RPC へ渡る（未設定に戻す＝キー削除の意図を落とさない）', async () => {
    await callPatch(CONNECTION_ID, { import_config: { target_space_id: null } })
    expect(rpcArgs!.p_patch).toEqual({ target_space_id: null })
  })
})
