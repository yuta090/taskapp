import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { IntegrationsConsoleClient } from '@/app/(internal)/[orgId]/secretary/integrations/IntegrationsConsoleClient'
import type { SinkMeta } from '@/lib/hooks/useSinks'
import type { IntegrationId } from '@/lib/integrations/registry'

/**
 * IntegrationsConsoleClient — 「ツール連携」タブ。左レール(ToolRail)＋右詳細
 * (surfaceで出し分け: connector→ConnectorSyncPane / sink→SinkProviderPanel /
 * catalogのうちアダプタ実装済み(backlog等)→TaskSyncConnectPanel / それ以外の
 * export・catalog→ToolConnectOverview)。Inspectorは使わない。モーダル禁止・保存ボタンなし。
 */

const { useSinksMock } = vi.hoisted(() => ({ useSinksMock: vi.fn() }))
vi.mock('@/lib/hooks/useSinks', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/hooks/useSinks')>()
  return { ...actual, useSinks: (...args: unknown[]) => useSinksMock(...args) }
})

vi.mock('@/components/secretary/integrations/ToolRail', () => ({
  ToolRail: ({
    selectedId,
    onSelect,
  }: {
    selectedId: IntegrationId
    onSelect: (id: IntegrationId) => void
  }) => (
    <div data-testid="tool-rail">
      <span data-testid="tool-rail-selected">{selectedId}</span>
      {(['google_tasks', 'notion', 'backlog', 'wrike', 'csv_export', 'generic_inbound'] as IntegrationId[]).map((id) => (
        <button key={id} onClick={() => onSelect(id)}>
          select-{id}
        </button>
      ))}
    </div>
  ),
}))

vi.mock('@/components/secretary/integrations/ConnectorSyncPane', () => ({
  ConnectorSyncPane: ({ orgId }: { orgId: string }) => <div data-testid="connector-sync-pane">{orgId}</div>,
}))

vi.mock('@/components/secretary/integrations/GenericInboundPanel', () => ({
  GenericInboundPanel: ({ orgId }: { orgId: string }) => <div data-testid="generic-inbound-panel">{orgId}</div>,
}))

vi.mock('@/components/secretary/integrations/SinkProviderPanel', () => ({
  SinkProviderPanel: ({
    provider,
    onCreated,
  }: {
    provider: string
    onCreated: (sink: SinkMeta, secret?: string) => void
  }) => (
    <div data-testid="sink-provider-panel">
      <span data-testid="sink-provider-panel-provider">{provider}</span>
      <button onClick={() => onCreated({ id: 'sink-new' } as SinkMeta, 'whsec_created')}>simulate-create</button>
    </div>
  ),
}))

vi.mock('@/components/secretary/integrations/ToolConnectOverview', () => ({
  ToolConnectOverview: ({ def }: { def: { id: IntegrationId } }) => (
    <div data-testid="tool-connect-overview">{def.id}</div>
  ),
}))

vi.mock('@/components/secretary/integrations/TaskSyncConnectPanel', () => ({
  TaskSyncConnectPanel: ({ orgId, integrationId }: { orgId: string; integrationId: IntegrationId }) => (
    <div data-testid="task-sync-connect-panel">
      {orgId}:{integrationId}
    </div>
  ),
}))

beforeEach(() => {
  vi.clearAllMocks()
  useSinksMock.mockReturnValue({
    sinks: [],
    viewerRole: 'owner',
    notionConnection: { connected: false, workspaceName: null },
    googleSheetsConnection: { connected: false },
    isLoading: false,
    error: null,
  })
})

