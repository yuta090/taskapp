import React, { createRef } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import {
  MinutesDocumentView,
  type MinutesDocumentViewHandle,
} from '@/components/meeting/MinutesDocumentView'
import { MinutesConflictError } from '@/lib/hooks/useMeetings'
import type { Meeting } from '@/types/database'

// 議事録の文書ビュー。中央の広い領域に Wiki と同じ書き味で本文を出し、自動保存する。
//
// 重大1（データ消失）: 一覧の行は minutes_md を取っていない(undefined)ため、そのまま
// 種(seed)にすると本文が空で開き、1文字書くと既存の議事録が消える。→ 開くたびに必ず
// fetchMeetingDetail で取り直し、その結果だけを本文・基準にする。届くまではエディタを出さない。
//
// 重大2（データ消失）: 一覧のキャッシュ(['meetings', spaceId])は既定で2分で古くなり、
// 画面に戻ると取り直されて minutes_md 無しの行に置き換わる。meeting.minutes_md の有無で
// 描画を決めていると、そのたびにエディタが外れ、開いたときの本文で作り直されてしまう
// （楽観ロックの基準は自動保存で進んでいるため、次の保存が「別の場所の更新」に気づけず
// 通ってしまい、途中までの編集が消える）。→ 本文と基準は画面の中の状態として持ち、
// 一覧のキャッシュ変化では作り直さない（会議の切り替え・最新を読み込む・タスク化後だけ作り直す）。

vi.mock('@/lib/hooks/useAnnouncements', () => ({
  useAnnouncements: () => ({ announcements: [], unreadCount: 0, markAsRead: vi.fn(), markAllAsRead: vi.fn() }),
}))

vi.mock('@/lib/hooks/useIsMobile', () => ({ useIsMobile: () => false }))

let capturedOnChange: ((md: string) => void) | undefined
let lastEditorProps: { minutesMd: string; editable: boolean } | null = null
let mountCount = 0

