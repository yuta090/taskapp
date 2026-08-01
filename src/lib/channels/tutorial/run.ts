/**
 * 練習（対話型チュートリアル）の進行そのもの。
 *
 * 「Discord でタスクをどう消すのか分からない」という困りごとを、説明書ではなく
 * **手を取って1回やってもらう**ことで直す。登録直後に声をかけ、タスクを1件登録して、
 * その場で消すところまで案内する。
 *
 * この関数はDBに触らない純ロジック（送信・保存・採番はすべて呼び出し側から注入する）。
 * 各チャットの webhook から同じ形で呼べるようにするため。
 *
 * 守る不変条件:
 *   - **送るのは返信(reply)だけ**。push の口を持たないので LINE の無料枠を1通も使わない。
 *   - **未登録（limbo）グループでは動かさない**。呼び出し側は登録済みグループでのみ呼ぶ。
 *     未登録グループで反応すると、bot が居ることを外から確かめられる材料になる。
 *   - **一度終えたら二度と案内しない**（finished）。
 *   - **48時間より前に作られたグループは巻き込まない**（この機能より前からある接続を驚かせない）。
 *   - **できない操作を約束しない**。使い方を持たないチャット（1:1専用の whatsapp 等）や
 *     「タスク追加」が効かないグループでは、そもそも練習を始めない。
 *
 * ⚠ 状態の読み書き（select→update）は同一トランザクションではない（TOCTOU）。同じグループに
 *   同時刻に2発言が届くと**案内が1回余分に出る**ことがある。ただしタスクの二重作成や取りこぼしは
 *   起きない（作成側の rpc_create_instant_digest_task が unique(source_message_id, title) で冪等）。
 *   案内が1回重なるだけの害と、migration を1本足してRPC化する重さが釣り合わないため、
 *   **RPC化はしない**（この判断は意図的なもので、見落としではない）。
 */

import { getChannelCommandGuide } from '@/lib/channels/commandGuides'
import { parseSkipCommand } from '@/lib/channels/textCommands'
import {
  isNewGroup,
  isTutorialExpired,
  readTutorialState,
  type ChannelTutorialState,
  type TutorialStep,
} from '@/lib/channels/tutorial/state'
import {
  TUTORIAL_COMPLETED_TEXT,
  TUTORIAL_INTRO_TEXT,
  TUTORIAL_RESTART_INTRO_TEXT,
  TUTORIAL_SKIPPED_TEXT,
  TUTORIAL_UNAVAILABLE_TEXT,
  buildTutorialAddedText,
} from '@/lib/channels/tutorial/messages'

export interface TutorialGroupContext {
  groupId: string
  /** registry の ChannelId。使い方を持たないチャネルでは練習しない */
  channel: string
  /** channel_groups.created_at（ISO）。分からなければ遅れ出しの案内はしない */
  createdAt: string | null
  /** channel_groups.metadata（jsonb） */
  metadata: Record<string, unknown> | null
  /**
   * 「タスク追加 ○○」がこのグループで実際に効くか（既定 true）。
   * LINE は拾い方の設定(pickup_mode)によって効かない場合があるため、呼び出し側が実態を渡す。
   * false のときは練習を始めない（打っても無反応、が本件で直そうとしている失敗そのものだから）。
   */
  addTaskEnabled?: boolean
}

/** 採番の結果のうち、練習が必要とする分だけ。 */
export interface TutorialNumberedTask {
  id: string
  digestNumber: number
  title: string
}

export interface TutorialDeps {
  /** 秘書の発話。返信のみ（push は持たない） */
  reply: (text: string) => Promise<void>
  /** metadata.tutorial を保存する（既存キーを壊さないマージ更新であること） */
  saveTutorialState: (groupId: string, state: ChannelTutorialState) => Promise<void>
  /**
   * **番号がまだ無いタスクにだけ**続きの番号を与えて、一覧に出るタスクを番号順で返す。
   * ⚠ 番号の総入れ替え（clearAndRenumberOpenDigestTasks）を渡してはいけない。総入れ替えは
   *   配信直前の cron だけの仕事で、チャットの発言をきっかけに走らせると利用者の手元の一覧と
   *   番号がズレる（「完了3」が別のタスクを消す）。
   */
  assignDigestNumbersToNewTasks: (groupId: string) => Promise<TutorialNumberedTask[]>
  now: () => Date
}

