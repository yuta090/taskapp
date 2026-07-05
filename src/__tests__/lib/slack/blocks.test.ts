import { describe, it, expect } from 'vitest'
import { buildTaskBlocks } from '@/lib/slack/blocks'
import type { TaskNotificationPayload } from '@/lib/notifications/types'

function makePayload(overrides: Partial<TaskNotificationPayload['task']> = {}): TaskNotificationPayload {
  return {
    task: {
      id: 't1',
      title: 'サンプルタスク',
      status: 'todo',
      ball: 'internal',
      origin: 'internal',
      type: 'task',
      ...overrides,
    },
    spaceName: 'テストプロジェクト',
    appUrl: 'https://example.com',
  }
}

function findFieldText(blocks: unknown[], label: string): string | undefined {
  for (const block of blocks as { fields?: { text: string }[] }[]) {
    const field = block.fields?.find((f) => f.text.startsWith(`*${label}*`))
    if (field) return field.text
  }
  return undefined
}

describe('buildTaskBlocks — 用語統一 (M-1, M-3)', () => {
  it('ball=client のとき「クライアント確認待ち」を表示する', () => {
    const blocks = buildTaskBlocks('task_updated', makePayload({ ball: 'client' }))
    const json = JSON.stringify(blocks)
    expect(json).toContain('クライアント確認待ち')
    expect(json).not.toContain('確認待ち","')
  })

  it('status=todo は「着手予定」と表示する', () => {
    const blocks = buildTaskBlocks('task_updated', makePayload({ status: 'todo' }))
    expect(findFieldText(blocks, 'ステータス')).toContain('着手予定')
  })

  it('status=in_review は「社内承認中」と表示する', () => {
    const blocks = buildTaskBlocks('task_updated', makePayload({ status: 'in_review' }))
    expect(findFieldText(blocks, 'ステータス')).toContain('社内承認中')
  })
})
