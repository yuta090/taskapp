import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act, fireEvent } from '@testing-library/react'
import { MinutesDocumentView } from '@/components/meeting/MinutesDocumentView'
import type { Meeting } from '@/types/database'

// 「〇〇さんが書いています」の帯。
//
// - 出すのは「いま書いている人」だけ（開いているだけの人は v1 では出さない）。
// - 編集は止めない（同時に書けてしまったときは、これまで通り保存の楽観ロックが最後の砦）。
// - 購読するのは「書ける人」だけ。閲覧だけの人・相手先では在席そのものを送らない。

vi.mock('@/lib/hooks/useAnnouncements', () => ({
  useAnnouncements: () => ({ announcements: [], unreadCount: 0, markAsRead: vi.fn(), markAllAsRead: vi.fn() }),
}))

vi.mock('@/lib/hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({
    user: { id: 'u-self', email: 'me@example.com', user_metadata: { name: '自分' } },
    loading: false,
    error: null,
  }),
}))

interface PresencePeer {
  userId: string
  name: string
  editing: boolean
}

let presenceOthers: PresencePeer[] = []
const setEditingSpy = vi.fn()
const presenceOptions: Array<{ meetingId: string; enabled: boolean; self: { userId: string; name: string } }> = []

vi.mock('@/lib/hooks/useMinutesPresence', () => ({
  useMinutesPresence: (options: { meetingId: string; enabled: boolean; self: { userId: string; name: string } }) => {
    presenceOptions.push(options)
    return { others: presenceOthers, setEditing: setEditingSpy }
  },
}))

let capturedOnChange: ((md: string) => void) | undefined

vi.mock('@/components/meeting/MinutesEditorDynamic', () => ({
  MinutesEditorDynamic: (props: { minutesMd: string; editable: boolean; onChange?: (md: string) => void }) => {
    capturedOnChange = props.onChange
    return <div data-testid="minutes-editor" data-editable={String(props.editable)} />
  },
}))

function makeMeeting(overrides: Partial<Meeting> = {}): Meeting {
  return {
    id: 'm1',
    org_id: 'org1',
    space_id: 'space1',
    title: '定例MTG',
    status: 'planned',
    held_at: null,
    started_at: null,
    ended_at: null,
    created_at: '2026-09-01T00:00:00',
    updated_at: '2026-09-01T00:00:00.111111+00',
    notes: null,
    minutes_md: '# 定例MTG\n\n本文',
    summary_subject: null,
    summary_body: null,
    ...overrides,
  } as Meeting
}

function setup(extraProps: Record<string, unknown> = {}) {
  const updateMinutes = vi.fn().mockImplementation(async (_id: string, content: string) => ({
    minutesMd: content,
    updatedAt: '2026-09-01T00:00:01.222222+00',
  }))
  const fetchMeetingDetail = vi.fn().mockResolvedValue(makeMeeting())

  const utils = render(
    <MinutesDocumentView
      orgId="org1"
      spaceId="space1"
      meeting={makeMeeting()}
      canEdit
      onBack={vi.fn()}
      onOpenInfo={vi.fn()}
      updateMinutes={updateMinutes}
      fetchMeetingDetail={fetchMeetingDetail}
      {...extraProps}
    />
  )

  return { updateMinutes, fetchMeetingDetail, ...utils }
}

async function loaded() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0)
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  presenceOthers = []
  presenceOptions.length = 0
  capturedOnChange = undefined
})

afterEach(() => {
  vi.useRealTimers()
})