vi.mock('@/components/meeting/MinutesEditorDynamic', () => ({
  MinutesEditorDynamic: (props: { minutesMd: string; editable: boolean; onChange?: (md: string) => void }) => {
    capturedOnChange = props.onChange
    lastEditorProps = { minutesMd: props.minutesMd, editable: props.editable }
    React.useEffect(() => {
      mountCount += 1
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
    minutes_md: '# 定例MTG\n\n本文',
    summary_subject: null,
    summary_body: null,
    ...overrides,
  } as Meeting
}

/** 一覧の行（詳細未取得）: minutes_md は列を取っていないので undefined */
function makeListRow(overrides: Partial<Meeting> = {}): Meeting {
  return makeMeeting({ minutes_md: undefined, ...overrides } as Partial<Meeting>)
}

function deferred<T>() {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function setup(meetingOverrides: Partial<Meeting> = {}, extraProps: Record<string, unknown> = {}) {
  const meeting = makeMeeting(meetingOverrides)
  // 既定では、送った内容がそのままサーバーの minutes_md になったことにする
  // （HIGH-2 の「サーバーにあると分かっている生の本文」追跡と整合させるため）
  const updateMinutes = vi
    .fn()
    .mockImplementation(async (_id: string, content: string) => ({
      minutesMd: content,
      updatedAt: '2026-09-01T00:00:01.222222+00',
    }))
  const fetchMeetingDetail = vi.fn().mockResolvedValue(makeMeeting())
  const onBack = vi.fn()
  const onOpenInfo = vi.fn()
  const ref = createRef<MinutesDocumentViewHandle>()

  const utils = render(
    <MinutesDocumentView
      ref={ref}
      orgId="org1"
      spaceId="space1"
      meeting={meeting}
      canEdit
      onBack={onBack}
      onOpenInfo={onOpenInfo}
      updateMinutes={updateMinutes}
      fetchMeetingDetail={fetchMeetingDetail}
      {...extraProps}
    />
  )

  return { meeting, updateMinutes, fetchMeetingDetail, onBack, onOpenInfo, ref, ...utils }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  capturedOnChange = undefined
  lastEditorProps = null
  mountCount = 0
  mockWriteText.mockClear()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('重大1: 一覧の行(minutes_md未取得)から開いても、必ず詳細を取り直してから本文を出す', () => {
  it('マウントしたら fetchMeetingDetail を呼ぶ（一覧に minutes_md が既にあっても呼ぶ）', () => {
    const { fetchMeetingDetail } = setup()
    expect(fetchMeetingDetail).toHaveBeenCalledWith('m1')
  })

  it('詳細が届くまではエディタを出さない（読み込み中の表示だけ）', async () => {
    const { promise, resolve } = deferred<Meeting>()
    const meeting = makeListRow()
    const fetchMeetingDetail = vi.fn().mockReturnValue(promise)
    render(
      <MinutesDocumentView
        orgId="org1"
        spaceId="space1"
        meeting={meeting}
        canEdit
        onBack={vi.fn()}
        onOpenInfo={vi.fn()}
        updateMinutes={vi.fn().mockResolvedValue({ minutesMd: null, updatedAt: '9999-01-01T00:00:00.000000+00' })}
        fetchMeetingDetail={fetchMeetingDetail}
      />
    )

    expect(screen.queryByTestId('minutes-editor')).not.toBeInTheDocument()
    expect(screen.getByText('読み込み中...')).toBeInTheDocument()

    await act(async () => {
      resolve(makeMeeting({ minutes_md: 'キックオフの本文' }))
      await promise
    })

    expect(screen.getByTestId('minutes-editor')).toBeInTheDocument()
    expect(lastEditorProps?.minutesMd).toBe('キックオフの本文')
  })

  it('詳細が届く前に保存関数が呼ばれることはない（エディタが無いので入力できない）', async () => {
    const { promise } = deferred<Meeting>()
    const updateMinutes = vi.fn()
    const fetchMeetingDetail = vi.fn().mockReturnValue(promise)
    render(
      <MinutesDocumentView
        orgId="org1"
        spaceId="space1"
        meeting={makeListRow()}
        canEdit
        onBack={vi.fn()}
        onOpenInfo={vi.fn()}
        updateMinutes={updateMinutes}
        fetchMeetingDetail={fetchMeetingDetail}
      />
    )

    expect(screen.queryByTestId('minutes-editor')).not.toBeInTheDocument()
    expect(capturedOnChange).toBeUndefined()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000)
    })
    expect(updateMinutes).not.toHaveBeenCalled()
  })

  it('一覧のキャッシュに古い本文(IDB由来)が残っていても、取り直した本文で出す', async () => {
    // meeting prop 自体に「前回開いたときの古い本文」が残っている状態（IDB永続化された
    // 直近のクエリ結果）を模す。fetchMeetingDetail が返す最新の本文が優先されること。
    const fetchMeetingDetail = vi
      .fn()
      .mockResolvedValue(makeMeeting({ minutes_md: '最新の本文', updated_at: '2026-09-01T00:00:09.999999+00' }))

    render(
      <MinutesDocumentView
        orgId="org1"
        spaceId="space1"
        meeting={makeMeeting({ minutes_md: '古いキャッシュ本文', updated_at: '2026-09-01T00:00:00.000000+00' })}
        canEdit
        onBack={vi.fn()}
        onOpenInfo={vi.fn()}
        updateMinutes={vi.fn().mockResolvedValue({ minutesMd: null, updatedAt: '9999-01-01T00:00:00.000000+00' })}
        fetchMeetingDetail={fetchMeetingDetail}
      />
    )

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(lastEditorProps?.minutesMd).toBe('最新の本文')
  })

  it('取り直しが失敗したらエディタを出さずエラー案内を出す', async () => {
    const fetchMeetingDetail = vi.fn().mockRejectedValue(new Error('network error'))
    render(
      <MinutesDocumentView
        orgId="org1"
        spaceId="space1"
        meeting={makeListRow()}
        canEdit
        onBack={vi.fn()}
        onOpenInfo={vi.fn()}
        updateMinutes={vi.fn().mockResolvedValue({ minutesMd: null, updatedAt: '9999-01-01T00:00:00.000000+00' })}
        fetchMeetingDetail={fetchMeetingDetail}
      />
    )

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(screen.queryByTestId('minutes-editor')).not.toBeInTheDocument()
    expect(screen.getByText('議事録を読み込めませんでした')).toBeInTheDocument()
    const retryButton = screen.getByText('再試行')

    fetchMeetingDetail.mockResolvedValue(makeMeeting({ minutes_md: '再取得できた本文' }))
    await act(async () => {
      fireEvent.click(retryButton)
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(screen.getByTestId('minutes-editor')).toBeInTheDocument()
    expect(lastEditorProps?.minutesMd).toBe('再取得できた本文')
  })

  it('取り直しが null を返した場合もエディタを出さずエラー案内を出す', async () => {
    const fetchMeetingDetail = vi.fn().mockResolvedValue(null)
    render(
      <MinutesDocumentView
        orgId="org1"
        spaceId="space1"
        meeting={makeListRow()}
        canEdit
        onBack={vi.fn()}
        onOpenInfo={vi.fn()}
        updateMinutes={vi.fn().mockResolvedValue({ minutesMd: null, updatedAt: '9999-01-01T00:00:00.000000+00' })}
        fetchMeetingDetail={fetchMeetingDetail}
      />
    )

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(screen.queryByTestId('minutes-editor')).not.toBeInTheDocument()
    expect(screen.getByText('議事録を読み込めませんでした')).toBeInTheDocument()
  })
})

describe('重大2: 一覧のキャッシュが変わってもエディタを外さない・作り直さない', () => {
  it('詳細が届いた後、一覧のキャッシュが minutes_md 無しの行に戻ってもエディタは残り、入力中の本文も残る', async () => {
    const fetchMeetingDetail = vi.fn().mockResolvedValue(makeMeeting({ minutes_md: '最初に届いた本文' }))
    const { rerender } = render(
      <MinutesDocumentView
        orgId="org1"
        spaceId="space1"
        meeting={makeListRow()}
        canEdit
        onBack={vi.fn()}
        onOpenInfo={vi.fn()}
        updateMinutes={vi.fn().mockResolvedValue({ minutesMd: null, updatedAt: '9999-01-01T00:00:00.000000+00' })}
        fetchMeetingDetail={fetchMeetingDetail}
      />
    )

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(screen.getByTestId('minutes-editor')).toBeInTheDocument()
    expect(fetchMeetingDetail).toHaveBeenCalledTimes(1)

    // 入力中の本文を作る（保存はまだ走らせない）
    act(() => capturedOnChange?.('最初に届いた本文\n\n入力中の追記'))

    // 一覧の再取得(staleTime超過)で meeting.id は同じまま minutes_md が undefined に戻る
    // ケースを模す。id が同じなら再取得はしない（会議の切り替えではないため）。
    rerender(
      <MinutesDocumentView
        orgId="org1"
        spaceId="space1"
        meeting={makeListRow({ updated_at: '2026-09-01T00:05:00.000000+00' })}
        canEdit
        onBack={vi.fn()}
        onOpenInfo={vi.fn()}
        updateMinutes={vi.fn().mockResolvedValue({ minutesMd: null, updatedAt: '9999-01-01T00:00:00.000000+00' })}
        fetchMeetingDetail={fetchMeetingDetail}
      />
    )

    expect(fetchMeetingDetail).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('minutes-editor')).toBeInTheDocument()
    expect(mountCount).toBe(1)
  })
})

describe('MinutesDocumentView 開いただけでは保存しない', () => {
  it('マウント直後に onChange が正規化済みの同じ内容で呼ばれても保存は走らない', async () => {
    const { updateMinutes } = setup()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(screen.getByTestId('minutes-editor')).toBeInTheDocument()

    // BlockNote が初期表示直後に normalize 済みの同一内容で onChange を呼ぶケースを模す
    act(() => capturedOnChange?.('# 定例MTG\n\n本文'))

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000)
    })

    expect(updateMinutes).not.toHaveBeenCalled()
  })
})

describe('MinutesDocumentView 自動保存', () => {
  it('編集後、デバウンスを経て正規化済みMarkdownで保存する', async () => {
    const { updateMinutes, meeting } = setup()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    act(() => capturedOnChange?.('# 定例MTG\n\n編集後の本文'))

    // デバウンス中はまだ呼ばれない
    expect(updateMinutes).not.toHaveBeenCalled()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500)
    })

    expect(updateMinutes).toHaveBeenCalledWith(
      'm1',
      '# 定例MTG\n\n編集後の本文',
      meeting.updated_at
    )
  })

  it('保存中→保存済みの表示が出る', async () => {
    setup()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    act(() => capturedOnChange?.('新しい本文'))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500)
    })
    expect(screen.getByText('保存済み')).toBeInTheDocument()
  })

  it('自分の保存の後にエディタが作り直されない（key・マウント回数が変わらない）', async () => {
    const { updateMinutes } = setup()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(mountCount).toBe(1)

    act(() => capturedOnChange?.('保存する本文'))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500)
    })
    expect(updateMinutes).toHaveBeenCalledTimes(1)
    expect(mountCount).toBe(1)
  })
})

