import { describe, it, expect, vi, beforeEach } from 'vitest'

const rpcMock = vi.fn()
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ rpc: rpcMock }),
}))

const { recordOrgMilestone } = await import('@/lib/analytics/recordOrgMilestone')

beforeEach(() => {
  vi.clearAllMocks()
})

describe('recordOrgMilestone', () => {
  it('RPC に組織IDと節目を渡す', async () => {
    rpcMock.mockResolvedValue({ error: null })
    await recordOrgMilestone('org-1', 'portal_previewed')
    expect(rpcMock).toHaveBeenCalledWith('rpc_record_org_milestone', {
      p_org_id: 'org-1',
      p_milestone: 'portal_previewed',
    })
  })

  it('RPC がエラーでも例外にしない', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    rpcMock.mockResolvedValue({ error: { message: 'denied' } })
    await expect(recordOrgMilestone('org-1', 'portal_previewed')).resolves.toBeUndefined()
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})
