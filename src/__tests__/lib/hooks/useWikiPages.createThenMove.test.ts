import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useWikiPages } from '@/lib/hooks/useWikiPages'
import type { WikiPage } from '@/types/database'

// 作った直後（保存が終わる前）のフォルダをドラッグすると、移動が黙って消えていた。
// 画面に出ている仮の行は、保存の結果が返ると別の id の行に差し替わり、その間に
// 仮の行へ入れた変更（親フォルダ）が上書きされていた。
//   - 仮の行と保存する行の id を同じにする（差し替えで id が変わらない）
//   - 保存が終わる前の行（や、その行を親にする移動）の更新は、保存を待ってから送る
//   - 保存の結果で、あとから入れた変更を上書きしない

const mockGetUser = vi.fn(async () => ({ data: { user: { id: 'user-1' } }, error: null }))

const mockSelect = vi.fn()
const mockSelectEq1 = vi.fn()
const mockSelectEq2 = vi.fn()
const mockSelectOrder = vi.fn()

const mockInsert = vi.fn()
const mockInsertSelect = vi.fn()
const mockInsertSingle = vi.fn()

const mockUpdate = vi.fn()
const mockUpdateEq1 = vi.fn()
const mockUpdateEq2 = vi.fn()
const mockUpdateSelect = vi.fn()

const mockFrom = vi.fn((table: string) => {
  if (table !== 'wiki_pages') throw new Error(`unexpected table: ${table}`)
  return { select: mockSelect, insert: mockInsert, update: mockUpdate }
})

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    from: mockFrom,
    auth: {
      getUser: mockGetUser,
      getSession: async () => ({ data: { session: { user: { id: 'user-1' } } }, error: null }),
    },
  }),
}))

function makePageRow(overrides: Partial<WikiPage> = {}): WikiPage {
  return {
    id: 'existing-1',
    org_id: 'org1',
    space_id: 'space1',
    title: '既存のページ',
    body: '',
    tags: [],
    parent_page_id: null,
    milestone_id: null,
    pinned_at: null,
    sort_order: null,
    is_folder: false,
    created_by: 'user-1',
    updated_by: 'user-1',
    created_at: '2026-09-01T00:00:00+09:00',
    updated_at: '2026-09-01T00:00:00+09:00',
    ...overrides,
  }
}

function createWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children)
  }
}

/** insert の結果を手で返せるようにする（保存が終わる前の状態を作るため） */
function holdInsert() {
  let release: () => void = () => {}
  mockInsertSingle.mockImplementation(() => {
    const row = mockInsert.mock.calls.at(-1)?.[0] as Partial<WikiPage>
    return new Promise(resolve => {
      release = () =>
        resolve({
          data: makePageRow({
            ...row,
            id: row.id ?? 'server-generated-id',
            created_at: '2026-09-29T10:00:00+09:00',
            updated_at: '2026-09-29T10:00:00+09:00',
          }),
          error: null,
        })
    })
  })
  return { release: () => release() }
}

async function renderWikiPages() {
  const hook = renderHook(() => useWikiPages({ orgId: 'org1', spaceId: 'space1' }), {
    wrapper: createWrapper(),
  })
  await waitFor(() => expect(hook.result.current.loading).toBe(false))
  await waitFor(() => expect(hook.result.current.pages).toHaveLength(1))
  return hook
}