describe('MinutesDocumentView 空本文', () => {
  it('本文が空になったら保存せず注意文を出す(minutes-empty-notice)', async () => {
    const { updateMinutes } = setup()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    act(() => capturedOnChange?.('   '))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000)
    })

    expect(updateMinutes).not.toHaveBeenCalled()
    expect(screen.getByTestId('minutes-empty-notice')).toBeInTheDocument()
    expect(screen.getByText('本文が空です。保存されていません')).toBeInTheDocument()
  })
})

describe('MinutesDocumentView 競合（本当に本文が変わったとき。HIGH-2）', () => {
  it('保存が0行(競合)になっても、サーバーの本文が変わっていなければ帯を出さず、基準だけ差し替えて1回だけ送り直す', async () => {
    // 開始・終了などで updated_at だけが進んだ見せかけの競合
    const { updateMinutes, fetchMeetingDetail, meeting } = setup()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    // サーバーの本文は開いたときのまま(=knownServerRaw)。updated_at だけ進んでいる
    fetchMeetingDetail.mockResolvedValue(makeMeeting({ updated_at: '2026-09-01T00:09:00.000000+00' }))
    updateMinutes.mockRejectedValueOnce(new MinutesConflictError())

    act(() => capturedOnChange?.('編集した本文'))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500)
    })

    expect(screen.queryByTestId('minutes-conflict-banner')).not.toBeInTheDocument()
    expect(screen.getByText('保存済み')).toBeInTheDocument()
    // 1回目(古い基準で失敗)+2回目(新しい基準で成功)
    expect(updateMinutes).toHaveBeenCalledTimes(2)
    expect(updateMinutes).toHaveBeenNthCalledWith(1, 'm1', '編集した本文', meeting.updated_at)
    expect(updateMinutes).toHaveBeenNthCalledWith(2, 'm1', '編集した本文', '2026-09-01T00:09:00.000000+00')
  })

  it('保存が0行(競合)になり、サーバーの本文も変わっていれば帯(minutes-conflict-banner)を出し、以後の自動保存を止める', async () => {
    const { updateMinutes, fetchMeetingDetail } = setup()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    // AI・ほかの人が本文そのものを書き換えていた（本当の競合）
    fetchMeetingDetail.mockResolvedValue(makeMeeting({ minutes_md: 'AIが書き換えた本文' }))
    updateMinutes.mockRejectedValueOnce(new MinutesConflictError())

    act(() => capturedOnChange?.('編集した本文'))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500)
    })

    expect(screen.getByTestId('minutes-conflict-banner')).toBeInTheDocument()
    expect(
      screen.getByText(/AI秘書やほかの人が、この議事録を先に書き換えました/)
    ).toBeInTheDocument()
    // 1回だけ試して、リトライはしない
    expect(updateMinutes).toHaveBeenCalledTimes(1)

    // 競合後にさらに編集しても自動保存は走らない
    updateMinutes.mockClear()
    act(() => capturedOnChange?.('さらに編集した本文'))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000)
    })
    expect(updateMinutes).not.toHaveBeenCalled()
  })

  it('「書きかけをコピー」で今の本文をクリップボードへコピーする', async () => {
    const { updateMinutes, fetchMeetingDetail } = setup()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    fetchMeetingDetail.mockResolvedValue(makeMeeting({ minutes_md: 'AIが書き換えた本文' }))
    updateMinutes.mockRejectedValueOnce(new MinutesConflictError())

    act(() => capturedOnChange?.('編集した本文'))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500)
    })
    expect(screen.getByText('書きかけをコピー')).toBeInTheDocument()

    await act(async () => {
      fireEvent.click(screen.getByText('書きかけをコピー'))
    })
    expect(mockWriteText).toHaveBeenCalledWith('編集した本文')
  })

  it('「最新を読み込む」で詳細を取り直し、帯を閉じてエディタを作り直す', async () => {
    const { updateMinutes, fetchMeetingDetail } = setup()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    fetchMeetingDetail.mockResolvedValue(makeMeeting({ minutes_md: 'AIが書き換えた本文' }))
    updateMinutes.mockRejectedValueOnce(new MinutesConflictError())

    act(() => capturedOnChange?.('編集した本文'))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500)
    })
    expect(screen.getByText('最新を読み込む')).toBeInTheDocument()

    const fresh = makeMeeting({ minutes_md: 'サーバー側の最新本文', updated_at: '2026-09-01T00:00:02.333333+00' })
    fetchMeetingDetail.mockResolvedValue(fresh)
    await act(async () => {
      fireEvent.click(screen.getByText('最新を読み込む'))
    })

    expect(fetchMeetingDetail).toHaveBeenCalledWith('m1')
    expect(screen.queryByTestId('minutes-conflict-banner')).not.toBeInTheDocument()
    expect(lastEditorProps?.minutesMd).toBe('サーバー側の最新本文')

    // 作り直した後の編集は、新しい基準(updated_at)で保存する
    updateMinutes.mockClear()
    act(() => capturedOnChange?.('新しい基準からの編集'))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500)
    })
    expect(updateMinutes).toHaveBeenCalledWith('m1', '新しい基準からの編集', '2026-09-01T00:00:02.333333+00')
  })
})