describe('MinutesDocumentView 「〇〇さんが書いています」の帯', () => {
  it('ほかに誰も書いていなければ帯を出さない', async () => {
    setup()
    await loaded()
    expect(screen.queryByTestId('minutes-presence-banner')).not.toBeInTheDocument()
  })

  it('ほかの1人が書いていれば「〇〇さんが書いています」を出す', async () => {
    presenceOthers = [{ userId: 'u-a', name: '佐藤', editing: true }]
    setup()
    await loaded()

    expect(screen.getByTestId('minutes-presence-banner')).toBeInTheDocument()
    expect(screen.getByText('佐藤さんが書いています')).toBeInTheDocument()
  })

  it('2人以上なら名前を並べて出す', async () => {
    presenceOthers = [
      { userId: 'u-a', name: '佐藤', editing: true },
      { userId: 'u-b', name: '鈴木', editing: true },
    ]
    setup()
    await loaded()

    expect(screen.getByText('佐藤さん、鈴木さんが書いています')).toBeInTheDocument()
  })

  it('開いているだけ（書いていない）の人は出さない', async () => {
    presenceOthers = [{ userId: 'u-a', name: '佐藤', editing: false }]
    setup()
    await loaded()

    expect(screen.queryByTestId('minutes-presence-banner')).not.toBeInTheDocument()
  })

  it('帯が出ていても編集は止めず、保存もできる', async () => {
    presenceOthers = [{ userId: 'u-a', name: '佐藤', editing: true }]
    const { updateMinutes } = setup()
    await loaded()

    expect(screen.getByTestId('minutes-editor')).toHaveAttribute('data-editable', 'true')

    act(() => capturedOnChange?.('# 定例MTG\n\n二人で書いた本文'))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500)
    })

    expect(updateMinutes).toHaveBeenCalledWith(
      'm1',
      '# 定例MTG\n\n二人で書いた本文',
      '2026-09-01T00:00:00.111111+00'
    )
  })
})

describe('MinutesDocumentView 在席を送るのは書ける人だけ', () => {
  it('書ける人なら、自分の名前つきで購読する', async () => {
    setup()
    await loaded()

    const last = presenceOptions[presenceOptions.length - 1]
    expect(last).toMatchObject({
      meetingId: 'm1',
      enabled: true,
      self: { userId: 'u-self', name: '自分' },
    })
  })

  it('閲覧だけの人(canEdit=false)は購読しない', async () => {
    setup({ canEdit: false })
    await loaded()

    expect(presenceOptions.length).toBeGreaterThan(0)
    expect(presenceOptions.every((o) => o.enabled === false)).toBe(true)
  })

  it('詳細を読み込めていない間は購読しない（本体がまだ無い）', async () => {
    const never = new Promise<Meeting>(() => {})
    render(
      <MinutesDocumentView
        orgId="org1"
        spaceId="space1"
        meeting={makeMeeting()}
        canEdit
        onBack={vi.fn()}
        onOpenInfo={vi.fn()}
        updateMinutes={vi.fn()}
        fetchMeetingDetail={vi.fn().mockReturnValue(never)}
      />
    )
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(presenceOptions).toHaveLength(0)
  })
})

describe('MinutesDocumentView 書いていることの伝え方', () => {
  it('エディタ領域にカーソルが入ったら「書いています」にする', async () => {
    setup()
    await loaded()

    setEditingSpy.mockClear()
    fireEvent.focusIn(screen.getByTestId('minutes-editor-region'))
    expect(setEditingSpy).toHaveBeenCalledWith(true)
  })

  it('本文が変わったら「書いています」にする（開いた直後の同じ内容では立てない）', async () => {
    setup()
    await loaded()

    setEditingSpy.mockClear()
    // BlockNote が初期表示直後に同じ内容で呼んでくるぶん
    act(() => capturedOnChange?.('# 定例MTG\n\n本文'))
    expect(setEditingSpy).not.toHaveBeenCalledWith(true)

    act(() => capturedOnChange?.('# 定例MTG\n\n書き足した'))
    expect(setEditingSpy).toHaveBeenCalledWith(true)
  })

  it('エディタ領域の外へカーソルが出たら「書いています」を下ろす', async () => {
    setup()
    await loaded()

    setEditingSpy.mockClear()
    const region = screen.getByTestId('minutes-editor-region')
    fireEvent.focusOut(region, { relatedTarget: document.body })
    expect(setEditingSpy).toHaveBeenCalledWith(false)
  })

  it('エディタ領域の中でカーソルが移っただけなら下ろさない', async () => {
    setup()
    await loaded()

    setEditingSpy.mockClear()
    const region = screen.getByTestId('minutes-editor-region')
    fireEvent.focusOut(region, { relatedTarget: screen.getByTestId('minutes-editor') })
    expect(setEditingSpy).not.toHaveBeenCalledWith(false)
  })
})
