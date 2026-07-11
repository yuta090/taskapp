import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { SinkDetailPanel } from '@/components/secretary/integrations/SinkDetailPanel'
import type { SinkMeta } from '@/lib/hooks/useSinks'

/**
 * SinkDetailPanel — 右カラム: 設定(表示名/URL/イベント購読)・有効/無効・secretローテーション・
 * テスト配達・エラーバナー＋再有効化。保存ボタンは持たず、操作ごとに即時mutateする
 * (docs/spec/AI_SECRETARY_STAGE3_INTEGRATIONS.md §4)。
 */

const { updateSinkMutateAsyncMock, testSinkMutateAsyncMock, confirmMock, toastErrorMock } = vi.hoisted(() => ({
  updateSinkMutateAsyncMock: vi.fn(),
  testSinkMutateAsyncMock: vi.fn(),
  confirmMock: vi.fn().mockResolvedValue(true),
  toastErrorMock: vi.fn(),
}))

vi.mock('@/lib/hooks/useSinks', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/hooks/useSinks')>()
  return {
    ...actual,
    useUpdateSink: () => ({ mutateAsync: updateSinkMutateAsyncMock, isPending: false }),
    useTestSinkDelivery: () => ({ mutateAsync: testSinkMutateAsyncMock, isPending: false }),
  }
})

vi.mock('@/components/shared', () => ({
  useConfirmDialog: () => ({ confirm: confirmMock, ConfirmDialog: null }),
}))

vi.mock('@/components/secretary/integrations/DeliveryLogList', () => ({
  DeliveryLogList: ({ sinkId }: { sinkId: string }) => <div data-testid="delivery-log-list">{sinkId}</div>,
}))
vi.mock('@/components/secretary/integrations/WebhookReceiverGuide', () => ({
  WebhookReceiverGuide: () => <div data-testid="webhook-guide" />,
}))

vi.mock('sonner', () => ({ toast: { error: toastErrorMock, success: vi.fn() } }))

function sink(overrides: Partial<SinkMeta> = {}): SinkMeta {
  return {
    id: 'sink-1',
    orgId: 'org-1',
    groupId: null,
    provider: 'webhook',
    displayName: '自社Webhook',
    config: { url: 'https://example.com/hook' },
    connectionId: null,
    events: ['task.created', 'task.done'],
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
  confirmMock.mockResolvedValue(true)
  updateSinkMutateAsyncMock.mockResolvedValue({ sink: sink() })
})

