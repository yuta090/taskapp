import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * code_only 成立時の org 通知（検知的統制・設計正本 §4/§7-8(m)・PR3b）。
 *
 * 紐付けRPCとは同一Txではない（成立後にwebhookからベストエフォートで呼ぶ）。
 * 通知失敗が紐付け自体を巻き戻してはならない（呼び出し側の try/catch が担保。ここでは
 * 内部の一部失敗が他の送信をブロックしないことのみ検証する）。
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function chain(response: any) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const builder: any = {}
  for (const m of ['select', 'eq', 'in', 'order', 'limit', 'upsert']) {
    builder[m] = vi.fn(() => builder)
  }
  builder.maybeSingle = vi.fn(() => Promise.resolve(response))
  builder.then = (resolve: (value: unknown) => void) => resolve(response)
  return builder
}

let fromResponses: Record<string, unknown>
const fromMock = vi.fn()
const getUserByIdMock = vi.fn()
const sendEmailMock = vi.fn()

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => ({
    from: fromMock,
    auth: { admin: { getUserById: getUserByIdMock } },
  })),
}))

vi.mock('@/lib/email/groupClaimLinked', () => ({
  sendGroupClaimLinkedEmail: (...args: unknown[]) => sendEmailMock(...args),
}))

const { notifyCodeOnlyGroupLinked } = await import('@/lib/channels/groupClaimNotify')

beforeEach(() => {
  vi.clearAllMocks()
  fromResponses = {}
  fromMock.mockImplementation((table: string) => chain(fromResponses[table] ?? { data: null, error: null }))
  sendEmailMock.mockResolvedValue({ success: true })
})

describe('notifyCodeOnlyGroupLinked', () => {
  it('org owner/admin全員へin_app通知をupsertし、解決できたメール宛にメールを送る', async () => {
    fromResponses['organizations'] = { data: { name: '山田商事' }, error: null }
    fromResponses['spaces'] = { data: { name: '経理プロジェクト' }, error: null }
    fromResponses['org_memberships'] = {
      data: [{ user_id: 'owner-1' }, { user_id: 'admin-1' }],
      error: null,
    }
    getUserByIdMock.mockImplementation((id: string) =>
      Promise.resolve({ data: { user: { email: `${id}@example.com` } } }),
    )

    await notifyCodeOnlyGroupLinked('org-1', 'space-1', 'ある店舗のグループ')

    const notifIdx = fromMock.mock.calls.findIndex(([table]) => table === 'notifications')
    expect(notifIdx).toBeGreaterThanOrEqual(0)
    const notifBuilder = fromMock.mock.results[notifIdx].value
    expect(notifBuilder.upsert).toHaveBeenCalled()
    const rows = notifBuilder.upsert.mock.calls[0][0] as Array<Record<string, unknown>>
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({
      org_id: 'org-1',
      space_id: 'space-1',
      to_user_id: 'owner-1',
      channel: 'in_app',
      type: 'group_claim_linked',
    })

    expect(sendEmailMock).toHaveBeenCalledTimes(2)
    expect(sendEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'owner-1@example.com',
        orgName: '山田商事',
        spaceName: '経理プロジェクト',
        groupDisplayName: 'ある店舗のグループ',
      }),
    )
  })

  it('org内部メンバー(owner/admin)が0人なら何もしない', async () => {
    fromResponses['org_memberships'] = { data: [], error: null }
    await notifyCodeOnlyGroupLinked('org-1', 'space-1', 'グループ')
    expect(getUserByIdMock).not.toHaveBeenCalled()
    expect(sendEmailMock).not.toHaveBeenCalled()
  })

  it('メールが無い(getUserByIdがnull)受信者はメール送信をスキップするが他は送る', async () => {
    fromResponses['org_memberships'] = { data: [{ user_id: 'no-email-1' }, { user_id: 'owner-1' }], error: null }
    getUserByIdMock.mockImplementation((id: string) =>
      Promise.resolve({ data: { user: id === 'owner-1' ? { email: 'owner-1@example.com' } : null } }),
    )

    await notifyCodeOnlyGroupLinked('org-1', 'space-1', 'グループ')
    expect(sendEmailMock).toHaveBeenCalledTimes(1)
    expect(sendEmailMock).toHaveBeenCalledWith(expect.objectContaining({ to: 'owner-1@example.com' }))
  })

  it('一部の送信が失敗しても他の送信・呼び出し全体は継続する（例外を投げない）', async () => {
    fromResponses['org_memberships'] = { data: [{ user_id: 'u-1' }, { user_id: 'u-2' }], error: null }
    getUserByIdMock.mockImplementation((id: string) =>
      Promise.resolve({ data: { user: { email: `${id}@example.com` } } }),
    )
    sendEmailMock.mockImplementationOnce(() => Promise.reject(new Error('resend down')))
    sendEmailMock.mockImplementationOnce(() => Promise.resolve({ success: true }))

    await expect(notifyCodeOnlyGroupLinked('org-1', 'space-1', 'グループ')).resolves.toBeUndefined()
    expect(sendEmailMock).toHaveBeenCalledTimes(2)
  })

  it('in_app通知upsertが失敗しても例外を投げない（ベストエフォート）', async () => {
    fromResponses['org_memberships'] = { data: [{ user_id: 'owner-1' }], error: null }
    fromResponses['notifications'] = { data: null, error: { message: 'boom' } }
    getUserByIdMock.mockResolvedValue({ data: { user: { email: 'owner-1@example.com' } } })

    await expect(notifyCodeOnlyGroupLinked('org-1', 'space-1', 'グループ')).resolves.toBeUndefined()
  })

  it('グループ表示名がnullでも例外にならない', async () => {
    fromResponses['org_memberships'] = { data: [{ user_id: 'owner-1' }], error: null }
    getUserByIdMock.mockResolvedValue({ data: { user: { email: 'owner-1@example.com' } } })
    await expect(notifyCodeOnlyGroupLinked('org-1', 'space-1', null)).resolves.toBeUndefined()
  })
})