describe('IntegrationsConsoleClient', () => {
  it('SecretaryTabNavを自前で描画しない(タブバーは親のsecretary/layout.tsxが持つ)', () => {
    render(<IntegrationsConsoleClient orgId="org-1" />)
    expect(screen.queryByTestId('secretary-tab-integrations')).not.toBeInTheDocument()
  })

  it('左にToolRailを描画する', () => {
    render(<IntegrationsConsoleClient orgId="org-1" />)
    expect(screen.getByTestId('tool-rail')).toBeInTheDocument()
  })

  it('既定でgoogle_tasksが選択され、ConnectorSyncPaneが出る', () => {
    render(<IntegrationsConsoleClient orgId="org-1" />)
    expect(screen.getByTestId('tool-rail-selected')).toHaveTextContent('google_tasks')
    expect(screen.getByTestId('connector-sync-pane')).toHaveTextContent('org-1')
    expect(screen.queryByTestId('sink-provider-panel')).not.toBeInTheDocument()
    expect(screen.queryByTestId('tool-connect-overview')).not.toBeInTheDocument()
  })

  it('sinkサービス(notion)を選択するとSinkProviderPanelが出る', () => {
    render(<IntegrationsConsoleClient orgId="org-1" />)
    fireEvent.click(screen.getByText('select-notion'))
    expect(screen.getByTestId('sink-provider-panel')).toBeInTheDocument()
    expect(screen.getByTestId('sink-provider-panel-provider')).toHaveTextContent('notion')
    expect(screen.queryByTestId('connector-sync-pane')).not.toBeInTheDocument()
  })

  it('planned(backlog)だがアダプタ実装済みのツールを選択するとTaskSyncConnectPanelが出る', () => {
    render(<IntegrationsConsoleClient orgId="org-1" />)
    fireEvent.click(screen.getByText('select-backlog'))
    expect(screen.getByTestId('task-sync-connect-panel')).toHaveTextContent('org-1:backlog')
    expect(screen.queryByTestId('tool-connect-overview')).not.toBeInTheDocument()
  })

  it('planned かつアダプタ未実装(wrike)を選択するとToolConnectOverviewが出る', () => {
    render(<IntegrationsConsoleClient orgId="org-1" />)
    fireEvent.click(screen.getByText('select-wrike'))
    expect(screen.getByTestId('tool-connect-overview')).toHaveTextContent('wrike')
    expect(screen.queryByTestId('task-sync-connect-panel')).not.toBeInTheDocument()
  })

  it('export(csv_export)を選択するとToolConnectOverviewが出る', () => {
    render(<IntegrationsConsoleClient orgId="org-1" />)
    fireEvent.click(screen.getByText('select-csv_export'))
    expect(screen.getByTestId('tool-connect-overview')).toHaveTextContent('csv_export')
  })

  it('connectorだがgeneric_inboundを選択するとGenericInboundPanelが出る(ConnectorSyncPaneやTaskSyncConnectPanelではない)', () => {
    render(<IntegrationsConsoleClient orgId="org-1" />)
    fireEvent.click(screen.getByText('select-generic_inbound'))
    expect(screen.getByTestId('generic-inbound-panel')).toHaveTextContent('org-1')
    expect(screen.queryByTestId('connector-sync-pane')).not.toBeInTheDocument()
    expect(screen.queryByTestId('task-sync-connect-panel')).not.toBeInTheDocument()
  })

  it('sinkパネルの作成完了(onCreated)でsecretを一度だけバナー表示する。閉じると消える', () => {
    render(<IntegrationsConsoleClient orgId="org-1" />)
    fireEvent.click(screen.getByText('select-notion'))
    fireEvent.click(screen.getByText('simulate-create'))
    expect(screen.getByText('whsec_created')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '閉じる' }))
    expect(screen.queryByText('whsec_created')).not.toBeInTheDocument()
  })

  it('別ツールへ選択を切り替えるとsecretバナーが消える', () => {
    render(<IntegrationsConsoleClient orgId="org-1" />)
    fireEvent.click(screen.getByText('select-notion'))
    fireEvent.click(screen.getByText('simulate-create'))
    expect(screen.getByText('whsec_created')).toBeInTheDocument()

    fireEvent.click(screen.getByText('select-google_tasks'))
    expect(screen.queryByText('whsec_created')).not.toBeInTheDocument()
  })
})