describe('MinutesDocumentView 権限', () => {
  it('書けない人は読み取り専用', async () => {
    setup({}, { canEdit: false })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(screen.getByTestId('minutes-editor')).toHaveAttribute('data-editable', 'false')
  })

  it('予定(planned)の会議でも書ける人は書ける（status では決めない）', async () => {
    setup({ status: 'planned' }, { canEdit: true })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(screen.getByTestId('minutes-editor')).toHaveAttribute('data-editable', 'true')
  })
})

describe('MinutesDocumentView E2E目印・見出し', () => {
  it('一番外側に minutes-document-view の目印を持つ', async () => {
    setup()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(screen.getByTestId('minutes-document-view')).toBeInTheDocument()
  })
})

describe('MinutesDocumentView タスク化のための保留中保存の即時反映', () => {
  it('flushPendingSave: 保留中の保存があれば即座に流し、保存後の本文を返す', async () => {
    const { updateMinutes, ref, meeting } = setup()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    act(() => capturedOnChange?.('保存前の本文'))

    let flushed = ''
    await act(async () => {
      flushed = await ref.current!.flushPendingSave()
    })

    expect(updateMinutes).toHaveBeenCalledWith('m1', '保存前の本文', meeting.updated_at)
    expect(flushed).toBe('保存前の本文')
  })

  it('flushPendingSave: 保留中の保存が無ければ何もせず今の本文を返す', async () => {
    const { updateMinutes, ref } = setup()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    let flushed = ''
    await act(async () => {
      flushed = await ref.current!.flushPendingSave()
    })

    expect(updateMinutes).not.toHaveBeenCalled()
    expect(flushed).toBe('# 定例MTG\n\n本文')
  })

  it('HIGH-1: 競合中は flushPendingSave が本文を返さず例外を投げる（タスク化に確定していない本文を渡さない）', async () => {
    const { updateMinutes, fetchMeetingDetail, ref } = setup()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    fetchMeetingDetail.mockResolvedValue(makeMeeting({ minutes_md: 'AIが書き換えた本文' }))
    updateMinutes.mockRejectedValueOnce(new MinutesConflictError())

    act(() => capturedOnChange?.('編集した本文'))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500)
    })
    expect(screen.getByTestId('minutes-conflict-banner')).toBeInTheDocument()

    await expect(ref.current!.flushPendingSave()).rejects.toThrow()
  })

  it('HIGH-1: 保存に失敗した直後は flushPendingSave が例外を投げる', async () => {
    const { updateMinutes, ref } = setup()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    updateMinutes.mockRejectedValueOnce(new Error('network down'))

    act(() => capturedOnChange?.('編集した本文'))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500)
    })

    await expect(ref.current!.flushPendingSave()).rejects.toThrow()
  })

  it('HIGH-1: 別の保存が通信中(保存中)なら flushPendingSave は待たずに例外を投げる', async () => {
    let resolveSave!: (v: { minutesMd: string; updatedAt: string }) => void
    const updateMinutes = vi.fn().mockImplementation(
      () => new Promise((resolve) => { resolveSave = resolve })
    )
    const { ref } = setup({}, { updateMinutes })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    act(() => capturedOnChange?.('編集1'))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500)
    })
    // この時点で updateMinutes は呼ばれ、まだ解決していない（通信中）
    expect(updateMinutes).toHaveBeenCalledTimes(1)

    act(() => capturedOnChange?.('編集2'))
    await expect(ref.current!.flushPendingSave()).rejects.toThrow()

    resolveSave({ minutesMd: '編集1', updatedAt: 'X' })
    await act(async () => {
      await Promise.resolve()
    })
  })
})

