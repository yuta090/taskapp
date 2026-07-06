import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { TaskComments } from '@/components/task/TaskComments'

vi.mock('@/lib/hooks/useTaskComments', () => ({
  useTaskComments: () => ({
    comments: [],
    loading: false,
    error: null,
    fetchComments: vi.fn(),
    createComment: vi.fn(),
    updateComment: vi.fn(),
    softDeleteComment: vi.fn(),
    canEdit: () => false,
  }),
}))

/**
 * A2: 内部ユーザーがコメントを書くとき、既定の公開範囲は「社内のみ」にする
 * (これまでの既定「外部に公開」だと、意図せずクライアントに見える下書きが漏れやすい)。
 */
describe('TaskComments — コメント可視性の初期値 (A2)', () => {
  it('canSetVisibility=true のとき、初期状態で「社内のみ」がアクティブになっている', () => {
    render(
      <TaskComments
        orgId="o1"
        spaceId="s1"
        taskId="t1"
        currentUserId="u1"
        canSetVisibility
      />
    )

    const internalButton = screen.getByRole('button', { name: /社内のみ/ })
    const clientButton = screen.getByRole('button', { name: /外部に公開/ })

    expect(internalButton.className).toContain('bg-gray-200')
    expect(clientButton.className).not.toContain('bg-amber-100')
  })
})
