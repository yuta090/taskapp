import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { IntegrationsConsoleClient } from '@/app/(internal)/[orgId]/secretary/integrations/IntegrationsConsoleClient'
import type { SinkMeta } from '@/lib/hooks/useSinks'

/**
 * IntegrationsConsoleClient — Main pane内2カラム(左: sink一覧 / 右: 詳細)。
 * Inspectorは使わない。3ペイン規則・モーダル禁止(docs/spec/AI_SECRETARY_STAGE3_INTEGRATIONS.md §4)。
 */

const { useSinksMock } = vi.hoisted(() => ({ useSinksMock: vi.fn() }))
vi.mock('@/lib/hooks/useSinks', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/hooks/useSinks')>()
  return { ...actual, useSinks: (...args: unknown[]) => useSinksMock(...args) }
})

vi.mock('@/components/secretary/integrations/SinkListPane', () => ({
  SinkListPane: ({
    sinks,
    selectedSinkId,
    onSelect,
    onCreated,
    googleSheetsConnection,
  }: {
    sinks: SinkMeta[]
    selectedSinkId: string | null
    onSelect: (id: string) => void
    onCreated: (sink: SinkMeta, secret: string) => void
    googleSheetsConnection?: { connected: boolean }
  }) => (
    <div data-testid="sink-list-pane">
      <span data-testid="selected-id">{selectedSinkId ?? 'none'}</span>
      <span data-testid="list-pane-google-sheets-connected">{String(googleSheetsConnection?.connected)}</span>
      {sinks.map((s) => (
        <button key={s.id} onClick={() => onSelect(s.id)}>
          select-{s.id}
        </button>
      ))}
      <button onClick={() => onCreated({ ...sinks[0], id: 'sink-new', displayName: '新規' }, 'whsec_created')}>
        simulate-create
      </button>
    </div>
  ),
}))

vi.mock('@/components/secretary/integrations/SinkDetailPanel', () => ({
  SinkDetailPanel: ({
    sink,
    googleSheetsConnection,
  }: {
    sink: SinkMeta
    googleSheetsConnection?: { connected: boolean }
  }) => (
    <div data-testid="sink-detail-panel">
      {sink.displayName}
      <span data-testid="detail-panel-google-sheets-connected">{String(googleSheetsConnection?.connected)}</span>
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

beforeEach(() => {
  vi.clearAllMocks()
})

describe('IntegrationsConsoleClient', () => {
  it('SecretaryTabNavを自前で描画しない(タブバーは親の secretary/layout.tsx が持つ)', () => {
    useSinksMock.mockReturnValue({ sinks: [], viewerRole: 'owner', isLoading: false, error: null })
    render(<IntegrationsConsoleClient orgId="org-1" />)
    expect(screen.queryByTestId('secretary-tab-integrations')).not.toBeInTheDocument()
  })

  it('sinkが無ければ詳細パネルの代わりに空状態を表示する', () => {
    useSinksMock.mockReturnValue({ sinks: [], viewerRole: 'owner', isLoading: false, error: null })
    render(<IntegrationsConsoleClient orgId="org-1" />)
    expect(screen.queryByTestId('sink-detail-panel')).not.toBeInTheDocument()
    expect(screen.getByText(/連携先を選択するか、新規作成/)).toBeInTheDocument()
  })

  it('未選択なら先頭のsinkを既定選択し、詳細パネルへ渡す', () => {
    useSinksMock.mockReturnValue({
      sinks: [sink(), sink({ id: 'sink-2', displayName: '2つ目' })],
      viewerRole: 'owner',
      isLoading: false,
      error: null,
    })
    render(<IntegrationsConsoleClient orgId="org-1" />)
    expect(screen.getByTestId('selected-id')).toHaveTextContent('sink-1')
    expect(screen.getByTestId('sink-detail-panel')).toHaveTextContent('自社Webhook')
  })

  it('googleSheetsConnectionをSinkListPane/SinkDetailPanelの両方へ渡す', () => {
    useSinksMock.mockReturnValue({
      sinks: [sink()],
      viewerRole: 'owner',
      isLoading: false,
      error: null,
      googleSheetsConnection: { connected: true },
    })
    render(<IntegrationsConsoleClient orgId="org-1" />)
    expect(screen.getByTestId('list-pane-google-sheets-connected')).toHaveTextContent('true')
    expect(screen.getByTestId('detail-panel-google-sheets-connected')).toHaveTextContent('true')
  })

  it('一覧からの選択で詳細パネルが切り替わる', () => {
    useSinksMock.mockReturnValue({
      sinks: [sink(), sink({ id: 'sink-2', displayName: '2つ目' })],
      viewerRole: 'owner',
      isLoading: false,
      error: null,
    })
    render(<IntegrationsConsoleClient orgId="org-1" />)
    fireEvent.click(screen.getByText('select-sink-2'))
    expect(screen.getByTestId('sink-detail-panel')).toHaveTextContent('2つ目')
  })

  it('作成完了で新しいsinkを選択し、secretを一度だけバナー表示する。閉じると消える', () => {
    useSinksMock.mockReturnValue({ sinks: [sink()], viewerRole: 'owner', isLoading: false, error: null })
    render(<IntegrationsConsoleClient orgId="org-1" />)

    fireEvent.click(screen.getByText('simulate-create'))

    expect(screen.getByTestId('selected-id')).toHaveTextContent('sink-new')
    expect(screen.getByText('whsec_created')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '閉じる' }))
    expect(screen.queryByText('whsec_created')).not.toBeInTheDocument()
  })

  it('作成後に別sinkを選択するとsecretバナーが消える（選択操作でクリアされる）', () => {
    useSinksMock.mockReturnValue({
      sinks: [sink(), sink({ id: 'sink-2', displayName: '2つ目' })],
      viewerRole: 'owner',
      isLoading: false,
      error: null,
    })
    render(<IntegrationsConsoleClient orgId="org-1" />)

    fireEvent.click(screen.getByText('simulate-create'))
    expect(screen.getByText('whsec_created')).toBeInTheDocument()

    fireEvent.click(screen.getByText('select-sink-2'))
    expect(screen.queryByText('whsec_created')).not.toBeInTheDocument()
  })
})
