import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { GeneralSettings } from '@/app/(internal)/[orgId]/project/[spaceId]/settings/GeneralSettings'

const update = vi.fn()

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

// 名前の取得はキャッシュ（['spaceName', spaceId]）から。取得経路はここでは検証しない
vi.mock('@/lib/hooks/useSpaceName', async () => {
  const { useQueryClient } = await import('@tanstack/react-query')
  return {
    useSpaceName: (spaceId: string) => {
      const qc = useQueryClient()
      return (qc.getQueryData(['spaceName', spaceId]) as string) ?? ''
    },
  }
})

function renderWithClient() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  queryClient.setQueryData(['spaceName', 's1'], '旧プロジェクト名')
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <GeneralSettings spaceId="s1" />
    </QueryClientProvider>
  )
  return { ...utils, queryClient }
}

beforeEach(() => {
  update.mockReset()
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
      expect(queryClient.getQueryData(['spaceName', 's1'])).toBe('新プロジェクト名')
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
