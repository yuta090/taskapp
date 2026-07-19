import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { SecretaryConsoleClient } from '@/app/(internal)/[orgId]/secretary/SecretaryConsoleClient'
import type { UserSpace } from '@/lib/hooks/useUserSpaces'

/**
 * SecretaryConsoleClient — shell-layout統合後の仕様:
 * - タブバー(SecretaryTabNav)は親の secretary/layout.tsx が一元描画するため、
 *   ここでは自前で描画しない(二重nav禁止)。
 * - 相手先選択は `?space=<id>` に持ち上げ、往復(タブ切替・戻る/進む)で選択が消えない。
 */

const ORG = 'org-1'

const { useUserSpacesMock, useChannelAccountMock, useChannelIdentitiesMock, useChannelGroupCountsMock } =
  vi.hoisted(() => ({
    useUserSpacesMock: vi.fn(),
    useChannelAccountMock: vi.fn(),
    useChannelIdentitiesMock: vi.fn(),
    useChannelGroupCountsMock: vi.fn(),
  }))

vi.mock('@/lib/hooks/useUserSpaces', () => ({
  useUserSpaces: (...args: unknown[]) => useUserSpacesMock(...args),
}))
vi.mock('@/lib/hooks/useChannelAccount', () => ({
  useChannelAccount: (...args: unknown[]) => useChannelAccountMock(...args),
}))
vi.mock('@/lib/hooks/useChannelIdentities', () => ({
  useChannelIdentities: (...args: unknown[]) => useChannelIdentitiesMock(...args),
}))
vi.mock('@/lib/hooks/useChannelGroupCounts', () => ({
  useChannelGroupCounts: (...args: unknown[]) => useChannelGroupCountsMock(...args),
}))

vi.mock('@/components/secretary/BotStatusHeader', () => ({
  BotStatusHeader: () => <div data-testid="bot-status-header" />,
}))

vi.mock('@/components/secretary/SpaceConnectionList', () => ({
  SpaceConnectionList: ({
    spaces,
    selectedSpaceId,
    onSelect,
  }: {
    spaces: UserSpace[]
    selectedSpaceId: string | null
    onSelect: (id: string) => void
  }) => (
    <div data-testid="space-connection-list">
      <span data-testid="selected-space-id">{selectedSpaceId ?? 'none'}</span>
      {spaces.map((s) => (
        <button key={s.id} onClick={() => onSelect(s.id)}>
          select-{s.id}
        </button>
      ))}
    </div>
  ),
}))

vi.mock('@/components/secretary/MessageTimeline', () => ({
  MessageTimeline: ({ space }: { space: UserSpace | null }) => (
    <div data-testid="message-timeline">{space?.name ?? 'none'}</div>
  ),
}))

const { usePathnameMock, useSearchParamsMock, routerReplaceMock } = vi.hoisted(() => ({
  usePathnameMock: vi.fn(),
  useSearchParamsMock: vi.fn(),
  routerReplaceMock: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  usePathname: () => usePathnameMock(),
  useSearchParams: () => useSearchParamsMock(),
  useRouter: () => ({ replace: routerReplaceMock, push: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
}))

function space(overrides: Partial<UserSpace> = {}): UserSpace {
  return {
    id: 'space-1',
    name: 'スペース1',
    orgId: ORG,
    orgName: '組織1',
    role: 'admin',
    archivedAt: null,
    groupId: null,
    sortOrder: 0,
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  usePathnameMock.mockReturnValue(`/${ORG}/secretary`)
  useSearchParamsMock.mockReturnValue(new URLSearchParams())
  useChannelAccountMock.mockReturnValue({
    account: null,
    sharedBotInUse: false,
    viewerRole: 'owner',
    isLoading: false,
    setStatus: vi.fn(),
  })
  useChannelIdentitiesMock.mockReturnValue({ counts: {} })
  useChannelGroupCountsMock.mockReturnValue({ counts: {} })
  useUserSpacesMock.mockReturnValue({
    spaces: [space(), space({ id: 'space-2', name: 'スペース2' })],
  })
})

describe('SecretaryConsoleClient', () => {
  it('SecretaryTabNavを自前で描画しない(タブバーは親layoutが持つ)', () => {
    render(<SecretaryConsoleClient orgId={ORG} />)
    expect(screen.queryByTestId('secretary-tab-messages')).not.toBeInTheDocument()
    expect(screen.queryByTestId('secretary-tab-approvals')).not.toBeInTheDocument()
  })

  it('?spaceが無ければ先頭のspaceを既定選択する', () => {
    render(<SecretaryConsoleClient orgId={ORG} />)
    expect(screen.getByTestId('selected-space-id')).toHaveTextContent('space-1')
    expect(screen.getByTestId('message-timeline')).toHaveTextContent('スペース1')
  })

  it('?space=<id> があれば初期選択として復元する', () => {
    useSearchParamsMock.mockReturnValue(new URLSearchParams('space=space-2'))
    render(<SecretaryConsoleClient orgId={ORG} />)
    expect(screen.getByTestId('selected-space-id')).toHaveTextContent('space-2')
    expect(screen.getByTestId('message-timeline')).toHaveTextContent('スペース2')
  })

  it('選択変更でrouter.replaceにより?spaceが更新される', () => {
    render(<SecretaryConsoleClient orgId={ORG} />)
    fireEvent.click(screen.getByText('select-space-2'))
    expect(screen.getByTestId('selected-space-id')).toHaveTextContent('space-2')
    expect(routerReplaceMock).toHaveBeenCalledWith(
      expect.stringContaining('space=space-2'),
      expect.anything(),
    )
  })
})
