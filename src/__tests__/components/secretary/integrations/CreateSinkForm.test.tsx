import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react'
import { CreateSinkForm } from '@/components/secretary/integrations/CreateSinkForm'
import type { SinkMeta } from '@/lib/hooks/useSinks'

/**
 * CreateSinkForm — sink作成(PR-1 APIはprovider='webhook'のみ)。
 * 作成成功時はsecretを一度だけ表示する導線を親(onCreated)へ委譲する
 * (docs/spec/AI_SECRETARY_STAGE3_INTEGRATIONS.md §4)。
 */

const { mutateAsyncMock, toastErrorMock } = vi.hoisted(() => ({
  mutateAsyncMock: vi.fn(),
  toastErrorMock: vi.fn(),
}))

vi.mock('@/lib/hooks/useSinks', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/hooks/useSinks')>()
  return {
    ...actual,
    useCreateSink: () => ({ mutateAsync: mutateAsyncMock, isPending: false }),
  }
})

vi.mock('@/lib/hooks/useChannelGroups', () => ({
  useChannelGroups: () => ({
    groups: [{ id: 'group-1', displayName: '本店グループ', externalGroupId: 'G-1' }],
    isLoading: false,
    error: null,
  }),
}))

vi.mock('sonner', () => ({ toast: { error: toastErrorMock, success: vi.fn() } }))

const SINK: SinkMeta = {
  id: 'sink-1',
  orgId: 'org-1',
  groupId: null,
  provider: 'webhook',
  displayName: '自社Webhook',
  config: { url: 'https://example.com/hook' },
  connectionId: null,
  events: ['task.created', 'task.done', 'task.dismissed'],
  status: 'active',
  consecutiveFailures: 0,
  lastDeliveredAt: null,
  createdBy: 'user-1',
  createdAt: '2026-07-11T00:00:00.000Z',
  updatedAt: '2026-07-11T00:00:00.000Z',
  lastDelivery: null,
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('CreateSinkForm', () => {
  it('表示名・URL未入力では作成ボタンが無効', () => {
    render(<CreateSinkForm orgId="org-1" onCreated={vi.fn()} onCancel={vi.fn()} />)
    expect(screen.getByRole('button', { name: '作成' })).toBeDisabled()
  })

  it('必須項目を入力すると作成ボタンが有効になり、送信するとsecretを含む結果でonCreatedを呼ぶ', async () => {
    mutateAsyncMock.mockResolvedValue({ sink: SINK, secret: 'whsec_new1' })
    const onCreated = vi.fn()
    render(<CreateSinkForm orgId="org-1" onCreated={onCreated} onCancel={vi.fn()} />)

    fireEvent.change(screen.getByLabelText('表示名'), { target: { value: '自社Webhook' } })
    fireEvent.change(screen.getByLabelText('URL'), { target: { value: 'https://example.com/hook' } })

    const submit = screen.getByRole('button', { name: '作成' })
    expect(submit).not.toBeDisabled()

    await act(async () => {
      fireEvent.click(submit)
    })

    expect(mutateAsyncMock).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: 'org-1',
        displayName: '自社Webhook',
        url: 'https://example.com/hook',
        events: ['task.created', 'task.done', 'task.dismissed'],
        groupId: null,
      }),
    )
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(SINK, 'whsec_new1'))
  })

  it('イベント購読チェックボックスの変更が送信内容に反映される(task.reopenedを追加購読)', async () => {
    mutateAsyncMock.mockResolvedValue({ sink: SINK, secret: 'whsec_new1' })
    render(<CreateSinkForm orgId="org-1" onCreated={vi.fn()} onCancel={vi.fn()} />)

    fireEvent.change(screen.getByLabelText('表示名'), { target: { value: 'x' } })
    fireEvent.change(screen.getByLabelText('URL'), { target: { value: 'https://example.com/hook' } })
    fireEvent.click(screen.getByLabelText('task.reopened'))

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '作成' }))
    })

    expect(mutateAsyncMock).toHaveBeenCalledWith(
      expect.objectContaining({
        events: expect.arrayContaining(['task.created', 'task.done', 'task.dismissed', 'task.reopened']),
      }),
    )
  })

  it('グループ選択でgroupIdが送信される', async () => {
    mutateAsyncMock.mockResolvedValue({ sink: SINK, secret: 'whsec_new1' })
    render(<CreateSinkForm orgId="org-1" onCreated={vi.fn()} onCancel={vi.fn()} />)

    fireEvent.change(screen.getByLabelText('表示名'), { target: { value: 'x' } })
    fireEvent.change(screen.getByLabelText('URL'), { target: { value: 'https://example.com/hook' } })
    fireEvent.change(screen.getByLabelText('対象グループ(任意)'), { target: { value: 'group-1' } })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '作成' }))
    })

    expect(mutateAsyncMock).toHaveBeenCalledWith(expect.objectContaining({ groupId: 'group-1' }))
  })

  it('作成失敗時はtoast.errorを表示しonCreatedを呼ばない', async () => {
    mutateAsyncMock.mockRejectedValue(new Error('invalid webhook url: ip_denied'))
    const onCreated = vi.fn()
    render(<CreateSinkForm orgId="org-1" onCreated={onCreated} onCancel={vi.fn()} />)

    fireEvent.change(screen.getByLabelText('表示名'), { target: { value: 'x' } })
    fireEvent.change(screen.getByLabelText('URL'), { target: { value: 'http://169.254.169.254/' } })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '作成' }))
    })

    expect(toastErrorMock).toHaveBeenCalledWith('invalid webhook url: ip_denied')
    expect(onCreated).not.toHaveBeenCalled()
  })

  it('キャンセルボタンでonCancelを呼ぶ', () => {
    const onCancel = vi.fn()
    render(<CreateSinkForm orgId="org-1" onCreated={vi.fn()} onCancel={onCancel} />)
    fireEvent.click(screen.getByRole('button', { name: 'キャンセル' }))
    expect(onCancel).toHaveBeenCalled()
  })
})
