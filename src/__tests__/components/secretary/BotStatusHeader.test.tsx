import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { BotStatusHeader } from '@/components/secretary/BotStatusHeader'
import type { ChannelAccountMeta } from '@/lib/hooks/useChannelAccount'

/** BotStatusHeader — 有効/無効トグルはowner/adminのみ表示(docs/spec §5) */

const accountMeta: ChannelAccountMeta = {
  id: 'acc-1',
  channel: 'line',
  displayName: '山田会計事務所',
  lineBotUserId: 'U-bot-1',
  status: 'active',
  createdAt: '2026-07-01T00:00:00.000Z',
  ownerType: 'org',
}

describe('BotStatusHeader', () => {
  it('未接続なら案内文を表示しトグルは出さない', () => {
    render(<BotStatusHeader account={null} viewerRole="owner" onToggle={vi.fn()} isLoading={false} />)
    expect(screen.getByText('LINEはまだつながっていません')).toBeInTheDocument()
    expect(screen.queryByTestId('bot-status-toggle')).not.toBeInTheDocument()
  })

  it('自社LINE(org)は「自社LINE」バッジを出す', () => {
    render(<BotStatusHeader account={accountMeta} viewerRole="member" onToggle={vi.fn()} isLoading={false} />)
    expect(screen.getByText('山田会計事務所')).toBeInTheDocument()
    expect(screen.getByText('自社LINE')).toBeInTheDocument()
  })

  it('自社LINEが無くても共通LINE利用中なら「共通LINEを利用中」を出す', () => {
    render(
      <BotStatusHeader account={null} sharedBotInUse viewerRole="owner" onToggle={vi.fn()} isLoading={false} />,
    )
    expect(screen.getByText('共通LINEを利用中')).toBeInTheDocument()
    expect(screen.queryByText('LINEはまだつながっていません')).not.toBeInTheDocument()
  })

  it('member(owner/adminでない)にはトグルを表示しない', () => {
    render(<BotStatusHeader account={accountMeta} viewerRole="member" onToggle={vi.fn()} isLoading={false} />)
    expect(screen.getByText('山田会計事務所')).toBeInTheDocument()
    expect(screen.queryByTestId('bot-status-toggle')).not.toBeInTheDocument()
  })

  it('ownerにはトグルを表示し、クリックでdisabledへの切替を呼ぶ', async () => {
    const onToggle = vi.fn().mockResolvedValue(undefined)
    render(<BotStatusHeader account={accountMeta} viewerRole="owner" onToggle={onToggle} isLoading={false} />)

    const toggle = screen.getByTestId('bot-status-toggle')
    await act(async () => {
      fireEvent.click(toggle)
    })
    expect(onToggle).toHaveBeenCalledWith('acc-1', 'disabled')
  })

  it('adminにもトグルを表示する', () => {
    render(<BotStatusHeader account={accountMeta} viewerRole="admin" onToggle={vi.fn()} isLoading={false} />)
    expect(screen.getByTestId('bot-status-toggle')).toBeInTheDocument()
  })
})
