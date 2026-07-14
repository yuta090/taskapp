import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * findIdentityIdsByExternalUserIds — メンションで取れたLINE userId を identity に解決する。
 *
 * ★顧問先(space)スコープが必須。
 * channel_identities は「同一人物が複数顧問先の窓口になるケース（社長が2法人経営等）」を
 * 明示的に許容している（20260710204722_channel_plumbing.sql の active一意は
 * (org_id, channel, external_id, space_id)）。
 * org_id だけで引くと、A社のグループの申し送りにB社のidentityが付き、
 * 顧問先をまたいだ担当の誤帰属が起きる。
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function chain(response: any) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const builder: any = {}
  const calls: Array<[string, unknown]> = []
  builder.__calls = calls
  builder.select = vi.fn(() => builder)
  builder.eq = vi.fn((col: string, val: unknown) => {
    calls.push([col, val])
    return builder
  })
  builder.in = vi.fn((col: string, val: unknown) => {
    calls.push([col, val])
    return Promise.resolve(response)
  })
  return builder
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let builder: any
const fromMock = vi.fn()

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => ({ from: fromMock })),
}))

const { findIdentityIdsByExternalUserIds } = await import('@/lib/channels/store')

beforeEach(() => {
  vi.clearAllMocks()
})

describe('findIdentityIdsByExternalUserIds', () => {
  it('space_id で絞り込む（同一人物が複数顧問先の窓口でも、他spaceのidentityを引かない）', async () => {
    builder = chain({
      data: [{ id: 'identity-space-1', external_id: 'U-shacho' }],
      error: null,
    })
    fromMock.mockImplementation(() => builder)

    const result = await findIdentityIdsByExternalUserIds('org-1', 'space-1', ['U-shacho'])

    // org_id / channel / status に加えて space_id で必ず絞ること
    expect(builder.__calls).toContainEqual(['org_id', 'org-1'])
    expect(builder.__calls).toContainEqual(['space_id', 'space-1'])
    expect(builder.__calls).toContainEqual(['channel', 'line'])
    expect(builder.__calls).toContainEqual(['status', 'active'])
    expect(result.get('U-shacho')).toBe('identity-space-1')
  })

  it('spaceが未確定（未紐付けグループ）なら解決しない（他spaceのidentityを流用しない）', async () => {
    fromMock.mockImplementation(() => chain({ data: [], error: null }))

    const result = await findIdentityIdsByExternalUserIds('org-1', null, ['U-shacho'])

    // identity は space_id not null。spaceが決まっていない以上、誰のものとも言えない
    expect(result.size).toBe(0)
    expect(fromMock).not.toHaveBeenCalled()
  })

  it('userIdが空なら問い合わせない', async () => {
    fromMock.mockImplementation(() => chain({ data: [], error: null }))

    const result = await findIdentityIdsByExternalUserIds('org-1', 'space-1', [])

    expect(result.size).toBe(0)
    expect(fromMock).not.toHaveBeenCalled()
  })
})