describe('useWikiPages: 作った直後のページを動かす', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })

    mockSelect.mockReturnValue({ eq: mockSelectEq1 })
    mockSelectEq1.mockReturnValue({ eq: mockSelectEq2 })
    mockSelectEq2.mockReturnValue({ order: mockSelectOrder })
    mockSelectOrder.mockResolvedValue({ data: [makePageRow()], error: null })

    mockInsert.mockReturnValue({ select: mockInsertSelect })
    mockInsertSelect.mockReturnValue({ single: mockInsertSingle })

    mockUpdate.mockReturnValue({ eq: mockUpdateEq1 })
    mockUpdateEq1.mockReturnValue({ eq: mockUpdateEq2 })
    mockUpdateEq2.mockReturnValue({ select: mockUpdateSelect })
    mockUpdateSelect.mockImplementation(async () => ({
      data: [{ id: 'x', updated_at: '2026-09-29T10:00:01+09:00' }],
      error: null,
    }))
  })

  it('画面に出す仮の行と、保存する行の id が同じ', async () => {
    const { result } = await renderWikiPages()
    const insert = holdInsert()

    let createPromise: Promise<WikiPage> = Promise.resolve(makePageRow())
    act(() => {
      createPromise = result.current.createPage({ title: '新しいフォルダ', isFolder: true })
    })
    await waitFor(() => expect(mockInsert).toHaveBeenCalledTimes(1))

    const shownId = result.current.pages.find(p => p.title === '新しいフォルダ')?.id
    expect(shownId).toBeTruthy()
    expect(mockInsert.mock.calls[0][0]).toMatchObject({ id: shownId })

    await act(async () => {
      insert.release()
      await createPromise
    })
    expect(result.current.pages.find(p => p.title === '新しいフォルダ')?.id).toBe(shownId)
  })

  it('保存が終わる前に動かしたページは、保存を待ってから移動を送り、移動は消えない', async () => {
    const { result } = await renderWikiPages()
    const insert = holdInsert()

    let createPromise: Promise<WikiPage> = Promise.resolve(makePageRow())
    act(() => {
      createPromise = result.current.createPage({ title: '新しいフォルダ', isFolder: true })
    })
    await waitFor(() => expect(mockInsert).toHaveBeenCalledTimes(1))
    const newId = result.current.pages.find(p => p.title === '新しいフォルダ')!.id

    let movePromise: Promise<unknown> = Promise.resolve()
    act(() => {
      movePromise = result.current.updatePage(newId, { parent_page_id: 'existing-1' })
    })
    // 画面ではすぐ動く
    await waitFor(() =>
      expect(result.current.pages.find(p => p.id === newId)?.parent_page_id).toBe('existing-1')
    )
    // まだ保存されていない行への更新は送らない（送っても0行で空振りする）
    await new Promise(r => setTimeout(r, 20))
    expect(mockUpdate).not.toHaveBeenCalled()

    await act(async () => {
      insert.release()
      await createPromise
      await movePromise
    })

    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ parent_page_id: 'existing-1' }))
    expect(mockUpdateEq1).toHaveBeenCalledWith('id', newId)
    // 保存の結果で上書きされず、移動したまま
    expect(result.current.pages.find(p => p.id === newId)?.parent_page_id).toBe('existing-1')
  })

  it('保存が終わる前のフォルダの中へ動かすときも、フォルダの保存を待ってから送る', async () => {
    const { result } = await renderWikiPages()
    const insert = holdInsert()

    let createPromise: Promise<WikiPage> = Promise.resolve(makePageRow())
    act(() => {
      createPromise = result.current.createPage({ title: '新しいフォルダ', isFolder: true })
    })
    await waitFor(() => expect(mockInsert).toHaveBeenCalledTimes(1))
    const folderId = result.current.pages.find(p => p.title === '新しいフォルダ')!.id

    let movePromise: Promise<unknown> = Promise.resolve()
    act(() => {
      movePromise = result.current.updatePage('existing-1', { parent_page_id: folderId })
    })
    await new Promise(r => setTimeout(r, 20))
    // 親がまだ DB に無いうちに送ると、外部キーで弾かれる
    expect(mockUpdate).not.toHaveBeenCalled()

    await act(async () => {
      insert.release()
      await createPromise
      await movePromise
    })

    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ parent_page_id: folderId }))
    expect(result.current.pages.find(p => p.id === 'existing-1')?.parent_page_id).toBe(folderId)
  })

  it('作成に失敗したら、待っていた移動も失敗にし、消えたページを生き返らせない', async () => {
    const { result } = await renderWikiPages()
    let fail: () => void = () => {}
    mockInsertSingle.mockImplementation(
      () => new Promise(resolve => { fail = () => resolve({ data: null, error: new Error('insert failed') }) })
    )

    let createPromise: Promise<unknown> = Promise.resolve()
    act(() => {
      createPromise = result.current.createPage({ title: '新しいフォルダ', isFolder: true }).catch(() => 'create-failed')
    })
    await waitFor(() => expect(mockInsert).toHaveBeenCalledTimes(1))
    const newId = result.current.pages.find(p => p.title === '新しいフォルダ')!.id

    let movePromise: Promise<unknown> = Promise.resolve()
    act(() => {
      movePromise = result.current.updatePage(newId, { parent_page_id: 'existing-1' }).catch(() => 'move-failed')
    })

    await act(async () => {
      fail()
      expect(await createPromise).toBe('create-failed')
      expect(await movePromise).toBe('move-failed')
    })

    expect(mockUpdate).not.toHaveBeenCalled()
    await waitFor(() => expect(result.current.pages.find(p => p.id === newId)).toBeUndefined())
  })

  it('移動先のフォルダの作成に失敗したら、まとめての移動も戻し、消えたフォルダを生き返らせない', async () => {
    const { result } = await renderWikiPages()
    let fail: () => void = () => {}
    mockInsertSingle.mockImplementation(
      () => new Promise(resolve => { fail = () => resolve({ data: null, error: new Error('insert failed') }) })
    )

    let createPromise: Promise<unknown> = Promise.resolve()
    act(() => {
      createPromise = result.current.createPage({ title: '新しいフォルダ', isFolder: true }).catch(() => 'create-failed')
    })
    await waitFor(() => expect(mockInsert).toHaveBeenCalledTimes(1))
    const folderId = result.current.pages.find(p => p.title === '新しいフォルダ')!.id

    let movePromise: Promise<unknown> = Promise.resolve()
    act(() => {
      movePromise = result.current.reparentPages(['existing-1'], folderId).catch(() => 'move-failed')
    })

    await act(async () => {
      fail()
      await createPromise
      expect(await movePromise).toBe('move-failed')
    })

    expect(mockUpdate).not.toHaveBeenCalled()
    await waitFor(() => {
      expect(result.current.pages.find(p => p.id === folderId)).toBeUndefined()
      expect(result.current.pages.find(p => p.id === 'existing-1')?.parent_page_id).toBeNull()
    })
  })
})
