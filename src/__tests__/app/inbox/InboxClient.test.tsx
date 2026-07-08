import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import InboxClient from '@/app/(internal)/inbox/InboxClient'

/**
 * Regression coverage for the empty-inbox copy added as part of the
 * first-run UX stream (D): a brand-new project previously showed the
 * unhelpful "通知はありません" with no guidance on what to do next.
 */

vi.mock('@/lib/hooks/useNotifications', () => ({
  useNotifications: () => ({
    notifications: [],
    loading: false,
    error: null,
    fetchNotifications: vi.fn(),
    markAsRead: vi.fn(),
    markAsActioned: vi.fn(),
    markAllAsRead: vi.fn(),
  }),
}))

vi.mock('@/components/layout', () => ({
  useInspector: () => ({ setInspector: vi.fn() }),
}))

vi.mock('@/components/notification/NotificationInspector', () => ({
  NotificationInspector: () => null,
}))

describe('InboxClient — 空状態の教育化 (初回UX改善 D)', () => {
  it('通知が0件のとき、タスク作成とクライアント公開を促す案内文を表示する', () => {
    render(<InboxClient />)
    expect(
      screen.getByText(
        'クライアントの承認・修正依頼やボールの受け渡しがここに届きます。まずはタスクを作成してクライアントに公開してみましょう。'
      )
    ).toBeInTheDocument()
  })
})
