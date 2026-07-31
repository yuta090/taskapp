import { describe, it, expect } from 'vitest'
import {
  TUTORIAL_INTRO_TEXT,
  TUTORIAL_COMPLETED_TEXT,
  TUTORIAL_SKIPPED_TEXT,
  TUTORIAL_PRACTICE_TITLE,
  buildTutorialAddedText,
} from '@/lib/channels/tutorial/messages'
import { parseAddTaskCommand, parseHelpCommand, parseSkipCommand } from '@/lib/channels/textCommands'
import { parseDigestCompleteCommand } from '@/lib/channels/digest/commands'
import { renderHelpReplyText } from '@/lib/channels/commandGuides'

/**
 * 練習で秘書がしゃべる文章。
 *
 * ここが守る約束:
 *   1. **案内どおり打てば動く**（例文は実際の読み取り関数に通して確かめる）
 *   2. **ヘルプと言い方をそろえる**（片方が「消す」、片方が「完了にする」だと迷わせる）
 *   3. **直前の返信と同じことを2度言わない**（登録の報告・完了の報告は呼び出し側が済ませている）
 *   4. **練習のタスクが相手先に残らない**（残る前提の言葉を使わない）
 *   5. **打てない言葉を動詞で誘わない**（「やめる」は合図ではないので、その語で誘わない）
 */

/** 言い方の割れを見るための語。秘書の実際の返事は「完了にしました」。 */
const OLD_TIDY_WORD_RE = /片づけ/
const DELETE_WORD_RE = /(?<!取り)消(す|し|せ|さ)/

/** 直前の返信と重なる「もう済んだことの再報告」。 */
const RE_REPORT_RE = /登録できました|登録しました|お預かりしました|完了しました|できました/

function maxParenDepth(text: string): number {
  let depth = 0
  let max = 0
  for (const ch of text) {
    if (ch === '（' || ch === '(') {
      depth += 1
      max = Math.max(max, depth)
    } else if (ch === '）' || ch === ')') {
      depth = Math.max(0, depth - 1)
    }
  }
  return max
}

const ALL_TEXTS = [
  TUTORIAL_INTRO_TEXT,
  TUTORIAL_COMPLETED_TEXT,
  TUTORIAL_SKIPPED_TEXT,
  buildTutorialAddedText(3, TUTORIAL_PRACTICE_TITLE),
]

describe('練習の文面（共通の約束）', () => {
  it('ヘルプと同じ言い方にそろえる（「片づける」「消す」を混ぜない）', () => {
    for (const text of ALL_TEXTS) {
      expect(text, `別の言い方が残っている: ${text}`).not.toMatch(OLD_TIDY_WORD_RE)
      expect(text, `「消す」が残っている: ${text}`).not.toMatch(DELETE_WORD_RE)
    }
    // ヘルプ側も同じ言い方であることを、実物どうしで突き合わせる
    expect(renderHelpReplyText('discord')).not.toMatch(OLD_TIDY_WORD_RE)
    expect(renderHelpReplyText('discord')).not.toMatch(DELETE_WORD_RE)
  })

  it('番号のふり直しを時刻で断定しない', () => {
    for (const text of ALL_TEXTS) {
      expect(text, `時刻を断定している: ${text}`).not.toMatch(/毎朝|毎日|翌朝|明朝/)
    }
  })

  it('カッコを入れ子にしない', () => {
    for (const text of ALL_TEXTS) {
      expect(maxParenDepth(text), `カッコが入れ子: ${text}`).toBeLessThanOrEqual(1)
    }
  })
})

