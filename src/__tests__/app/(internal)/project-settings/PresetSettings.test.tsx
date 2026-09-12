import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { PresetSettings } from '@/app/(internal)/[orgId]/project/[spaceId]/settings/PresetSettings'

// テンプレート適用(rpc_apply_preset_to_space)は、app_can_write_space の前に
// 「space_memberships の行がはっきり admin/editor」かを確かめて insufficient_permissions
// を返す（20260911143112_space_role_boundary.sql の rpc_apply_preset_to_space）。
// canEditSpaceContent（行が無い社内メンバーは editor 扱い）より狭く、
// 代理店設定・ポータル表示設定と同じ canEditMoney の規則。
// 閲覧者・行が無い社内メンバー・役割未確定の間は「テンプレートを適用」を押せなくする。

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

let mockCanEditMoney = true
vi.mock('@/lib/hooks/useCanEditSpace', () => ({
  useCanEditSpace: () => ({ canEdit: true, canEditMoney: mockCanEditMoney, resolved: true, loading: false }),
}))

function renderSettings() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <PresetSettings orgId="o1" spaceId="s1" />
    </QueryClientProvider>
  )
}

beforeEach(() => {
  mockSpace = { preset_genre: null }
  mockSpacePending = false
  mockCounts = { wikiPages: 0, milestones: 0 }
  mockCountsPending = false
  mockCanEditMoney = true
})

describe('PresetSettings — space の行が admin/editor には従来どおりテンプレート適用を出す', () => {
  it('空のプロジェクトで「テンプレートを適用」ボタンが押せる', () => {
    renderSettings()
    expect(screen.getByRole('button', { name: 'テンプレートを適用' })).not.toBeDisabled()
  })

  it('押すとテンプレート選択(PresetApplicator)が開く', () => {
    renderSettings()
    fireEvent.click(screen.getByRole('button', { name: 'テンプレートを適用' }))
    expect(screen.getByTestId('preset-applicator')).toBeInTheDocument()
  })
})

describe('PresetSettings — 操作できない人（閲覧者・行が無い社内メンバー等）にはテンプレート適用を出さない', () => {
  it('「テンプレートを適用」ボタンが disabled になる', () => {
    mockCanEditMoney = false
    renderSettings()
    expect(screen.getByRole('button', { name: 'テンプレートを適用' })).toBeDisabled()
  })

  it('押してもテンプレート選択は開かない', () => {
    mockCanEditMoney = false
    renderSettings()
    fireEvent.click(screen.getByRole('button', { name: 'テンプレートを適用' }))
    expect(screen.queryByTestId('preset-applicator')).not.toBeInTheDocument()
  })
})
