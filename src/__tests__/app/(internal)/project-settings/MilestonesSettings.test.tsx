import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { MilestonesSettings } from '@/app/(internal)/[orgId]/project/[spaceId]/settings/MilestonesSettings'

// マイルストーンの作成・編集・削除は milestones の RLS（app_can_write_space と同じ規則）。
// 閲覧者・役割が未確定の間は操作できないようにする。
//
// データの取得・更新は useMilestones（タスク一覧・ガント・バーンダウン等と同じキャッシュ
// ['milestones', spaceId] を使う react-query hook）に載せる。ここでは useMilestones を
// モックして「この画面が hook を正しく呼んでいるか」だけを見る（キャッシュ・永続化・
// 楽観更新そのものは useMilestones 側のテストで担保済み）。

let mockMilestones: Array<{
  id: string
  name: string
  start_date: string | null
  due_date: string | null
  completed_at: string | null
  order_key: number
}> = []
let mockLoading = false
let mockError: Error | null = null

const createMilestoneMock = vi.fn()
const updateMilestoneMock = vi.fn()
const deleteMilestoneMock = vi.fn()
const fetchMilestonesMock = vi.fn()

vi.mock('@/lib/hooks/useMilestones', () => ({
  useMilestones: () => ({
    milestones: mockMilestones,
    loading: mockLoading,
    error: mockError,
    fetchMilestones: fetchMilestonesMock,
    createMilestone: createMilestoneMock,
    updateMilestone: updateMilestoneMock,
    deleteMilestone: deleteMilestoneMock,
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
  mockMilestones = [
    { id: 'm1', name: '既存マイルストーン', start_date: null, due_date: null, completed_at: null, order_key: 0 },
  ]
  mockLoading = false
  mockError = null
  createMilestoneMock.mockClear().mockResolvedValue(undefined)
  updateMilestoneMock.mockClear().mockResolvedValue(undefined)
  deleteMilestoneMock.mockClear().mockResolvedValue(undefined)
  fetchMilestonesMock.mockClear()
  mockCanEdit = true
})

describe('MilestonesSettings — 前回データ（キャッシュ）をそのまま使う', () => {
  it('useMilestones が loading:false を返せば、待たずに一覧が出る（開くたびの「読み込み中」で止まらない）', () => {
    renderSettings()
    expect(screen.queryByText('読み込み中...')).not.toBeInTheDocument()
    expect(screen.getByText('既存マイルストーン')).toBeInTheDocument()
  })

  it('useMilestones が loading:true（まだ一度も取れていない）の間だけ「読み込み中」を出す', () => {
    mockLoading = true
    mockMilestones = []
    renderSettings()
    expect(screen.getByText('読み込み中...')).toBeInTheDocument()
  })

  it('取得に失敗したら理由を出す', () => {
    mockError = new Error('boom')
    renderSettings()
    expect(screen.getByText(/マイルストーンの取得に失敗しました/)).toBeInTheDocument()
    expect(screen.getByText(/boom/)).toBeInTheDocument()
  })
})

describe('MilestonesSettings — 編集できる人には従来どおり操作できる', () => {
  it('新規マイルストーンを追加できる（useMilestones.createMilestone を呼ぶ）', async () => {
    renderSettings()

    fireEvent.change(screen.getByPlaceholderText('マイルストーン名'), { target: { value: '新規MS' } })
    fireEvent.click(screen.getByRole('button', { name: /追加/ }))

    await waitFor(() =>
      expect(createMilestoneMock).toHaveBeenCalledWith({
        name: '新規MS',
        startDate: null,
        dueDate: null,
      })
    )
  })

  it('既存行を編集できる（useMilestones.updateMilestone を呼ぶ）', async () => {
    renderSettings()

    fireEvent.click(screen.getByRole('button', { name: /を編集/ }))
    const nameInput = screen.getByDisplayValue('既存マイルストーン')
    fireEvent.change(nameInput, { target: { value: '改名後' } })

    // 編集行の保存(Check)/キャンセル(X)ボタンはアイコンのみでアクセシブルな名前が無いため、
    // 行のコンテナに絞って先頭（保存）を取る
    const editRow = nameInput.closest('div')!.parentElement!
    fireEvent.click(within(editRow).getAllByRole('button')[0])

    await waitFor(() =>
      expect(updateMilestoneMock).toHaveBeenCalledWith('m1', {
        name: '改名後',
        startDate: null,
        dueDate: null,
      })
    )
  })

  it('既存行を削除できる（確認ダイアログで確定後に useMilestones.deleteMilestone を呼ぶ）', async () => {
    renderSettings()

    fireEvent.click(screen.getByRole('button', { name: /を削除/ }))
    fireEvent.click(await screen.findByRole('button', { name: '削除' }))

    await waitFor(() => expect(deleteMilestoneMock).toHaveBeenCalledWith('m1'))
  })
})

describe('MilestonesSettings — 閲覧者・役割未確定には操作させない', () => {
  it('「追加」ボタンが disabled になる（名前を入力していても）', () => {
    mockCanEdit = false
    renderSettings()
    fireEvent.change(screen.getByPlaceholderText('マイルストーン名'), { target: { value: '新規MS' } })

    expect(screen.getByRole('button', { name: /追加/ })).toBeDisabled()
  })

  it('既存行の編集・削除ボタンが disabled になる', () => {
    mockCanEdit = false
    renderSettings()

    expect(screen.getByRole('button', { name: /を編集/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: /を削除/ })).toBeDisabled()
  })

  it('追加ボタンを押しても作成しない', () => {
    mockCanEdit = false
    renderSettings()

    fireEvent.change(screen.getByPlaceholderText('マイルストーン名'), { target: { value: '新規MS' } })
    fireEvent.click(screen.getByRole('button', { name: /追加/ }))

    expect(createMilestoneMock).not.toHaveBeenCalled()
  })
})