describe('TUTORIAL_INTRO_TEXT', () => {
  it('打たせる合図が、実際の読み取りでそのまま通る', () => {
    const line = TUTORIAL_INTRO_TEXT.split('\n').find((l) => l.includes('タスク追加'))!
    expect(line, '練習の打ち方が書かれていない').toBeDefined()
    const quoted = line.match(/『(.+?)』/)![1]
    const parsed = parseAddTaskCommand(quoted)
    expect(parsed, `案内どおり打っても読めない: ${quoted}`).not.toBeNull()
    expect(parsed!.title).toBe(TUTORIAL_PRACTICE_TITLE)
  })

  it('「タスク追加」のあとに空白が要ることを、最初に打たせる前に伝える', () => {
    expect(parseAddTaskCommand(`タスク追加${TUTORIAL_PRACTICE_TITLE}`), '区切り無しでも読めてしまう').toBeNull()
    expect(TUTORIAL_INTRO_TEXT, '空白が要ることが書かれていない').toMatch(/空白|空け/)
  })

  it('逃げ道（あとで）と救急箱（ヘルプ）を最初に伝える', () => {
    expect(parseSkipCommand('あとで')).toBe(true)
    expect(parseHelpCommand('ヘルプ')).toBe(true)
    expect(TUTORIAL_INTRO_TEXT).toContain('『あとで』')
    expect(TUTORIAL_INTRO_TEXT).toContain('『ヘルプ』')
  })

  /**
   * 「やめるときは『あとで』」と書くと、動詞につられて『やめる』と打つ人が出る。
   * ところが『やめる』は合図から外してある（普通の会話に割り込まないため）ので無反応になる。
   * 打てない言葉を、文章の動詞で誘わない。
   */
  it('合図でない言葉を動詞で誘わない（『やめる』は合図ではない）', () => {
    expect(parseSkipCommand('やめる'), '前提が変わっている: やめるが合図になった').toBe(false)
    expect(TUTORIAL_INTRO_TEXT, '打てない言葉で誘っている').not.toContain('やめる')
  })

  it('練習のタスクが残らないことをその場で伝える', () => {
    expect(TUTORIAL_INTRO_TEXT).toContain('残りません')
  })

  it('練習のタイトルは使い捨てと分かる短い言葉にする（相手先の一覧に中身の無いタスクを残さない）', () => {
    expect(TUTORIAL_PRACTICE_TITLE).toContain('れんしゅう')
    expect(TUTORIAL_PRACTICE_TITLE.length).toBeLessThanOrEqual(8)
  })
})

describe('buildTutorialAddedText', () => {
  const text = buildTutorialAddedText(3, TUTORIAL_PRACTICE_TITLE)

  it('約束した番号で完了にできる（案内する合図が実際の読み取りに通る）', () => {
    const commands = [...text.matchAll(/『(.+?)』/g)].map((m) => m[1])
    const complete = commands.find((c) => parseDigestCompleteCommand(c))
    expect(complete, `完了の打ち方が書かれていない: ${text}`).toBeDefined()
    expect(parseDigestCompleteCommand(complete!)).toBe(3)
  })

  it('いま付いた番号を伝える', () => {
    expect(text).toContain('3')
  })

  it('直前の「登録しました」を言い直さず、次にやることだけを言う', () => {
    expect(text, `同じ報告を2通続けている: ${text}`).not.toMatch(RE_REPORT_RE)
  })

  /**
   * 直前の返信の文面に寄りかからない。
   *
   * 以前は「直前の返信が『次にお届けする一覧に載ります』と言っている」ことを前提に
   * 「いま付いた番号は3番です。」と書いていた。ところが LINE はこの返信を通らず、
   * 直前に出るのは「タスクに追加しました。」だけで**一覧の話をしていない**。
   * 前提が崩れるので、この1通だけを読んで通じる形にする。
   */
  it('この1通だけで、どのタスクの何番なのかが分かる', () => {
    expect(text, `どのタスクの話か分からない: ${text}`).toContain(TUTORIAL_PRACTICE_TITLE)
    expect(text, `番号が書かれていない: ${text}`).toContain('3')
  })

  it('直前の返信を指す言い方から始めない（LINEでは直前の文面が違う）', () => {
    expect(text.split('\n')[0], `直前の返信に寄りかかっている: ${text}`).not.toMatch(/^(その|それ|これ|この|上の|いま付いた)/)
  })

  it('定期のお知らせを指す「一覧」を練習で持ち出さない（合図の名前と意味が割れる）', () => {
    expect(text, `意味の割れる語を使っている: ${text}`).not.toContain('一覧')
  })
})

describe('TUTORIAL_COMPLETED_TEXT / TUTORIAL_SKIPPED_TEXT', () => {
  it('締めは、完了の報告を繰り返さずに終わりだけ伝える', () => {
    expect(TUTORIAL_COMPLETED_TEXT, '同じ報告を2通続けている').not.toMatch(RE_REPORT_RE)
    expect(TUTORIAL_COMPLETED_TEXT).toContain('『ヘルプ』')
  })

  it('やめたときは引き止めず、呼び出し方だけ残す', () => {
    expect(TUTORIAL_SKIPPED_TEXT).toContain('『ヘルプ』')
    expect(TUTORIAL_SKIPPED_TEXT.length).toBeLessThanOrEqual(60)
  })
})
