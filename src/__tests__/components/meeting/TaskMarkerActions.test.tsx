import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { TaskMarkerChip } from '@/components/meeting/MinutesEditor'
import type { MinutesTaskState } from '@/lib/minutes/taskActions'

// 議事録の「タスク作成済み」の印を押すと、その場で完了・決定できる小さなパネルが出る。
// 会議中に「これ終わったね」となったとき、議事録から離れずに終わらせられるようにする。

const mockPush = vi.hoisted(() => vi.fn())
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mockPush }) }))

const ORG = '00000000-0000-0000-0000-0000000000aa'
const SPACE = '00000000-0000-0000-0000-0000000000bb'
const TASK = '3f2504e0-4f89-11d3-9a0c-0305e82c3301'

const state = (over: Partial<MinutesTaskState> = {}): MinutesTaskState => ({
  status: 'todo',
  type: 'task',
  decisionState: null,
  reviewPending: false,
  ...over,
})

function makeResolver(
  result: { title: string; state: MinutesTaskState } | null,
  run = vi.fn().mockResolvedValue(undefined)
) {
  return { resolve: vi.fn().mockResolvedValue(result), run }
}

/** 印には ref で渡す（エディタはマウント時の1回しか作られないため） */
const refOf = (r: ReturnType<typeof makeResolver> | undefined) => ({ current: r })

const openPanel = () => fireEvent.click(screen.getByTestId('minutes-task-marker-chip'))

describe('TaskMarkerChip: 操作の入り口が無いとき', () => {
  it('これまでどおり、押すとタスクへ移動する', () => {
    render(<TaskMarkerChip taskId={TASK} orgId={ORG} spaceId={SPACE} />)
    openPanel()
    expect(mockPush).toHaveBeenCalledWith(`/${ORG}/project/${SPACE}?task=${TASK}`)
    expect(screen.queryByTestId('minutes-task-actions')).toBeNull()
  })
})