describe('HIGH-3: 入力の直後に離れても最後の入力を失わない', () => {
  it('デバウンス中にアンマウントしたら、保留中の本文を state を触らず送る', async () => {
    const updateMinutes = vi.fn().mockResolvedValue({ minutesMd: 'A 最後の一文', updatedAt: 'U2' })
    const { unmount, meeting } = setup({}, { updateMinutes })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    act(() => capturedOnChange?.('A 最後の一文'))
    unmount()

    expect(updateMinutes).toHaveBeenCalledWith('m1', 'A 最後の一文', meeting.updated_at)
  })

  it('「戻る」は保存を待ってから戻る', async () => {
    let resolveSave!: (v: { minutesMd: string; updatedAt: string }) => void
    const updateMinutes = vi.fn().mockImplementation(
      () => new Promise((resolve) => { resolveSave = resolve })
    )
    const { onBack } = setup({}, { updateMinutes })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    act(() => capturedOnChange?.('編集した本文'))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500)
    })

    const backButton = screen.getByLabelText('会議一覧へ戻る')
    fireEvent.click(backButton)
    // 保存(通信)が終わるまでは戻らない
    expect(onBack).not.toHaveBeenCalled()

    await act(async () => {
      resolveSave({ minutesMd: '編集した本文', updatedAt: 'U9' })
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(onBack).toHaveBeenCalledTimes(1)
  })

  it('未保存の間は beforeunload で確認を出す', async () => {
    setup()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    act(() => capturedOnChange?.('編集した本文'))

    const event = new Event('beforeunload', { cancelable: true }) as BeforeUnloadEvent
    const preventDefaultSpy = vi.spyOn(event, 'preventDefault')
    window.dispatchEvent(event)
    expect(preventDefaultSpy).toHaveBeenCalled()
  })

  it('保存済みで何も変えていなければ beforeunload で止めない', async () => {
    setup()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    const event = new Event('beforeunload', { cancelable: true }) as BeforeUnloadEvent
    const preventDefaultSpy = vi.spyOn(event, 'preventDefault')
    window.dispatchEvent(event)
    expect(preventDefaultSpy).not.toHaveBeenCalled()
  })
})

describe('M1: 閲覧だけの人(canEdit=false)はチェックボックス等の操作でも保存が走らない', () => {
  it('canEdit=false なら onChange 自体を渡さない', async () => {
    setup({}, { canEdit: false })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(capturedOnChange).toBeUndefined()
  })
})

describe('LOW: 保存する本文の末尾の空行を落とす', () => {
  it('BlockNote が足す末尾の空行は、比べる前・保存する前の両方で落とす', async () => {
    const { updateMinutes, meeting } = setup()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    // 開いたときと同じ内容 + 末尾の空行だけが増えたケース → 保存しない
    act(() => capturedOnChange?.('# 定例MTG\n\n本文\n\n'))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000)
    })
    expect(updateMinutes).not.toHaveBeenCalled()

    // 本当に編集した場合は、末尾の空行を落として保存する
    act(() => capturedOnChange?.('# 定例MTG\n\n本文\n\n編集\n\n'))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500)
    })
    expect(updateMinutes).toHaveBeenCalledWith('m1', '# 定例MTG\n\n本文\n\n編集', meeting.updated_at)
  })
})
