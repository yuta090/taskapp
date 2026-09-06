import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { GitHubRepoSettings } from '@/app/(internal)/[orgId]/project/[spaceId]/settings/GitHubRepoSettings'
import { SlackChannelSettings } from '@/app/(internal)/[orgId]/project/[spaceId]/settings/SlackChannelSettings'
import { getSetupGuide } from '@/lib/integrations/setupGuides'

/**
 * プロジェクト設定 → 外部連携（GitHub / Slack）の「連携のしかた」ボタン。
 *
 * 「どうやって繋ぐのか」が画面のどこにも無く、利用者が組織設定へ行っても迷う、という
 * 要望から入れた。手順の中身は setupGuides.ts（単一の真実源）から引き、この画面では
 * 文言を書かない。ToolSetupGuide は本物を使う（差し替えると「手順が出ているか」を検証できない）。
 */

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}))
vi.mock('@/components/shared', () => ({
  useConfirmDialog: () => ({ confirm: vi.fn().mockResolvedValue(false), ConfirmDialog: null }),
}))
vi.mock('@/lib/github/config', () => ({ isGitHubConfigured: () => true }))
vi.mock('@/lib/slack/config', () => ({ isSlackConfigured: () => true }))

const idle = { data: undefined, isLoading: false }
const mutation = { mutateAsync: vi.fn(), mutate: vi.fn(), isPending: false }

vi.mock('@/lib/hooks', () => ({
  useGitHubInstallation: () => idle,
  useGitHubRepositories: () => ({ data: [], isLoading: false }),
  useSpaceGitHubRepos: () => ({ data: [], isLoading: false }),
  useLinkRepoToSpace: () => mutation,
  useUnlinkRepoFromSpace: () => mutation,
}))
vi.mock('@/lib/hooks/useSlack', () => ({
  useSlackWorkspace: () => idle,
  useSlackChannel: () => idle,
  useSlackChannelList: () => ({ data: [], isLoading: false }),
  useLinkSlackChannel: () => mutation,
  useUnlinkSlackChannel: () => mutation,
  useUpdateNotifyToggles: () => mutation,
}))

describe('プロジェクト設定の GitHub / Slack に「連携のしかた」がある', () => {
  it('GitHub: 未接続でもボタンがあり、押すと手順（組織設定→GitHubと連携する→リポジトリを追加）が出る', () => {
    render(<GitHubRepoSettings orgId="org-1" spaceId="space-1" />)
    const button = screen.getByRole('button', { name: /連携のしかた/ })
    fireEvent.click(button)
    const guide = getSetupGuide('github')!
    expect(guide).not.toBeNull()
    for (const step of guide.steps) {
      expect(screen.getByText(step)).toBeInTheDocument()
    }
    // 利用者が実際に押すボタン名がそのまま手順に出ている
    expect(guide.steps.join('\n')).toMatch(/GitHubと連携する/)
    expect(guide.steps.join('\n')).toMatch(/リポジトリを追加/)
  })

  it('Slack: 未接続でもボタンがあり、押すと手順（組織設定→Slackと連携する→/invite→チャンネルを選択）が出る', () => {
    render(<SlackChannelSettings orgId="org-1" spaceId="space-1" />)
    fireEvent.click(screen.getByRole('button', { name: /連携のしかた/ }))
    const guide = getSetupGuide('slack')!
    expect(guide).not.toBeNull()
    for (const step of guide.steps) {
      expect(screen.getByText(step)).toBeInTheDocument()
    }
    expect(guide.steps.join('\n')).toMatch(/Slackと連携する/)
    expect(guide.steps.join('\n')).toMatch(/\/invite @AgentPM/)
    expect(guide.steps.join('\n')).toMatch(/連携する/)
  })
})
