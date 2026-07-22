import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * PATCH /api/integrations/connections/[id]/import-config
 *
 * - owner/adminのみ(接続のorg_idから解決)
 * - import_config( { target_space_id, read_list_ids?, default_assignee_id? } )を更新
 * - org境界検証はDBトリガー(integration_connections_validate_import_config)が担う。
 *   トリガー例外(admin clientのupdateがerrorを返すケース)は422+ユーザー向けメッセージに変換する。
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
const updateResultMock = vi.fn()
let updatePayload: Record<string, unknown> | null = null

function makeSelectChain() {
  const chain: Record<string, unknown> = {}
  Object.assign(chain, {
    eq: vi.fn(() => chain),
    maybeSingle: vi.fn(() => Promise.resolve(findResultMock())),
  })
  return chain
}

function makeUpdateChain() {
  const chain: Record<string, unknown> = {}
  Object.assign(chain, {
    eq: vi.fn(() => chain),
    select: vi.fn(() => ({
      maybeSingle: vi.fn(() => Promise.resolve(updateResultMock())),
    })),
  })
  return chain
}

const createAdminClientMock = vi.fn(() => ({
  from: vi.fn(() => ({
    select: vi.fn(() => makeSelectChain()),
    update: vi.fn((payload: Record<string, unknown>) => {
      updatePayload = payload
      return makeUpdateChain()
    }),
  })),
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
  updatePayload = null
  getUserMock.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
  membershipSingleMock.mockResolvedValue({ data: { role: 'owner' }, error: null })
  findResultMock.mockReturnValue({ data: { org_id: ORG_ID }, error: null })
  updateResultMock.mockReturnValue({
    data: { id: CONNECTION_ID, import_config: validBody.import_config },
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

  it('200 updates import_config', async () => {
    const response = await callPatch(CONNECTION_ID, validBody)
    const data = await response.json()
    expect(response.status).toBe(200)
    expect(data.import_config).toEqual(validBody.import_config)
    expect(updatePayload).toEqual({ import_config: validBody.import_config })
  })

  /**
   * import_enabled を同じ PATCH で受ける理由: 2回に分けると片方だけ成功して状態が中途半端に残る
   * （取り込み先は設定されたのに無効のまま＝永久に同期されない／取り込み先が消えたのに有効のまま）。
   */
  it('import_enabled を同じ更新で変更できる', async () => {
    const response = await callPatch(CONNECTION_ID, { ...validBody, import_enabled: true })
    expect(response.status).toBe(200)
    expect(updatePayload).toEqual({ import_config: validBody.import_config, import_enabled: true })
  })

  it('import_enabled を省略したときは触らない（後方互換）', async () => {
    await callPatch(CONNECTION_ID, validBody)
    expect(updatePayload).toEqual({ import_config: validBody.import_config })
  })

  it('import_enabled が boolean でなければ 400（曖昧な値で同期の有無を決めない）', async () => {
    const response = await callPatch(CONNECTION_ID, { ...validBody, import_enabled: 'yes' })
    expect(response.status).toBe(400)
  })

  it('422 when the DB trigger (P0001) rejects an out-of-org target_space_id (user-facing message)', async () => {
    updateResultMock.mockReturnValue({
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

  it('400 when a UUID cast fails (22P02) for target_space_id/default_assignee_id', async () => {
    updateResultMock.mockReturnValue({
      data: null,
      error: { code: '22P02', message: 'invalid input syntax for type uuid: "not-a-uuid"' },
    })
    const response = await callPatch(CONNECTION_ID, validBody)
    expect(response.status).toBe(400)
  })

  it('500 (not 422) for a transient/unknown DB error — never mislabeled as a permanent input error', async () => {
    updateResultMock.mockReturnValue({
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
   * ⚠ 最重要の回帰テスト(迂回の防止): notion_mappings はサーバ管理フィールド。汎用PATCHが
   * クライアントの送信値をそのまま採用すると、保存API(mapping/route.ts)のライブスキーマ検証を
   * 迂回して実在しないprop_idを永続化できてしまう。DBの現在値が保持されることを確認する。
   */
  it('汎用PATCHで実在しないprop_idを含むnotion_mappingsを送っても永続化されない(DBの現在値が保持される)', async () => {
    const currentMappings = {
      [NOTION_DATABASE_ID]: {
        due_prop_id: 'due-1',
        status: null,
        confirmed_at: '2026-07-01T00:00:00.000Z',
      },
    }
    findResultMock.mockReturnValue({
      data: {
        org_id: ORG_ID,
        import_config: {
          target_space_id: SPACE_ID,
          notion_mappings: currentMappings,
          read_container_ids: [NOTION_DATABASE_ID],
        },
      },
      error: null,
    })

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
    expect(updatePayload).not.toBeNull()
    const config = updatePayload!.import_config as Record<string, unknown>
    expect(config.notion_mappings).toEqual(currentMappings)
    expect(config.notion_mappings).not.toEqual(maliciousMappings)
  })

  /**
   * ⚠ 最重要の回帰テスト(消失の防止): 別画面でtarget_space_idだけを変更する操作で、
   * 確定済みのnotion_mappings/read_container_idsが丸ごと消えてはならない。
   */
  it('汎用PATCHでtarget_space_idだけ変更してもnotion_mappings/read_container_idsが消えない', async () => {
    const currentMappings = {
      [NOTION_DATABASE_ID]: {
        due_prop_id: 'due-1',
        status: null,
        confirmed_at: '2026-07-01T00:00:00.000Z',
      },
    }
    findResultMock.mockReturnValue({
      data: {
        org_id: ORG_ID,
        import_config: {
          target_space_id: SPACE_ID,
          notion_mappings: currentMappings,
          read_container_ids: [NOTION_DATABASE_ID],
        },
      },
      error: null,
    })

    // クライアントはtarget_space_idの変更だけを意図しており、notion_mappings/read_container_ids
    // には一切触れていない(キー自体を送っていない)。
    const response = await callPatch(CONNECTION_ID, { import_config: { target_space_id: NEW_SPACE_ID } })

    expect(response.status).toBe(200)
    const config = updatePayload!.import_config as Record<string, unknown>
    expect(config.target_space_id).toBe(NEW_SPACE_ID)
    expect(config.notion_mappings).toEqual(currentMappings)
    expect(config.read_container_ids).toEqual([NOTION_DATABASE_ID])
  })

  /**
   * ⚠ 最重要の回帰テスト(迂回の防止・kintone版): kintone_mappings/kintone_app_ids も
   * notion_mappings と同じサーバ管理フィールド。汎用PATCHがクライアントの送信値をそのまま
   * 採用すると、kintone/mapping.ts のライブスキーマ検証を迂回して実在しないフィールドコード・
   * アプリIDを永続化できてしまう。DBの現在値が保持されることを確認する。
   */
  it('汎用PATCHで実在しないフィールドコードを含むkintone_mappingsを送っても永続化されない(DBの現在値が保持される)', async () => {
    const currentMappings = {
      '5': {
        title_field_code: 'title',
        due_field_code: 'due',
        status: null,
        confirmed_at: '2026-07-01T00:00:00.000Z',
      },
    }
    findResultMock.mockReturnValue({
      data: {
        org_id: ORG_ID,
        import_config: {
          target_space_id: SPACE_ID,
          kintone_mappings: currentMappings,
          kintone_app_ids: ['5'],
        },
      },
      error: null,
    })

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
    const config = updatePayload!.import_config as Record<string, unknown>
    expect(config.kintone_mappings).toEqual(currentMappings)
    expect(config.kintone_mappings).not.toEqual(maliciousMappings)
    expect(config.kintone_app_ids).toEqual(['5'])
  })

  /**
   * ⚠ 最重要の回帰テスト(消失の防止・kintone版): 別画面でtarget_space_idだけを変更する操作で、
   * 確定済みのkintone_mappings/kintone_app_idsが丸ごと消えてはならない。
   */
  it('汎用PATCHでtarget_space_idだけ変更してもkintone_mappings/kintone_app_idsが消えない', async () => {
    const currentMappings = {
      '5': {
        title_field_code: 'title',
        due_field_code: 'due',
        status: null,
        confirmed_at: '2026-07-01T00:00:00.000Z',
      },
    }
    findResultMock.mockReturnValue({
      data: {
        org_id: ORG_ID,
        import_config: {
          target_space_id: SPACE_ID,
          kintone_mappings: currentMappings,
          kintone_app_ids: ['5'],
        },
      },
      error: null,
    })

    const response = await callPatch(CONNECTION_ID, { import_config: { target_space_id: NEW_SPACE_ID } })

    expect(response.status).toBe(200)
    const config = updatePayload!.import_config as Record<string, unknown>
    expect(config.target_space_id).toBe(NEW_SPACE_ID)
    expect(config.kintone_mappings).toEqual(currentMappings)
    expect(config.kintone_app_ids).toEqual(['5'])
  })

  it('read_container_idsを明示的に送った場合はその値で上書きされる(意図的なクリアも許す)', async () => {
    findResultMock.mockReturnValue({
      data: {
        org_id: ORG_ID,
        import_config: { target_space_id: SPACE_ID, read_container_ids: [NOTION_DATABASE_ID] },
      },
      error: null,
    })

    const response = await callPatch(CONNECTION_ID, {
      import_config: { target_space_id: SPACE_ID, read_container_ids: [] },
    })

    expect(response.status).toBe(200)
    const config = updatePayload!.import_config as Record<string, unknown>
    expect(config.read_container_ids).toEqual([])
  })
})