describe('SinkDetailPanel', () => {
  it('表示名・URL・配達ログ・受信ガイドを表示する', () => {
    render(<SinkDetailPanel orgId="org-1" sink={sink()} viewerRole="owner" />)
    expect(screen.getByDisplayValue('自社Webhook')).toBeInTheDocument()
    expect(screen.getByDisplayValue('https://example.com/hook')).toBeInTheDocument()
    expect(screen.getByTestId('delivery-log-list')).toHaveTextContent('sink-1')
    expect(screen.getByTestId('webhook-guide')).toBeInTheDocument()
  })

  it('表示名をblurすると変更があればupdateを呼ぶ', async () => {
    render(<SinkDetailPanel orgId="org-1" sink={sink()} viewerRole="owner" />)
    const input = screen.getByLabelText('表示名')
    fireEvent.change(input, { target: { value: '新しい名前' } })
    await act(async () => {
      fireEvent.blur(input)
    })
    expect(updateSinkMutateAsyncMock).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: 'org-1', sinkId: 'sink-1', displayName: '新しい名前' }),
    )
  })

  it('表示名を変更せずblurしてもupdateを呼ばない', async () => {
    render(<SinkDetailPanel orgId="org-1" sink={sink()} viewerRole="owner" />)
    const input = screen.getByLabelText('表示名')
    await act(async () => {
      fireEvent.blur(input)
    })
    expect(updateSinkMutateAsyncMock).not.toHaveBeenCalled()
  })

  it('イベント購読チェックボックスの変更で即座にupdateを呼ぶ', async () => {
    render(<SinkDetailPanel orgId="org-1" sink={sink()} viewerRole="owner" />)
    await act(async () => {
      fireEvent.click(screen.getByLabelText('task.reopened'))
    })
    expect(updateSinkMutateAsyncMock).toHaveBeenCalledWith(
      expect.objectContaining({
        sinkId: 'sink-1',
        events: expect.arrayContaining(['task.created', 'task.done', 'task.reopened']),
      }),
    )
  })

  it('有効/無効トグルでstatusを送る', async () => {
    render(<SinkDetailPanel orgId="org-1" sink={sink({ status: 'active' })} viewerRole="owner" />)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '無効にする' }))
    })
    expect(updateSinkMutateAsyncMock).toHaveBeenCalledWith(
      expect.objectContaining({ sinkId: 'sink-1', status: 'disabled' }),
    )
  })

  it('status=errorはエラーバナーと再有効化ボタンを表示する', async () => {
    render(<SinkDetailPanel orgId="org-1" sink={sink({ status: 'error', consecutiveFailures: 20 })} viewerRole="owner" />)
    expect(screen.getByText(/配達エラーが続いています/)).toBeInTheDocument()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '再度有効化' }))
    })
    expect(updateSinkMutateAsyncMock).toHaveBeenCalledWith(
      expect.objectContaining({ sinkId: 'sink-1', status: 'active' }),
    )
  })

  it('secretローテーションは確認後に呼ばれ、返り値のsecretを表示する', async () => {
    updateSinkMutateAsyncMock.mockResolvedValue({ sink: sink(), secret: 'whsec_rotated' })
    render(<SinkDetailPanel orgId="org-1" sink={sink()} viewerRole="owner" />)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /secretを再生成/ }))
    })

    expect(confirmMock).toHaveBeenCalled()
    expect(updateSinkMutateAsyncMock).toHaveBeenCalledWith(
      expect.objectContaining({ sinkId: 'sink-1', rotateSecret: true }),
    )
    expect(screen.getByText('whsec_rotated')).toBeInTheDocument()
  })

  it('確認をキャンセルすればsecretローテーションを呼ばない', async () => {
    confirmMock.mockResolvedValue(false)
    render(<SinkDetailPanel orgId="org-1" sink={sink()} viewerRole="owner" />)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /secretを再生成/ }))
    })

    expect(updateSinkMutateAsyncMock).not.toHaveBeenCalled()
  })

  it('テスト配達ボタンで成功結果を表示する(outcome:"sent")', async () => {
    testSinkMutateAsyncMock.mockResolvedValue({ deliveryId: 'd-1', outcome: 'sent', responseStatus: 200 })
    render(<SinkDetailPanel orgId="org-1" sink={sink()} viewerRole="owner" />)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'テスト配達' }))
    })

    expect(testSinkMutateAsyncMock).toHaveBeenCalledWith('sink-1')
    expect(screen.getByText(/200/)).toBeInTheDocument()
  })

  it('テスト配達ボタンで失敗結果とエラー文言を表示する(outcome:"failed")', async () => {
    testSinkMutateAsyncMock.mockResolvedValue({
      deliveryId: null,
      outcome: 'failed',
      responseStatus: 401,
      error: 'unauthorized',
    })
    render(<SinkDetailPanel orgId="org-1" sink={sink()} viewerRole="owner" />)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'テスト配達' }))
    })

    const message = screen.getByText(/テスト配達に失敗しました/)
    expect(message).toHaveTextContent('unauthorized')
    expect(message).toHaveClass('text-red-600')
  })

  it('member(owner/adminでない)は編集不可（inputはdisabled、操作系ボタンなし）', () => {
    render(<SinkDetailPanel orgId="org-1" sink={sink()} viewerRole="member" />)
    expect(screen.getByLabelText('表示名')).toBeDisabled()
    expect(screen.queryByRole('button', { name: '無効にする' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /secretを再生成/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'テスト配達' })).not.toBeInTheDocument()
  })

  describe('provider=notion', () => {
    function notionSink(overrides: Partial<SinkMeta> = {}): SinkMeta {
      return sink({
        provider: 'notion',
        config: { database_id: '12345678-1234-1234-1234-123456789012' },
        connectionId: 'conn-1',
        ...overrides,
      })
    }

    it('URL欄の代わりにデータベースID欄を表示し、secret再生成ボタンは出さない', () => {
      render(<SinkDetailPanel orgId="org-1" sink={notionSink()} viewerRole="owner" />)
      expect(screen.queryByLabelText('URL')).not.toBeInTheDocument()
      expect(screen.getByLabelText('データベースID')).toHaveValue('12345678-1234-1234-1234-123456789012')
      expect(screen.queryByRole('button', { name: /secretを再生成/ })).not.toBeInTheDocument()
    })

    it('データベースIDをblurすると変更があればconfigを更新する', async () => {
      render(<SinkDetailPanel orgId="org-1" sink={notionSink()} viewerRole="owner" />)
      const input = screen.getByLabelText('データベースID')
      fireEvent.change(input, { target: { value: '87654321-4321-4321-4321-210987654321' } })
      await act(async () => {
        fireEvent.blur(input)
      })
      expect(updateSinkMutateAsyncMock).toHaveBeenCalledWith(
        expect.objectContaining({
          orgId: 'org-1',
          sinkId: 'sink-1',
          config: { database_id: '87654321-4321-4321-4321-210987654321' },
        }),
      )
    })

    it('接続中のワークスペース名を表示する', () => {
      render(
        <SinkDetailPanel
          orgId="org-1"
          sink={notionSink()}
          viewerRole="owner"
          notionConnection={{ connected: true, workspaceName: 'Acme Workspace' }}
        />,
      )
      expect(screen.getByText(/Acme Workspace/)).toBeInTheDocument()
    })

    it('テスト配達ボタンは引き続き表示される', () => {
      render(<SinkDetailPanel orgId="org-1" sink={notionSink()} viewerRole="owner" />)
      expect(screen.getByRole('button', { name: 'テスト配達' })).toBeInTheDocument()
    })
  })

  describe('provider=google_sheets', () => {
    function sheetsSink(overrides: Partial<SinkMeta> = {}): SinkMeta {
      return sink({
        provider: 'google_sheets',
        config: { spreadsheet_id: '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms', sheet_name: 'タスク' },
        connectionId: 'conn-gs-1',
        ...overrides,
      })
    }

    it('URL欄の代わりにスプレッドシートID/シート名欄を表示し、secret再生成ボタンは出さない', () => {
      render(<SinkDetailPanel orgId="org-1" sink={sheetsSink()} viewerRole="owner" />)
      expect(screen.queryByLabelText('URL')).not.toBeInTheDocument()
      expect(screen.getByLabelText('スプレッドシートID')).toHaveValue(
        '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms',
      )
      expect(screen.getByLabelText('シート名')).toHaveValue('タスク')
      expect(screen.queryByRole('button', { name: /secretを再生成/ })).not.toBeInTheDocument()
    })

    it('スプレッドシートIDをblurすると変更があればconfigを更新する（シート名は現在値のまま送る）', async () => {
      render(<SinkDetailPanel orgId="org-1" sink={sheetsSink()} viewerRole="owner" />)
      const input = screen.getByLabelText('スプレッドシートID')
      fireEvent.change(input, { target: { value: 'differentSpreadsheetId0000000000000' } })
      await act(async () => {
        fireEvent.blur(input)
      })
      expect(updateSinkMutateAsyncMock).toHaveBeenCalledWith(
        expect.objectContaining({
          orgId: 'org-1',
          sinkId: 'sink-1',
          config: { spreadsheet_id: 'differentSpreadsheetId0000000000000', sheet_name: 'タスク' },
        }),
      )
    })

    it('シート名をblurすると変更があればconfigを更新する（スプレッドシートIDは現在値のまま送る）', async () => {
      render(<SinkDetailPanel orgId="org-1" sink={sheetsSink()} viewerRole="owner" />)
      const input = screen.getByLabelText('シート名')
      fireEvent.change(input, { target: { value: '新しいシート' } })
      await act(async () => {
        fireEvent.blur(input)
      })
      expect(updateSinkMutateAsyncMock).toHaveBeenCalledWith(
        expect.objectContaining({
          orgId: 'org-1',
          sinkId: 'sink-1',
          config: {
            spreadsheet_id: '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms',
            sheet_name: '新しいシート',
          },
        }),
      )
    })

    it('接続状態を表示する', () => {
      render(
        <SinkDetailPanel
          orgId="org-1"
          sink={sheetsSink()}
          viewerRole="owner"
          googleSheetsConnection={{ connected: true }}
        />,
      )
      expect(screen.getByText(/接続中/)).toBeInTheDocument()
    })

    it('テスト配達ボタンは引き続き表示される', () => {
      render(<SinkDetailPanel orgId="org-1" sink={sheetsSink()} viewerRole="owner" />)
      expect(screen.getByRole('button', { name: 'テスト配達' })).toBeInTheDocument()
    })

    it('行append方式による重複行の注記を表示する', () => {
      render(<SinkDetailPanel orgId="org-1" sink={sheetsSink()} viewerRole="owner" />)
      expect(screen.getByText(/重複行が入ることがあります/)).toBeInTheDocument()
    })
  })
})
