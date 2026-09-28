import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

// 一覧のチェックボックス（と行の状態メニュー）で完了にしたときの案内。
// タスク詳細を開いていないので、案内は画面の通知に出し、押されたら詳細と入力欄を開く。
// 運用ルール「確認依頼は子タスクで出す」2026-09-15 確定。

const toastSuccess = vi.fn()
vi.mock('sonner', () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccess(...args),
  },
}))

import {
  suggestReviewRequestOnDone,
  REVIEW_REQUEST_NUDGE_TITLE,
  REVIEW_REQUEST_NUDGE_BODY,
  REVIEW_REQUEST_NUDGE_ACTION_LABEL,
  useReviewRequestTarget,
} from '@/lib/tasks/reviewRequestNudge'

describe('suggestReviewRequestOnDone', () => {
  beforeEach(() => {
    toastSuccess.mockClear()
  })

  it('未完了だったタスクを完了にしたら案内を出す', () => {
    const shown = suggestReviewRequestOnDone({
      previousStatus: 'in_progress',
      nextStatus: 'done',
      onAccept: vi.fn(),
    })

    expect(shown).toBe(true)
    expect(toastSuccess).toHaveBeenCalledTimes(1)
    expect(toastSuccess.mock.calls[0][0]).toBe(REVIEW_REQUEST_NUDGE_TITLE)
    expect(toastSuccess.mock.calls[0][1].description).toBe(REVIEW_REQUEST_NUDGE_BODY)
  })

  it('完了以外にしたときは出さない', () => {
    const shown = suggestReviewRequestOnDone({
      previousStatus: 'done',
      nextStatus: 'todo',
      onAccept: vi.fn(),
    })

    expect(shown).toBe(false)
    expect(toastSuccess).not.toHaveBeenCalled()
  })

  it('すでに完了のタスクを完了にし直したときは出さない', () => {
    const shown = suggestReviewRequestOnDone({
      previousStatus: 'done',
      nextStatus: 'done',
      onAccept: vi.fn(),
    })

    expect(shown).toBe(false)
    expect(toastSuccess).not.toHaveBeenCalled()
  })

  it('直前の状態が分からないときは出す（一覧に無い行から完了にした場合）', () => {
    const shown = suggestReviewRequestOnDone({
      previousStatus: undefined,
      nextStatus: 'done',
      onAccept: vi.fn(),
    })

    expect(shown).toBe(true)
    expect(toastSuccess).toHaveBeenCalledTimes(1)
  })

  it('案内の「確認依頼を出す」を押すと、渡した処理を呼ぶ', () => {
    const onAccept = vi.fn()
    suggestReviewRequestOnDone({ previousStatus: 'todo', nextStatus: 'done', onAccept })

    const options = toastSuccess.mock.calls[0][1]
    expect(options.action.label).toBe(REVIEW_REQUEST_NUDGE_ACTION_LABEL)

    options.action.onClick()
    expect(onAccept).toHaveBeenCalledTimes(1)
  })
})

describe('useReviewRequestTarget', () => {
  it('案内を押した直後は、選ばれているタスクがまだ前のままでも目印を消さない', () => {
    // プロジェクトのタスク一覧は選択中のタスクを URL から読むため、押した直後の描き直しでは
    // まだ前の値（null）のまま。ここで消してしまうと入力欄が出ない
    const { result, rerender } = renderHook(({ selected }) => useReviewRequestTarget(selected), {
      initialProps: { selected: null as string | null },
    })

    act(() => result.current.markReviewRequest('t1'))
    expect(result.current.reviewRequestTaskId).toBe('t1')

    rerender({ selected: null })
    expect(result.current.reviewRequestTaskId).toBe('t1')

    rerender({ selected: 't1' })
    expect(result.current.reviewRequestTaskId).toBe('t1')
  })

  it('そのタスクを開いたあと、別のタスクに移ったら忘れる', () => {
    const { result, rerender } = renderHook(({ selected }) => useReviewRequestTarget(selected), {
      initialProps: { selected: null as string | null },
    })

    act(() => result.current.markReviewRequest('t1'))
    rerender({ selected: 't1' })
    rerender({ selected: 't2' })

    expect(result.current.reviewRequestTaskId).toBeNull()
  })

  it('そのタスクを開いたあと、詳細を閉じたら忘れる', () => {
    const { result, rerender } = renderHook(({ selected }) => useReviewRequestTarget(selected), {
      initialProps: { selected: null as string | null },
    })

    act(() => result.current.markReviewRequest('t1'))
    rerender({ selected: 't1' })
    rerender({ selected: null })

    expect(result.current.reviewRequestTaskId).toBeNull()
  })
})
