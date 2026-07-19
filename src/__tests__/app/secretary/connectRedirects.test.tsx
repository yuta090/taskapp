import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * チャネル連携ハブ移設に伴う恒久リダイレクトの検証。
 * 旧URL(メール/オンボーディング/通知に流通済み)を新URLへ振り替える:
 *   /secretary/user-links        → /secretary/connect/line
 *   /secretary/group-links       → /secretary/connect/line/groups
 *   /secretary/connect (索引)    → /secretary/connect/line
 * orgId を保持することが要件。
 */

class RedirectSignal extends Error {
  constructor(public destination: string) {
    super('NEXT_REDIRECT')
  }
}

const redirectMock = vi.fn((destination: string) => {
  throw new RedirectSignal(destination)
})

vi.mock('next/navigation', () => ({
  redirect: (destination: string) => redirectMock(destination),
}))

const ORG = '11111111-1111-4111-8111-111111111111'

const { default: LegacyUserLinksPage } = await import(
  '@/app/(internal)/[orgId]/secretary/user-links/page'
)
const { default: LegacyGroupLinksPage } = await import(
  '@/app/(internal)/[orgId]/secretary/group-links/page'
)
const { default: ConnectIndexPage } = await import(
  '@/app/(internal)/[orgId]/secretary/connect/page'
)

beforeEach(() => vi.clearAllMocks())

describe('secretary connect リダイレクト', () => {
  it('旧 user-links → connect/line（orgId保持）', async () => {
    await expect(LegacyUserLinksPage({ params: Promise.resolve({ orgId: ORG }) })).rejects.toBeInstanceOf(
      RedirectSignal,
    )
    expect(redirectMock).toHaveBeenCalledWith(`/${ORG}/secretary/connect/line`)
  })

  it('旧 group-links → connect/line/groups（orgId保持）', async () => {
    await expect(LegacyGroupLinksPage({ params: Promise.resolve({ orgId: ORG }) })).rejects.toBeInstanceOf(
      RedirectSignal,
    )
    expect(redirectMock).toHaveBeenCalledWith(`/${ORG}/secretary/connect/line/groups`)
  })

  it('connect 索引 → connect/line', async () => {
    await expect(ConnectIndexPage({ params: Promise.resolve({ orgId: ORG }) })).rejects.toBeInstanceOf(
      RedirectSignal,
    )
    expect(redirectMock).toHaveBeenCalledWith(`/${ORG}/secretary/connect/line`)
  })
})
