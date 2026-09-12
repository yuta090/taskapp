import React, { createRef } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import {
  MinutesDocumentView,
  type MinutesDocumentViewHandle,
} from '@/components/meeting/MinutesDocumentView'
import { MinutesConflictError } from '@/lib/hooks/useMeetings'
import type { Meeting } from '@/types/database'

// AI秘書やチャットの minutes_append が末尾に追記しても、人が書いている書きかけは
// 消えず、行き止まり（競合の帯）にもならないことを確かめる。
//
// 本体（MinutesDocumentBody）は作り直さない。合流は「生きているエディタの末尾に
// 足された分の Markdown を挿し込む」形で行う（appendMarkdown）。BlockNote は
// 本物のトランザクションを起こすので、その直後の onChange から普段どおりの
// 自動保存が走る。このテストでは MinutesEditorDynamic をモックし、
// registerApi で受け取った appendMarkdown が呼ばれたら、実機の BlockNote と
// 同じように onChange を発火させる形でエディタの動きを再現する。

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

vi.mock('@/lib/hooks/useMinutesPresence', () => ({
  useMinutesPresence: () => ({ others: [], setEditing: vi.fn() }),
}))

vi.mock('@/lib/hooks/useIsMobile', () => ({ useIsMobile: () => false }))

let capturedOnChange: ((md: string) => void) | undefined
let mountCount = 0
// 差し込み口が使えない状態（読み取り専用・形式が壊れている等）を模すためのフラグ。
// true なら通常どおり api を登録し、false なら null を登録する（=編集側で appendMarkdown が使えない）。
let apiAvailable = true
// 本物の BlockNote エディタが「今持っている」本文。プロップの minutesMd（マウント時の
// 初期値のみ）とは別に、テストが capturedOnChange 経由で人の入力を模すたびに更新する。
// appendMarkdown はこの「今の中身」の末尾に足すので、実機と同じ挙動になる。
let currentEditorContent = ''
const mockAppendMarkdown = vi.fn((addition: string) => {
  // 実機の appendMarkdown は、挿し込みに成功すると本物の BlockNote トランザクション
  // (onChange) を起こす。「今のエディタの中身 + \n\n + 追記」で模す（実際の
  // MinutesEditor は末尾ブロックの後ろに挿すので同じ形になる）。
  currentEditorContent = `${currentEditorContent}\n\n${addition}`
  capturedOnChange?.(currentEditorContent)
  return true
})

vi.mock('@/components/meeting/MinutesEditorDynamic', () => ({
  MinutesEditorDynamic: (props: {
    minutesMd: string
    editable: boolean
    onChange?: (md: string) => void
    registerApi?: (api: { appendMarkdown: (md: string) => boolean } | null) => void
  }) => {
    const initializedRef = React.useRef(false)
    if (!initializedRef.current) {
      currentEditorContent = props.minutesMd
      initializedRef.current = true
    }
    // 人の入力を模す capturedOnChange() 呼び出しも「今の中身」を更新してから、
    // 本物の onChange(=handleEditorChange) へ転送する。
    capturedOnChange = (md: string) => {
      currentEditorContent = md
      props.onChange?.(md)
    }
    React.useEffect(() => {
      mountCount += 1
      props.registerApi?.(apiAvailable ? { appendMarkdown: mockAppendMarkdown } : null)
      return () => props.registerApi?.(null)
      // eslint-disable-next-line react-hooks/exhaustive-deps -- テスト用の簡易モック
    }, [])
    return <div data-testid="minutes-editor" data-editable={String(props.editable)} />
  },
}))

const mockWriteText = vi.fn().mockResolvedValue(undefined)
Object.assign(navigator, { clipboard: { writeText: mockWriteText } })

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
    minutes_md: '# 定例MTG\n\n決まったこと',
    summary_subject: null,
    summary_body: null,
    ...overrides,
  } as Meeting
}

function setup(meetingOverrides: Partial<Meeting> = {}, extraProps: Record<string, unknown> = {}) {
  const meeting = makeMeeting(meetingOverrides)
  const updateMinutes = vi
    .fn()
    .mockImplementation(async (_id: string, content: string) => ({
      minutesMd: content,
      updatedAt: '2026-09-01T00:00:01.222222+00',
    }))
  const fetchMeetingDetail = vi.fn().mockResolvedValue(makeMeeting())
  const ref = createRef<MinutesDocumentViewHandle>()

  const utils = render(
    <MinutesDocumentView
      ref={ref}
      orgId="org1"
      spaceId="space1"
      meeting={meeting}
      canEdit
      onBack={vi.fn()}
      onOpenInfo={vi.fn()}
      updateMinutes={updateMinutes}
      fetchMeetingDetail={fetchMeetingDetail}
      {...extraProps}
    />
  )

  return { meeting, updateMinutes, fetchMeetingDetail, ref, ...utils }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  capturedOnChange = undefined
  mountCount = 0
  mockWriteText.mockClear()
  mockAppendMarkdown.mockClear()
  apiAvailable = true
  currentEditorContent = ''
})

afterEach(() => {
  vi.useRealTimers()
})

