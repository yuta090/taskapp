import React, { createRef } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import {
  MinutesDocumentView,
  type MinutesDocumentViewHandle,
} from '@/components/meeting/MinutesDocumentView'
import { MinutesConflictError } from '@/lib/hooks/useMeetings'
import type { Meeting } from '@/types/database'

// 2回目のレビューで見つかった不具合の回帰テスト。
//
// HIGH-A: 「会議を終了」を押すと updated_at が進むが、文書ビューの基準は古いまま。
//   タスク化直前の確認をそのまま「updated_at が違えば中止」にしていたため、本文が
//   1文字も変わっていなくても毎回タスク化が中止になっていた。→ ensureUpToDate は
//   保存(runSave)の0行判定と同じ「サーバーの生の本文が変わっていなければ基準だけ
//   差し替えて通す」判定にする。
//
// MEDIUM-A（レビュアーの再現テスト R6・R9 相当）: アンマウント時の保存が
//   updateMinutes を直接叩いていたため、通信中の別の保存と衝突したり(R6)、
//   0行(見せかけの競合)の自己修復ができず編集が消えていた(R9)。→ アンマウントの
//   クリーンアップは常に最新の scheduleSave を ref 経由で呼ぶ（保存と同じ道を通す）。
//
// LOW（R10 相当）: 保存が通信中に「入力→取り消して基準へ戻す」をすると、取り消し前の
//   古い内容が保留中バッファに残ったまま送られていた。→ 通信中は基準一致かどうかに
//   関わらず、保留中バッファを常に「今の本文」で上書きする。

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
let mounts = 0

