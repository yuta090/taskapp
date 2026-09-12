import React, { createRef } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import {
  MinutesDocumentView,
  MinutesSaveInProgressError,
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
//
// appendMarkdown は 'applied' | 'busy' | 'failed' の3通りを返す。'busy'（一時的：
// タスク化中の読み取り専用・日本語の変換中）は帯を出さずに決めた回数だけやり直し、
// 'failed'（恒久的）だけ帯を出す。

const AUTO_SAVE_DEBOUNCE_MS = 1500
// MinutesDocumentView.tsx の APPEND_RETRY_DELAYS_MS と同じ値（要素数=やり直す回数）
const APPEND_RETRY_DELAYS_MS = [1_500, 3_000]

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

// setEditing は全レンダーで同じ参照を返す（低2の検査で呼び出し回数を追うため）。
// vi.mock のファクトリはモジュール外の変数をクロージャで参照できる
// （実際に呼ばれるのはテスト本体の実行時=モジュール初期化が終わった後）。
const mockSetEditing = vi.fn()
vi.mock('@/lib/hooks/useMinutesPresence', () => ({
  useMinutesPresence: () => ({ others: [], setEditing: mockSetEditing }),
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
// MinutesEditorDynamic に最後に渡された editable プロップ。forceReadOnly が
// effectiveEditable=false にする実際の統合的な振る舞いを模すために使う。
let lastEditableProp = true

/**
 * appendMarkdown の既定の実装。実機と同じく、読み取り専用（lastEditableProp=false）
 * なら 'busy' を返す。それ以外は「今のエディタの中身 + \n\n + 追記」で成功を模す
 * （実際の MinutesEditor は末尾ブロックの後ろに挿すので同じ形になる）。
 * 個々のテストは `mockAppendMarkdown.mockImplementationOnce(() => 'busy'|'failed')`
 * などでこの既定を1回だけ上書きできる。
 */
function defaultAppendImpl(addition: string): 'applied' | 'busy' | 'failed' {
  if (!lastEditableProp) return 'busy'
  currentEditorContent = `${currentEditorContent}\n\n${addition}`
  capturedOnChange?.(currentEditorContent)
  return 'applied'
}
const mockAppendMarkdown = vi.fn(defaultAppendImpl)

vi.mock('@/components/meeting/MinutesEditorDynamic', () => ({
  MinutesEditorDynamic: (props: {
    minutesMd: string
    editable: boolean
    onChange?: (md: string) => void
    registerApi?: (api: { appendMarkdown: (md: string) => 'applied' | 'busy' | 'failed' } | null) => void
  }) => {
    const initializedRef = React.useRef(false)
    if (!initializedRef.current) {
      currentEditorContent = props.minutesMd
      initializedRef.current = true
    }
    lastEditableProp = props.editable
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

const BASE_MD = '# 定例MTG\n\n決まったこと'
const HUMAN_EDIT = `${BASE_MD}\n\n人が書き足した分`
const AI_ADDITION = 'AI秘書が追記した分'
const SERVER_WITH_ADDITION = `${BASE_MD}\n\n${AI_ADDITION}`
const NEW_UPDATED_AT = '2026-09-01T00:09:00.000000+00'

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
    minutes_md: BASE_MD,
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

/** 競合→末尾追記の読み直しが起きる状況を仕込む共通処理 */
function primeAppendedConflict(
  updateMinutes: ReturnType<typeof setup>['updateMinutes'],
  fetchMeetingDetail: ReturnType<typeof setup>['fetchMeetingDetail']
) {
  fetchMeetingDetail.mockResolvedValue(makeMeeting({ minutes_md: SERVER_WITH_ADDITION, updated_at: NEW_UPDATED_AT }))
  updateMinutes.mockRejectedValueOnce(new MinutesConflictError())
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  capturedOnChange = undefined
  mountCount = 0
  mockWriteText.mockClear()
  mockAppendMarkdown.mockClear()
  mockAppendMarkdown.mockImplementation(defaultAppendImpl)
  apiAvailable = true
  currentEditorContent = ''
  lastEditableProp = true
})

afterEach(() => {
  vi.useRealTimers()
})

describe('AI秘書の末尾追記との自動合流（適用できたとき）', () => {
  it('DBの本文が自分の基準の"\\n\\n"区切りの前方一致(末尾への追記)なら、appendMarkdownへ足された分だけを渡し、帯を出さない', async () => {
    const { updateMinutes, fetchMeetingDetail } = setup()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(mountCount).toBe(1)

    primeAppendedConflict(updateMinutes, fetchMeetingDetail)

    act(() => capturedOnChange?.(HUMAN_EDIT))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(AUTO_SAVE_DEBOUNCE_MS)
    })

    // (a) appendMarkdown には「足された分の Markdown だけ」が渡る
    expect(mockAppendMarkdown).toHaveBeenCalledWith(AI_ADDITION)

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

    primeAppendedConflict(updateMinutes, fetchMeetingDetail)

    act(() => capturedOnChange?.(HUMAN_EDIT))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(AUTO_SAVE_DEBOUNCE_MS)
    })

    // appendMarkdown 呼び出し(モック内)が onChange を発火させ、それが保存を積む。
    // 追加の入力をしなくても、通信中に来た本文を送り直す既存の仕組み
    // (pendingContentRef/scheduleSave)にそのまま乗って自動的に保存される。
    expect(updateMinutes).toHaveBeenCalledWith('m1', `${HUMAN_EDIT}\n\n${AI_ADDITION}`, NEW_UPDATED_AT)
  })

  it('致命2の再現テスト(手で解決するPromise): 差し込み直後・保存が飛んでいる最中にflushPendingSave()を呼んでも嘘をつかない', async () => {
    // 2回目(合流後の連鎖保存)の updateMinutes をわざと未確定のままにし、
    // 「まだ確定していない」状態で flushPendingSave を呼んだときの挙動を検査する。
    let resolveSecond!: (v: { minutesMd: string; updatedAt: string }) => void
    let callCount = 0
    const updateMinutes = vi.fn().mockImplementation(() => {
      callCount += 1
      if (callCount === 1) return Promise.reject(new MinutesConflictError())
      return new Promise((resolve) => {
        resolveSecond = resolve
      })
    })
    const { fetchMeetingDetail, ref } = setup({}, { updateMinutes })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    primeAppendedConflict(updateMinutes, fetchMeetingDetail)
    // primeAppendedConflict は1回目だけ reject するが、ここでは updateMinutes 自体を
    // 独自実装で差し替えているため、mockRejectedValueOnce の積み増しは使わず
    // callCount ベースの実装をそのまま使う（reject は既に callCount===1 で発生する）。

    act(() => capturedOnChange?.(HUMAN_EDIT))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(AUTO_SAVE_DEBOUNCE_MS)
    })

    // ここまでで: 1回目(競合)→合流→連鎖で2回目の updateMinutes が呼ばれ、
    // まだ確定していない(resolveSecond は未解決)。savingRef はまだ真のはず。
    await expect(ref.current!.flushPendingSave()).rejects.toThrow(MinutesSaveInProgressError)

    // 後始末: 未処理の Promise を残さない
    resolveSecond({ minutesMd: `${HUMAN_EDIT}\n\n${AI_ADDITION}`, updatedAt: 'final' })
    await act(async () => {
      await Promise.resolve()
    })
  })
})

describe('AI秘書の末尾追記との自動合流（一時的に取り込めない: busy）', () => {
  it('busyのときは帯を出さない', async () => {
    const { updateMinutes, fetchMeetingDetail } = setup()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    primeAppendedConflict(updateMinutes, fetchMeetingDetail)
    mockAppendMarkdown.mockImplementationOnce(() => 'busy')

    act(() => capturedOnChange?.(HUMAN_EDIT))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(AUTO_SAVE_DEBOUNCE_MS)
    })

    expect(screen.queryByTestId('minutes-conflict-banner')).not.toBeInTheDocument()
  })

  it('busyの後、APPEND_RETRY_DELAYS_MS[0]経過でやり直し、"applied"になれば帯を出さず保存される', async () => {
    const { updateMinutes, fetchMeetingDetail } = setup()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    fetchMeetingDetail.mockResolvedValue(makeMeeting({ minutes_md: SERVER_WITH_ADDITION, updated_at: NEW_UPDATED_AT }))
    // 1回目・やり直し(busyのまま基準を進めていないので再送も同じ理由で競合する)の
    // 2回とも競合させ、3回目(合流成功後の連鎖保存)だけ既定の成功にする。
    updateMinutes.mockRejectedValueOnce(new MinutesConflictError()).mockRejectedValueOnce(new MinutesConflictError())
    mockAppendMarkdown.mockImplementationOnce(() => 'busy')

    act(() => capturedOnChange?.(HUMAN_EDIT))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(AUTO_SAVE_DEBOUNCE_MS)
    })
    expect(mockAppendMarkdown).toHaveBeenCalledTimes(1)
    expect(screen.queryByTestId('minutes-conflict-banner')).not.toBeInTheDocument()

    // 1回目の busy から APPEND_RETRY_DELAYS_MS[0] 経過でやり直す(2回目は既定=applied)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(APPEND_RETRY_DELAYS_MS[0])
    })
    expect(mockAppendMarkdown).toHaveBeenCalledTimes(2)
    expect(screen.queryByTestId('minutes-conflict-banner')).not.toBeInTheDocument()
    expect(updateMinutes).toHaveBeenCalledWith('m1', `${HUMAN_EDIT}\n\n${AI_ADDITION}`, NEW_UPDATED_AT)
  })

  it('2回ともbusyなら3回目の試行で帯が出る（回数を使い切ったら帯に倒す）', async () => {
    const { updateMinutes, fetchMeetingDetail } = setup()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    fetchMeetingDetail.mockResolvedValue(makeMeeting({ minutes_md: SERVER_WITH_ADDITION, updated_at: NEW_UPDATED_AT }))
    // 合流できないまま(busyのまま)なので、DBの本文は毎回変わらず、保存は毎回競合する
    updateMinutes.mockRejectedValue(new MinutesConflictError())
    mockAppendMarkdown.mockImplementation(() => 'busy')

    act(() => capturedOnChange?.(HUMAN_EDIT))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(AUTO_SAVE_DEBOUNCE_MS)
    }) // 1回目の試行: busy
    expect(screen.queryByTestId('minutes-conflict-banner')).not.toBeInTheDocument()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(APPEND_RETRY_DELAYS_MS[0])
    }) // 2回目の試行: busy
    expect(screen.queryByTestId('minutes-conflict-banner')).not.toBeInTheDocument()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(APPEND_RETRY_DELAYS_MS[1])
    }) // 3回目の試行: 回数を使い切って帯を出す
    expect(mockAppendMarkdown).toHaveBeenCalledTimes(3)
    expect(screen.getByTestId('minutes-conflict-banner')).toBeInTheDocument()
  })

  it('読み取り専用(forceReadOnly)中に追記が来ても帯を出さない(タスク化中の行き止まりが消えたこと)', async () => {
    const { updateMinutes, fetchMeetingDetail, rerender, meeting } = setup()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    primeAppendedConflict(updateMinutes, fetchMeetingDetail)

    act(() => capturedOnChange?.(HUMAN_EDIT))

    // タスク化が始まり、読み取り専用になった（本体は作り直されない。forceReadOnly だけ変わる）
    rerender(
      <MinutesDocumentView
        orgId="org1"
        spaceId="space1"
        meeting={meeting}
        canEdit
        forceReadOnly
        onBack={vi.fn()}
        onOpenInfo={vi.fn()}
        updateMinutes={updateMinutes}
        fetchMeetingDetail={fetchMeetingDetail}
      />
    )

    await act(async () => {
      await vi.advanceTimersByTimeAsync(AUTO_SAVE_DEBOUNCE_MS)
    })

    // 実機の appendMarkdown と同じく、読み取り専用(effectiveEditable=false)なので
    // 'busy' が返り、帯は出ない
    expect(screen.queryByTestId('minutes-conflict-banner')).not.toBeInTheDocument()
  })

  it('差し込み口が登録されていない(API無し)ときも一時的な busy と同じ扱いにし、回数を使い切ったら帯を出す', async () => {
    apiAvailable = false
    const { updateMinutes, fetchMeetingDetail } = setup()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    fetchMeetingDetail.mockResolvedValue(makeMeeting({ minutes_md: SERVER_WITH_ADDITION, updated_at: NEW_UPDATED_AT }))
    updateMinutes.mockRejectedValue(new MinutesConflictError())

    act(() => capturedOnChange?.(HUMAN_EDIT))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(AUTO_SAVE_DEBOUNCE_MS)
    })
    expect(screen.queryByTestId('minutes-conflict-banner')).not.toBeInTheDocument()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(APPEND_RETRY_DELAYS_MS[0])
    })
    expect(screen.queryByTestId('minutes-conflict-banner')).not.toBeInTheDocument()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(APPEND_RETRY_DELAYS_MS[1])
    })
    expect(mockAppendMarkdown).not.toHaveBeenCalled()
    expect(screen.getByTestId('minutes-conflict-banner')).toBeInTheDocument()
  })
})

