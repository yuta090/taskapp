import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { AppLinkPicker } from '@/components/editor/AppLinkPicker'

/**
 * Wiki と議事録の両方から使う「アプリの中の物へのリンク」を差し込むピッカー。
 * ファイル・Wikiページ・議事録・タスクを、同じ見た目・同じ操作で選べることを確かめる。
 */

const ORG_ID = 'org-1'
const SPACE_ID = 'space-1'

let mockFiles: { id: string; name: string; sizeBytes: number; clientVisible: boolean }[] = []
let mockWikiPages: { id: string; title: string; tags: string[] | null }[] = []
let mockMeetings: { id: string; title: string; held_at: string | null }[] = []
let mockTasks: { id: string; title: string; short_id: number | null; status: string }[] = []

vi.mock('@/lib/hooks/useFiles', () => ({
  useFiles: () => ({ data: mockFiles, isLoading: false }),
}))

vi.mock('@/lib/hooks/useWikiPages', () => ({
  useWikiPages: () => ({ pages: mockWikiPages, loading: false }),
}))

vi.mock('@/lib/hooks/useMeetings', () => ({
  useMeetings: () => ({ meetings: mockMeetings, loading: false }),
}))

vi.mock('@/lib/hooks/useTasks', () => ({
  useTasks: () => ({ tasks: mockTasks, loading: false }),
}))

const onSelect = vi.fn()

function renderPicker(props: Partial<React.ComponentProps<typeof AppLinkPicker>> = {}) {
  return render(
    <AppLinkPicker orgId={ORG_ID} spaceId={SPACE_ID} onSelect={onSelect} {...props} />
  )
}

/** 種別を切り替える */
function switchTo(kind: string) {
  fireEvent.click(screen.getByTestId(`app-link-picker-kind-${kind}`))
}

/** 最後に選ばれたリンク */
function lastLink() {
  return onSelect.mock.calls.at(-1)?.[0]
}

beforeEach(() => {
  onSelect.mockClear()
  mockFiles = [
    { id: 'f1', name: '要件定義.pdf', sizeBytes: 2048, clientVisible: true },
    { id: 'f2', name: '社内メモ.txt', sizeBytes: 100, clientVisible: false },
  ]
  mockWikiPages = [
    { id: 'w1', title: 'プロジェクトホーム', tags: ['ホーム'] },
    { id: 'w2', title: '画面仕様', tags: ['仕様書'] },
  ]
  mockMeetings = [
    { id: 'm1', title: 'キックオフ', held_at: '2026-01-15T10:00:00' },
    { id: 'm2', title: 'デザインレビュー', held_at: null },
  ]
  mockTasks = [
    { id: 't1', title: 'トップページを作る', short_id: 42, status: 'in_progress' },
    { id: 't2', title: '番号のないタスク', short_id: null, status: 'todo' },
  ]
})

describe('AppLinkPicker — 4種類のリンクを同じ操作で差し込める', () => {
  it('ファイル・Wikiページ・議事録・タスクの4つを選べる', () => {
    renderPicker()
    for (const kind of ['file', 'wiki', 'meeting', 'task']) {
      expect(screen.getByTestId(`app-link-picker-kind-${kind}`)).toBeInTheDocument()
    }
  })

  it('既定ではファイルを出す', () => {
    renderPicker()
    expect(screen.getByText('要件定義.pdf')).toBeInTheDocument()
  })

  it('ファイルを選ぶとダウンロードのリンクになる', () => {
    renderPicker()
    fireEvent.click(screen.getByText('要件定義.pdf'))
    expect(lastLink()).toEqual({ href: '/api/files/f1/download', label: '要件定義.pdf' })
  })

  it('社内のみのファイルを選ぶと、相手先には開けないと伝える', () => {
    renderPicker()
    expect(screen.queryByText(/相手先には開けません/)).not.toBeInTheDocument()
    fireEvent.click(screen.getByText('社内メモ.txt'))
    expect(screen.getByText(/相手先には開けません/)).toBeInTheDocument()
  })

  it('Wikiページを選ぶとそのページを開くリンクになる', () => {
    renderPicker()
    switchTo('wiki')
    fireEvent.click(screen.getByText('画面仕様'))
    expect(lastLink()).toEqual({
      href: `/${ORG_ID}/project/${SPACE_ID}/wiki?page=w2`,
      label: '画面仕様',
    })
  })

  it('議事録を選ぶとその会議を開くリンクになる', () => {
    renderPicker()
    switchTo('meeting')
    fireEvent.click(screen.getByText('キックオフ'))
    expect(lastLink()).toEqual({
      href: `/${ORG_ID}/project/${SPACE_ID}/meetings?meeting=m1`,
      label: 'キックオフ',
    })
  })

  it('タスクを選ぶとそのタスクを開くリンクになり、番号を頭に付ける', () => {
    renderPicker()
    switchTo('task')
    fireEvent.click(screen.getByText(/トップページを作る/))
    expect(lastLink()).toEqual({
      href: `/${ORG_ID}/project/${SPACE_ID}?task=t1`,
      label: 'TP-42 トップページを作る',
    })
  })

  it('番号のないタスクは名前だけにする', () => {
    renderPicker()
    switchTo('task')
    fireEvent.click(screen.getByText('番号のないタスク'))
    expect(lastLink()?.label).toBe('番号のないタスク')
  })

  it('打った言葉で絞り込む', () => {
    renderPicker()
    switchTo('wiki')
    fireEvent.change(screen.getByTestId('app-link-picker-input'), { target: { value: '仕様' } })
    expect(screen.getByText('画面仕様')).toBeInTheDocument()
    expect(screen.queryByText('プロジェクトホーム')).not.toBeInTheDocument()
  })

  it('種別を切り替えると打った言葉を消す（前の種別の言葉で空振りしない）', () => {
    renderPicker()
    fireEvent.change(screen.getByTestId('app-link-picker-input'), { target: { value: 'あああ' } })
    switchTo('task')
    expect(screen.getByTestId('app-link-picker-input')).toHaveValue('')
    expect(screen.getByText(/トップページを作る/)).toBeInTheDocument()
  })

  it('候補が多いときは件数を伝える', () => {
    mockTasks = Array.from({ length: 12 }, (_, i) => ({
      id: `t${i}`,
      title: `タスク${i}`,
      short_id: i,
      status: 'todo',
    }))
    renderPicker()
    switchTo('task')
    expect(screen.getAllByTestId('app-link-picker-option')).toHaveLength(8)
    expect(screen.getByText(/ほか 4 件/)).toBeInTheDocument()
  })

  it('完了したタスクは候補に出さない', () => {
    mockTasks = [
      { id: 'done', title: '終わったタスク', short_id: 1, status: 'done' },
      { id: 'doing', title: '進行中のタスク', short_id: 2, status: 'in_progress' },
    ]
    renderPicker()
    switchTo('task')
    expect(screen.getByText(/進行中のタスク/)).toBeInTheDocument()
    expect(screen.queryByText(/終わったタスク/)).not.toBeInTheDocument()
  })

  it('1件も無いときは、どこで作るかを伝える', () => {
    mockFiles = []
    renderPicker()
    expect(screen.getByText(/ファイルはまだありません/)).toBeInTheDocument()
  })
})
