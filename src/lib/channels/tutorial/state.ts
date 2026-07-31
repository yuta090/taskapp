/**
 * 練習（対話型チュートリアル）の進み具合の持ち方。
 *
 * 置き場所は `channel_groups.metadata`（jsonb・既存の器）の `tutorial` キー。
 * **テーブルも列も増やさない（DDLゼロ）**。増やすのは「登録した直後の1回だけ使う短命な状態」
 * のためで、そのために移行の要る列を足すのは割に合わないため。
 *
 * 放置の後始末に cron は増やさない。**読んだときに24時間で期限切れと判定して終了扱いに落とす**
 * （遅延評価）。二度と発言が来なければ状態が残るだけで、誰にも害が無い。
 * 練習で作ったタスクは消さない — 利用者が自分の言葉で書いた本物のタスクだから。
 */

/** 練習の段階。awaiting_add=登録待ち / awaiting_done=消し込み待ち / finished=終了（二度と案内しない） */
export type TutorialStep = 'awaiting_add' | 'awaiting_done' | 'finished'

export interface ChannelTutorialState {
  step: TutorialStep
  /** 練習で登録したタスク（awaiting_done の間だけ入る） */
  taskId?: string
  /** 案内した番号（awaiting_done の間だけ入る） */
  digestNumber?: number
  /** 開始時刻。ISO文字列（timestamptz の瞬時値用途・date-only ではない） */
  startedAt: string
}

/** 24時間で自動終了（放置の始末を cron でなく読み取り時に行う）。 */
export const TUTORIAL_TTL_MS = 24 * 60 * 60 * 1000

/** この機能より前からある既存グループを巻き込まないための窓。 */
export const NEW_GROUP_WINDOW_MS = 48 * 60 * 60 * 1000

const STEPS: readonly string[] = ['awaiting_add', 'awaiting_done', 'finished']

/**
 * metadata.tutorial を読む。jsonb は外から来る「なんでも入る箱」なので形を検査する。
 * 形が壊れていれば null（＝まだ案内していない扱い）に倒す。
 */
export function readTutorialState(
  metadata: Record<string, unknown> | null | undefined,
): ChannelTutorialState | null {
  const raw = metadata?.tutorial
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null

  const value = raw as Record<string, unknown>
  const step = value.step
  const startedAt = value.startedAt
  if (typeof step !== 'string' || !STEPS.includes(step)) return null
  if (typeof startedAt !== 'string' || !startedAt) return null

  const state: ChannelTutorialState = { step: step as TutorialStep, startedAt }
  if (typeof value.taskId === 'string') state.taskId = value.taskId
  if (typeof value.digestNumber === 'number' && Number.isInteger(value.digestNumber)) {
    state.digestNumber = value.digestNumber
  }
  return state
}

/** 開始から24時間たったか。開始時刻が読めない場合も期限切れ扱い（宙吊りにしない）。 */
export function isTutorialExpired(state: ChannelTutorialState, now: Date): boolean {
  const startedAt = Date.parse(state.startedAt)
  if (Number.isNaN(startedAt)) return true
  return now.getTime() - startedAt > TUTORIAL_TTL_MS
}

/**
 * この機能より後に作られたグループか。48時間以内なら「新しい」。
 * 既存グループ（前からある接続）は全て48時間より古いので、遅れ出しの案内が絶対に発火しない。
 */
export function isNewGroup(createdAt: string | null | undefined, now: Date): boolean {
  if (!createdAt) return false
  const created = Date.parse(createdAt)
  if (Number.isNaN(created)) return false
  return now.getTime() - created <= NEW_GROUP_WINDOW_MS
}