vi.mock('@/components/meeting/MinutesEditorDynamic', () => ({
  MinutesEditorDynamic: (props: { minutesMd: string; onChange?: (md: string) => void }) => {
    onChange = props.onChange
    React.useEffect(() => {
      mounts += 1
    }, [])
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
  ref?: React.Ref<MinutesDocumentViewHandle>
) {
  return (
    <MinutesDocumentView
      ref={ref}
      orgId="o"
      spaceId="s"
      meeting={meeting}
      canEdit
      onBack={vi.fn()}
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

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  onChange = undefined
  mounts = 0
})

afterEach(() => {
  vi.useRealTimers()
})

describe('HIGH-A: 会議終了などでupdated_atだけ進んでも、本文が同じならタスク化の直前確認は通す', () => {
  it('ensureUpToDate: updated_atが違っても本文が同じなら基準を差し替えて例外を投げない', async () => {
    const up = vi.fn()
    const fd = vi.fn().mockResolvedValue(mk({ minutes_md: 'A', updated_at: 'U1' }))
    const ref = createRef<MinutesDocumentViewHandle>()
    render(view(mk({ minutes_md: 'A', updated_at: 'U1' }), up, fd, ref))
    await flush()

    // 会議終了などで本文はそのまま updated_at だけ進んだ状態
    fd.mockResolvedValue(mk({ minutes_md: 'A', updated_at: 'U2' }))

    await expect(ref.current!.ensureUpToDate()).resolves.toBeUndefined()
    expect(ref.current!.getBaseUpdatedAt()).toBe('U2')
    expect(screen.queryByTestId('minutes-conflict-banner')).not.toBeInTheDocument()
  })

  it('ensureUpToDate: updated_atが同じなら何もせず通す（サーバーへ読み直しの副作用以外は無い）', async () => {
    const up = vi.fn()
    const fd = vi.fn().mockResolvedValue(mk({ minutes_md: 'A', updated_at: 'U1' }))
    const ref = createRef<MinutesDocumentViewHandle>()
    render(view(mk({ minutes_md: 'A', updated_at: 'U1' }), up, fd, ref))
    await flush()

    await expect(ref.current!.ensureUpToDate()).resolves.toBeUndefined()
    expect(ref.current!.getBaseUpdatedAt()).toBe('U1')
  })

  it('ensureUpToDate: 本文自体が違えば競合の帯を出して例外を投げる', async () => {
    const up = vi.fn()
    const fd = vi.fn().mockResolvedValue(mk({ minutes_md: 'A', updated_at: 'U1' }))
    const ref = createRef<MinutesDocumentViewHandle>()
    render(view(mk({ minutes_md: 'A', updated_at: 'U1' }), up, fd, ref))
    await flush()

    fd.mockResolvedValue(mk({ minutes_md: 'AIが書き換えた本文', updated_at: 'U2' }))

    await act(async () => {
      await expect(ref.current!.ensureUpToDate()).rejects.toThrow()
    })
    expect(screen.getByTestId('minutes-conflict-banner')).toBeInTheDocument()
  })
})

describe('MEDIUM-A（R6相当）: 通信中に離れても、保存と同じ道(scheduleSave)を通って正しい基準で送られる', () => {
  it('R6: 保存が通信中に編集して離れても、二重の直接送信にならず新しい基準で1回だけ届く', async () => {
    let resolveFirst!: (v: { minutesMd: string; updatedAt: string }) => void
    const calls: Array<[string, string]> = []
    let server = { md: 'A', at: 'U1' }
    const up = vi.fn((_id: string, md: string, b: string) => {
      calls.push([md, b])
      if (calls.length === 1) {
        return new Promise<{ minutesMd: string; updatedAt: string }>((resolve) => {
          resolveFirst = resolve
        })
      }
      if (b !== server.at) return Promise.reject(new MinutesConflictError())
      server = { md, at: 'U3' }
      return Promise.resolve({ minutesMd: md, updatedAt: 'U3' })
    })
    const fd = vi.fn().mockResolvedValue(mk({ minutes_md: 'A', updated_at: 'U1' }))
    const { unmount } = render(view(mk({ minutes_md: 'A', updated_at: 'U1' }), up, fd))
    await flush()

    act(() => onChange?.('x1'))
    await wait(1600)
    // この時点で1回目の保存が通信中（未解決）
    expect(calls).toHaveLength(1)

    act(() => onChange?.('x1 最後'))
    unmount()

    // 1回目の保存がサーバー側で先に確定する
    server = { md: 'x1', at: 'U2' }
    await act(async () => {
      resolveFirst({ minutesMd: 'x1', updatedAt: 'U2' })
    })
    await wait(3000)

    // 「x1 最後」は新しい基準(U2)で1回だけ送られる（古い基準U1で直接叩く二重送信をしない）
    expect(calls).toEqual([
      ['x1', 'U1'],
      ['x1 最後', 'U2'],
    ])
    expect(server.md).toBe('x1 最後')
  })
})

describe('MEDIUM-A（R9相当）: 保留中の編集を残して離れても、0行の自己修復を経て保存される', () => {
  it('R9: 会議終了で基準が古いまま離れても、本文が同じなら基準を差し替えて保存する', async () => {
    let server = { md: 'A', at: 'U2' } // 既に会議終了などでU2まで進んでいる
    const up = vi.fn(async (_id: string, md: string, b: string) => {
      if (b !== server.at) throw new MinutesConflictError()
      server = { md, at: 'U3' }
      return { minutesMd: md, updatedAt: 'U3' }
    })
    // 開いたときの詳細取得は古いU1のまま(文書ビューはこれを基準にする)。以降の
    // 読み直し(0行の自己修復)ではU2を返す
    const fd = vi
      .fn()
      .mockResolvedValueOnce(mk({ minutes_md: 'A', updated_at: 'U1' }))
      .mockResolvedValue(mk({ minutes_md: 'A', updated_at: 'U2' }))
    const { unmount } = render(view(mk({ minutes_md: 'A', updated_at: 'U1' }), up, fd))
    await flush()

    act(() => onChange?.('A 最後の一文'))
    unmount()
    await wait(3000)

    expect(server.md).toBe('A 最後の一文')
    expect(server.at).toBe('U3')
  })
})

describe('LOW（R10相当）: 保存中は、基準と同じ本文でも保留中バッファを今の本文で上書きする', () => {
  it('R10: 保存中に編集→取り消しても、最終的に画面の内容(基準と同じ)で確定する', async () => {
    let resolveFirst!: (v: { minutesMd: string; updatedAt: string }) => void
    const saved: string[] = []
    const up = vi.fn((_id: string, md: string) => {
      saved.push(md)
      if (saved.length === 1) {
        return new Promise<{ minutesMd: string; updatedAt: string }>((resolve) => {
          resolveFirst = resolve
        })
      }
      return Promise.resolve({ minutesMd: md, updatedAt: 'U3' })
    })
    const fd = vi.fn().mockResolvedValue(mk({ minutes_md: 'O', updated_at: 'U1' }))
    render(view(mk({ minutes_md: 'O', updated_at: 'U1' }), up, fd))
    await flush()

    act(() => onChange?.('X'))
    await wait(1600)
    act(() => onChange?.('Y'))
    await wait(1600)
    act(() => onChange?.('O')) // 基準(開いたときの本文)へ戻す
    await wait(1600)

    await act(async () => {
      resolveFirst({ minutesMd: 'X', updatedAt: 'U2' })
    })
    await flush()

    // 保留中バッファは「Y」ではなく最終的な「O」で送られる
    expect(saved).toEqual(['X', 'O'])
  })
})

describe('MEDIUM-C: flush は正規化baselineではなくサーバーの生の本文を返す', () => {
  it('flushPendingSave は保存確定後、更新結果の生の本文(サーバーの値)を返す', async () => {
    const up = vi.fn().mockResolvedValue({ minutesMd: '# サーバー整形後の本文', updatedAt: 'U2' })
    const fd = vi.fn().mockResolvedValue(mk({ minutes_md: 'A', updated_at: 'U1' }))
    const ref = createRef<MinutesDocumentViewHandle>()
    render(view(mk({ minutes_md: 'A', updated_at: 'U1' }), up, fd, ref))
    await flush()

    act(() => onChange?.('A 編集'))
    await wait(1600)

    const flushed = await ref.current!.flushPendingSave()
    expect(flushed).toBe('# サーバー整形後の本文')
  })

  it('保留中の保存が無ければ、開いたときに取り直した生の本文をそのまま返す', async () => {
    const up = vi.fn()
    const fd = vi.fn().mockResolvedValue(mk({ minutes_md: '開いたときの生の本文', updated_at: 'U1' }))
    const ref = createRef<MinutesDocumentViewHandle>()
    render(view(mk({ minutes_md: '開いたときの生の本文', updated_at: 'U1' }), up, fd, ref))
    await flush()

    const flushed = await ref.current!.flushPendingSave()
    expect(flushed).toBe('開いたときの生の本文')
  })
})

describe('MEDIUM-B: 競合中・保存失敗のまま離れようとすると確認する', () => {
  it('競合中に「戻る」を押すと確認ダイアログを出し、キャンセルなら戻らない', async () => {
    const up = vi.fn().mockRejectedValue(new MinutesConflictError())
    const fd = vi
      .fn()
      .mockResolvedValueOnce(mk({ minutes_md: 'A', updated_at: 'U1' }))
      .mockResolvedValue(mk({ minutes_md: 'AIが書き換えた本文', updated_at: 'U2' }))
    const onBack = vi.fn()
    render(
      <MinutesDocumentView
        orgId="o"
        spaceId="s"
        meeting={mk({ minutes_md: 'A', updated_at: 'U1' })}
        canEdit
        onBack={onBack}
        onOpenInfo={vi.fn()}
        updateMinutes={up}
        fetchMeetingDetail={fd}
      />
    )
    await flush()

    act(() => onChange?.('編集した本文'))
    await wait(1600)
    expect(screen.getByTestId('minutes-conflict-banner')).toBeInTheDocument()

    await act(async () => {
      screen.getByLabelText('会議一覧へ戻る').click()
      await Promise.resolve()
      await Promise.resolve()
    })
    const dialog = screen.getByRole('alertdialog')
    expect(dialog.textContent).toContain('保存されていない書きかけがあります')

    act(() => {
      screen.getByRole('button', { name: 'キャンセル' }).click()
    })
    expect(onBack).not.toHaveBeenCalled()
  })

  it('保存中(通信中)に「戻る」を押しても確認せずそのまま戻る', async () => {
    const up = vi.fn().mockImplementation(() => new Promise(() => {}))
    const fd = vi.fn().mockResolvedValue(mk({ minutes_md: 'A', updated_at: 'U1' }))
    const onBack = vi.fn()
    render(
      <MinutesDocumentView
        orgId="o"
        spaceId="s"
        meeting={mk({ minutes_md: 'A', updated_at: 'U1' })}
        canEdit
        onBack={onBack}
        onOpenInfo={vi.fn()}
        updateMinutes={up}
        fetchMeetingDetail={fd}
      />
    )
    await flush()

    act(() => onChange?.('編集した本文'))
    await wait(1600)
    expect(up).toHaveBeenCalledTimes(1)

    await act(async () => {
      screen.getByLabelText('会議一覧へ戻る').click()
      await Promise.resolve()
    })
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(onBack).toHaveBeenCalledTimes(1)
  })
})
