import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { MinutesDocumentView } from '@/components/meeting/MinutesDocumentView'
import type { Meeting } from '@/types/database'

// 同時編集（Google ドキュメント式）を入れたときの、議事録の画面のふるまい。
//
// - 列へ保存するのは書記1人だけ。全員が保存すると更新時刻の突き合わせで弾き合う
// - 相手の文字が流れ込んだぶんでは「書いています」を立てない（自分は書いていない）
// - つながりが切れたら1人で書く形に戻し、知らせる帯を出す
// - 本文が二重になったら（種が2つ入ったら）保存せずに列から読み直す

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

const setEditingSpy = vi.fn()
let collabState: {
  active: boolean
  isScribe: boolean
  degradedReason: string | null
  applyingRemote: boolean
  synced: boolean
  solo: boolean
}
let capturedCollabOptions: { collabAllowed: boolean; initialMarkdown: string } | null = null

const fakeFragment = { __kind: 'fragment' }
const fakeAwareness = { __kind: 'awareness' }
const fakeMeta = new Map<string, unknown>()

/**
 * 読み直しで本体が作り直されると器も新しくなるので、種の重複は1回きり。
 * 代役でも同じにする（ずっと重複のままだと、本物では起きない繰り返しになる）。
 */
let collabMountCount = 0

vi.mock('@/lib/hooks/useMinutesCollab', () => ({
  useMinutesCollab: (options: { collabAllowed: boolean; initialMarkdown: string }) => {
    capturedCollabOptions = options
    collabMountCount += 1
    if (collabState.degradedReason === 'duplicate-seed' && collabMountCount > 1) {
      collabState = { ...collabState, degradedReason: null }
    }
    return {
      others: [],
      setEditing: setEditingSpy,
      active: collabState.active,
      isScribe: collabState.isScribe,
      fragment: collabState.active ? fakeFragment : null,
      awareness: collabState.active ? fakeAwareness : null,
      meta: collabState.active ? fakeMeta : null,
      isApplyingRemote: () => collabState.applyingRemote,
      synced: collabState.synced,
      pending: false,
      solo: collabState.solo,
      degradedReason: collabState.degradedReason,
      registerSeeder: vi.fn(),
      requestRoomReload: vi.fn(),
    }
  },
}))

let capturedOnChange: ((md: string) => void) | undefined
let capturedCollaboration: unknown

vi.mock('@/components/meeting/MinutesEditorDynamic', () => ({
  MinutesEditorDynamic: (props: {
    minutesMd: string
    editable: boolean
    onChange?: (md: string) => void
    collaboration?: unknown
  }) => {
    capturedOnChange = props.onChange
    capturedCollaboration = props.collaboration
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

function setup() {
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
    />
  )
  return { updateMinutes, fetchMeetingDetail, ...utils }
}

async function loaded() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0)
  })
}

