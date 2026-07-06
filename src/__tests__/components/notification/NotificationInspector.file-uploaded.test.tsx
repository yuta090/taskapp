import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { NotificationInspector } from '@/components/notification/NotificationInspector'
import type { NotificationWithPayload } from '@/lib/hooks/useNotifications'

/**
 * file_uploaded: クライアントがポータルからファイルをアップロードした際に内部メンバーへ
 * 届く通知。専用アクションパネルは持たず、payload.link による汎用の
 * 「詳細を見る」ボタン(既存の confirmation_request 等と同じ仕組み)で
 * ファイルページを開ければ十分。
 */

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    from: vi.fn(),
    auth: { getUser: vi.fn(() => Promise.resolve({ data: { user: null } })) },
  }),
}))

function makeNotification(overrides: Partial<NotificationWithPayload> = {}): NotificationWithPayload {
  return {
    id: 'n1',
    org_id: 'org-1',
    space_id: 'space-1',
    to_user_id: 'user-1',
    channel: 'in_app',
    type: 'file_uploaded',
    dedupe_key: 'dedupe-1',
    payload: {},
    created_at: '2026-07-01T00:00:00',
    read_at: null,
    actioned_at: null,
    ...overrides,
  } as NotificationWithPayload
}

const noop = () => {}

describe('NotificationInspector — file_uploaded', () => {
  it('shows the payload title/message and a "詳細を見る" link to payload.link', () => {
    render(
      <NotificationInspector
        notification={makeNotification({
          payload: {
            title: 'ファイル: クライアントから資料が届きました',
            message: '山田太郎さんが「見積書.pdf」をアップロードしました',
            link: '/org-1/project/space-1/files',
          },
        })}
        onClose={noop}
        onMarkAsRead={noop}
        onNavigate={noop}
        hasPrev={false}
        hasNext={false}
      />
    )

    expect(screen.getByText('ファイル: クライアントから資料が届きました')).toBeInTheDocument()
    expect(screen.getByText('山田太郎さんが「見積書.pdf」をアップロードしました')).toBeInTheDocument()
    expect(screen.getByText('ファイル')).toBeInTheDocument()

    const link = screen.getByRole('link', { name: /詳細を見る/ })
    expect(link).toHaveAttribute('href', '/org-1/project/space-1/files')
  })

  it('is not treated as actionable (no "要対応" state)', () => {
    render(
      <NotificationInspector
        notification={makeNotification({ payload: { link: '/org-1/project/space-1/files' } })}
        onClose={noop}
        onMarkAsRead={noop}
        onNavigate={noop}
        hasPrev={false}
        hasNext={false}
      />
    )

    // 完了にして次へ(タスク非actionable時のフッター)は出ず、既読/次への導線のみになる
    expect(screen.queryByText('完了にして次へ')).not.toBeInTheDocument()
  })
})
