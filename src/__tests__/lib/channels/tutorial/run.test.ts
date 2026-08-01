import { describe, it, expect, vi } from 'vitest'
import {
  startTutorial,
  advanceTutorial,
  restartTutorial,
  type TutorialDeps,
  type TutorialGroupContext,
} from '@/lib/channels/tutorial/run'
import {
  TUTORIAL_INTRO_TEXT,
  TUTORIAL_COMPLETED_TEXT,
  TUTORIAL_SKIPPED_TEXT,
  TUTORIAL_RESTART_INTRO_TEXT,
  TUTORIAL_UNAVAILABLE_TEXT,
  buildTutorialAddedText,
} from '@/lib/channels/tutorial/messages'
import { TUTORIAL_TTL_MS, NEW_GROUP_WINDOW_MS, type ChannelTutorialState } from '@/lib/channels/tutorial/state'

/**
 * 登録直後の「はじめまして」から、タスクを1件登録して消すところまでを手を取って案内する練習。
 *
 * 守る不変条件:
 *   - 送るのは返信(reply)だけ。push の口を持たない＝LINE の無料枠を1通も使わない。
 *   - 一度終わったら二度と案内しない（finished）。
 *   - 48時間より前に作られた既存グループは絶対に巻き込まない。
 *   - 放置は24時間で自動的に終わり（cronを増やさない）、練習で作ったタスクは消さない。
 */

const NOW = new Date('2026-07-30T09:00:00.000Z')

function makeGroup(over: Partial<TutorialGroupContext> = {}): TutorialGroupContext {
  return {
    groupId: 'grp-1',
    channel: 'discord',
    // 既定は「たった今作られたグループ」
    createdAt: new Date(NOW.getTime() - 60_000).toISOString(),
    metadata: null,
    ...over,
  }
}

function withState(state: ChannelTutorialState, over: Partial<TutorialGroupContext> = {}) {
  return makeGroup({ metadata: { tutorial: state }, ...over })
}

function makeDeps(over: Partial<TutorialDeps> = {}): TutorialDeps {
  return {
    reply: vi.fn().mockResolvedValue(undefined),
    saveTutorialState: vi.fn().mockResolvedValue(undefined),
    assignDigestNumbersToNewTasks: vi
      .fn()
      .mockResolvedValue([{ id: 'task-9', digestNumber: 1, title: '秘書の使い方をおぼえる' }]),
    now: () => NOW,
    ...over,
  }
}

function savedState(deps: TutorialDeps): ChannelTutorialState {
  const calls = (deps.saveTutorialState as ReturnType<typeof vi.fn>).mock.calls
  return calls[calls.length - 1][1] as ChannelTutorialState
}