describe('TaskMarkerChip: 操作パネル', () => {
  it('押すとパネルが出て、タスクの題名と状態が分かる', async () => {
    const resolver = makeResolver({ title: '玄関の向きを決める', state: state({ status: 'todo' }) })
    render(<TaskMarkerChip taskId={TASK} orgId={ORG} spaceId={SPACE} resolverRef={refOf(resolver)} />)
    openPanel()

    expect(await screen.findByText('玄関の向きを決める')).toBeTruthy()
    expect(screen.getByText('未着手')).toBeTruthy()
    // 開いただけでは移動しない
    expect(mockPush).not.toHaveBeenCalled()
  })

  it('ふつうのタスクは「完了にする」が押せる', async () => {
    const run = vi.fn().mockResolvedValue(undefined)
    const resolver = makeResolver({ title: '資料を作る', state: state() }, run)
    render(<TaskMarkerChip taskId={TASK} orgId={ORG} spaceId={SPACE} resolverRef={refOf(resolver)} />)
    openPanel()

    const complete = await screen.findByTestId('minutes-task-action-complete')
    fireEvent.click(complete)
    await waitFor(() => expect(run).toHaveBeenCalledWith(TASK, 'complete'))
  })

  it('未決の決定事項のタスクは「決定にする」が先に出て、完了は理由付きで押せない', async () => {
    const resolver = makeResolver({
      title: '玄関の向きを決める',
      state: state({ type: 'spec', decisionState: 'considering' }),
    })
    render(<TaskMarkerChip taskId={TASK} orgId={ORG} spaceId={SPACE} resolverRef={refOf(resolver)} />)
    openPanel()

    expect(await screen.findByTestId('minutes-task-action-decide')).toBeTruthy()
    const complete = screen.getByTestId('minutes-task-action-complete')
    expect(complete).toBeDisabled()
    expect(screen.getByText('先に「決定にする」を押してください')).toBeTruthy()
  })

  it('操作したあとは状態を読み直す（決定の次に完了が押せるように）', async () => {
    const resolver = makeResolver({
      title: '玄関の向きを決める',
      state: state({ type: 'spec', decisionState: 'considering' }),
    })
    render(<TaskMarkerChip taskId={TASK} orgId={ORG} spaceId={SPACE} resolverRef={refOf(resolver)} />)
    openPanel()
    await screen.findByTestId('minutes-task-action-decide')
    expect(resolver.resolve).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByTestId('minutes-task-action-decide'))
    await waitFor(() => expect(resolver.resolve).toHaveBeenCalledTimes(2))
  })

  it('「タスクを開く」で移動する', async () => {
    const resolver = makeResolver({ title: '資料を作る', state: state() })
    render(<TaskMarkerChip taskId={TASK} orgId={ORG} spaceId={SPACE} resolverRef={refOf(resolver)} />)
    openPanel()

    fireEvent.click(await screen.findByTestId('minutes-task-action-open'))
    expect(mockPush).toHaveBeenCalledWith(`/${ORG}/project/${SPACE}?task=${TASK}`)
  })

  it('見つからないタスクは、その理由を出す', async () => {
    const resolver = makeResolver(null)
    render(<TaskMarkerChip taskId={TASK} orgId={ORG} spaceId={SPACE} resolverRef={refOf(resolver)} />)
    openPanel()

    expect(await screen.findByText(/見つかりませんでした/)).toBeTruthy()
  })

  it('操作に失敗したら、その理由をパネルに出す（黙って閉じない）', async () => {
    const run = vi.fn().mockRejectedValue(new Error('社内承認が完了するまでタスクを完了できません'))
    const resolver = makeResolver({ title: '資料を作る', state: state() }, run)
    render(<TaskMarkerChip taskId={TASK} orgId={ORG} spaceId={SPACE} resolverRef={refOf(resolver)} />)
    openPanel()

    fireEvent.click(await screen.findByTestId('minutes-task-action-complete'))
    expect(await screen.findByText('社内承認が完了するまでタスクを完了できません')).toBeTruthy()
  })

  it('Esc で閉じる', async () => {
    const resolver = makeResolver({ title: '資料を作る', state: state() })
    render(<TaskMarkerChip taskId={TASK} orgId={ORG} spaceId={SPACE} resolverRef={refOf(resolver)} />)
    openPanel()
    await screen.findByTestId('minutes-task-actions')

    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByTestId('minutes-task-actions')).toBeNull())
  })

  it('パネルの外を押すと閉じる', async () => {
    const resolver = makeResolver({ title: '資料を作る', state: state() })
    render(<TaskMarkerChip taskId={TASK} orgId={ORG} spaceId={SPACE} resolverRef={refOf(resolver)} />)
    openPanel()
    await screen.findByTestId('minutes-task-actions')

    fireEvent.mouseDown(document.body)
    await waitFor(() => expect(screen.queryByTestId('minutes-task-actions')).toBeNull())
  })

  it('パネルを押しても本文のカーソルを奪わない（エディタの中に出るため）', async () => {
    const resolver = makeResolver({ title: '資料を作る', state: state() })
    render(<TaskMarkerChip taskId={TASK} orgId={ORG} spaceId={SPACE} resolverRef={refOf(resolver)} />)
    openPanel()

    const panel = await screen.findByTestId('minutes-task-actions')
    const ev = new MouseEvent('mousedown', { bubbles: true, cancelable: true })
    panel.dispatchEvent(ev)
    expect(ev.defaultPrevented).toBe(true)
  })
})

/**
 * 権限の制限が印に届くこと。BlockNote のエディタとスキーマはマウント時の1回しか
 * 作られないので、値のまま閉じ込めると「あとから編集不可にした」が届かない
 * （タスク化の処理中でも完了できてしまう）。ref で渡して押した時点の値を読む。
 */
describe('TaskMarkerChip: あとから操作を止めたとき', () => {
  it('ref の中身を空にすると、パネルを出さず移動するだけになる', async () => {
    const resolver = makeResolver({ title: '資料を作る', state: state() })
    const ref: { current: ReturnType<typeof makeResolver> | undefined } = { current: resolver }
    render(<TaskMarkerChip taskId={TASK} orgId={ORG} spaceId={SPACE} resolverRef={ref} />)

    // はじめは開く
    openPanel()
    expect(await screen.findByTestId('minutes-task-actions')).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByTestId('minutes-task-actions')).toBeNull())

    // 操作を止める（読み取り専用に切り替わった、タスク化の処理中、など）
    ref.current = undefined
    openPanel()
    expect(screen.queryByTestId('minutes-task-actions')).toBeNull()
    expect(mockPush).toHaveBeenCalledWith(`/${ORG}/project/${SPACE}?task=${TASK}`)
  })
})