describe('AI秘書の末尾追記との自動合流（恒久的に取り込めない: failed）', () => {
  it('appendMarkdownが"failed"を返すとき(恒久的な失敗)は競合の帯を出す', async () => {
    const { updateMinutes, fetchMeetingDetail } = setup()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    mockAppendMarkdown.mockImplementationOnce(() => 'failed')
    primeAppendedConflict(updateMinutes, fetchMeetingDetail)

    act(() => capturedOnChange?.(HUMAN_EDIT))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(AUTO_SAVE_DEBOUNCE_MS)
    })

    expect(screen.getByTestId('minutes-conflict-banner')).toBeInTheDocument()
  })

  it('末尾への追記ではない(前方一致でない、または\\n\\n区切りが無い)変更なら、従来どおり競合の帯を出す', async () => {
    const { updateMinutes, fetchMeetingDetail } = setup()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    // 途中の文言が書き換えられている(前方一致ではない)
    fetchMeetingDetail.mockResolvedValue(
      makeMeeting({ minutes_md: '# 定例MTG(改題)\n\n決まったこと', updated_at: NEW_UPDATED_AT })
    )
    updateMinutes.mockRejectedValueOnce(new MinutesConflictError())

    act(() => capturedOnChange?.(HUMAN_EDIT))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(AUTO_SAVE_DEBOUNCE_MS)
    })

    expect(screen.getByTestId('minutes-conflict-banner')).toBeInTheDocument()
    expect(mockAppendMarkdown).not.toHaveBeenCalled()
  })
})

