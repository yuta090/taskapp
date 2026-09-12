import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { VideoProviderSettings } from '@/app/(internal)/[orgId]/project/[spaceId]/settings/VideoProviderSettings'

// デフォルトプロバイダー(spaces.default_video_provider)は、agency_mode等のような専用の
// DBトリガーを持たない、ただの spaces の列。更新は spaces の更新RLS（app_can_write_space）
// と同じ規則なので canEdit を使う。閲覧者・役割未確定では選択欄を disabled にする。

vi.mock('@/lib/hooks/useIntegrations', () => ({
  useIntegrations: () => ({ loading: false, isConnected: () => true }),
}))

vi.mock('@/lib/hooks/useSpaceRow', () => ({
  useSpaceRow: () => ({ space: { default_video_provider: null }, isPending: false }),
  patchSpaceRow: vi.fn(),
}))

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    from: () => ({ update: () => ({ eq: vi.fn().mockResolvedValue({ error: null }) }) }),
  }),
}))

let mockCanEdit = true
vi.mock('@/lib/hooks/useCanEditSpace', () => ({
  useCanEditSpace: () => ({ canEdit: mockCanEdit, canEditMoney: false, resolved: true, loading: false }),
}))

function renderSettings() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <VideoProviderSettings orgId="o1" spaceId="s1" />
    </QueryClientProvider>
  )
}

beforeEach(() => {
  mockCanEdit = true
})

describe('VideoProviderSettings — 編集できる人には従来どおり操作できる', () => {
  it('選択欄が操作できる', () => {
    renderSettings()
    expect(screen.getByTestId('video-default-provider')).not.toBeDisabled()
  })
})

describe('VideoProviderSettings — 閲覧者・役割未確定には操作させない', () => {
  it('選択欄が disabled になる', () => {
    mockCanEdit = false
    renderSettings()
    expect(screen.getByTestId('video-default-provider')).toBeDisabled()
  })
})
