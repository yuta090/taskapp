import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { SlackChannelSettings } from '@/app/(internal)/[orgId]/project/[spaceId]/settings/SlackChannelSettings'

// Slackチャンネルの連携・解除・自動通知トグルは space_slack_channels の RLS
// （"space admins can manage slack channels": role in ('admin','editor') の明示行のみ・
// 行が無い社内メンバーへのフォールバックは無い）と同じ規則。代理店設定・ポータル表示設定と
// 同じ canEditMoney を使う。閲覧者・行が無い社内メンバー・役割未確定では操作できない。

vi.mock('@/lib/slack/config', () => ({
  isSlackConfigured: () => true,
}))

vi.mock('@/components/integrations/ToolSetupGuide', () => ({
  ToolSetupGuide: () => null,
}))

const linkMutateAsync = vi.fn().mockResolvedValue(undefined)
const unlinkMutateAsync = vi.fn().mockResolvedValue(undefined)
const updateTogglesMutate = vi.fn()

let mockLinkedChannel: {
  channel_name: string
  notify_task_created?: boolean
  notify_ball_passed?: boolean
  notify_status_changed?: boolean
  notify_comment_added?: boolean
} | null = null

vi.mock('@/lib/hooks/useSlack', () => ({
  useSlackWorkspace: () => ({ data: { team_name: 'テストチーム' }, isLoading: false }),
  useSlackChannel: () => ({ data: mockLinkedChannel, isLoading: false }),
  useSlackChannelList: () => ({ data: [{ id: 'c1', name: 'general', is_private: false }], isLoading: false }),
  useLinkSlackChannel: () => ({ mutateAsync: linkMutateAsync, isPending: false }),
  useUnlinkSlackChannel: () => ({ mutateAsync: unlinkMutateAsync, isPending: false }),
  useUpdateNotifyToggles: () => ({ mutate: updateTogglesMutate, isPending: false }),
}))

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

let mockCanEditMoney = true
vi.mock('@/lib/hooks/useCanEditSpace', () => ({
  useCanEditSpace: () => ({ canEdit: true, canEditMoney: mockCanEditMoney, resolved: true, loading: false }),
}))

function renderSettings() {
  return render(<SlackChannelSettings orgId="o1" spaceId="s1" />)
}

beforeEach(() => {
  linkMutateAsync.mockClear()
  unlinkMutateAsync.mockClear()
  updateTogglesMutate.mockClear()
  mockCanEditMoney = true
  mockLinkedChannel = null
})

describe('SlackChannelSettings — space の行が admin/editor には従来どおり操作できる', () => {
  it('未連携: チャンネルを選んで「連携する」を押せる', async () => {
    renderSettings()
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'c1' } })
    fireEvent.click(screen.getByRole('button', { name: '連携する' }))
    expect(linkMutateAsync).toHaveBeenCalled()
  })

  it('連携済み: 解除ボタン・通知トグルが操作できる', () => {
    mockLinkedChannel = { channel_name: 'general' }
    renderSettings()

    expect(screen.getByTitle('チャンネル連携を解除')).not.toBeDisabled()
    for (const checkbox of screen.getAllByRole('checkbox')) {
      expect(checkbox).not.toBeDisabled()
    }
  })
})

describe('SlackChannelSettings — 操作できない人（閲覧者・行が無い社内メンバー等）には操作させない', () => {
  it('未連携: 「連携する」ボタンが disabled になる', () => {
    mockCanEditMoney = false
    renderSettings()
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'c1' } })
    expect(screen.getByRole('button', { name: '連携する' })).toBeDisabled()
  })

  it('未連携: 押しても連携しない', () => {
    mockCanEditMoney = false
    renderSettings()
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'c1' } })
    fireEvent.click(screen.getByRole('button', { name: '連携する' }))
    expect(linkMutateAsync).not.toHaveBeenCalled()
  })

  it('連携済み: 解除ボタン・通知トグルが disabled になる', () => {
    mockCanEditMoney = false
    mockLinkedChannel = { channel_name: 'general' }
    renderSettings()

    expect(screen.getByTitle('チャンネル連携を解除')).toBeDisabled()
    for (const checkbox of screen.getAllByRole('checkbox')) {
      expect(checkbox).toBeDisabled()
    }
  })

  it('連携済み: 通知トグルを押しても更新されない', () => {
    mockCanEditMoney = false
    mockLinkedChannel = { channel_name: 'general' }
    renderSettings()

    fireEvent.click(screen.getAllByRole('checkbox')[0])
    expect(updateTogglesMutate).not.toHaveBeenCalled()
  })
})
