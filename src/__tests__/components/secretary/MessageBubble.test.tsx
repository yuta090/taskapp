import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MessageBubble } from '@/components/secretary/MessageBubble'
import type { ChannelMessageRow } from '@/lib/hooks/useChannelTimeline'

/** MessageBubble — inbound/outboundの振り分けとredacted墓標表示 */

function makeMessage(overrides: Partial<ChannelMessageRow> = {}): ChannelMessageRow {
  return {
    id: 'm1',
    org_id: 'org-1',
    space_id: 'space-1',
    identity_id: null,
    account_id: null,
    channel: 'line',
    direction: 'inbound',
    actor: 'client',
    external_user_id: 'U-client-1',
    content_type: 'text',
    body: 'こんにちは',
    storage_path: null,
    status: 'received',
    error: null,
    redacted_at: null,
    occurred_at: '2026-07-11T09:00:00.000Z',
    created_at: '2026-07-11T09:00:00.000Z',
    ...overrides,
  }
}

describe('MessageBubble', () => {
  it('inbound(顧問先発言)は左寄せのクラスになる', () => {
    const { container } = render(<MessageBubble message={makeMessage()} />)
    expect(container.querySelector('.justify-start')).not.toBeNull()
    expect(screen.getByText('こんにちは')).toBeInTheDocument()
    expect(screen.getByText('顧問先')).toBeInTheDocument()
  })

  it('outbound(秘書発言)は右寄せのクラスになる', () => {
    const { container } = render(
      <MessageBubble
        message={makeMessage({ direction: 'outbound', actor: 'secretary', body: '請求書をお送りください' })}
      />,
    )
    expect(container.querySelector('.justify-end')).not.toBeNull()
    expect(screen.getByText('秘書')).toBeInTheDocument()
  })

  it('redacted_atがあると本文は出さず墓標表示になる', () => {
    render(
      <MessageBubble
        message={makeMessage({ redacted_at: '2026-07-11T10:00:00.000Z', body: '削除済みのはずの本文' })}
      />,
    )
    expect(screen.getByText('削除済み（機微情報）')).toBeInTheDocument()
    expect(screen.queryByText('削除済みのはずの本文')).not.toBeInTheDocument()
  })

  it('添付(image)はアイコン＋ファイル名を表示する', () => {
    render(
      <MessageBubble
        message={makeMessage({
          content_type: 'image',
          body: null,
          storage_path: 'org-1/line/msg-123',
        })}
      />,
    )
    expect(screen.getByText(/画像: msg-123/)).toBeInTheDocument()
  })

  it('status=failedは再試行ボタンを表示し、クリックでonRetryが呼ばれる', () => {
    const onRetry = vi.fn()
    render(<MessageBubble message={makeMessage({ status: 'failed', error: '送信失敗' })} onRetry={onRetry} />)

    const retryButton = screen.getByText('再試行')
    retryButton.click()
    expect(onRetry).toHaveBeenCalledTimes(1)
  })
})
