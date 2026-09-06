import { describe, it, expect, vi, beforeEach } from 'vitest'
import { saveOAuthConnection } from '@/lib/integrations/connection-store'

/**
 * OAuth 接続（integration_connections）の保存。
 *
 * 背景: 20260721193711_task_sync_credentials で一意キーが
 *   (provider, owner_type, owner_id, coalesce(external_account_key, ''))
 * という「式付き」に変わった。PostgREST の upsert(onConflict) は列名しか指定できず式に
 * 合わせられないため、`onConflict: 'provider,owner_type,owner_id'` は Postgres に
 *   "there is no unique or exclusion constraint matching the ON CONFLICT specification"
 * で拒否される＝カレンダー/Zoom/Teams/Notion/スプレッドシート/Google タスク/会計の接続が
 * すべて save_failed になっていた（2026-09-06 本番で再現）。
 * 対策: upsert をやめ、既存行（key 未設定）を引いて update / 無ければ insert。
 */

const maybeSingleMock = vi.fn()
const orMock = vi.fn(() => ({ maybeSingle: maybeSingleMock }))
const eqChain = { eq: vi.fn(), or: orMock }
eqChain.eq.mockReturnValue(eqChain)
const selectForFindMock = vi.fn(() => eqChain)

const updateSingleMock = vi.fn()
const updateEqMock = vi.fn(() => ({ select: () => ({ single: updateSingleMock }) }))
const updateMock = vi.fn(() => ({ eq: updateEqMock }))

const insertSingleMock = vi.fn()
const insertMock = vi.fn(() => ({ select: () => ({ single: insertSingleMock }) }))

const upsertMock = vi.fn()
const fromMock = vi.fn(() => ({ select: selectForFindMock, update: updateMock, insert: insertMock, upsert: upsertMock }))
const admin = { from: fromMock } as unknown as Parameters<typeof saveOAuthConnection>[0]

const ROW = {
  provider: 'google_calendar',
  owner_type: 'user' as const,
  owner_id: '22222222-2222-4222-8222-222222222222',
  org_id: '11111111-1111-4111-8111-111111111111',
  access_token: '',
  access_token_encrypted: 'enc(a)',
  status: 'active',
}

beforeEach(() => {
  vi.clearAllMocks()
  eqChain.eq.mockReturnValue(eqChain)
})

describe('saveOAuthConnection', () => {
  it('既存行があれば update（id で絞る）し、id を返す', async () => {
    maybeSingleMock.mockResolvedValue({ data: { id: 'conn-1' }, error: null })
    updateSingleMock.mockResolvedValue({ data: { id: 'conn-1' }, error: null })

    const result = await saveOAuthConnection(admin, ROW)

    expect(fromMock).toHaveBeenCalledWith('integration_connections')
    expect(eqChain.eq).toHaveBeenCalledWith('provider', 'google_calendar')
    expect(eqChain.eq).toHaveBeenCalledWith('owner_type', 'user')
    expect(eqChain.eq).toHaveBeenCalledWith('owner_id', ROW.owner_id)
    // 一意キーの coalesce(external_account_key,'') に合わせ、NULL と '' の両方を「key 未設定」とみなす
    expect(orMock).toHaveBeenCalledWith('external_account_key.is.null,external_account_key.eq.')
    expect(updateMock).toHaveBeenCalledWith(ROW)
    expect(updateEqMock).toHaveBeenCalledWith('id', 'conn-1')
    expect(insertMock).not.toHaveBeenCalled()
    expect(result).toEqual({ data: { id: 'conn-1' }, error: null })
  })

  it('既存行が無ければ insert し、id を返す', async () => {
    maybeSingleMock.mockResolvedValue({ data: null, error: null })
    insertSingleMock.mockResolvedValue({ data: { id: 'conn-new' }, error: null })

    const result = await saveOAuthConnection(admin, ROW)

    expect(insertMock).toHaveBeenCalledWith(ROW)
    expect(updateMock).not.toHaveBeenCalled()
    expect(result).toEqual({ data: { id: 'conn-new' }, error: null })
  })

  it('upsert(onConflict) は使わない（式付き一意キーに合わせられず必ず失敗するため）', async () => {
    maybeSingleMock.mockResolvedValue({ data: null, error: null })
    insertSingleMock.mockResolvedValue({ data: { id: 'conn-new' }, error: null })
    await saveOAuthConnection(admin, ROW)
    expect(upsertMock).not.toHaveBeenCalled()
  })

  it('既存行の検索でエラーなら書き込まずにエラーを返す', async () => {
    maybeSingleMock.mockResolvedValue({ data: null, error: { message: 'boom' } })
    const result = await saveOAuthConnection(admin, ROW)
    expect(result.error).toEqual({ message: 'boom' })
    expect(result.data).toBeNull()
    expect(updateMock).not.toHaveBeenCalled()
    expect(insertMock).not.toHaveBeenCalled()
  })

  it('update のエラーはそのまま返す', async () => {
    maybeSingleMock.mockResolvedValue({ data: { id: 'conn-1' }, error: null })
    updateSingleMock.mockResolvedValue({ data: null, error: { message: 'update failed' } })
    const result = await saveOAuthConnection(admin, ROW)
    expect(result).toEqual({ data: null, error: { message: 'update failed' } })
  })
})
