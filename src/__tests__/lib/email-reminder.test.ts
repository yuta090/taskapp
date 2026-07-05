import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ReminderTaskRef } from '@/lib/reminders/computeClientReminders'

const mockSend = vi.fn().mockResolvedValue({ data: { id: 'test-message-id' }, error: null })

vi.mock('resend', () => {
  return {
    Resend: class MockResend {
      emails = {
        send: mockSend,
      }
    },
  }
})

process.env.RESEND_API_KEY = 'test-api-key'
process.env.FROM_EMAIL = 'test@example.com'
process.env.NEXT_PUBLIC_APP_NAME = 'TestApp'
process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000'

import { sendReminderEmail } from '@/lib/email/reminder'

function ref(overrides: Partial<ReminderTaskRef> = {}): ReminderTaskRef {
  return {
    taskId: 'task-1',
    title: 'デザイン確認',
    spaceName: 'ECサイトリニューアル',
    dueDate: '2026-07-01',
    daysOverdue: 3,
    ...overrides,
  }
}

describe('sendReminderEmail', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSend.mockResolvedValue({ data: { id: 'test-message-id' }, error: null })
  })

  it('shows the total task count in the subject', async () => {
    await sendReminderEmail({
      to: 'client@example.com',
      displayName: 'クライアント太郎',
      digest: { overdue: [], dueToday: [ref({ title: '確認A', dueDate: '2026-07-05', daysOverdue: 0 })], stalled: [] },
    })

    const callArgs = mockSend.mock.calls[0][0]
    expect(callArgs.subject).toContain('1件')
  })

  it('appends the overdue count to the subject when there are overdue tasks', async () => {
    await sendReminderEmail({
      to: 'client@example.com',
      displayName: 'クライアント太郎',
      digest: { overdue: [ref()], dueToday: [], stalled: [] },
    })

    const callArgs = mockSend.mock.calls[0][0]
    expect(callArgs.subject).toContain('1件')
    expect(callArgs.subject).toContain('期限超過1件')
  })

  it('does not mention overdue count in the subject when there are none', async () => {
    await sendReminderEmail({
      to: 'client@example.com',
      displayName: 'クライアント太郎',
      digest: { overdue: [], dueToday: [], stalled: [ref({ title: '確認B', dueDate: null, daysOverdue: 0 })] },
    })

    const callArgs = mockSend.mock.calls[0][0]
    expect(callArgs.subject).not.toContain('期限超過')
  })

  it('includes a task confirmation link for each task', async () => {
    await sendReminderEmail({
      to: 'client@example.com',
      displayName: 'クライアント太郎',
      digest: { overdue: [ref({ taskId: 'task-abc' })], dueToday: [], stalled: [] },
    })

    const callArgs = mockSend.mock.calls[0][0]
    expect(callArgs.html).toContain('http://localhost:3000/portal/task/task-abc')
  })

  it('includes a link to the portal settings page in the footer', async () => {
    await sendReminderEmail({
      to: 'client@example.com',
      displayName: 'クライアント太郎',
      digest: { overdue: [ref()], dueToday: [], stalled: [] },
    })

    const callArgs = mockSend.mock.calls[0][0]
    expect(callArgs.html).toContain('http://localhost:3000/portal/settings')
  })

  it('escapes HTML in the task title', async () => {
    await sendReminderEmail({
      to: 'client@example.com',
      displayName: 'クライアント太郎',
      digest: { overdue: [ref({ title: '<script>alert(1)</script>' })], dueToday: [], stalled: [] },
    })

    const callArgs = mockSend.mock.calls[0][0]
    expect(callArgs.html).not.toContain('<script>alert(1)</script>')
    expect(callArgs.html).toContain('&lt;script&gt;')
  })

  it('separates overdue, due today, and stalled sections', async () => {
    await sendReminderEmail({
      to: 'client@example.com',
      displayName: 'クライアント太郎',
      digest: {
        overdue: [ref({ taskId: 'o1', title: '期限切れタスク' })],
        dueToday: [ref({ taskId: 'd1', title: '本日期限タスク', dueDate: '2026-07-05', daysOverdue: 0 })],
        stalled: [ref({ taskId: 's1', title: '滞留タスク', dueDate: null, daysOverdue: 0 })],
      },
    })

    const callArgs = mockSend.mock.calls[0][0]
    expect(callArgs.html).toContain('期限を過ぎています')
    expect(callArgs.html).toContain('本日が期限です')
    expect(callArgs.html).toContain('ご対応をお待ちしています')
    expect(callArgs.html).toContain('期限切れタスク')
    expect(callArgs.html).toContain('本日期限タスク')
    expect(callArgs.html).toContain('滞留タスク')
  })
})