describe('AI秘書の末尾追記との自動合流', () => {
  it('DBの本文が自分の基準の"\\n\\n"区切りの前方一致(末尾への追記)なら、appendMarkdownへ足された分だけを渡し、帯を出さない', async () => {
    const { updateMinutes, fetchMeetingDetail } = setup()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(mountCount).toBe(1)

    // 保存が0行(競合)になり、読み直すと「基準の本文 + \n\n + AIの追記」が返ってくる
    fetchMeetingDetail.mockResolvedValue(
      makeMeeting({
        minutes_md: '# 定例MTG\n\n決まったこと\n\nAI秘書が追記した分',
        updated_at: '2026-09-01T00:09:00.000000+00',
      })
    )
    updateMinutes.mockRejectedValueOnce(new MinutesConflictError())

    act(() => capturedOnChange?.('# 定例MTG\n\n決まったこと\n\n人が書き足した分'))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500)
    })

    // (a) appendMarkdown には「足された分の Markdown だけ」が渡る
    expect(mockAppendMarkdown).toHaveBeenCalledWith('AI秘書が追記した分')

    // (b) 競合の帯は出ない
    expect(screen.queryByTestId('minutes-conflict-banner')).not.toBeInTheDocument()

    // (c) 本体は作り直されない（マウント回数が変わらない）
    expect(mountCount).toBe(1)
  })

  it('挿し込みのあと追加入力なしで、合流後の本文が新しいupdated_atを基準に保存される', async () => {
    const { updateMinutes, fetchMeetingDetail } = setup()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    fetchMeetingDetail.mockResolvedValue(
      makeMeeting({
        minutes_md: '# 定例MTG\n\n決まったこと\n\nAI秘書が追記した分',
        updated_at: '2026-09-01T00:09:00.000000+00',
      })
    )
    updateMinutes.mockRejectedValueOnce(new MinutesConflictError())

    act(() => capturedOnChange?.('# 定例MTG\n\n決まったこと\n\n人が書き足した分'))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500)
    })

    // appendMarkdown 呼び出し(モック内)が onChange を発火させ、それが保存を積む。
    // 追加の入力をしなくても、通信中に来た本文を送り直す既存の仕組み
    // (pendingContentRef/scheduleSave)にそのまま乗って自動的に保存される。
    expect(updateMinutes).toHaveBeenCalledWith(
      'm1',
      '# 定例MTG\n\n決まったこと\n\n人が書き足した分\n\nAI秘書が追記した分',
      '2026-09-01T00:09:00.000000+00'
    )
  })

  it('致命2の再現テスト: 合流直後にflushPendingSave()を呼んだら、古いサーバー本文ではなく合流後の本文が返る', async () => {
    const { updateMinutes, fetchMeetingDetail, ref } = setup()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    fetchMeetingDetail.mockResolvedValue(
      makeMeeting({
        minutes_md: '# 定例MTG\n\n決まったこと\n\nAI秘書が追記した分',
        updated_at: '2026-09-01T00:09:00.000000+00',
      })
    )
    updateMinutes.mockRejectedValueOnce(new MinutesConflictError())

    act(() => capturedOnChange?.('# 定例MTG\n\n決まったこと\n\n人が書き足した分'))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500)
    })

    // タスク化がすぐ押された想定: デバウンス完了を待たず flushPendingSave を呼ぶ
    let flushed = ''
    await act(async () => {
      flushed = await ref.current!.flushPendingSave()
    })

    expect(flushed).toBe(
      '# 定例MTG\n\n決まったこと\n\n人が書き足した分\n\nAI秘書が追記した分'
    )
    expect(updateMinutes).toHaveBeenCalledWith(
      'm1',
      '# 定例MTG\n\n決まったこと\n\n人が書き足した分\n\nAI秘書が追記した分',
      '2026-09-01T00:09:00.000000+00'
    )
  })

  it('appendMarkdownがfalseを返すとき(差し込み失敗)は競合の帯を出す', async () => {
    const { updateMinutes, fetchMeetingDetail } = setup()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    mockAppendMarkdown.mockReturnValueOnce(false)

    fetchMeetingDetail.mockResolvedValue(
      makeMeeting({
        minutes_md: '# 定例MTG\n\n決まったこと\n\nAI秘書が追記した分',
        updated_at: '2026-09-01T00:09:00.000000+00',
      })
    )
    updateMinutes.mockRejectedValueOnce(new MinutesConflictError())

    act(() => capturedOnChange?.('# 定例MTG\n\n決まったこと\n\n人が書き足した分'))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500)
    })

    expect(screen.getByTestId('minutes-conflict-banner')).toBeInTheDocument()
  })

  it('差し込み口が登録されていない(API無し)ときも競合の帯を出す(黙って進めない)', async () => {
    apiAvailable = false
    const { updateMinutes, fetchMeetingDetail } = setup()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    fetchMeetingDetail.mockResolvedValue(
      makeMeeting({
        minutes_md: '# 定例MTG\n\n決まったこと\n\nAI秘書が追記した分',
        updated_at: '2026-09-01T00:09:00.000000+00',
      })
    )
    updateMinutes.mockRejectedValueOnce(new MinutesConflictError())

    act(() => capturedOnChange?.('# 定例MTG\n\n決まったこと\n\n人が書き足した分'))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500)
    })

    expect(mockAppendMarkdown).not.toHaveBeenCalled()
    expect(screen.getByTestId('minutes-conflict-banner')).toBeInTheDocument()
  })

  it('末尾への追記ではない(前方一致でない、または\\n\\n区切りが無い)変更なら、従来どおり競合の帯を出す', async () => {
    const { updateMinutes, fetchMeetingDetail } = setup()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    // 途中の文言が書き換えられている(前方一致ではない)
    fetchMeetingDetail.mockResolvedValue(
      makeMeeting({
        minutes_md: '# 定例MTG(改題)\n\n決まったこと',
        updated_at: '2026-09-01T00:09:00.000000+00',
      })
    )
    updateMinutes.mockRejectedValueOnce(new MinutesConflictError())

    act(() => capturedOnChange?.('# 定例MTG\n\n決まったこと\n\n人が書き足した分'))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500)
    })

    expect(screen.getByTestId('minutes-conflict-banner')).toBeInTheDocument()
    expect(mockAppendMarkdown).not.toHaveBeenCalled()
  })
})
