import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, act, fireEvent, screen } from '@testing-library/react'
import { useInAppLinkNavigation } from '@/components/editor/inAppLinkNavigation'
import { InPlaceLinkOpenerProvider } from '@/components/editor/inPlaceLinkOpener'
import { TaskMarkerChip } from '@/components/meeting/MinutesEditor'

/**
 * 議事録画面は「その場で開く」受け口を用意する。受け口が引き受けたリンクは画面を移らない。
 * 会議中に資料を開くたびにページが切り替わらないようにするため。
 */

const push = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
}))

const HREF = '/org-1/project/space-1?task=t1'

function renderLink(opener: (href: string) => boolean) {
  let anchor: HTMLAnchorElement | null = null
  const flush = vi.fn(async () => {})
  function Harness() {
    const ref = useInAppLinkNavigation(flush)
    return (
      <div ref={ref}>
        <a href={HREF} ref={(n) => { anchor = n }}>リンク</a>
      </div>
    )
  }
  render(
    <InPlaceLinkOpenerProvider value={opener}>
      <Harness />
    </InPlaceLinkOpenerProvider>
  )
  return {
    flush,
    click: async () => {
      await act(async () => {
        anchor!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }))
      })
    },
  }
}

beforeEach(() => {
  push.mockClear()
})

describe('本文のリンク', () => {
  it('受け口が引き受けたら、画面を移らずその場で開く', async () => {
    const opener = vi.fn(() => true)
    const link = renderLink(opener)
    await link.click()
    expect(opener).toHaveBeenCalledWith(HREF)
    expect(push).not.toHaveBeenCalled()
  })

  it('受け口が引き受けなかったら、これまでどおり保存してから移る', async () => {
    const opener = vi.fn(() => false)
    const link = renderLink(opener)
    await link.click()
    expect(link.flush).toHaveBeenCalled()
    expect(push).toHaveBeenCalledWith(HREF)
  })
})

describe('「タスク作成済み」の印', () => {
  const TASK = '11111111-1111-4111-8111-111111111111'

  it('受け口があれば、印を押しても画面を移らずその場で開く', () => {
    const opener = vi.fn(() => true)
    render(
      <InPlaceLinkOpenerProvider value={opener}>
        <TaskMarkerChip taskId={TASK} orgId="org-1" spaceId="space-1" />
      </InPlaceLinkOpenerProvider>
    )
    fireEvent.click(screen.getByTestId('minutes-task-marker-chip'))
    expect(opener).toHaveBeenCalledWith(`/org-1/project/space-1?task=${TASK}`)
    expect(push).not.toHaveBeenCalled()
  })
})
