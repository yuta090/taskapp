import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MilestonesSettings } from '@/app/(internal)/[orgId]/project/[spaceId]/settings/MilestonesSettings'

// マイルストーンの作成・編集・削除は milestones の RLS（app_can_write_space と同じ規則）。
// 閲覧者・役割が未確定の間は操作できないようにする。

let mockRows: Array<{
  id: string
  name: string
  start_date: string | null
  due_date: string | null
  completed_at: string | null
  order_key: number
}> = []

const insertMock = vi.fn()
const updateMock = vi.fn()
const deleteMock = vi.fn()

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          order: () => Promise.resolve({ data: mockRows, error: null }),
        }),
      }),
      insert: (payload: unknown) => {
        insertMock(payload)
        return Promise.resolve({ error: null })
      },
      update: (payload: unknown) => {
        updateMock(payload)
        return { eq: () => Promise.resolve({ error: null }) }
      },
      delete: () => {
        deleteMock()
        return { eq: () => Promise.resolve({ error: null }) }
      },
    }),
  }),
}))

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

let mockCanEdit = true
vi.mock('@/lib/hooks/useCanEditSpace', () => ({
  useCanEditSpace: () => ({ canEdit: mockCanEdit, canEditMoney: false, resolved: true, loading: false }),
}))

function renderSettings() {
  return render(<MilestonesSettings orgId="o1" spaceId="s1" />)
}

beforeEach(() => {
  mockRows = [
    { id: 'm1', name: '既存マイルストーン', start_date: null, due_date: null, completed_at: null, order_key: 0 },
  ]
  insertMock.mockClear()
  updateMock.mockClear()
  deleteMock.mockClear()
  mockCanEdit = true
})

describe('MilestonesSettings — 編集できる人には従来どおり操作できる', () => {
  it('新規マイルストーンを追加できる', async () => {
    renderSettings()
    await screen.findByText('既存マイルストーン')

    fireEvent.change(screen.getByPlaceholderText('マイルストーン名'), { target: { value: '新規MS' } })
    fireEvent.click(screen.getByRole('button', { name: /追加/ }))

    await waitFor(() => expect(insertMock).toHaveBeenCalled())
  })
})

describe('MilestonesSettings — 閲覧者・役割未確定には操作させない', () => {
  it('「追加」ボタンが disabled になる（名前を入力していても）', async () => {
    mockCanEdit = false
    renderSettings()
    await screen.findByText('既存マイルストーン')
    fireEvent.change(screen.getByPlaceholderText('マイルストーン名'), { target: { value: '新規MS' } })

    expect(screen.getByRole('button', { name: /追加/ })).toBeDisabled()
  })

  it('既存行の編集・削除ボタンが disabled になる', async () => {
    mockCanEdit = false
    renderSettings()
    await screen.findByText('既存マイルストーン')

    expect(screen.getByRole('button', { name: '編集' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '削除' })).toBeDisabled()
  })

  it('追加ボタンを押しても作成しない', async () => {
    mockCanEdit = false
    renderSettings()
    await screen.findByText('既存マイルストーン')

    fireEvent.change(screen.getByPlaceholderText('マイルストーン名'), { target: { value: '新規MS' } })
    fireEvent.click(screen.getByRole('button', { name: /追加/ }))

    expect(insertMock).not.toHaveBeenCalled()
  })
})
