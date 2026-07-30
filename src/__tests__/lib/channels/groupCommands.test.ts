import { describe, it, expect, vi } from 'vitest'
import {
  handleClaimedGroupMessage,
  ADD_TASK_EMPTY_TEXT,
  APPROVAL_REQUESTED_TEXT,
  COMMAND_FAILED_TEXT,
  TASK_LIST_MAX_CHARS,
  TASK_LIST_MAX_ITEMS,
  buildAddTaskDoneText,
  buildAddTaskDoneNoDigestText,
  buildTaskListMoreText,
  buildTaskListReplyText,
  LIST_EMPTY_TEXT,
  COMPLETE_WITHOUT_NUMBER_TEXT,
  type GroupCommandDeps,
  type GroupCommandParams,
} from '@/lib/channels/groupCommands'
import { formatDateToLocalString } from '@/lib/gantt/dateUtils'
import { jstNow } from '@/lib/datetime/jstNow'
import { ALREADY_DONE_TEXT, buildDigestDoneText } from '@/lib/channels/claimLimboCore'
import { renderHelpReplyText } from '@/lib/channels/commandGuides'

function makeParams(over: Partial<GroupCommandParams<'discord'>> = {}): GroupCommandParams<'discord'> {
  return {
    orgId: 'org-1',
    spaceId: 'space-1',
    accountId: 'acc-1',
    groupId: 'grp-1',
    channel: 'discord',
    externalUserId: 'u-1',
    autoReplyTo: 'msg-1',
    sourceMessageId: 'row-1',
    text: 'こんにちは',
    ...over,
  }
}

function makeDeps(over: Partial<GroupCommandDeps<'discord'>> = {}): GroupCommandDeps<'discord'> {
  return {
    completeDigestTask: vi.fn().mockResolvedValue({ id: 'task-1', title: '見積もりを送る' }),
    createInstantDigestTask: vi.fn().mockResolvedValue({ id: 'task-9', pending: false, duplicate: false }),
    reply: vi.fn().mockResolvedValue({ providerMessageId: null }),
    insertOutbound: vi.fn().mockResolvedValue(undefined),
    assignDigestNumbersToNewTasks: vi.fn().mockResolvedValue([]),
    ...over,
  }
}

