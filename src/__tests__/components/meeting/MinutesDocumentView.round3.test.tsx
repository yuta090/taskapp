import React, { createRef } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act, fireEvent } from '@testing-library/react'
import {
  MinutesDocumentView,
  type MinutesDocumentViewHandle,
} from '@/components/meeting/MinutesDocumentView'
import type { Meeting } from '@/types/database'

// 3回目のレビューで見つかった不具合の回帰テスト。
//
// CRITICAL-N1（レビュアーの再現テスト R11 相当）: 本文を全部消してから離れると、
//   アンマウント時の後始末が「空」をそのまま保存し、既存の議事録を空で上書きしていた。
//   → 後始末の条件に「今の本文が空でない」を足す。
//
// HIGH-N2（R12 相当）: 保存が通信中に本文を全部消すと、保留中バッファに「空」が
//   積まれ、通信中の保存が終わった直後にその「空」が送られていた。
//   → 保存中でも、空になったら保留中バッファには積まない(null にする)。

vi.mock('@/lib/hooks/useAnnouncements', () => ({
  useAnnouncements: () => ({ announcements: [], unreadCount: 0, markAsRead: vi.fn(), markAllAsRead: vi.fn() }),
}))

// 「〇〇さんが書いています」の在席はこのファイルの関心事ではないので固定で返す
// （在席そのものの検査は MinutesDocumentView.presence.test.tsx）
vi.mock('@/lib/hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({
    user: { id: 'u-self', email: 'me@example.com', user_metadata: { name: '自分' } },
    loading: false,
    error: null,
  }),
}))

vi.mock('@/lib/hooks/useMinutesPresence', () => ({
  useMinutesPresence: () => ({ others: [], setEditing: vi.fn() }),
}))

let onChange: ((md: string) => void) | undefined

vi.mock('@/components/meeting/MinutesEditorDynamic', () => ({
  MinutesEditorDynamic: (props: { onChange?: (md: string) => void }) => {
    onChange = props.onChange
    return <div data-testid="minutes-editor" />
  },
}))

const base = {
  id: 'm1',
  org_id: 'o',
  space_id: 's',
  title: 't',
  status: 'ended',
  held_at: null,
  started_at: null,
  ended_at: null,
  created_at: 'c',
  notes: null,
  summary_subject: null,
  summary_body: null,
} as unknown as Meeting

function mk(overrides: Partial<Meeting>): Meeting {
  return { ...base, ...overrides } as Meeting
}

function view(
  meeting: Meeting,
  updateMinutes: (id: string, md: string, base: string) => Promise<{ minutesMd: string | null; updatedAt: string }>,
  fetchMeetingDetail: (id: string) => Promise<Meeting | null>,
  ref?: React.Ref<MinutesDocumentViewHandle>,
  onBack: () => void = () => {}
) {
  return (
    <MinutesDocumentView
      ref={ref}
      orgId="o"
      spaceId="s"
      meeting={meeting}
      canEdit
      onBack={onBack}
      onOpenInfo={vi.fn()}
      updateMinutes={updateMinutes}
      fetchMeetingDetail={fetchMeetingDetail}
    />
  )
}

const flush = async () => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0)
  })
}
const wait = async (ms: number) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

/** サーバーを模す: 基準が合えば書き、合わなければ0行(MinutesConflictErrorは使わずreject) */
function fakeServer(md: string, at: string) {
  const s = { md, at, n: 0 }
  const up = vi.fn(async (_id: string, content: string, b: string) => {
    if (b !== s.at) throw new Error('conflict')
    s.n++
    s.md = content
    s.at = 'S' + s.n
    return { minutesMd: content, updatedAt: s.at }
  })
  const fd = vi.fn(async () => mk({ minutes_md: s.md, updated_at: s.at }))
  return { s, up, fd }
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  onChange = undefined
})

afterEach(() => {
  vi.useRealTimers()
})

describe('CRITICAL-N1: 本文を全部消してから離れると、議事録が空で上書きされる（R11）', () => {
  it('本文を全部消してからアンマウントしても保存しない（サーバーの内容は残る）', async () => {
    const { s, up, fd } = fakeServer('A 大事な本文', 'U1')
    const { unmount } = render(view(mk({ minutes_md: 'A 大事な本文', updated_at: 'U1' }), up, fd))
    await flush()

    act(() => onChange?.('   '))
    await wait(3000)
    // 空にした直後は保存しない(空本文の注意が出る)
    expect(screen.getByTestId('minutes-empty-notice')).toBeInTheDocument()
    expect(up).not.toHaveBeenCalled()

    unmount()
    await wait(3000)

    // サーバー側の本文は空で上書きされていない
    expect(s.md).toBe('A 大事な本文')
    expect(up).not.toHaveBeenCalled()
  })
})

describe('HIGH-N2: 保存の通信中に本文を全部消すと、空で保存される（R12）', () => {
  it('通信中に全部消しても、その保存が終わったあとに空を送らない', async () => {
    const { s, up, fd } = fakeServer('A', 'U1')
    let release!: (v: { minutesMd: string; updatedAt: string }) => void
    const gate = new Promise<{ minutesMd: string; updatedAt: string }>((r) => {
      release = r
    })
    const orig = up.getMockImplementation()!
    up.mockImplementationOnce(async (...a: Parameters<typeof orig>) => {
      await gate
      return orig(...a)
    })

    render(view(mk({ minutes_md: 'A', updated_at: 'U1' }), up, fd))
    await flush()

    act(() => onChange?.('A 編集'))
    await wait(1600)
    expect(up).toHaveBeenCalledTimes(1) // 通信中(未解決)

    act(() => onChange?.(''))

    await act(async () => {
      release({ minutesMd: 'A 編集', updatedAt: 'S1' })
    })
    await wait(3000)

    // 「空」が保留中バッファに積まれて追い打ちで送られていない
    expect(up).toHaveBeenCalledTimes(1)
    expect(s.md).toBe('A 編集')
  })
})

describe('N4: 保存失敗後に「捨てて戻る」を選んだら、後始末で書きかけを送らない（R13）', () => {
  it('「捨てて戻る」を選んだあとにアンマウントしても、書きかけは送られない', async () => {
    const { s, up, fd } = fakeServer('A', 'U1')
    up.mockRejectedValueOnce(new Error('network'))
    const onBack = vi.fn()
    const { unmount } = render(view(mk({ minutes_md: 'A', updated_at: 'U1' }), up, fd, undefined, onBack))
    await flush()

    act(() => onChange?.('下書き'))
    await wait(1600)

    await act(async () => {
      fireEvent.click(screen.getByLabelText('会議一覧へ戻る'))
    })
    await flush()

    const discard = screen.getByText('捨てて戻る')
    await act(async () => {
      fireEvent.click(discard)
    })
    await flush()

    expect(onBack).toHaveBeenCalledTimes(1)

    unmount()
    await wait(3000)

    expect(s.md).toBe('A')
  })
})

describe('N5: ensureUpToDate は詳細を1回だけ読む', () => {
  it('fetchMeetingDetail の呼び出し回数が、開いたとき+ensureUpToDateの分の2回で収まる', async () => {
    const { fd, up } = fakeServer('* 箇条書き', 'U1')
    const ref = createRef<MinutesDocumentViewHandle>()
    render(view(mk({}), up, fd, ref))
    await flush()
    expect(fd).toHaveBeenCalledTimes(1) // 開いたときの1回

    await act(async () => {
      await ref.current!.ensureUpToDate()
    })

    expect(fd).toHaveBeenCalledTimes(2) // ensureUpToDate 自身の1回だけ増える(2回読みにならない)
  })
})
