import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { PresetSettings } from '@/app/(internal)/[orgId]/project/[spaceId]/settings/PresetSettings'

// テンプレート適用(rpc_apply_preset_to_space)は app_can_write_space と同じ規則
// （社内の編集者=admin/editorのみ・行が無い社内メンバーはeditor扱い）。
// 閲覧者・役割未確定の間は「テンプレートを適用」を押せなくする。

let mockSpace: { preset_genre: string | null } | null = { preset_genre: null }
let mockSpacePending = false
vi.mock('@/lib/hooks/useSpaceRow', () => ({
  useSpaceRow: () => ({ space: mockSpace, isPending: mockSpacePending }),
  spaceQueryKey: (spaceId: string) => ['space', spaceId],
}))

let mockCounts: { wikiPages: number; milestones: number } | null = { wikiPages: 0, milestones: 0 }
let mockCountsPending = false
vi.mock('@/lib/hooks/useSpaceContentCounts', () => ({
  useSpaceContentCounts: () => ({ counts: mockCounts, isPending: mockCountsPending }),
}))

vi.mock('@/components/space/PresetApplicator', () => ({
  PresetApplicator: () => <div data-testid="preset-applicator" />,
}))

let mockCanEdit = true
vi.mock('@/lib/hooks/useCanEditSpace', () => ({
  useCanEditSpace: () => ({ canEdit: mockCanEdit, canEditMoney: false, resolved: true, loading: false }),
}))

beforeEach(() => {
  mockSpace = { preset_genre: null }
  mockSpacePending = false
  mockCounts = { wikiPages: 0, milestones: 0 }
  mockCountsPending = false
  mockCanEdit = true
})

describe('PresetSettings — 編集できる人にはテンプレート適用を出す', () => {
  it('空のプロジェクトで「テンプレートを適用」ボタンが押せる', () => {
    render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <PresetSettings orgId="o1" spaceId="s1" />
    </QueryClientProvider>
  )
    expect(screen.getByRole('button', { name: 'テンプレートを適用' })).not.toBeDisabled()
  })

  it('押すとテンプレート選択(PresetApplicator)が開く', () => {
    render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <PresetSettings orgId="o1" spaceId="s1" />
    </QueryClientProvider>
  )
    fireEvent.click(screen.getByRole('button', { name: 'テンプレートを適用' }))
    expect(screen.getByTestId('preset-applicator')).toBeInTheDocument()
  })
})

describe('PresetSettings — 閲覧者・役割未確定にはテンプレート適用を出さない', () => {
  it('閲覧者では「テンプレートを適用」ボタンが disabled になる', () => {
    mockCanEdit = false
    render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <PresetSettings orgId="o1" spaceId="s1" />
    </QueryClientProvider>
  )
    expect(screen.getByRole('button', { name: 'テンプレートを適用' })).toBeDisabled()
  })

  it('押してもテンプレート選択は開かない', () => {
    mockCanEdit = false
    render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <PresetSettings orgId="o1" spaceId="s1" />
    </QueryClientProvider>
  )
    fireEvent.click(screen.getByRole('button', { name: 'テンプレートを適用' }))
    expect(screen.queryByTestId('preset-applicator')).not.toBeInTheDocument()
  })
})
