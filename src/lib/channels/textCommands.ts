/**
 * チャット内の合図（コマンド）の読み取り — 「完了N」以外の共通文法。
 *
 * 「完了N」の判定は digest/commands.ts が正本で、ここでは一切触らない（既存の厳格文法を
 * そのまま残す）。ここが足すのは、利用者から「Discord でタスクをどう消すのか分からない」と
 * 言われた困りごとを直すための3つだけ:
 *   - ヘルプ（使い方をその場で出す）
 *   - タスク追加 ○○（その場で1件登録する）
 *   - あとで（練習の中断）
 *
 * ⚠ 設計方針: **打っていない人には絶対に発火させない**。
 *   ヘルプ・中断は正規化したうえでの「完全一致」で判定する。「ヘルプが欲しい」のような
 *   普通の会話に秘書が割り込むと、グループの会話そのものを壊すため。
 *   「タスク追加」だけは内容を続けて書く必要があるので先頭一致にする（文中の言及では発火しない）。
 */

import { sanitizeDigestTitle } from '@/lib/channels/digest/compute'

/**
 * 合図の突合用に正規化する。
 * 前後空白除去 → 全角英数を半角へ → 空白（全角含む）を全除去 → 小文字化。
 */
export function normalizeCommandToken(text: string): string {
  return text
    .trim()
    // 全角の英数字（Ａ-Ｚ ａ-ｚ ０-９）を半角へ。全角と半角で別扱いにしない
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    // 空白（全角スペース含む）は全て除去
    .replace(/[\s　]+/g, '')
    .toLowerCase()
}

/** 語尾の「？」「!」「。」程度のゆらぎは合図として無視する（打った人には必ず届かせる）。 */
const TRAILING_PUNCTUATION_RE = /[?？!！。、.]+$/

function toCommandKeyword(text: string): string {
  return normalizeCommandToken(text).replace(TRAILING_PUNCTUATION_RE, '')
}

/** 使い方を出す合図。 */
const HELP_KEYWORDS = ['ヘルプ', 'help', '使い方', 'つかいかた', 'コマンド'] as const

/**
 * 練習をやめる合図。
 *
 * ⚠ 語彙は意図的に狭い。中断の判定は「練習が進行中のグループ」でしか行わない
 *   （tutorial/run.ts の advanceTutorial は、練習の状態が保存されているときにだけ
 *   parseSkipCommand を呼ぶ）が、その24時間の間に普通の会話でぶつかると
 *   秘書が余計な返事をしてしまう。案内している逃げ道は『あとで』だけなので、
 *   単独でも会話に出てきやすい「やめる」「中止」は合図にしない。
 */
const SKIP_KEYWORDS = ['あとで', 'スキップ', 'skip'] as const

/**
 * いまのタスクを番号つきで出し直す合図。
 *
 * ⚠ これが無いと詰む: まとめの一覧を見失うと番号が分からなくなり、「完了N」が打てなくなる。
 *   （案内には「完了3」のように書いてあるのに、その3がどこにも見当たらない状態になる）
 */
const LIST_KEYWORDS = ['一覧', 'いちらん', 'タスク一覧', 'リスト', 'list'] as const

/**
 * 番号を付け忘れた「完了」単独。
 *
 * ⚠ 沈黙させない: 案内は「終わったら『完了3』と送ってください」と読めるので、
 *   番号を落として「完了」だけ送る人が必ず出る。ここで黙ると、打った本人は
 *   「壊れている」と受け取って二度と使わなくなる。
 */
const COMPLETE_WITHOUT_NUMBER_KEYWORDS = ['完了'] as const

/** ヘルプ合図か。厳格一致（誤爆させない）。 */
export function parseHelpCommand(text: string): boolean {
  const keyword = toCommandKeyword(text)
  return (HELP_KEYWORDS as readonly string[]).includes(keyword)
}

/** 中断合図か。厳格一致（誤爆させない）。 */
export function parseSkipCommand(text: string): boolean {
  const keyword = toCommandKeyword(text)
  return (SKIP_KEYWORDS as readonly string[]).includes(keyword)
}

/** 一覧合図か。ヘルプと同じ厳格一致（「一覧を出して」のような普通の会話では発火しない）。 */
export function parseListCommand(text: string): boolean {
  const keyword = toCommandKeyword(text)
  return (LIST_KEYWORDS as readonly string[]).includes(keyword)
}

/**
 * 番号なしの「完了」単独か。厳格一致。
 * 「完了1」は parseDigestCompleteCommand が先に拾うため、ここには来ない
 * （空白除去後に数字が残る文字列はこの完全一致に当たらない）。
 * 「完了しました」のような報告文も当たらない（完了サジェストの担当のまま）。
 */
export function parseCompleteWithoutNumberCommand(text: string): boolean {
  const keyword = toCommandKeyword(text)
  return (COMPLETE_WITHOUT_NUMBER_KEYWORDS as readonly string[]).includes(keyword)
}

export type AddTaskCommand = { title: string }

/**
 * 「タスク追加 ○○」。先頭一致のみ（「明日タスク追加する」では発火しない）。
 * prefix が付いていなければ null。本文が空なら title:'' を返し、呼び出し側が
 * 「内容が読み取れませんでした」と案内する。
 *
 * ⚠ 「タスク追加」と内容の間の区切り（空白・全角空白・コロン）は**1個以上を必須**にする。
 *   0個を許すと「タスク追加ってどうやるの？」という質問が
 *   『ってどうやるの？』というタスクになってしまう（使い方を聞いただけの人に
 *   身に覚えのないタスクを作らない）。「タスク追加」単独は内容が空の合図として読む。
 *
 * タイトルの整形（改行・制御文字の除去と50字の切り詰め）は sanitizeDigestTitle に委ねる。
 * LINE のメンション即時タスク化（buildMentionTaskTitle）と同じ上限にそろえるため、
 * ここで独自に切り詰めない。
 */
const ADD_TASK_PREFIX_RE = /^タスク追加(?:[\s　:：]+([\s\S]*))?$/

/**
 * 「タスク追加＋区切り」が本文のどこからどこまでかを返す。**読み取りの正本はここ1本**。
 *
 * LINE はタイトルを「本文から合図の区間を消す」やり方（buildMentionTaskTitle）で作るため、
 * 真偽だけでなく**消す範囲**が要る。以前は LINE だけが自前の前方一致を持っていて、
 * 区切りを見ずに「タスク追加ってどうやるの？」を『ってどうやるの？』というタスクにしていた。
 * その自前判定を捨ててここに寄せる（同じ文法が2箇所にあるとまた必ずズレるため）。
 *
 * index は常に 0（先頭一致のみ）。length は先頭の空白＋「タスク追加」＋区切りの長さ。
 */
export function matchAddTaskPrefix(
  text: string,
): { index: number; length: number; rest: string } | null {
  const leadingWhitespace = text.length - text.trimStart().length
  const trimmed = text.trim()
  const match = trimmed.match(ADD_TASK_PREFIX_RE)
  if (!match) return null
  const rest = match[1] ?? ''
  // rest は trimmed の末尾なので、差分がそのまま「合図＋区切り」の長さになる
  return { index: 0, length: leadingWhitespace + (trimmed.length - rest.length), rest }
}

export function parseAddTaskCommand(text: string): AddTaskCommand | null {
  const matched = matchAddTaskPrefix(text)
  if (!matched) return null
  return { title: sanitizeDigestTitle(matched.rest) }
}
