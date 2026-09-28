// @vitest-environment jsdom
/**
 * 合流の本体（`session.ts`）を読み込めなかったとき。
 *
 * この画面は今までどおり1人用で動くので、本人は困らない。困るのは相手で、
 * 「いま開いている」と名乗ったままだと、ほかの人はこちらが本文を用意すると思って
 * 待ち続ける。読み込めないと分かった時点で名乗りを下ろす。
 *
 * 読み込みの失敗はモジュールごと差し替えないと作れないので、ファイルを分けてある。
 */
import { describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useMinutesCollab } from '@/lib/hooks/useMinutesCollab'

const setCollabPresentSpy = vi.fn()

vi.mock('@/lib/collab/session', () => {
  throw new Error('読み込めません')
})

vi.mock('@/lib/hooks/useMinutesPresence', () => ({
  useMinutesPresence: () => ({
    others: [],
    setEditing: vi.fn(),
    sendCollab: vi.fn(),
    setCollabActive: vi.fn(),
    setCollabPresent: setCollabPresentSpy,
    setCollabState: vi.fn(),
    setColorIndex: vi.fn(),
  }),
}))

describe('合流の本体を読み込めないとき', () => {
  it('「いま開いている」の名乗りを下ろす', async () => {
    const { result } = renderHook(() =>
      useMinutesCollab({
        meetingId: 'm1',
        presenceEnabled: true,
        self: { userId: 'u-self', name: '自分' },
        collabAllowed: true,
        initialMarkdown: '# 会議',
      })
    )
    for (let i = 0; i < 100; i++) {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 5))
      })
      if (result.current.pending === false) break
    }

    expect(result.current.solo).toBe(true)
    expect(setCollabPresentSpy).toHaveBeenLastCalledWith(false)
  })
})
