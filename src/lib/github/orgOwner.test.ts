import { describe, it, expect, vi } from 'vitest'

/**
 * GitHub 連携の操作（インストール開始・インストール完了）は、その組織の owner だけに
 * 許可する。判定は `/api/github/authorize` と `/api/github/callback` の両方で必要になる
 * ため、二重実装しないよう1か所に切り出す。
 */
describe('isOrgOwner', () => {
  function fakeSupabase(membership: { role: string } | null) {
    return {
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: vi.fn(() => Promise.resolve({ data: membership, error: null })),
            })),
          })),
        })),
      })),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any
  }

  it('role が owner なら true', async () => {
    const { isOrgOwner } = await import('./orgOwner')
    const supabase = fakeSupabase({ role: 'owner' })
    expect(await isOrgOwner(supabase, 'org-1', 'user-1')).toBe(true)
  })

  it('owner 以外の role なら false', async () => {
    const { isOrgOwner } = await import('./orgOwner')
    const supabase = fakeSupabase({ role: 'member' })
    expect(await isOrgOwner(supabase, 'org-1', 'user-1')).toBe(false)
  })

  it('所属していなければ false', async () => {
    const { isOrgOwner } = await import('./orgOwner')
    const supabase = fakeSupabase(null)
    expect(await isOrgOwner(supabase, 'org-1', 'user-1')).toBe(false)
  })
})
