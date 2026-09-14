import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { WikiPageInspector } from '@/components/wiki/WikiPageInspector'
import type { WikiPage, WikiPageVersion } from '@/types/database'

// 確定した時点の控えに印を出し、そのあと本文が変わったら知らせる。
// ユーザーの言う「凍結」は編集を止めることではなく、控えが残って変化が分かること。

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

function page(overrides: Partial<WikiPage> = {}): WikiPage {
  return {
    id: 'page-1',
    org_id: 'org1',
    space_id: 'space1',
    title: 'ページA',
    body: '',
    tags: ['仕様書'],
    parent_page_id: null,
    milestone_id: null,
    pinned_at: null,
    sort_order: null,
    created_by: 'user1',
    updated_by: 'user1',
    created_at: '2026-09-01T00:00:00+09:00',
    updated_at: '2026-09-14T11:00:00+09:00',
    ...overrides,
  }
}

function version(overrides: Partial<WikiPageVersion> & { created_at: string }): WikiPageVersion {
  return {
    id: `v-${overrides.created_at}`,
    org_id: 'org1',
    page_id: 'page-1',
    title: 'ページA',
    body: '',
    created_by: 'user1',
    kind: 'autosave',
    task_id: null,
    ...overrides,
  } as WikiPageVersion
}

function openVersions() {
  fireEvent.click(screen.getByText('バージョン履歴'))
}

describe('WikiPageInspector 確定時点の控え', () => {
  it('確定の控えには印を出す', async () => {
    const onFetchVersions = vi.fn().mockResolvedValue([
      version({ created_at: '2026-09-14T11:00:00+09:00' }),
      version({ created_at: '2026-09-14T10:00:00+09:00', kind: 'decided', task_id: 'task-1' }),
      version({ created_at: '2026-09-13T10:00:00+09:00', kind: 'implemented', task_id: 'task-2' }),
    ])
    render(
      <WikiPageInspector page={page()} onClose={vi.fn()} onFetchVersions={onFetchVersions} />
    )
    openVersions()
    await waitFor(() => expect(onFetchVersions).toHaveBeenCalled())

    expect(await screen.findByText('確定時点')).toBeTruthy()
    expect(screen.getByText('実装時点')).toBeTruthy()
    // 自動保存の控えには印を出さない（数が多く、印の意味が薄れる）
    expect(screen.getAllByTestId('wiki-version-kind')).toHaveLength(2)
  })

  it('確定のあとに本文を保存していたら知らせる', async () => {
    // 確定の控えより後ろに、自動保存の控えが積まれている＝本文が変わった
    const onFetchVersions = vi.fn().mockResolvedValue([
      version({ created_at: '2026-09-14T11:00:00+09:00' }),
      version({ created_at: '2026-09-14T10:00:00+09:00', kind: 'decided', task_id: 'task-1' }),
    ])
    render(
      <WikiPageInspector page={page()} onClose={vi.fn()} onFetchVersions={onFetchVersions} />
    )
    openVersions()
    await waitFor(() => expect(onFetchVersions).toHaveBeenCalled())

    expect(await screen.findByTestId('wiki-changed-since-decision')).toBeTruthy()
  })

  it('確定した直後は知らせない（控えがいちばん新しい）', async () => {
    const onFetchVersions = vi.fn().mockResolvedValue([
      version({ created_at: '2026-09-14T11:00:00+09:00', kind: 'decided', task_id: 'task-1' }),
      version({ created_at: '2026-09-14T09:00:00+09:00' }),
    ])
    render(
      <WikiPageInspector page={page()} onClose={vi.fn()} onFetchVersions={onFetchVersions} />
    )
    openVersions()
    await waitFor(() => expect(onFetchVersions).toHaveBeenCalled())

    expect(screen.queryByTestId('wiki-changed-since-decision')).toBeNull()
  })

  it('ページの属性だけ変えたときは知らせない（本文は変わっていない）', async () => {
    // ピン留めやタグを変えると wiki_pages.updated_at は進むが、版は積まれない。
    // page.updated_at で判定していたころは、ここで誤って警告が出ていた。
    const onFetchVersions = vi.fn().mockResolvedValue([
      version({ created_at: '2026-09-14T10:00:00+09:00', kind: 'decided', task_id: 'task-1' }),
    ])
    render(
      <WikiPageInspector
        page={page({ updated_at: '2026-09-14T23:00:00+09:00' })}
        onClose={vi.fn()}
        onFetchVersions={onFetchVersions}
      />
    )
    openVersions()
    await waitFor(() => expect(onFetchVersions).toHaveBeenCalled())

    expect(screen.queryByTestId('wiki-changed-since-decision')).toBeNull()
  })

  it('確定の控えが1件も無ければ知らせない', async () => {
    const onFetchVersions = vi.fn().mockResolvedValue([
      version({ created_at: '2026-09-14T10:00:00+09:00' }),
    ])
    render(
      <WikiPageInspector
        page={page({ updated_at: '2026-09-14T11:00:00+09:00' })}
        onClose={vi.fn()}
        onFetchVersions={onFetchVersions}
      />
    )
    openVersions()
    await waitFor(() => expect(onFetchVersions).toHaveBeenCalled())

    expect(screen.queryByTestId('wiki-changed-since-decision')).toBeNull()
    expect(screen.queryByTestId('wiki-version-kind')).toBeNull()
  })
})
