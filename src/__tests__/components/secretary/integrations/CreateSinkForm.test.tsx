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

const { mutateAsyncMock, createNotionMutateAsyncMock, createGoogleSheetsMutateAsyncMock, toastErrorMock } =
  vi.hoisted(() => ({
    mutateAsyncMock: vi.fn(),
    createNotionMutateAsyncMock: vi.fn(),
    createGoogleSheetsMutateAsyncMock: vi.fn(),
    toastErrorMock: vi.fn(),
  }))

vi.mock('@/lib/hooks/useSinks', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/hooks/useSinks')>()
  return {
    ...actual,
    useCreateSink: () => ({ mutateAsync: mutateAsyncMock, isPending: false }),
    useCreateNotionSink: () => ({ mutateAsync: createNotionMutateAsyncMock, isPending: false }),
    useCreateGoogleSheetsSink: () => ({ mutateAsync: createGoogleSheetsMutateAsyncMock, isPending: false }),
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

  describe('lockedProvider（ToolRail経由でproviderが確定している場合）', () => {
    it('lockedProvider未指定なら従来通りラジオが表示される(後方互換)', () => {
      render(<CreateSinkForm orgId="org-1" onCreated={vi.fn()} onCancel={vi.fn()} />)
      expect(screen.getByRole('radiogroup', { name: '連携先の種類' })).toBeInTheDocument()
    })

    it('lockedProvider指定時はラジオを表示しない', () => {
      render(<CreateSinkForm orgId="org-1" onCreated={vi.fn()} onCancel={vi.fn()} lockedProvider="notion" />)
      expect(screen.queryByRole('radiogroup', { name: '連携先の種類' })).not.toBeInTheDocument()
    })

    it('lockedProvider="notion"指定時はNotion用フィールドが最初から表示される', () => {
      render(
        <CreateSinkForm
          orgId="org-1"
          onCreated={vi.fn()}
          onCancel={vi.fn()}
          lockedProvider="notion"
          notionConnection={{ connected: true, workspaceName: 'Acme Workspace' }}
        />,
      )
      expect(screen.getByLabelText('データベースID')).toBeInTheDocument()
      expect(screen.queryByLabelText('URL')).not.toBeInTheDocument()
    })

    it('lockedProvider="webhook"指定時に送信するとuseCreateSinkが呼ばれる', async () => {
      mutateAsyncMock.mockResolvedValue({ sink: SINK, secret: 'whsec_new1' })
      const onCreated = vi.fn()
      render(
        <CreateSinkForm orgId="org-1" onCreated={onCreated} onCancel={vi.fn()} lockedProvider="webhook" />,
      )
      fireEvent.change(screen.getByLabelText('表示名'), { target: { value: '自社Webhook' } })
      fireEvent.change(screen.getByLabelText('URL'), { target: { value: 'https://example.com/hook' } })

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: '作成' }))
      })

      expect(mutateAsyncMock).toHaveBeenCalledWith(expect.objectContaining({ orgId: 'org-1' }))
      await waitFor(() => expect(onCreated).toHaveBeenCalledWith(SINK, 'whsec_new1'))
    })

    it('lockedProvider="google_sheets"指定時はGoogle Sheets用フィールドが最初から表示される', () => {
      render(
        <CreateSinkForm
          orgId="org-1"
          onCreated={vi.fn()}
          onCancel={vi.fn()}
          lockedProvider="google_sheets"
          googleSheetsConnection={{ connected: true }}
        />,
      )
      expect(screen.getByLabelText('スプレッドシートID')).toBeInTheDocument()
      expect(screen.getByLabelText('シート名')).toBeInTheDocument()
      expect(screen.queryByLabelText('URL')).not.toBeInTheDocument()
    })
  })

  describe('provider=notion', () => {
    it('Notionを選択するとURL欄が消えデータベースID欄が表示される', () => {
      render(
        <CreateSinkForm
          orgId="org-1"
          onCreated={vi.fn()}
          onCancel={vi.fn()}
          notionConnection={{ connected: true, workspaceName: 'Acme Workspace' }}
        />,
      )
      fireEvent.click(screen.getByLabelText('Notion'))
      expect(screen.queryByLabelText('URL')).not.toBeInTheDocument()
      expect(screen.getByLabelText('データベースID')).toBeInTheDocument()
    })

    it('未接続なら作成ボタンが無効で接続導線を表示する', () => {
      render(
        <CreateSinkForm
          orgId="org-1"
          onCreated={vi.fn()}
          onCancel={vi.fn()}
          notionConnection={{ connected: false, workspaceName: null }}
        />,
      )
      fireEvent.click(screen.getByLabelText('Notion'))
      fireEvent.change(screen.getByLabelText('表示名'), { target: { value: 'Notion連携' } })
      fireEvent.change(screen.getByLabelText('データベースID'), {
        target: { value: '12345678-1234-1234-1234-123456789012' },
      })
      expect(screen.getByRole('button', { name: '作成' })).toBeDisabled()
      expect(screen.getByRole('link', { name: /Notion に接続/ })).toHaveAttribute(
        'href',
        '/api/integrations/auth/notion?orgId=org-1',
      )
    })

    it('接続済みならdatabaseIdを入力して送信するとuseCreateNotionSinkが呼ばれる', async () => {
      createNotionMutateAsyncMock.mockResolvedValue({
        sink: { ...SINK, id: 'sink-2', provider: 'notion', config: { database_id: 'db-1' } },
      })
      const onCreated = vi.fn()
      render(
        <CreateSinkForm
          orgId="org-1"
          onCreated={onCreated}
          onCancel={vi.fn()}
          notionConnection={{ connected: true, workspaceName: 'Acme Workspace' }}
        />,
      )
      fireEvent.click(screen.getByLabelText('Notion'))
      fireEvent.change(screen.getByLabelText('表示名'), { target: { value: 'Notion連携' } })
      fireEvent.change(screen.getByLabelText('データベースID'), {
        target: { value: '12345678-1234-1234-1234-123456789012' },
      })

      const submit = screen.getByRole('button', { name: '作成' })
      expect(submit).not.toBeDisabled()

      await act(async () => {
        fireEvent.click(submit)
      })

      expect(createNotionMutateAsyncMock).toHaveBeenCalledWith(
        expect.objectContaining({
          orgId: 'org-1',
          displayName: 'Notion連携',
          databaseId: '12345678-1234-1234-1234-123456789012',
        }),
      )
      // notionはsecretを持たないためonCreatedはsecret引数なしで呼ばれる
      await waitFor(() => expect(onCreated).toHaveBeenCalled())
      expect(onCreated.mock.calls[0][0]).toEqual(expect.objectContaining({ id: 'sink-2', provider: 'notion' }))
      expect(onCreated.mock.calls[0]).toHaveLength(1)
    })
  })

  describe('provider=google_sheets', () => {
    it('Google Sheetsを選択するとURL欄が消えスプレッドシートID/シート名欄が表示される', () => {
      render(
        <CreateSinkForm
          orgId="org-1"
          onCreated={vi.fn()}
          onCancel={vi.fn()}
          googleSheetsConnection={{ connected: true }}
        />,
      )
      fireEvent.click(screen.getByLabelText('Google Sheets'))
      expect(screen.queryByLabelText('URL')).not.toBeInTheDocument()
      expect(screen.getByLabelText('スプレッドシートID')).toBeInTheDocument()
      expect(screen.getByLabelText('シート名')).toBeInTheDocument()
    })

    it('未接続なら作成ボタンが無効で接続導線を表示する', () => {
      render(
        <CreateSinkForm
          orgId="org-1"
          onCreated={vi.fn()}
          onCancel={vi.fn()}
          googleSheetsConnection={{ connected: false }}
        />,
      )
      fireEvent.click(screen.getByLabelText('Google Sheets'))
      fireEvent.change(screen.getByLabelText('表示名'), { target: { value: 'Sheets連携' } })
      fireEvent.change(screen.getByLabelText('スプレッドシートID'), {
        target: { value: '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms' },
      })
      fireEvent.change(screen.getByLabelText('シート名'), { target: { value: 'タスク' } })
      expect(screen.getByRole('button', { name: '作成' })).toBeDisabled()
      expect(screen.getByRole('link', { name: /Google Sheets に接続/ })).toHaveAttribute(
        'href',
        '/api/integrations/auth/google_sheets?orgId=org-1',
      )
    })

    it('接続済みならID/シート名を入力して送信するとuseCreateGoogleSheetsSinkが呼ばれる', async () => {
      createGoogleSheetsMutateAsyncMock.mockResolvedValue({
        sink: {
          ...SINK,
          id: 'sink-3',
          provider: 'google_sheets',
          config: { spreadsheet_id: 'sheet-abc', sheet_name: 'タスク' },
        },
      })
      const onCreated = vi.fn()
      render(
        <CreateSinkForm
          orgId="org-1"
          onCreated={onCreated}
          onCancel={vi.fn()}
          googleSheetsConnection={{ connected: true }}
        />,
      )
      fireEvent.click(screen.getByLabelText('Google Sheets'))
      fireEvent.change(screen.getByLabelText('表示名'), { target: { value: 'Sheets連携' } })
      fireEvent.change(screen.getByLabelText('スプレッドシートID'), { target: { value: 'sheet-abc' } })
      fireEvent.change(screen.getByLabelText('シート名'), { target: { value: 'タスク' } })

      const submit = screen.getByRole('button', { name: '作成' })
      expect(submit).not.toBeDisabled()

      await act(async () => {
        fireEvent.click(submit)
      })

      expect(createGoogleSheetsMutateAsyncMock).toHaveBeenCalledWith(
        expect.objectContaining({
          orgId: 'org-1',
          displayName: 'Sheets連携',
          spreadsheetId: 'sheet-abc',
          sheetName: 'タスク',
        }),
      )
      await waitFor(() => expect(onCreated).toHaveBeenCalled())
      expect(onCreated.mock.calls[0][0]).toEqual(expect.objectContaining({ id: 'sink-3', provider: 'google_sheets' }))
      expect(onCreated.mock.calls[0]).toHaveLength(1)
    })
  })
})
