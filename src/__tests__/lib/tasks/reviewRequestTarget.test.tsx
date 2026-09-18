import React, { useState, startTransition } from 'react'
import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { useReviewRequestTarget } from '@/lib/tasks/reviewRequestNudge'

// プロジェクトのタスク一覧は、選んでいるタスクを URL から読む。URL の書き換え（pushState）は
// Next が transition として流すので、案内を押した直後の描き直しではまだ前の値のまま届く。
// 素朴に「選んでいるタスクと違えば忘れる」と書くと、立てた目印をその場で消してしまい
// 入力欄が出ない。実際の届き方に寄せて確かめる。
function ListWithInspector() {
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)
  const { reviewRequestTaskId, markReviewRequest } = useReviewRequestTarget(selectedTaskId)
  const open = reviewRequestTaskId !== null && reviewRequestTaskId === selectedTaskId

  return (
    <div>
      <button
        onClick={() => {
          markReviewRequest('t1')
          startTransition(() => setSelectedTaskId('t1'))
        }}
      >
        確認依頼を出す
      </button>
      <button onClick={() => startTransition(() => setSelectedTaskId('t2'))}>別のタスクを開く</button>
      <button onClick={() => startTransition(() => setSelectedTaskId('t1'))}>元のタスクを開く</button>
      <div data-testid="open">{String(open)}</div>
    </div>
  )
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 50))

describe('useReviewRequestTarget — URL 経由で詳細を開く画面', () => {
  it('案内から開くと、確認依頼の入力欄が開く', async () => {
    render(<ListWithInspector />)

    fireEvent.click(screen.getByText('確認依頼を出す'))
    await settle()

    expect(screen.getByTestId('open').textContent).toBe('true')
  })

  it('別のタスクに移ったら忘れ、同じタスクを開き直しても勝手に出ない', async () => {
    render(<ListWithInspector />)

    fireEvent.click(screen.getByText('確認依頼を出す'))
    await settle()
    fireEvent.click(screen.getByText('別のタスクを開く'))
    await settle()
    fireEvent.click(screen.getByText('元のタスクを開く'))
    await settle()

    expect(screen.getByTestId('open').textContent).toBe('false')
  })
})
