import { describe, expect, it, vi } from 'vitest'
import { passBallToClient } from './passToClient'

function deps(over: Partial<Parameters<typeof passBallToClient>[1]> = {}) {
  const calls: string[] = []
  const d = {
    getOwners: vi.fn(async () => {
      calls.push('owners')
      return [
        { side: 'client' as const, user_id: 'c1' },
        { side: 'internal' as const, user_id: 'i1' },
      ]
    }),
    passBall: vi.fn(async (_args: { clientOwnerIds: string[]; internalOwnerIds: string[] }) => {
      calls.push('pass')
    }),
    notifyApproval: vi.fn(async () => {
      calls.push('approval')
      return true
    }),
    notifySlack: vi.fn(() => {
      calls.push('slack')
    }),
    ...over,
  }
  return { d, calls }
}

describe('passBallToClient', () => {
  it('今の担当者のままボールを渡し、そのあと承認依頼メールと Slack を送る（Web と同じ順）', async () => {
    const { d, calls } = deps()
    expect(await passBallToClient('t1', d)).toEqual({ emailSent: true })
    expect(d.passBall).toHaveBeenCalledWith({ clientOwnerIds: ['c1'], internalOwnerIds: ['i1'] })
    expect(calls).toEqual(['owners', 'pass', 'approval', 'slack'])
  })

  it('メールを送れなくても、ボールは戻さない（Web と同じ）。送れなかったことを返す', async () => {
    const { d } = deps({ notifyApproval: vi.fn(async () => false) })
    expect(await passBallToClient('t1', d)).toEqual({ emailSent: false })
  })

  it('代理店・ベンダーの担当者がいたら、渡さずに止める（担当者が消えるため）', async () => {
    const { d } = deps({ getOwners: vi.fn(async () => [{ side: 'vendor' as const, user_id: 'v1' }]) })
    await expect(passBallToClient('t1', d)).rejects.toThrow('Web')
    expect(d.passBall).not.toHaveBeenCalled()
    expect(d.notifyApproval).not.toHaveBeenCalled()
  })

  it('ボールを渡せなかったら、メールも Slack も送らない', async () => {
    const { d } = deps({
      passBall: vi.fn(async () => {
        throw new Error('rls')
      }),
    })
    await expect(passBallToClient('t1', d)).rejects.toThrow('rls')
    expect(d.notifyApproval).not.toHaveBeenCalled()
    expect(d.notifySlack).not.toHaveBeenCalled()
  })
})