describe('startTutorial（登録が成立した直後）', () => {
  it('導入文を返信し、「登録待ち」の状態にする', async () => {
    const deps = makeDeps()
    const step = await startTutorial(makeGroup(), deps)

    expect(step).toBe('awaiting_add')
    expect(deps.reply).toHaveBeenCalledWith(TUTORIAL_INTRO_TEXT)
    expect(deps.saveTutorialState).toHaveBeenCalledTimes(1)
    expect(savedState(deps)).toMatchObject({ step: 'awaiting_add' })
    expect((deps.saveTutorialState as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe('grp-1')
  })

  it('使い方を持たないチャット（whatsapp）では練習を始めない', async () => {
    const deps = makeDeps()
    const step = await startTutorial(makeGroup({ channel: 'whatsapp' }), deps)

    expect(step).toBeNull()
    expect(deps.reply).not.toHaveBeenCalled()
    expect(deps.saveTutorialState).not.toHaveBeenCalled()
  })

  it('「タスク追加」がそのグループで効かないなら始めない（できない操作を約束しない）', async () => {
    const deps = makeDeps()
    const step = await startTutorial(makeGroup({ channel: 'line', addTaskEnabled: false }), deps)

    expect(step).toBeNull()
    expect(deps.reply).not.toHaveBeenCalled()
  })

  it('すでに案内済みなら二度と出さない', async () => {
    const deps = makeDeps()
    const step = await startTutorial(
      withState({ step: 'finished', startedAt: NOW.toISOString() }),
      deps,
    )

    expect(step).toBeNull()
    expect(deps.reply).not.toHaveBeenCalled()
  })

  it('送る手段は返信だけ（push の口を持たない＝無料枠を使わない）', async () => {
    const deps = makeDeps()
    await startTutorial(makeGroup(), deps)
    expect(Object.keys(deps)).not.toContain('push')
  })
})

describe('advanceTutorial（練習中の1発言）', () => {
  const awaitingAdd: ChannelTutorialState = {
    step: 'awaiting_add',
    startedAt: NOW.toISOString(),
  }

  it('「タスク追加 ○○」を受けると、番号を確定してから「完了N」を案内する', async () => {
    const deps = makeDeps({
      assignDigestNumbersToNewTasks: vi
        .fn()
        .mockResolvedValue([
          { id: 'other', digestNumber: 1, title: '先にあったタスク' },
          { id: 'task-9', digestNumber: 2, title: '秘書の使い方をおぼえる' },
        ]),
    })
    const step = await advanceTutorial(
      withState(awaitingAdd),
      { kind: 'add_task', taskId: 'task-9', pending: false, title: '秘書の使い方をおぼえる' },
      deps,
    )

    expect(step).toBe('awaiting_done')
    expect(deps.assignDigestNumbersToNewTasks).toHaveBeenCalledWith('grp-1')
    // 案内する番号は、採番のしなおしが返した番号と必ず一致する
    expect(deps.reply).toHaveBeenCalledWith(buildTutorialAddedText(2, '秘書の使い方をおぼえる'))
    expect(savedState(deps)).toMatchObject({ step: 'awaiting_done', taskId: 'task-9', digestNumber: 2 })
  })

  it('番号の総入れ替えは頼まない（既にある番号は動かさず、新しい1件にだけ番号を足す）', async () => {
    // 一覧の番号を全部振り直してよいのは配信の直前（毎朝の cron）だけ。チャットの発言から
    // 総入れ替えを呼ぶと、利用者の手元の一覧と番号がズレて「完了3」が別のタスクを消す。
    const assign = vi.fn().mockResolvedValue([
      { id: 'other', digestNumber: 1, title: '先にあったタスク' },
      { id: 'task-9', digestNumber: 2, title: '秘書の使い方をおぼえる' },
    ])
    const deps = makeDeps({ assignDigestNumbersToNewTasks: assign })

    await advanceTutorial(
      withState(awaitingAdd),
      { kind: 'add_task', taskId: 'task-9', pending: false, title: '秘書の使い方をおぼえる' },
      deps,
    )

    // 練習が使える配線は「新しいタスクにだけ番号を与える」もの1本だけ
    expect(Object.keys(deps)).not.toContain('renumberOpenDigestTasks')
    expect(assign).toHaveBeenCalledTimes(1)
    expect(assign).toHaveBeenCalledWith('grp-1')
    // 先にあったタスクの番号(1)には触れず、案内するのは新しい方の番号(2)
    expect(deps.reply).toHaveBeenCalledWith(buildTutorialAddedText(2, '秘書の使い方をおぼえる'))
  })

  it('責任者の承認が要るタスクになった場合は練習を進めずに終える', async () => {
    const deps = makeDeps()
    const step = await advanceTutorial(
      withState(awaitingAdd),
      { kind: 'add_task', taskId: 'task-9', pending: true, title: '秘書の使い方をおぼえる' },
      deps,
    )

    expect(step).toBe('finished')
    expect(deps.assignDigestNumbersToNewTasks).not.toHaveBeenCalled()
    expect(deps.reply).not.toHaveBeenCalled()
    expect(savedState(deps)).toMatchObject({ step: 'finished' })
  })

  it('番号を確定できなかったら約束しない（状態はそのままで、次の「タスク追加」で再挑戦できる）', async () => {
    const deps = makeDeps({ assignDigestNumbersToNewTasks: vi.fn().mockRejectedValue(new Error('db down')) })
    const step = await advanceTutorial(
      withState(awaitingAdd),
      { kind: 'add_task', taskId: 'task-9', pending: false, title: '秘書の使い方をおぼえる' },
      deps,
    )

    expect(step).toBeNull()
    expect(deps.reply).not.toHaveBeenCalled()
    expect(deps.saveTutorialState).not.toHaveBeenCalled()
  })

  it('「あとで」でいつでも抜けられる', async () => {
    const deps = makeDeps()
    const step = await advanceTutorial(withState(awaitingAdd), { kind: 'other', text: 'あとで' }, deps)

    expect(step).toBe('finished')
    expect(deps.reply).toHaveBeenCalledWith(TUTORIAL_SKIPPED_TEXT)
    expect(savedState(deps)).toMatchObject({ step: 'finished' })
  })

  it('「ヘルプ」では状態を変えない（使い方はいつでも出せる）', async () => {
    const deps = makeDeps()
    const step = await advanceTutorial(withState(awaitingAdd), { kind: 'help' }, deps)

    expect(step).toBeNull()
    expect(deps.reply).not.toHaveBeenCalled()
    expect(deps.saveTutorialState).not.toHaveBeenCalled()
  })

  it('ふつうの発言では何もしない（沈黙・状態も変えない）', async () => {
    const deps = makeDeps()
    const step = await advanceTutorial(
      withState(awaitingAdd),
      { kind: 'other', text: '明日よろしくお願いします' },
      deps,
    )

    expect(step).toBeNull()
    expect(deps.reply).not.toHaveBeenCalled()
    expect(deps.saveTutorialState).not.toHaveBeenCalled()
  })

  it('開始から24時間たつと、何も送らずに終了扱いになる', async () => {
    const stale: ChannelTutorialState = {
      step: 'awaiting_add',
      startedAt: new Date(NOW.getTime() - TUTORIAL_TTL_MS - 1000).toISOString(),
    }
    const deps = makeDeps()
    const step = await advanceTutorial(
      withState(stale),
      { kind: 'add_task', taskId: 'task-9', pending: false, title: 'x' },
      deps,
    )

    expect(step).toBe('finished')
    expect(deps.reply).not.toHaveBeenCalled()
    expect(deps.assignDigestNumbersToNewTasks).not.toHaveBeenCalled()
    expect(savedState(deps)).toMatchObject({ step: 'finished' })
  })
})

describe('advanceTutorial（消し込みの練習中）', () => {
  const awaitingDone: ChannelTutorialState = {
    step: 'awaiting_done',
    taskId: 'task-9',
    digestNumber: 2,
    startedAt: NOW.toISOString(),
  }

  it('案内した番号の完了を受けると、締めの文を返して練習を終える', async () => {
    const deps = makeDeps()
    const step = await advanceTutorial(
      withState(awaitingDone),
      { kind: 'complete', digestNumber: 2, completedTaskId: 'task-9' },
      deps,
    )

    expect(step).toBe('finished')
    expect(deps.reply).toHaveBeenCalledWith(TUTORIAL_COMPLETED_TEXT)
    expect(savedState(deps)).toMatchObject({ step: 'finished' })
  })

  it('別の番号の完了では状態を変えない（ふだんの完了を邪魔しない）', async () => {
    const deps = makeDeps()
    const step = await advanceTutorial(
      withState(awaitingDone),
      { kind: 'complete', digestNumber: 5, completedTaskId: 'task-5' },
      deps,
    )

    expect(step).toBeNull()
    expect(deps.reply).not.toHaveBeenCalled()
    expect(deps.saveTutorialState).not.toHaveBeenCalled()
  })

  it('番号は合っていても別のタスクだったら締めない', async () => {
    const deps = makeDeps()
    const step = await advanceTutorial(
      withState(awaitingDone),
      { kind: 'complete', digestNumber: 2, completedTaskId: 'other-task' },
      deps,
    )

    expect(step).toBeNull()
    expect(deps.reply).not.toHaveBeenCalled()
  })

  it('「あとで」でここからも抜けられる', async () => {
    const deps = makeDeps()
    const step = await advanceTutorial(withState(awaitingDone), { kind: 'other', text: 'あとで' }, deps)

    expect(step).toBe('finished')
    expect(deps.reply).toHaveBeenCalledWith(TUTORIAL_SKIPPED_TEXT)
  })
})

describe('advanceTutorial（案内の遅れ出し・web_approval で成立したグループの受け皿）', () => {
  it('登録済みの新しいグループでの最初のふつうの発言から練習を始める', async () => {
    const deps = makeDeps()
    const step = await advanceTutorial(makeGroup(), { kind: 'other', text: 'おはようございます' }, deps)

    expect(step).toBe('awaiting_add')
    expect(deps.reply).toHaveBeenCalledWith(TUTORIAL_INTRO_TEXT)
  })

  it('48時間より前に作られたグループ（前からある接続）では始めない', async () => {
    const deps = makeDeps()
    const old = makeGroup({
      createdAt: new Date(NOW.getTime() - NEW_GROUP_WINDOW_MS - 1000).toISOString(),
    })
    const step = await advanceTutorial(old, { kind: 'other', text: 'おはようございます' }, deps)

    expect(step).toBeNull()
    expect(deps.reply).not.toHaveBeenCalled()
  })

  it('合図（完了N・ヘルプ・タスク追加）に一致した発言からは始めない', async () => {
    const deps = makeDeps()
    const step = await advanceTutorial(makeGroup(), { kind: 'help' }, deps)

    expect(step).toBeNull()
    expect(deps.reply).not.toHaveBeenCalled()
  })

  it('一度終えたグループでは二度と案内しない', async () => {
    const deps = makeDeps()
    const step = await advanceTutorial(
      withState({ step: 'finished', startedAt: NOW.toISOString() }),
      { kind: 'other', text: 'おはようございます' },
      deps,
    )

    expect(step).toBeNull()
    expect(deps.reply).not.toHaveBeenCalled()
    expect(deps.saveTutorialState).not.toHaveBeenCalled()
  })
})

/**
 * 「練習」でやり直す。
 *
 * 練習は1グループ1回きりで、「あとで」で抜けた人・24時間放置した人・あとから参加した人は
 * 二度と見られなかった。使い方が分からない人ほど最初に「あとで」と言うので、そこが片手落ちだった。
 * 本人が明示的に頼んだときは、何度でも最初からやり直せる。
 */
describe('restartTutorial（「練習」でやり直す）', () => {
  it('一度終わったグループでも、もう一度最初から始める', async () => {
    const group = withState({ step: 'finished', startedAt: NOW.toISOString() })
    const deps = makeDeps()

    const step = await restartTutorial(group, deps)

    expect(step).toBe('awaiting_add')
    expect(deps.reply).toHaveBeenCalledWith(TUTORIAL_RESTART_INTRO_TEXT)
    expect(deps.saveTutorialState).toHaveBeenCalledWith(
      'grp-1',
      expect.objectContaining({ step: 'awaiting_add', startedAt: NOW.toISOString() }),
    )
  })

  it('前の練習の途中経過（タスク・番号）を持ち越さない', async () => {
    const group = withState({
      step: 'awaiting_done',
      startedAt: new Date(NOW.getTime() - 60_000).toISOString(),
      taskId: 'old-task',
      digestNumber: 3,
    })
    const deps = makeDeps()

    await restartTutorial(group, deps)

    const saved = (deps.saveTutorialState as ReturnType<typeof vi.fn>).mock.calls[0][1]
    expect(saved.taskId).toBeUndefined()
    expect(saved.digestNumber).toBeUndefined()
  })

  it('前から使っている古いグループでも始められる（48時間の窓は本人の依頼には効かせない）', async () => {
    // 遅れ出しの案内は既存グループを巻き込まないよう48時間で切るが、
    // 本人が「練習」と打ったのなら、いつ作られたグループでも応じる。
    const group = makeGroup({
      createdAt: new Date(NOW.getTime() - NEW_GROUP_WINDOW_MS * 10).toISOString(),
    })
    const deps = makeDeps()

    await expect(restartTutorial(group, deps)).resolves.toBe('awaiting_add')
  })

  it('「はじめまして」とは言わない（初対面ではない）', () => {
    expect(TUTORIAL_RESTART_INTRO_TEXT).not.toContain('はじめまして')
    // やることは初回と同じなので、最初に打つ合図と空白の注意は落とさない。
    expect(TUTORIAL_RESTART_INTRO_TEXT).toContain('タスク追加 れんしゅう')
    expect(TUTORIAL_RESTART_INTRO_TEXT).toContain('空白')
  })

  it('練習ができないグループでは、黙らずに理由を返す', async () => {
    // 拾い方の設定などで「タスク追加」が効かないグループ。ここで黙ると
    // 「打ったのに無反応」＝この案件が直そうとしている失敗そのものになる。
    const group = makeGroup({ addTaskEnabled: false })
    const deps = makeDeps()

    const step = await restartTutorial(group, deps)

    expect(step).toBeNull()
    expect(deps.reply).toHaveBeenCalledWith(TUTORIAL_UNAVAILABLE_TEXT)
    expect(deps.saveTutorialState).not.toHaveBeenCalled()
  })
})

/**
 * 「あとで」で抜けた人が戻ってこられるか。
 * 戻る道を案内していなければ、やり直せる機能があっても誰も使えない。
 */
describe('抜けた人への案内', () => {
  it('「あとで」の返事に、やり直し方（『練習』）が入っている', () => {
    expect(TUTORIAL_SKIPPED_TEXT).toContain('練習')
  })
})