/** 打ってから、自動保存の待ち時間を通り越す */
async function typeAndWait(markdown: string) {
  await act(async () => {
    capturedOnChange?.(markdown)
    await vi.advanceTimersByTimeAsync(2_000)
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  collabState = { active: false, isScribe: true, degradedReason: null, applyingRemote: false, synced: true, solo: true }
  collabMountCount = 0
  capturedOnChange = undefined
  capturedCollaboration = undefined
  capturedCollabOptions = null
  fakeMeta.clear()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('同時編集中の保存', () => {
  it('書記でない人は列へ保存しない', async () => {
    collabState = { active: true, isScribe: false, degradedReason: null, applyingRemote: false, synced: true, solo: false }
    const { updateMinutes } = setup()
    await loaded()

    await typeAndWait('# 定例MTG\n\n本文\n\n山田が足した行')

    expect(updateMinutes).not.toHaveBeenCalled()
  })

  it('書記は列へ保存する', async () => {
    collabState = { active: true, isScribe: true, degradedReason: null, applyingRemote: false, synced: true, solo: false }
    const { updateMinutes } = setup()
    await loaded()

    await typeAndWait('# 定例MTG\n\n本文\n\n田中が足した行')

    expect(updateMinutes).toHaveBeenCalledTimes(1)
    expect(updateMinutes.mock.calls[0][1]).toContain('田中が足した行')
  })

  it('同時編集を使っていなければ、これまでどおり自分で保存する', async () => {
    const { updateMinutes } = setup()
    await loaded()

    await typeAndWait('# 定例MTG\n\n本文\n\n書いた')

    expect(updateMinutes).toHaveBeenCalledTimes(1)
  })
})

describe('同時編集の「書いています」', () => {
  it('相手の文字が流れ込んだぶんでは立てない', async () => {
    collabState = { active: true, isScribe: true, degradedReason: null, applyingRemote: true, synced: true, solo: false }
    setup()
    await loaded()
    setEditingSpy.mockClear()

    await act(async () => {
      capturedOnChange?.('# 定例MTG\n\n本文\n\n相手が書いた行')
    })

    expect(setEditingSpy).not.toHaveBeenCalledWith(true)
  })

  it('自分で打ったぶんでは立てる', async () => {
    collabState = { active: true, isScribe: true, degradedReason: null, applyingRemote: false, synced: true, solo: false }
    setup()
    await loaded()
    setEditingSpy.mockClear()

    await act(async () => {
      capturedOnChange?.('# 定例MTG\n\n本文\n\n自分で書いた行')
    })

    expect(setEditingSpy).toHaveBeenCalledWith(true)
  })
})

describe('同時編集が止まったとき', () => {
  it('つながりが切れたら、1人で書く形に戻したことを知らせる', async () => {
    collabState = { active: false, isScribe: true, degradedReason: 'transport-error', applyingRemote: false, synced: true, solo: true }
    setup()
    await loaded()

    const notice = screen.getByTestId('minutes-collab-degraded-notice')
    expect(notice).toHaveTextContent('一人ずつ書く形に戻しました')
    expect(notice).toHaveTextContent('書いた内容はこれまでどおり保存されます')
  })

  it('人数が多いときも、同じ形で知らせる', async () => {
    collabState = { active: false, isScribe: true, degradedReason: 'too-many-peers', applyingRemote: false, synced: true, solo: false }
    setup()
    await loaded()

    expect(screen.getByTestId('minutes-collab-degraded-notice')).toHaveTextContent('開いている人が多いので')
  })

  it('本文が二重になったら、その内容は保存せず列から読み直す', async () => {
    collabState = { active: false, isScribe: true, degradedReason: 'duplicate-seed', applyingRemote: false, synced: true, solo: true }
    const { updateMinutes, fetchMeetingDetail } = setup()
    await loaded()

    // 読み直し（列の取り直し）が走る。開いたときの1回と合わせて2回
    expect(fetchMeetingDetail.mock.calls.length).toBeGreaterThanOrEqual(2)
    // 二重になった本文は保存しない
    expect(updateMinutes).not.toHaveBeenCalled()
    expect(screen.queryByTestId('minutes-collab-degraded-notice')).not.toBeInTheDocument()
  })
})

describe('エディタへの受け渡し', () => {
  it('同時編集中は、エディタに器とカーソルの入れ物を渡す', async () => {
    collabState = { active: true, isScribe: true, degradedReason: null, applyingRemote: false, synced: true, solo: false }
    setup()
    await loaded()

    expect(capturedCollaboration).toEqual({
      fragment: fakeFragment,
      awareness: fakeAwareness,
      userName: '自分',
      userId: 'u-self',
    })
  })

  it('使わないときは渡さない', async () => {
    setup()
    await loaded()
    expect(capturedCollaboration).toBeUndefined()
  })

  it('本文が届くまでは書けないようにする（空のところへ打つと混ざるため）', async () => {
    collabState = { active: true, isScribe: true, degradedReason: null, applyingRemote: false, synced: false, solo: false }
    setup()
    await loaded()
    expect(screen.getByTestId('minutes-editor')).toHaveAttribute('data-editable', 'false')
  })

  it('つながらないまま1文字打っても、議事録が丸ごと消えない', async () => {
    // 本文が器に入る前に落ちたときは、器につながず1人用のエディタに載せ替える。
    // つないだままだと、空の器の中身（＝打った1文字だけ）が列に保存され、
    // 元の議事録が丸ごと消える。実際に起きた事故の再現テスト。
    collabState = {
      active: false,
      isScribe: true,
      degradedReason: 'transport-error',
      applyingRemote: false,
      synced: true,
      solo: true,
    }
    const { updateMinutes } = setup()
    await loaded()

    // 器につながっていない＝エディタは列の本文を持っている
    expect(capturedCollaboration).toBeUndefined()
    expect(screen.getByTestId('minutes-editor')).toHaveAttribute('data-editable', 'true')

    await typeAndWait('# 定例MTG\n\n本文\n\nあ')

    expect(updateMinutes).toHaveBeenCalledTimes(1)
    const saved = updateMinutes.mock.calls[0][1] as string
    expect(saved).toContain('# 定例MTG')
    expect(saved).toContain('本文')
    expect(saved).not.toBe('あ')
  })

  it('本文が届いたら書けるようになる', async () => {
    collabState = { active: true, isScribe: true, degradedReason: null, applyingRemote: false, synced: true, solo: false }
    setup()
    await loaded()
    expect(screen.getByTestId('minutes-editor')).toHaveAttribute('data-editable', 'true')
  })

  it('開いたときの本文を、同時編集の入り口へ渡す（種まきに使う）', async () => {
    setup()
    await loaded()
    expect(capturedCollabOptions?.initialMarkdown).toBe('# 定例MTG\n\n本文')
  })
})