/** 直前の1発言で何が起きたか。 */
export type TutorialSignal =
  | { kind: 'add_task'; taskId: string | null; pending: boolean; title: string }
  | { kind: 'complete'; digestNumber: number; completedTaskId: string | null }
  | { kind: 'help' }
  | { kind: 'other'; text: string }

/** 練習を始められるチャット/グループか。 */
function canRunTutorial(group: TutorialGroupContext): boolean {
  if (!getChannelCommandGuide(group.channel)) return false
  if (group.addTaskEnabled === false) return false
  return true
}

async function saveStep(
  group: TutorialGroupContext,
  deps: TutorialDeps,
  state: ChannelTutorialState,
): Promise<void> {
  await deps.saveTutorialState(group.groupId, state)
}

/**
 * 登録が成立した直後に練習の入り口を出す。
 * 既に案内済みなら何もしない。ここでは「48時間以内か」は見ない — たった今成立した接続だから。
 */
export async function startTutorial(
  group: TutorialGroupContext,
  deps: TutorialDeps,
): Promise<TutorialStep | null> {
  if (!canRunTutorial(group)) return null
  if (readTutorialState(group.metadata)) return null

  await deps.reply(TUTORIAL_INTRO_TEXT)
  const state: ChannelTutorialState = {
    step: 'awaiting_add',
    // toISOString(): timestamptz の瞬時値用途（date-only ではない・既存踏襲）。
    startedAt: deps.now().toISOString(),
  }
  await saveStep(group, deps, state)
  return 'awaiting_add'
}

/**
 * 「練習」と送られたときに、最初からやり直す。
 *
 * startTutorial との違いは2つ。**本人が明示的に頼んだ**ので、
 *   - すでに終わっている(finished)・途中である、のどちらでも始め直す（前の途中経過は持ち越さない）
 *   - 「前からある接続を巻き込まない」48時間の窓は効かせない（遅れ出しの案内を防ぐための窓であって、
 *     本人の依頼を断る理由にはならない）
 *
 * 練習できないグループでは**黙らずに理由を返す**。打ったのに無反応が、この案件で
 * いちばん直したかった失敗だから。
 */
export async function restartTutorial(
  group: TutorialGroupContext,
  deps: TutorialDeps,
): Promise<TutorialStep | null> {
  if (!canRunTutorial(group)) {
    await deps.reply(TUTORIAL_UNAVAILABLE_TEXT)
    return null
  }

  // toISOString(): timestamptz の瞬時値用途（date-only ではない・既存踏襲）。
  const startedAt = deps.now().toISOString()

  // 途中（登録は済んで、消し込み待ち）で「練習」と打たれた場合。
  //
  // ⚠ ここで無条件に最初から始めると、前に登録した練習用タスクが**開いたまま置き去りになる**。
  //   練習をやり直すたびに「れんしゅう」が1件ずつ相手先の一覧に積み上がっていく。
  //   前のタスクがまだ残っているなら、そこから**続き**を案内する（新しく作らせない）。
  //   残っていなければ（消された・完了済み）ふつうに最初から。
  const previous = readTutorialState(group.metadata)
  if (previous?.step === 'awaiting_done' && previous.taskId) {
    const resumed = await resumePractice(group, deps, previous, startedAt)
    if (resumed) return resumed
  }

  const state: ChannelTutorialState = { step: 'awaiting_add', startedAt }
  // ★保存を先に済ませる。案内を送ったあとで保存が転ぶと、
  //   利用者は言われたとおり「タスク追加」を打つのに練習が1歩も進まない（無反応に見える）。
  await saveStep(group, deps, state)
  await deps.reply(TUTORIAL_RESTART_INTRO_TEXT)
  return 'awaiting_add'
}

/**
 * 途中だった練習を、前のタスクのまま続きから案内する。
 * 前のタスクが一覧に見当たらなければ null（呼び出し側が最初から始める）。
 */