describe('handleClaimedGroupMessage', () => {
  it('「完了2」は完了処理を呼び、既存の完了文言をそのまま返す', async () => {
    const deps = makeDeps()
    const res = await handleClaimedGroupMessage(makeParams({ text: '完了2' }), deps)

    expect(res).toEqual({ matched: 'complete' })
    expect(deps.completeDigestTask).toHaveBeenCalledWith('grp-1', 2, 'u-1')
    expect(deps.reply).toHaveBeenCalledWith(buildDigestDoneText('見積もりを送る'))
    expect(deps.insertOutbound).toHaveBeenCalledTimes(1)
  })

  it('完了できるタスクが無ければ既存の「完了済み」文言をそのまま返す', async () => {
    const deps = makeDeps({ completeDigestTask: vi.fn().mockResolvedValue(null) })
    await handleClaimedGroupMessage(makeParams({ text: '完了2' }), deps)
    expect(deps.reply).toHaveBeenCalledWith(ALREADY_DONE_TEXT)
  })

  it('「ヘルプ」は使い方の文章を返し、秘書の発言として記録する', async () => {
    const deps = makeDeps()
    const res = await handleClaimedGroupMessage(makeParams({ text: 'ヘルプ' }), deps)

    expect(res).toEqual({ matched: 'help' })
    expect(deps.reply).toHaveBeenCalledWith(renderHelpReplyText('discord'))
    expect(deps.completeDigestTask).not.toHaveBeenCalled()
    expect(deps.createInstantDigestTask).not.toHaveBeenCalled()

    const outbound = (deps.insertOutbound as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(outbound).toMatchObject({
      orgId: 'org-1',
      spaceId: 'space-1',
      accountId: 'acc-1',
      groupId: 'grp-1',
      channel: 'discord',
      direction: 'outbound',
      actor: 'secretary',
      status: 'sent',
      error: null,
    })
    expect(outbound.body).toBe(renderHelpReplyText('discord'))
    expect(outbound.payload).toMatchObject({ autoReplyTo: 'msg-1' })
  })

  it('使い方を持たないチャットでは「ヘルプ」に答えない（沈黙）', async () => {
    const deps = makeDeps() as unknown as GroupCommandDeps<'whatsapp'>
    const res = await handleClaimedGroupMessage(
      { ...makeParams({ text: 'ヘルプ' }), channel: 'whatsapp' } as unknown as GroupCommandParams<'whatsapp'>,
      deps,
    )
    expect(res).toEqual({ matched: null })
    expect(deps.reply).not.toHaveBeenCalled()
    expect(deps.insertOutbound).not.toHaveBeenCalled()
  })

  it('「タスク追加 見積もりを送る」はタスクを1件作って返事をする', async () => {
    const deps = makeDeps()
    const res = await handleClaimedGroupMessage(
      makeParams({ text: 'タスク追加 見積もりを送る' }),
      deps,
    )

    expect(res).toEqual({ matched: 'add_task' })
    expect(deps.createInstantDigestTask).toHaveBeenCalledWith({
      groupId: 'grp-1',
      sourceMessageId: 'row-1',
      title: '見積もりを送る',
      assigneeExternalUserId: 'u-1',
    })
    expect(deps.reply).toHaveBeenCalledWith(buildAddTaskDoneText('見積もりを送る'))
    expect(deps.insertOutbound).toHaveBeenCalledTimes(1)
  })

  it('「タスク追加」だけなら内容が読めない旨を返し、タスクは作らない', async () => {
    const deps = makeDeps()
    const res = await handleClaimedGroupMessage(makeParams({ text: 'タスク追加' }), deps)

    expect(res).toEqual({ matched: 'add_task' })
    expect(deps.createInstantDigestTask).not.toHaveBeenCalled()
    expect(deps.reply).toHaveBeenCalledWith(ADD_TASK_EMPTY_TEXT)
  })

  it('ふつうの発言では返信も記録もしない（沈黙）', async () => {
    const deps = makeDeps()
    const res = await handleClaimedGroupMessage(makeParams({ text: '明日よろしくお願いします' }), deps)

    expect(res).toEqual({ matched: null })
    expect(deps.reply).not.toHaveBeenCalled()
    expect(deps.insertOutbound).not.toHaveBeenCalled()
    expect(deps.completeDigestTask).not.toHaveBeenCalled()
    expect(deps.createInstantDigestTask).not.toHaveBeenCalled()
  })

  it('本文が空なら何もしない', async () => {
    const deps = makeDeps()
    const res = await handleClaimedGroupMessage(makeParams({ text: '' }), deps)
    expect(res).toEqual({ matched: null })
    expect(deps.reply).not.toHaveBeenCalled()
  })

  it('秘書の送信手段は返信だけ（push の口を持たない＝無料枠を使わない）', async () => {
    const deps = makeDeps()
    await handleClaimedGroupMessage(makeParams({ text: 'ヘルプ' }), deps)
    expect(Object.keys(deps)).not.toContain('push')
    expect(deps.reply).toHaveBeenCalledTimes(1)
  })

  it('完了の判定は「タスク追加」「ヘルプ」より先に行う（既存の分岐順序を変えない）', async () => {
    const order: string[] = []
    const deps = makeDeps({
      completeDigestTask: vi.fn().mockImplementation(async () => {
        order.push('complete')
        return { id: 'task-1', title: 'x' }
      }),
      createInstantDigestTask: vi.fn().mockImplementation(async () => {
        order.push('add')
        return { id: 'task-9', pending: false, duplicate: false }
      }),
    })
    await handleClaimedGroupMessage(makeParams({ text: '完了1' }), deps)
    expect(order).toEqual(['complete'])
  })
})

/**
 * 「一覧」— 番号を見失ったときの逃げ道。
 *
 * これが無いと、まとめの一覧を流してしまった人は番号が分からず「完了N」が打てなくなる（詰む）。
 * ⚠ 番号は**振り直さない**。振り直すと、手元に残っている古い一覧の番号が別のタスクを指す。
 */
describe('一覧コマンド', () => {
  const OPEN_TASKS = [
    { id: 't-1', digestNumber: 1, title: '見積もりを送る' },
    { id: 't-3', digestNumber: 3, title: '請求書を出す' },
  ]

  it('「一覧」はいまのタスクを番号付きで返す（番号は振り直さない）', async () => {
    const deps = makeDeps({
      assignDigestNumbersToNewTasks: vi.fn().mockResolvedValue(OPEN_TASKS),
    })
    const res = await handleClaimedGroupMessage(makeParams({ text: '一覧' }), deps)

    expect(res).toEqual({ matched: 'list' })
    expect(deps.assignDigestNumbersToNewTasks).toHaveBeenCalledWith('grp-1')
    const replied = (deps.reply as ReturnType<typeof vi.fn>).mock.calls[0][0] as string
    expect(replied).toContain('1. 見積もりを送る')
    // 3番のまま出す（1,2 に詰め直さない）
    expect(replied).toContain('3. 請求書を出す')
    expect(replied).not.toContain('2. 請求書を出す')
    expect(deps.insertOutbound).toHaveBeenCalledTimes(1)
  })

  it.each(['リスト', 'タスク一覧'])('「%s」でも同じ一覧を返す', async (text) => {
    const deps = makeDeps({
      assignDigestNumbersToNewTasks: vi.fn().mockResolvedValue(OPEN_TASKS),
    })
    const res = await handleClaimedGroupMessage(makeParams({ text }), deps)
    expect(res).toEqual({ matched: 'list' })
    expect(deps.reply).toHaveBeenCalledWith(
      buildTaskListReplyText(OPEN_TASKS, formatDateToLocalString(jstNow())),
    )
  })

  it('0件なら「ありません」と返す（沈黙しない）', async () => {
    const deps = makeDeps({ assignDigestNumbersToNewTasks: vi.fn().mockResolvedValue([]) })
    const res = await handleClaimedGroupMessage(makeParams({ text: '一覧' }), deps)

    expect(res).toEqual({ matched: 'list' })
    expect(deps.reply).toHaveBeenCalledWith(LIST_EMPTY_TEXT)
  })

  it('普通の会話（「一覧を出して」）では発火しない', async () => {
    const deps = makeDeps()
    const res = await handleClaimedGroupMessage(makeParams({ text: '一覧を出して' }), deps)
    expect(res).toEqual({ matched: null })
    expect(deps.reply).not.toHaveBeenCalled()
  })
})

/**
 * 番号を落とした「完了」単独 — 黙ると詰むので、番号の付け方と「一覧」への逃げ道を返す。
 */
describe('番号なしの「完了」', () => {
  it('「完了」だけなら番号の付け方を案内する（沈黙しない）', async () => {
    const deps = makeDeps()
    const res = await handleClaimedGroupMessage(makeParams({ text: '完了' }), deps)

    expect(res).toEqual({ matched: 'complete_hint' })
    expect(deps.reply).toHaveBeenCalledWith(COMPLETE_WITHOUT_NUMBER_TEXT)
    expect(deps.completeDigestTask).not.toHaveBeenCalled()
    expect(deps.insertOutbound).toHaveBeenCalledTimes(1)
  })

  it('案内文には「一覧」と番号つきの例が入っている（次の一手が分かる）', () => {
    expect(COMPLETE_WITHOUT_NUMBER_TEXT).toContain('一覧')
    expect(COMPLETE_WITHOUT_NUMBER_TEXT).toContain('完了 3')
  })

  it('「完了1」は今までどおり完了処理（案内には落ちない）', async () => {
    const deps = makeDeps()
    const res = await handleClaimedGroupMessage(makeParams({ text: '完了1' }), deps)
    expect(res).toEqual({ matched: 'complete' })
  })

  it('「完了しました」のような報告文では発火しない', async () => {
    const deps = makeDeps()
    const res = await handleClaimedGroupMessage(makeParams({ text: '完了しました' }), deps)
    expect(res).toEqual({ matched: null })
    expect(deps.reply).not.toHaveBeenCalled()
  })
})

/**
 * 一覧が長すぎて送れない、を防ぐ（実害）。
 *
 * チャットには1通あたりの長さ上限があり（いちばん厳しい Discord で2000字）、超えると
 * 送信そのものが失敗する。タスクが溜まったグループでは「一覧」と打っても**永久に無反応**になる。
 * 打ったのに無反応、が今回いちばん直したかった失敗そのものなので、件数と文字数で必ず打ち切る。
 */
describe('一覧の打ち切り（長すぎて送れない、を作らない）', () => {
  function manyTasks(n: number) {
    return Array.from({ length: n }, (_, i) => ({
      id: `t-${i + 1}`,
      digestNumber: i + 1,
      title: `タスク${i + 1}`,
    }))
  }

  it('件数が上限を超えたら打ち切り、「ほかに N 件あります」と伝える', () => {
    const items = manyTasks(TASK_LIST_MAX_ITEMS + 5)
    const text = buildTaskListReplyText(items, '2026-07-30')

    expect(text).toContain(`タスク${TASK_LIST_MAX_ITEMS}`)
    expect(text).not.toContain(`タスク${TASK_LIST_MAX_ITEMS + 1}`)
    expect(text).toContain(buildTaskListMoreText(5))
    // 全体の件数は正直に伝える（打ち切っても総数は隠さない）
    expect(text).toContain(`（${TASK_LIST_MAX_ITEMS + 5}件）`)
  })

  it('文字数の上限も超えない（いちばん厳しいチャットでも送れる長さ）', () => {
    const items = Array.from({ length: 40 }, (_, i) => ({
      id: `t-${i + 1}`,
      digestNumber: i + 1,
      title: 'あ'.repeat(50), // タイトルの上限いっぱい
      assigneeHint: '山田',
    }))
    const text = buildTaskListReplyText(items, '2026-07-30')

    expect(text.length).toBeLessThanOrEqual(TASK_LIST_MAX_CHARS)
    expect(text).toContain('ほかに')
  })

  it('上限内なら今までどおり全部出す（打ち切りの断りも入れない）', () => {
    const items = manyTasks(3)
    const text = buildTaskListReplyText(items, '2026-07-30')

    expect(text).toContain('タスク3')
    expect(text).not.toContain('ほかに')
  })

  it('打ち切っても「完了N」の例と番号の対応は崩れない（先頭のタスクの番号を使う）', () => {
    const items = manyTasks(50)
    const text = buildTaskListReplyText(items, '2026-07-30')
    expect(text).toContain('「完了 1」')
  })
})

/**
 * 拾い方が「取り込まない(off)」のグループに「次にお届けする一覧に載ります」と言わない（嘘の約束）。
 * off のグループは毎朝のまとめ配信の対象から外れるため、その一覧は永久に届かない。
 */
describe('拾い方が「取り込まない(off)」のときの返事', () => {
  it('off のグループでは「次にお届けする一覧に載ります」と言わない', async () => {
    const deps = makeDeps()
    await handleClaimedGroupMessage(
      makeParams({ text: 'タスク追加 見積もりを送る', pickupMode: 'off' }),
      deps,
    )

    const replied = (deps.reply as ReturnType<typeof vi.fn>).mock.calls[0][0] as string
    expect(replied).toBe(buildAddTaskDoneNoDigestText('見積もりを送る'))
    expect(replied).not.toContain('次にお届けする一覧')
    // 預かったこと自体は伝える／確認のしかた（「一覧」）も伝える
    expect(replied).toContain('見積もりを送る')
    expect(replied).toContain('一覧')
  })

  it('off でもタスクは今までどおり作る（登録そのものは止めない）', async () => {
    const deps = makeDeps()
    await handleClaimedGroupMessage(
      makeParams({ text: 'タスク追加 見積もりを送る', pickupMode: 'off' }),
      deps,
    )
    expect(deps.createInstantDigestTask).toHaveBeenCalledWith(
      expect.objectContaining({ title: '見積もりを送る' }),
    )
  })

  it('off 以外（既定）では今までどおりの返事', async () => {
    const deps = makeDeps()
    await handleClaimedGroupMessage(
      makeParams({ text: 'タスク追加 見積もりを送る', pickupMode: 'all' }),
      deps,
    )
    expect(deps.reply).toHaveBeenCalledWith(buildAddTaskDoneText('見積もりを送る'))
  })

  it('拾い方が分からないとき（未指定）は今までどおりの返事', async () => {
    const deps = makeDeps()
    await handleClaimedGroupMessage(makeParams({ text: 'タスク追加 見積もりを送る' }), deps)
    expect(deps.reply).toHaveBeenCalledWith(buildAddTaskDoneText('見積もりを送る'))
  })

  it('責任者の承認が要るときは off でも承認待ちの文言（一覧の話をしない）', async () => {
    const deps = makeDeps({
      createInstantDigestTask: vi.fn().mockResolvedValue({ id: 't-1', pending: true, duplicate: false }),
    })
    await handleClaimedGroupMessage(
      makeParams({ text: 'タスク追加 見積もりを送る', pickupMode: 'off' }),
      deps,
    )
    expect(deps.reply).toHaveBeenCalledWith(APPROVAL_REQUESTED_TEXT)
  })
})

/**
 * 合図の処理が転んだときに黙らない（実害）。
 *
 * これまでは例外がそのまま上まで抜けて、打った人には返事も再送も来なかった
 * （webhook が非200なら送り直される、というのはチャネルによって成り立たない）。
 * 少なくとも「うまくいかなかった」ことは必ず伝える。
 */
describe('合図の処理が失敗したとき', () => {
  it('一覧の取得に失敗しても黙らない（うまくいかなかったと伝える）', async () => {
    const deps = makeDeps({
      assignDigestNumbersToNewTasks: vi.fn().mockRejectedValue(new Error('db down')),
    })
    const res = await handleClaimedGroupMessage(makeParams({ text: '一覧' }), deps)

    expect(res).toEqual({ matched: 'failed' })
    expect(deps.reply).toHaveBeenCalledWith(COMMAND_FAILED_TEXT)
  })

  it('タスクの登録に失敗しても黙らない', async () => {
    const deps = makeDeps({
      createInstantDigestTask: vi.fn().mockRejectedValue(new Error('rpc down')),
    })
    const res = await handleClaimedGroupMessage(
      makeParams({ text: 'タスク追加 見積もりを送る' }),
      deps,
    )

    expect(res).toEqual({ matched: 'failed' })
    expect(deps.reply).toHaveBeenCalledWith(COMMAND_FAILED_TEXT)
  })

  it('完了の処理に失敗しても黙らない', async () => {
    const deps = makeDeps({
      completeDigestTask: vi.fn().mockRejectedValue(new Error('rpc down')),
    })
    const res = await handleClaimedGroupMessage(makeParams({ text: '完了2' }), deps)

    expect(res).toEqual({ matched: 'failed' })
    expect(deps.reply).toHaveBeenCalledWith(COMMAND_FAILED_TEXT)
  })

  it('お知らせ自体も送れないときは、それ以上は何もしない（例外を投げ返さない）', async () => {
    const deps = makeDeps({
      assignDigestNumbersToNewTasks: vi.fn().mockRejectedValue(new Error('db down')),
      reply: vi.fn().mockRejectedValue(new Error('send down')),
    })
    await expect(handleClaimedGroupMessage(makeParams({ text: '一覧' }), deps)).resolves.toEqual({
      matched: 'failed',
    })
  })

  it('合図でないふつうの発言では、失敗のお知らせも出さない（沈黙のまま）', async () => {
    const deps = makeDeps({
      assignDigestNumbersToNewTasks: vi.fn().mockRejectedValue(new Error('db down')),
    })
    const res = await handleClaimedGroupMessage(makeParams({ text: 'おはようございます' }), deps)

    expect(res).toEqual({ matched: null })
    expect(deps.reply).not.toHaveBeenCalled()
  })
})

/**
 * 見本の形を1つにそろえる（秘書の返事の側）。
 *
 * 案内文（commandGuides.ts）は「『タスク追加』のあとに空白を1つ入れてください」という規則を立てている。
 * ところが番号を落とした人・一覧を見た人に出る**秘書の返事**が「完了3」と空白なしで書かれていると、
 * いちばん見本を探している人が「空白は要らない」と覚え、「タスク追加見積書」で無反応になる。
 * 案内側の同名テスト（commandGuides.test.ts）と対になる守り。
 */
describe('秘書の返事に出る見本の形をそろえる', () => {
  const SAMPLE_WITHOUT_SPACE_RE = /完了[0-9０-９]/

  it('返信文言の「完了 N」の見本には、必ず区切りの空白が入っている', () => {
    const texts = [
      COMPLETE_WITHOUT_NUMBER_TEXT,
      LIST_EMPTY_TEXT,
      ADD_TASK_EMPTY_TEXT,
      COMMAND_FAILED_TEXT,
      APPROVAL_REQUESTED_TEXT,
      buildAddTaskDoneText('見積もりを送る'),
      buildAddTaskDoneNoDigestText('見積もりを送る'),
      buildTaskListMoreText(3),
      buildTaskListReplyText([{ id: 't1', digestNumber: 7, title: '見積もりを送る' }], '2026-07-30'),
    ]
    for (const text of texts) {
      expect(text, `区切りの空白が無い見本: ${text}`).not.toMatch(SAMPLE_WITHOUT_SPACE_RE)
    }
  })
})
