import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { IntegrationsConsoleClient } from '@/app/(internal)/[orgId]/secretary/integrations/IntegrationsConsoleClient'

/**
 * 回帰テスト: sinkプロバイダ切替(webhook→notion等)でCreateSinkFormが前providerの
 * 内部状態(入力欄・provider)を持ち越さないこと。
 *
 * 再現していたバグ: <SinkProviderPanel> にkeyが無く、provider propが変わっても
 * 同一コンポーネントインスタンスが再利用されるため、CreateSinkFormのuseState初期値
 * (lockedProvider由来)が更新後も古いprovider('webhook')のまま残り、ヘッダ上は
 * Notionを選択していてもURL欄が残存し、送信するとwebhook sinkが作られてしまっていた。
 *
 * 本テストはToolRail/SinkProviderPanel/CreateSinkFormを実体のまま使い、
 * IntegrationsConsoleClient側の修正(SinkProviderPanelへkey={def.sinkProvider}を付与し、
 * provider切替時に完全再マウントさせる)を検証する。深い階層のAPIミューテーションのみモックする。
 */

vi.mock('@/lib/hooks/useSinks', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/hooks/useSinks')>()
  return {
    ...actual,
    useSinks: () => ({
      sinks: [],
      viewerRole: 'owner',
      notionConnection: { connected: true, workspaceName: 'Acme Workspace' },
      googleSheetsConnection: { connected: true },
      isLoading: false,
      error: null,
    }),
    useCreateSink: () => ({ mutateAsync: vi.fn(), isPending: false }),
    useCreateNotionSink: () => ({ mutateAsync: vi.fn(), isPending: false }),
    useCreateGoogleSheetsSink: () => ({ mutateAsync: vi.fn(), isPending: false }),
  }
})

vi.mock('@/lib/hooks/useChannelGroups', () => ({
  useChannelGroups: () => ({ groups: [], isLoading: false, error: null }),
}))

// 既定選択(google_tasks→connector surface)は本回帰の対象外。react-query未セットアップの
// まま実体のConnectorSyncPaneを描画するとuseConnectorsがQueryClientProviderを要求してしまう
// ため、ここでは軽量モックに差し替える(sinkプロバイダ切替の検証には無関係)。
vi.mock('@/components/secretary/integrations/ConnectorSyncPane', () => ({
  ConnectorSyncPane: () => <div data-testid="connector-sync-pane" />,
}))

beforeEach(() => {
  vi.clearAllMocks()
})

describe('IntegrationsConsoleClient — sinkプロバイダ切替時の完全再マウント(回帰)', () => {
  it('webhook作成フォーム入力中にnotionへ切替えると、CreateSinkFormが破棄され前providerの入力が残らない', () => {
    render(<IntegrationsConsoleClient orgId="org-1" />)

    // webhookを選択して「新規作成」を開く
    fireEvent.click(screen.getByTestId('tool-rail-webhook'))
    fireEvent.click(screen.getByRole('button', { name: /新規作成/ }))
    expect(screen.getByLabelText('URL')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('URL'), { target: { value: 'https://example.com/hook' } })

    // notionへ切替
    fireEvent.click(screen.getByTestId('tool-rail-notion'))

    // 修正後: SinkProviderPanelが完全再マウントされ、isCreatingはfalseにリセットされる。
    // 前providerのURL欄が残存してはいけない(=作成中の状態そのものが破棄される)。
    expect(screen.queryByLabelText('URL')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('データベースID')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /新規作成/ })).toBeInTheDocument()
  })

  it('notionで新規作成を開き直すとlockedProvider=notionのフィールド(データベースID)のみが出る', () => {
    render(<IntegrationsConsoleClient orgId="org-1" />)

    fireEvent.click(screen.getByTestId('tool-rail-webhook'))
    fireEvent.click(screen.getByRole('button', { name: /新規作成/ }))
    fireEvent.change(screen.getByLabelText('URL'), { target: { value: 'https://example.com/hook' } })

    fireEvent.click(screen.getByTestId('tool-rail-notion'))
    fireEvent.click(screen.getByRole('button', { name: /新規作成/ }))

    expect(screen.getByLabelText('データベースID')).toBeInTheDocument()
    expect(screen.queryByLabelText('URL')).not.toBeInTheDocument()
    // provider切替ラジオも表示されない(lockedProvider指定のため)
    expect(screen.queryByRole('radiogroup', { name: '連携先の種類' })).not.toBeInTheDocument()
  })
})
