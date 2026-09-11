import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SettingsLayout } from '@/app/(internal)/[orgId]/project/[spaceId]/settings/SettingsLayout'

/**
 * 設定画面サイドナビの GitHub 行の接続ドット。
 *
 * useGitHubInstallation（GitHub を接続した本人にしか行が返らない RLS 付きの表）だけで
 * 判定すると、本人以外には常に「未接続」ドットに見えてしまう。社内メンバーに connected を
 * 返す useGitHubConnection もあわせて見る。
 */

const mockUseGitHubInstallation = vi.fn()
const mockUseGitHubConnection = vi.fn()
const mockUseSlackWorkspace = vi.fn()
const mockUseIntegrations = vi.fn()
const mockUseSpaceMembers = vi.fn()

vi.mock('@/lib/hooks/useGitHub', () => ({
  useGitHubInstallation: (...args: unknown[]) => mockUseGitHubInstallation(...args),
  useGitHubConnection: (...args: unknown[]) => mockUseGitHubConnection(...args),
}))

vi.mock('@/lib/hooks/useSlack', () => ({
  useSlackWorkspace: (...args: unknown[]) => mockUseSlackWorkspace(...args),
}))

vi.mock('@/lib/hooks/useIntegrations', () => ({
  useIntegrations: (...args: unknown[]) => mockUseIntegrations(...args),
}))

vi.mock('@/lib/hooks/useSpaceMembers', () => ({
  useSpaceMembers: (...args: unknown[]) => mockUseSpaceMembers(...args),
}))

vi.mock('@/lib/hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ user: { id: 'user-1' }, loading: false, error: null }),
}))

// このテストではサイドナビの接続ドットだけを見る。中身の描画は他のテストで別途見ているので、
// ここでは軽いスタブに差し替える
vi.mock('@/app/(internal)/[orgId]/project/[spaceId]/settings/SetupBanner', () => ({
  SetupBanner: () => null,
}))
vi.mock('@/app/(internal)/[orgId]/project/[spaceId]/settings/GeneralSettings', () => ({
  GeneralSettings: () => null,
}))
vi.mock('@/app/(internal)/[orgId]/project/[spaceId]/settings/PresetSettings', () => ({
  PresetSettings: () => null,
}))

beforeEach(() => {
  vi.clearAllMocks()
  mockUseIntegrations.mockReturnValue({ isConnected: () => false, connections: [] })
  mockUseSlackWorkspace.mockReturnValue({ data: null })
  mockUseSpaceMembers.mockReturnValue({ members: [{ id: 'user-1', role: 'admin' }] })
})

function renderLayout() {
  return render(<SettingsLayout orgId="org-1" spaceId="space-1" />)
}

describe('SettingsLayout — サイドナビのGitHub接続ドット', () => {
  it('本人以外でも、GitHub接続済みなら「接続済み」ドットにする', () => {
    mockUseGitHubInstallation.mockReturnValue({ data: null })
    mockUseGitHubConnection.mockReturnValue({
      data: { connected: true, connectedBy: 'user-9', connectedAt: '2026-09-01', isMe: false },
    })

    renderLayout()

    const githubButton = screen.getByRole('button', { name: /GitHub/ })
    expect(githubButton.querySelector('[aria-label="接続済み"]')).not.toBeNull()
  })

  it('未接続なら今までどおり「未接続」ドットのまま', () => {
    mockUseGitHubInstallation.mockReturnValue({ data: null })
    mockUseGitHubConnection.mockReturnValue({
      data: { connected: false, connectedBy: null, connectedAt: null, isMe: false },
    })

    renderLayout()

    const githubButton = screen.getByRole('button', { name: /GitHub/ })
    expect(githubButton.querySelector('[aria-label="未接続"]')).not.toBeNull()
  })
})