async function resumePractice(
  group: TutorialGroupContext,
  deps: TutorialDeps,
  previous: ChannelTutorialState,
  startedAt: string,
): Promise<TutorialStep | null> {
  let open: TutorialNumberedTask[]
  try {
    open = await deps.assignDigestNumbersToNewTasks(group.groupId)
  } catch (error) {
    // 番号が読めないなら続きを約束できない。最初から始めるほうへ倒す。
    console.error('[tutorial] resume lookup failed', group.groupId, error)
    return null
  }

  // 番号は毎時ふり直されるので、控えていた番号ではなく**いまの番号**で案内する。
  const target = open.find((task) => task.id === previous.taskId)
  if (!target) return null

  const state: ChannelTutorialState = {
    step: 'awaiting_done',
    taskId: target.id,
    digestNumber: target.digestNumber,
    startedAt,
  }
  await saveStep(group, deps, state)
  await deps.reply(buildTutorialAddedText(target.digestNumber, target.title))
  return 'awaiting_done'
}

/**
 * 登録済みグループの1発言で練習を進める。
 * 返すのは「状態を書き換えたときのその段階」。何もしなかったときは null。
 */
export async function advanceTutorial(
  group: TutorialGroupContext,
  signal: TutorialSignal,
  deps: TutorialDeps,
): Promise<TutorialStep | null> {
  if (!canRunTutorial(group)) return null

  const now = deps.now()
  const state = readTutorialState(group.metadata)

  // まだ案内していないグループ: コンソールでの承認で成立した接続の受け皿（遅れ出し）。
  // 承認APIから送ると返信ではなく能動送信になり無料枠を使うので、承認後の最初の発言で始める。
  if (!state) {
    if (signal.kind !== 'other') return null // 合図に一致した発言からは始めない
    if (!isNewGroup(group.createdAt, now)) return null // 前からある接続は巻き込まない
    return startTutorial(group, deps)
  }

  if (state.step === 'finished') return null

  // 放置の後始末（cron を増やさない・読んだときに判定する）。何も送らずに終了扱いへ落とす。
  if (isTutorialExpired(state, now)) {
    await saveStep(group, deps, { ...state, step: 'finished' })
    return 'finished'
  }

  // どの段階でも「あとで」で抜けられる。
  if (signal.kind === 'other' && parseSkipCommand(signal.text)) {
    await deps.reply(TUTORIAL_SKIPPED_TEXT)
    await saveStep(group, deps, { ...state, step: 'finished' })
    return 'finished'
  }

  if (state.step === 'awaiting_add') {
    if (signal.kind !== 'add_task') return null // ヘルプ・ふつうの発言では何もしない（沈黙）

    // 責任者の承認が要るタスクは、承認されるまで一覧に載らず番号も付かない。
    // 消せない番号を約束しないため、練習はここで静かに終える（通常の返信は呼び出し側が済ませている）。
    if (signal.pending || !signal.taskId) {
      await saveStep(group, deps, { ...state, step: 'finished' })
      return 'finished'
    }

    // 番号を確定させてから案内する。rpc_create_instant_digest_task は番号を埋めないため、
    // ここで番号を与えないと「完了N」の N を約束できない。
    // ★与えるのは今できたタスクの分だけ。既にある番号は動かさない（総入れ替えは配信直前だけ）。
    let numbered: TutorialNumberedTask[]
    try {
      numbered = await deps.assignDigestNumbersToNewTasks(group.groupId)
    } catch (error) {
      // 番号が分からないなら約束しない。状態は awaiting_add のまま＝次の「タスク追加」で再挑戦できる。
      console.error('[tutorial] assign digest number failed', group.groupId, error)
      return null
    }

    const target = numbered.find((task) => task.id === signal.taskId)
    if (!target) {
      // 直後に他の経路で完了/取り下げられた等。約束できないので静かに終える。
      await saveStep(group, deps, { ...state, step: 'finished' })
      return 'finished'
    }

    await deps.reply(buildTutorialAddedText(target.digestNumber, target.title))
    await saveStep(group, deps, {
      ...state,
      step: 'awaiting_done',
      taskId: target.id,
      digestNumber: target.digestNumber,
    })
    return 'awaiting_done'
  }

  // awaiting_done: 案内した番号で、案内したタスクが消えたときだけ締める。
  if (signal.kind !== 'complete') return null
  if (signal.digestNumber !== state.digestNumber) return null
  if (!signal.completedTaskId || signal.completedTaskId !== state.taskId) return null

  await deps.reply(TUTORIAL_COMPLETED_TEXT)
  await saveStep(group, deps, { ...state, step: 'finished' })
  return 'finished'
}