describe('低1: 差し込み成功直後の余分な保存の抑止', () => {
  it('"applied"になった直後、差し込みのonChangeが張った通常のデバウンスタイマーは畳まれ、余分な保存は走らない', async () => {
    const { updateMinutes, fetchMeetingDetail } = setup()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    primeAppendedConflict(updateMinutes, fetchMeetingDetail)

    act(() => capturedOnChange?.(HUMAN_EDIT))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(AUTO_SAVE_DEBOUNCE_MS)
    })
    // ここまでで: 1回目(競合)→合流→連鎖の2回目(成功)で計2回
    expect(updateMinutes).toHaveBeenCalledTimes(2)

    updateMinutes.mockClear()
    // 通常のデバウンスタイマーが畳まれていなければ、AUTO_SAVE_DEBOUNCE_MS 後に
    // もう1回同じ内容の保存が余分に走ってしまう。ここでは走らないことを確認する。
    await act(async () => {
      await vi.advanceTimersByTimeAsync(AUTO_SAVE_DEBOUNCE_MS)
    })
    expect(updateMinutes).not.toHaveBeenCalled()
  })
})

describe('低2: 合流の差し込み中は「自分が書いています」を立てない', () => {
  it('人の入力では setEditing(true) を呼ぶが、合流の差し込み中は呼ばない', async () => {
    const { updateMinutes, fetchMeetingDetail } = setup()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    primeAppendedConflict(updateMinutes, fetchMeetingDetail)

    act(() => capturedOnChange?.(HUMAN_EDIT))
    // 人の入力では setEditing(true) が呼ばれる
    expect(mockSetEditing).toHaveBeenCalledWith(true)
    mockSetEditing.mockClear()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(AUTO_SAVE_DEBOUNCE_MS)
    })

    // 合流の差し込み（appendMarkdown経由のonChange）では setEditing(true) を呼ばない
    // （席を外していても「書いています」と誤って出さないため）
    expect(mockSetEditing).not.toHaveBeenCalledWith(true)
  })
})
