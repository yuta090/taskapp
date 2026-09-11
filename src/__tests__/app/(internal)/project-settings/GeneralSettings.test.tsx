import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { GeneralSettings } from '@/app/(internal)/[orgId]/project/[spaceId]/settings/GeneralSettings'

const update = vi.fn()

// 既定は「編集できる」(admin/editor)。閲覧者(viewer)・未確定の挙動は下の describe で
// canEdit:false を明示して検証する。
let mockCanEdit = true
vi.mock('@/lib/hooks/useCanEditSpace', () => ({
  useCanEditSpace: () => ({ canEdit: mockCanEdit, canEditMoney: false, resolved: true, loading: false }),
}))

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    from: vi.fn(() => ({
      update: (values: { name: string }) => {
        update(values)
        return { eq: vi.fn().mockResolvedValue({ error: null }) }
      },
    })),
  }),
}))

// 名前の取得はプロジェクト1行のキャッシュ（['space', spaceId]）から。取得経路はここでは検証しない
vi.mock('@/lib/hooks/useSpaceName', async () => {
  const { useQueryClient } = await import('@tanstack/react-query')
  return {
    useSpaceName: (spaceId: string) => {
      const qc = useQueryClient()
      return (qc.getQueryData(['space', spaceId]) as { name?: string } | undefined)?.name ?? ''
    },
  }
})

function renderWithClient() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  queryClient.setQueryData(['space', 's1'], { id: 's1', name: '旧プロジェクト名' })
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <GeneralSettings orgId="o1" spaceId="s1" />
    </QueryClientProvider>
  )
  return { ...utils, queryClient }
}

beforeEach(() => {
  update.mockReset()
  mockCanEdit = true
})

describe('GeneralSettings — プロジェクト名', () => {
  it('いま登録されている名前を出す', () => {
    renderWithClient()
    expect(screen.getByText('旧プロジェクト名')).toBeInTheDocument()
  })

  it('名前を変えたら、他の画面が見ている名前も同時に変わる', async () => {
    // 危険設定のアーカイブ確認は同じ名前を要求するので、ここがずれると古い名前でしか実行できなくなる
    const { queryClient } = renderWithClient()

    fireEvent.click(screen.getByTitle('編集'))
    fireEvent.change(screen.getByPlaceholderText('プロジェクト名'), {
      target: { value: '新プロジェクト名' },
    })
    fireEvent.click(screen.getByTitle('保存'))

    await waitFor(() => expect(update).toHaveBeenCalledWith({ name: '新プロジェクト名' }))
    await waitFor(() =>
      expect(
        (queryClient.getQueryData(['space', 's1']) as { name: string }).name
      ).toBe('新プロジェクト名')
    )
    expect(screen.getByText('新プロジェクト名')).toBeInTheDocument()
  })

  it('空の名前では保存しない', async () => {
    renderWithClient()

    fireEvent.click(screen.getByTitle('編集'))
    fireEvent.change(screen.getByPlaceholderText('プロジェクト名'), { target: { value: '  ' } })
    fireEvent.click(screen.getByTitle('保存'))

    await waitFor(() =>
      expect(screen.getByText('プロジェクト名を入力してください')).toBeInTheDocument()
    )
    expect(update).not.toHaveBeenCalled()
  })
})

// プロジェクト名の更新は spaces の更新（RLS: app_can_write_space）と同じ規則。
// 閲覧者・役割が未確定の間は編集の入口（鉛筆アイコン）を押せなくする。
describe('GeneralSettings — 編集できない人（閲覧者・役割未確定）には編集させない', () => {
  it('閲覧者では「編集」ボタンが disabled になる', () => {
    mockCanEdit = false
    renderWithClient()
    expect(screen.getByTitle('編集')).toBeDisabled()
  })

  it('「編集」ボタンを押しても入力欄は開かない（値は見える）', () => {
    mockCanEdit = false
    renderWithClient()
    fireEvent.click(screen.getByTitle('編集'))
    expect(screen.queryByPlaceholderText('プロジェクト名')).not.toBeInTheDocument()
    expect(screen.getByText('旧プロジェクト名')).toBeInTheDocument()
  })
})
