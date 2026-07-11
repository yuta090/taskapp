import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { SinkListPane } from '@/components/secretary/integrations/SinkListPane'
import type { SinkMeta } from '@/lib/hooks/useSinks'

/**
 * SinkListPane — 左カラム: sink一覧＋新規作成トグル。
 * member(owner/adminでない)には「新規作成」を出さない（POST APIはowner/admin限定）。
 */

vi.mock('@/components/secretary/integrations/CreateSinkForm', () => ({
  CreateSinkForm: ({ onCancel }: { onCancel: () => void }) => (
    <div data-testid="create-sink-form">
      <button onClick={onCancel}>close-create-form</button>
    </div>
  ),
}))

function sink(overrides: Partial<SinkMeta> = {}): SinkMeta {
  return {
    id: 'sink-1',
    orgId: 'org-1',
    groupId: null,
    provider: 'webhook',
    displayName: '自社Webhook',
    config: { url: 'https://example.com/hook' },
    connectionId: null,
    events: ['task.created'],
    status: 'active',
    consecutiveFailures: 0,
    lastDeliveredAt: null,
    createdBy: 'user-1',
    createdAt: '2026-07-11T00:00:00.000Z',
    updatedAt: '2026-07-11T00:00:00.000Z',
    lastDelivery: null,
    ...overrides,
  }
}

describe('SinkListPane', () => {
  it('sinkが無ければ空状態を表示する', () => {
    render(
      <SinkListPane
        orgId="org-1"
        sinks={[]}
        selectedSinkId={null}
        onSelect={vi.fn()}
        viewerRole="owner"
        onCreated={vi.fn()}
      />,
    )
    expect(screen.getByText(/連携先がありません/)).toBeInTheDocument()
  })

  it('sinkごとに表示名・statusを表示し、クリックでonSelectを呼ぶ', () => {
    const onSelect = vi.fn()
    render(
      <SinkListPane
        orgId="org-1"
        sinks={[sink(), sink({ id: 'sink-2', displayName: '無効なやつ', status: 'disabled' })]}
        selectedSinkId={null}
        onSelect={onSelect}
        viewerRole="owner"
        onCreated={vi.fn()}
      />,
    )
    expect(screen.getByText('自社Webhook')).toBeInTheDocument()
    expect(screen.getByText('無効なやつ')).toBeInTheDocument()

    fireEvent.click(screen.getByTestId('sink-list-item-sink-2'))
    expect(onSelect).toHaveBeenCalledWith('sink-2')
  })

  it('member(owner/adminでない)には新規作成ボタンを表示しない', () => {
    render(
      <SinkListPane
        orgId="org-1"
        sinks={[sink()]}
        selectedSinkId={null}
        onSelect={vi.fn()}
        viewerRole="member"
        onCreated={vi.fn()}
      />,
    )
    expect(screen.queryByRole('button', { name: /新規作成/ })).not.toBeInTheDocument()
  })

  it('owner/adminは新規作成ボタンでCreateSinkFormをトグルできる', () => {
    render(
      <SinkListPane
        orgId="org-1"
        sinks={[]}
        selectedSinkId={null}
        onSelect={vi.fn()}
        viewerRole="owner"
        onCreated={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /新規作成/ }))
    expect(screen.getByTestId('create-sink-form')).toBeInTheDocument()

    fireEvent.click(screen.getByText('close-create-form'))
    expect(screen.queryByTestId('create-sink-form')).not.toBeInTheDocument()
  })

  it('選択中のsinkはハイライトされる', () => {
    render(
      <SinkListPane
        orgId="org-1"
        sinks={[sink()]}
        selectedSinkId="sink-1"
        onSelect={vi.fn()}
        viewerRole="owner"
        onCreated={vi.fn()}
      />,
    )
    expect(screen.getByTestId('sink-list-item-sink-1')).toHaveClass('bg-indigo-50')
  })
})
