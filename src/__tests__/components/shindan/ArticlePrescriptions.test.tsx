import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { ArticlePrescriptions } from '@/components/shindan/ArticlePrescriptions'

/**
 * 診断結果に差し込む「あなたのタイプに効く記事」。
 *
 * 記事在庫は育っている途中なので、**0件のときに空の見出しを残さない**ことが要点。
 * 診断を受けた人の目に「準備中」と映るものを置かない。
 */

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function respond(posts: Array<{ slug: string; title: string; description?: string | null }>) {
  fetchMock.mockResolvedValue({
    ok: true,
    json: async () => ({ posts }),
  } as Response)
}

describe('ArticlePrescriptions', () => {
  it('タイプに効く記事をリンクとして出す', async () => {
    respond([
      { slug: 'tax-document-collection-workflow', title: '資料回収が遅れる税理士事務所へ', description: '催促を仕組みに' },
    ])

    render(<ArticlePrescriptions type="t6" typeName="無音型" />)

    const link = await screen.findByRole('link', { name: /資料回収が遅れる税理士事務所へ/ })
    expect(link).toHaveAttribute('href', '/task6/tax-document-collection-workflow')
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('type=t6'))
  })

  it('記事が無いタイプは、見出しごと何も出さない', async () => {
    respond([])

    const { container } = render(<ArticlePrescriptions type="t1" typeName="丸投げ型" />)

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    await waitFor(() => expect(container).toBeEmptyDOMElement())
  })

  it('取得に失敗しても何も出さない（結果画面を壊さない）', async () => {
    fetchMock.mockRejectedValue(new Error('network down'))

    const { container } = render(<ArticlePrescriptions type="t6" typeName="無音型" />)

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    await waitFor(() => expect(container).toBeEmptyDOMElement())
  })

  it('タイプ名を見出しに出す（自分ごとに見えるようにする）', async () => {
    respond([{ slug: 'a-b', title: '記事A' }])

    render(<ArticlePrescriptions type="t6" typeName="無音型" />)

    expect(await screen.findByText(/無音型/)).toBeInTheDocument()
  })
})
