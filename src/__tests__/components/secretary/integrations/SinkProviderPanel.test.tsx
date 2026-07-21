import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { SinkProviderPanel } from '@/components/secretary/integrations/SinkProviderPanel'
import type { SinkMeta } from '@/lib/hooks/useSinks'

/**
 * SinkProviderPanel — ToolRailで特定のsinkProvider(webhook/notion/google_sheets)が
 * 選択された際の詳細ペイン。1プロバイダ分の「一覧＋新規作成＋詳細」を合成する。
 * モーダル禁止・保存ボタンなし(既存のCreateSinkForm/SinkDetailPanelを再利用)。
 */

vi.mock('@/components/secretary/integrations/CreateSinkForm', () => ({
  CreateSinkForm: ({
    lockedProvider,
    onCreated,
    onCancel,
  }: {
    lockedProvider?: string
    onCreated: (sink: SinkMeta, secret?: string) => void
    onCancel: () => void
  }) => (
    <div data-testid="create-sink-form">
      <span data-testid="locked-provider">{lockedProvider}</span>
      <button onClick={() => onCreated({ ...sink(), id: 'sink-new' }, 'whsec_new')}>submit-create</button>
      <button onClick={onCancel}>cancel-create</button>
    </div>
  ),
}))

vi.mock('@/components/secretary/integrations/SinkDetailPanel', () => ({
  SinkDetailPanel: ({ sink }: { sink: SinkMeta }) => (
    <div data-testid="sink-detail-panel">{sink.displayName}</div>
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

beforeEach(() => {
  vi.clearAllMocks()
})

describe('SinkProviderPanel', () => {
  it('指定providerのsinkだけ一覧に出る', () => {
    render(
      <SinkProviderPanel
        orgId="org-1"
        provider="webhook"
        sinks={[
          sink({ id: 'wh-1', provider: 'webhook', displayName: 'Webhook1' }),
          sink({ id: 'notion-1', provider: 'notion', displayName: 'Notion1' }),
        ]}
        viewerRole="owner"
        onCreated={vi.fn()}
      />,
    )
    expect(screen.getByTestId('sink-provider-item-wh-1')).toBeInTheDocument()
    expect(screen.queryByTestId('sink-provider-item-notion-1')).not.toBeInTheDocument()
    expect(screen.queryByText('Notion1')).not.toBeInTheDocument()
  })

  it('sinkが無ければ空状態を表示する', () => {
    render(
      <SinkProviderPanel orgId="org-1" provider="webhook" sinks={[]} viewerRole="owner" onCreated={vi.fn()} />,
    )
    expect(screen.getByText(/まだ連携先がありません/)).toBeInTheDocument()
  })

  it('「新規作成」でlockedProvider付きのCreateSinkFormを開く', () => {
    render(
      <SinkProviderPanel orgId="org-1" provider="notion" sinks={[]} viewerRole="owner" onCreated={vi.fn()} />,
    )
    fireEvent.click(screen.getByRole('button', { name: /新規作成/ }))
    expect(screen.getByTestId('create-sink-form')).toBeInTheDocument()
    expect(screen.getByTestId('locked-provider')).toHaveTextContent('notion')
  })

  it('作成完了(onCreated)を呼び出し元へ伝播する', () => {
    const onCreated = vi.fn()
    render(
      <SinkProviderPanel orgId="org-1" provider="webhook" sinks={[]} viewerRole="owner" onCreated={onCreated} />,
    )
    fireEvent.click(screen.getByRole('button', { name: /新規作成/ }))
    fireEvent.click(screen.getByText('submit-create'))
    expect(onCreated).toHaveBeenCalledWith(expect.objectContaining({ id: 'sink-new' }), 'whsec_new')
  })

  it('一覧の行をクリックすると詳細パネル(SinkDetailPanel)が表示される', () => {
    render(
      <SinkProviderPanel
        orgId="org-1"
        provider="webhook"
        sinks={[
          sink({ id: 'wh-1', displayName: 'Webhook1' }),
          sink({ id: 'wh-2', displayName: 'Webhook2' }),
        ]}
        viewerRole="owner"
        onCreated={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByTestId('sink-provider-item-wh-2'))
    expect(screen.getByTestId('sink-detail-panel')).toHaveTextContent('Webhook2')
  })

  it('viewerRole=memberでは「新規作成」ボタンを表示しない', () => {
    render(
      <SinkProviderPanel orgId="org-1" provider="webhook" sinks={[]} viewerRole="member" onCreated={vi.fn()} />,
    )
    expect(screen.queryByRole('button', { name: /新規作成/ })).not.toBeInTheDocument()
  })
})
