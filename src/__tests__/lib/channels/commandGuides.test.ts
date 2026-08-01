import { describe, it, expect } from 'vitest'
import {
  BOT_PROFILE_SHORT_TEXT_MAX_LENGTH,
  BOT_PROFILE_TEXT_MAX_LENGTH,
  CHANNEL_COMMAND_TRAITS,
  LIST_COMMAND_INPUT,
  getChannelCommandGuide,
  getChannelPastePlacement,
  renderBotProfileShortText,
  renderBotProfileText,
  renderHelpReplyText,
} from '@/lib/channels/commandGuides'
import { chatChannels, listChannels } from '@/lib/channels/registry'
import { parseDigestCompleteCommand } from '@/lib/channels/digest/commands'
import {
  parseAddTaskCommand,
  parseHelpCommand,
  parsePracticeCommand,
} from '@/lib/channels/textCommands'
import { buildDigestDoneText } from '@/lib/channels/claimLimboCore'
import { buildTaskListReplyText } from '@/lib/channels/groupCommands'
import {
  TUTORIAL_INTRO_TEXT,
  TUTORIAL_PRACTICE_TITLE,
  buildTutorialAddedText,
} from '@/lib/channels/tutorial/messages'

/**
 * 文言の検証は「正解の文字列をテストに写す」のではなく、**性質**（含む／含まない・順序・
 * 字数上限）で見る。文字列を写すと、案内を直すたびにテストも同じ間違いごと書き換わり、
 * 何も守れなくなるため。
 */

/** 案内と実際の返事で言い方が割れていないか見るための語。秘書は「完了にしました」と返す。 */
const OLD_TIDY_WORD_RE = /片づけ/
const DELETE_WORD_RE = /(?<!取り)消(す|し|せ|さ)/

/** 時刻・頻度を断定していないか見るための語（番号のふり直しは毎朝ではない）。 */
const FIXED_TIME_WORD_RE = /毎朝|毎日|翌朝|明朝|朝の|朝に/

/** LINE に実在するボタンの名前。説明の中の「取り消す」は、この形以外で出してはいけない。 */
const UNDO_BUTTON_LABEL = '[取り消す]'

/** カッコの入れ子の深さ。読みにくさ（（例: @（秘書の名前））のような形）を機械で弾く。 */
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

function countOccurrences(text: string, word: string): number {
  return text.split(word).length - 1
}

/** そのチャネルの利用者が実際に目にする文章（画面・チャット返信・プロフィール欄）を全部集める。 */
function allUserFacingTexts(channel: string): string[] {
  const guide = getChannelCommandGuide(channel)!
  return [
    guide.summary,
    guide.summaryShort,
    ...guide.commands.flatMap((c) => [c.effect, c.shortEffect ?? '', c.note ?? '']),
    ...guide.limitations,
    renderHelpReplyText(channel)!,
    renderBotProfileText(channel)!,
    renderBotProfileShortText(channel)!,
  ].filter((t) => t.length > 0)
}

const GROUP_CHANNELS = chatChannels().filter((c) => c.group && c.inbound && c.status !== 'planned')

/**
 * チャットごとの「使い方」— 単一の真実源。
 *
 * ここが守る約束:
 *   1. **グループで使えるチャットには必ず使い方がある**（無いと「Discordでタスクをどう完了に
 *      するのか分からない」という今回の困りごとがそのまま残る）
 *   2. **使えない操作は案内しない**（1:1専用のチャットに「グループの申し送り」の話を書かない）
 *   3. **例文は本物の合図である**（案内どおり打っても動かない、を機械で防ぐ）
 *   4. **1つの操作を2つの言葉で呼ばない**（案内が「片づける」で返事が「完了にしました」だと迷う）
 */
describe('CHANNEL_COMMAND_TRAITS / getChannelCommandGuide', () => {
  const groupChannels = GROUP_CHANNELS
  const nonGroupChannels = listChannels().filter((c) => !(c.group && c.inbound && c.status !== 'planned'))

  it('グループで使えるチャットが7つある（前提の確認）', () => {
    expect(groupChannels.map((c) => c.id).sort()).toEqual(
      ['chatwork', 'discord', 'google_chat', 'line', 'slack', 'teams', 'telegram'].sort(),
    )
  })

  it.each(groupChannels.map((c) => [c.id, c.label]))(
    'グループで使えるチャット(%s: %s)には必ず使い方がある',
    (id) => {
      expect(getChannelCommandGuide(id as string)).not.toBeNull()
    },
  )

  it.each(nonGroupChannels.map((c) => [c.id, c.label]))(
    '1:1専用・未実装のチャット(%s: %s)には使い方を置かない',
    (id) => {
      expect(getChannelCommandGuide(id as string)).toBeNull()
    },
  )

  it('未知のチャネル名は null（呼び出し側でボタンごと出さない判断ができる）', () => {
    expect(getChannelCommandGuide('unknown_channel')).toBeNull()
    expect(renderBotProfileText('unknown_channel')).toBeNull()
    expect(renderHelpReplyText('unknown_channel')).toBeNull()
  })

  it('完了の例文は、実際の読み取り（parseDigestCompleteCommand）で番号として読める', () => {
    for (const def of groupChannels) {
      const guide = getChannelCommandGuide(def.id)!
      const traits = CHANNEL_COMMAND_TRAITS[def.id]!
      if (!traits.complete) continue
      const entry = guide.commands.find((c) => c.input?.startsWith('完了'))
      expect(entry, `${def.id}: 完了の例文が無い`).toBeDefined()
      expect(parseDigestCompleteCommand(entry!.input!), `${def.id}: 完了の例文が読めない`).not.toBeNull()
    }
  })

  it('使い方の例文は、実際の読み取り（parseHelpCommand）で読める', () => {
    for (const def of groupChannels) {
      const guide = getChannelCommandGuide(def.id)!
      const traits = CHANNEL_COMMAND_TRAITS[def.id]!
      if (!traits.help) continue
      const entry = guide.commands.find((c) => c.input !== null && parseHelpCommand(c.input))
      expect(entry, `${def.id}: 使い方の例文が無い`).toBeDefined()
    }
  })

  it('タスク追加の例文は、実際の読み取り（parseAddTaskCommand）で内容まで読める', () => {
    for (const def of groupChannels) {
      const guide = getChannelCommandGuide(def.id)!
      const traits = CHANNEL_COMMAND_TRAITS[def.id]!
      if (!traits.addTask) continue
      const entry = guide.commands.find((c) => c.input?.startsWith('タスク追加'))
      expect(entry, `${def.id}: タスク追加の例文が無い`).toBeDefined()
      const parsed = parseAddTaskCommand(entry!.input!)
      expect(parsed, `${def.id}: タスク追加の例文が読めない`).not.toBeNull()
      expect(parsed!.title.length, `${def.id}: 例文の内容が空`).toBeGreaterThan(0)
    }
  })

  it('注意書きは否定から始めない（探している人が最初に「できません」にぶつからない）', () => {
    for (const def of groupChannels) {
      const guide = getChannelCommandGuide(def.id)!
      const first = guide.limitations[0]
      expect(first, `${def.id}: 注意書きが無い`).toBeDefined()
      const firstSentence = first.split('。')[0]
      expect(firstSentence, `${def.id}: 1行目が否定から始まっている`).not.toMatch(/できません|ありません/)
    }
  })

  /**
   * 1通の中で同じ話を2回しない。合図の一覧が「完了 3 でタスクを完了にする」と答えているのに、
   * 注意書きでも同じ手順を書くと、読み手は「別の話かもしれない」と読み直すことになる。
   */
  it('合図の一覧で答えた手順を、注意書きで言い直さない', () => {
    for (const def of groupChannels) {
      const guide = getChannelCommandGuide(def.id)!
      const completeInput = guide.commands.find((c) => c.input?.startsWith('完了'))!.input!
      const restated = guide.limitations.filter(
        (l) => l.includes(completeInput) && l.includes('送ってください') && !l.includes('だけを送って'),
      )
      expect(restated, `${def.id}: 同じ手順を注意書きでも書いている: ${restated.join(' / ')}`).toHaveLength(0)
    }
  })

  it('LINEのボタンの説明と、間違えたときの案内が二重にならない', () => {
    const guide = getChannelCommandGuide('line')!
    const undoMentions = [
      ...guide.commands.filter((c) => c.effect.includes('[取り消す]')).map((c) => c.effect),
      ...guide.limitations.filter((l) => l.includes('[取り消す]')),
    ]
    expect(undoMentions, `[取り消す]の説明が重複: ${undoMentions.join(' / ')}`).toHaveLength(1)
  })
})

/**
 * 1つの操作に2つの言葉を使わない。
 * 秘書の実際の返事は「『○○』を完了にしました。」なので、**案内側をその言い方に合わせる**。
 */
describe('言い方を実際の返事にそろえる', () => {
  it('秘書の返事が「完了にしました」であることを実物で確かめる', () => {
    expect(buildDigestDoneText('見積もりを送る')).toContain('完了にしました')
  })

  it('案内も「完了にします」で書く（「片づける」「消す」を混ぜない）', () => {
    for (const def of GROUP_CHANNELS) {
      for (const text of allUserFacingTexts(def.id)) {
        expect(text, `${def.id}: 別の言い方が残っている: ${text}`).not.toMatch(OLD_TIDY_WORD_RE)
        expect(text, `${def.id}: 「消す」が残っている: ${text}`).not.toMatch(DELETE_WORD_RE)
      }
      expect(renderHelpReplyText(def.id), `${def.id}: 完了の言い方が無い`).toContain('完了に')
    }
  })

  /**
   * 「取り消す」は LINE のボタンの名前。同じ本文で「取り消すことはできません」と
   * 「[取り消す]を押すと戻せます」を両方言うと、読み手は正面から混乱する。
   * ボタン名以外の場所に「取り消」を出さないことを機械で固定する。
   */
  it('「取り消す」はボタンの名前としてしか出てこない', () => {
    for (const def of GROUP_CHANNELS) {
      for (const text of allUserFacingTexts(def.id)) {
        const withoutButton = text.split(UNDO_BUTTON_LABEL).join('')
        expect(withoutButton, `${def.id}: ボタン名以外に「取り消」が出ている: ${text}`).not.toContain('取り消')
      }
    }
  })

  it('やり直しは「元に戻す」で書く（どのチャットでも同じ言い方）', () => {
    for (const def of GROUP_CHANNELS) {
      const undo = getChannelCommandGuide(def.id)!.limitations.find((l) => l.includes('間違え'))
      expect(undo, `${def.id}: 間違えたときの案内が無い`).toBeDefined()
      expect(undo!, `${def.id}: やり直しの言い方がそろっていない`).toContain('元に戻せます')
    }
  })
})

/**
 * 案内どおり打っても動かない、を機械で防ぐ。
 * 「完了」には番号が要る／「タスク追加」には空白が要る、という**規則の違い**を文面で説明する。
 */
describe('打ち方の規則を、実装の読み取りと突き合わせる', () => {
  it('「完了」だけでは動かない（番号が要ることを実装で確かめる）', () => {
    expect(parseDigestCompleteCommand('完了')).toBeNull()
    expect(parseDigestCompleteCommand('完了 3')).toBe(3)
  })

  it('番号が要ることと、番号の在りかを説明している', () => {
    for (const def of GROUP_CHANNELS) {
      const guide = getChannelCommandGuide(def.id)!
      const complete = guide.commands.find((c) => c.input?.startsWith('完了'))!
      expect(complete.note, `${def.id}: 番号の説明が無い`).toBeDefined()
      expect(complete.note!, `${def.id}: 番号の在りかが書かれていない`).toContain('番号')
      expect(complete.note!, `${def.id}: 番号なしでは動かないことが書かれていない`).toMatch(
        /動きません|効きません|届きません/,
      )
      // チャット返信・プロフィール欄にも同じ説明が載ること（画面を持たない相手先が読む）
      expect(renderHelpReplyText(def.id)!).toContain(complete.note!)
      expect(renderBotProfileText(def.id)!).toContain(complete.note!)
    }
  })

  it('番号が分からないときの逃げ道として「一覧」を案内する', () => {
    for (const def of GROUP_CHANNELS) {
      const guide = getChannelCommandGuide(def.id)!
      const list = guide.commands.find((c) => c.input === LIST_COMMAND_INPUT)
      expect(list, `${def.id}: 「一覧」の案内が無い`).toBeDefined()
      expect(list!.effect, `${def.id}: 何が返るのか書かれていない`).toContain('番号')
      expect(list!.note ?? '', `${def.id}: いつ使うのか書かれていない`).toContain('番号')
      expect(renderHelpReplyText(def.id)!).toContain(LIST_COMMAND_INPUT)
      expect(renderBotProfileShortText(def.id)!).toContain(LIST_COMMAND_INPUT)
    }
  })

  it('「タスク追加」は区切りが要る（例文にも空白があり、注意書きでも言う）', () => {
    // 実装の事実: 区切り無しは読み取れない（＝無反応になる）
    expect(parseAddTaskCommand('タスク追加見積もりを送る')).toBeNull()
    for (const def of GROUP_CHANNELS) {
      const guide = getChannelCommandGuide(def.id)!
      const add = guide.commands.find((c) => c.input?.startsWith('タスク追加'))!
      expect(add.input!, `${def.id}: 例文に区切りが無い`).toMatch(/^タスク追加[\s　]/)
      expect(add.note, `${def.id}: 区切りの説明が無い`).toBeDefined()
      expect(add.note!, `${def.id}: 空白が要ることが書かれていない`).toMatch(/空白|空け/)
      expect(renderHelpReplyText(def.id)!).toContain(add.note!)
      expect(renderBotProfileText(def.id)!).toContain(add.note!)
    }
  })

  it('打つ合図の並び順は 完了 → 一覧 → タスク追加 → ヘルプ → 練習（困っている順）', () => {
    for (const def of GROUP_CHANNELS) {
      const guide = getChannelCommandGuide(def.id)!
      const typed = guide.commands.filter((c) => c.input !== null).map((c) => c.input!)
      const kind = typed.map((input) => {
        if (parseDigestCompleteCommand(input)) return 'complete'
        if (input === LIST_COMMAND_INPUT) return 'list'
        if (parseAddTaskCommand(input)) return 'add'
        if (parseHelpCommand(input)) return 'help'
        if (parsePracticeCommand(input)) return 'practice'
        return 'other'
      })
      // 練習はいちばん後ろ。ヘルプを読んでも分からなかった人の受け皿なので。
      expect(kind, `${def.id}: 並び順が違う`).toEqual([
        'complete',
        'list',
        'add',
        'help',
        'practice',
      ])
    }
  })
})

describe('読みやすさ（声に出して読める文章か）', () => {
  it('番号のふり直しを時刻で断定しない（一覧が出るたびに変わるため）', () => {
    for (const def of GROUP_CHANNELS) {
      for (const text of allUserFacingTexts(def.id)) {
        expect(text, `${def.id}: 時刻を断定している: ${text}`).not.toMatch(FIXED_TIME_WORD_RE)
      }
      expect(
        renderHelpReplyText(def.id),
        `${def.id}: どの一覧の番号を使うのかが書かれていない`,
      ).toContain('いちばん新しい')
    }
  })

  it('同じ言葉を1通で繰り返しすぎない（「一覧」は5回まで）', () => {
    for (const def of GROUP_CHANNELS) {
      const help = renderHelpReplyText(def.id)!
      expect(countOccurrences(help, '一覧'), `${def.id}: 「一覧」が多すぎる`).toBeLessThanOrEqual(5)
    }
  })

  it('メンションの補足に、そのまま打たれる見本を書かない', () => {
    for (const def of GROUP_CHANNELS) {
      for (const text of allUserFacingTexts(def.id)) {
        expect(text, `${def.id}: 見本をそのまま打たれる書き方: ${text}`).not.toContain('@秘書')
      }
    }
  })

  it('相手先が実行できない案内をしない（「コンソール」と言わず、担当の方に伝えてもらう）', () => {
    for (const def of GROUP_CHANNELS) {
      for (const text of allUserFacingTexts(def.id)) {
        expect(text, `${def.id}: 社内用語が出ている: ${text}`).not.toContain('コンソール')
        expect(text, `${def.id}: 社内用語が出ている: ${text}`).not.toContain('アプリの画面')
      }
      const undo = getChannelCommandGuide(def.id)!.limitations.find((l) => l.includes('間違え'))!
      // 取り消しボタンが届かないチャットでは、読んだ人自身ではなく担当の方にお願いする
      if (!CHANNEL_COMMAND_TRAITS[def.id]!.buttons) {
        expect(undo, `${def.id}: 誰に頼めばよいか書かれていない`).toContain('担当の方')
      }
    }
  })

  it('カッコを入れ子にしない（読みにくい補足を機械で弾く）', () => {
    for (const def of GROUP_CHANNELS) {
      for (const text of allUserFacingTexts(def.id)) {
        expect(maxParenDepth(text), `${def.id}: カッコが入れ子: ${text}`).toBeLessThanOrEqual(1)
      }
    }
  })

  it('LINEの「タスク追加」に「設定によっては効かない」という但し書きを付けない', () => {
    expect(CHANNEL_COMMAND_TRAITS.line!.addTask).toBe(true)
    for (const text of allUserFacingTexts('line')) {
      expect(text, `打ったのに効かないと読める但し書き: ${text}`).not.toMatch(/設定によって|場合によって|効かないこと/)
    }
  })

  it('各使い方には概要と3つ以上の合図がある', () => {
    for (const def of GROUP_CHANNELS) {
      const guide = getChannelCommandGuide(def.id)!
      expect(guide.channel).toBe(def.id)
      expect(guide.summary.length, `${def.id}: 概要が空`).toBeGreaterThan(0)
      expect(guide.summaryShort.length, `${def.id}: 短い概要が空`).toBeGreaterThan(0)
      expect(guide.commands.length, `${def.id}: 合図が少なすぎる`).toBeGreaterThanOrEqual(3)
      expect(guide.limitations.length, `${def.id}: 注意書きが無い`).toBeGreaterThan(0)
    }
  })
})

/**
 * 「一覧」という語が、1通の中で2つの意味に割れないようにする。
 *
 * 起きていた実害: 同じヘルプ1通の中で「一覧」が
 *   ① 秘書が定期的に送ってくるお知らせ  ② 打つと現在のタスクが返ってくる合図
 * の両方を指していた。しかも注意書きが「番号は一覧を作り直すたびに付け直します」と読め、
 * **新しい合図の実際の動き（番号を1つも動かさない）と正反対**のことを言っていた。
 * 定期のお知らせ側は「お知らせ」と呼び、「一覧」は打つ合図の名前だけに使う。
 */
describe('「一覧」の意味が1通の中で衝突しない', () => {
  it('「一覧」は打つ合図の名前としてしか出てこない', () => {
    for (const def of GROUP_CHANNELS) {
      for (const text of allUserFacingTexts(def.id)) {
        // 合図として書いた形（行頭の見出し・かぎカッコ付き）を取り除いた残りに出てはいけない
        const rest = text
          .split(`・${LIST_COMMAND_INPUT} `)
          .join('')
          .split(`「${LIST_COMMAND_INPUT}」`)
          .join('')
        expect(rest, `${def.id}: 合図でない意味の「${LIST_COMMAND_INPUT}」が残っている: ${text}`).not.toContain(
          LIST_COMMAND_INPUT,
        )
      }
    }
  })

  it('定期のお知らせを指す言葉が、合図と別の語になっている', () => {
    for (const def of GROUP_CHANNELS) {
      const help = renderHelpReplyText(def.id)!
      expect(help, `${def.id}: 定期のお知らせの呼び名が無い`).toContain('お知らせ')
    }
  })

  /**
   * 注意書きが実装と逆を言わない。「一覧」の返事は番号を振り直さず、渡された番号
   * （1, 3, 7 と飛んでいてもそのまま）を出す。付け直しの引き金は定期のお知らせ側。
   */
  it('番号の付け直しの引き金として「一覧」を挙げない（実装は振り直さない）', () => {
    const reply = buildTaskListReplyText(
      [
        { id: 'a', digestNumber: 1, title: 'あ' },
        { id: 'b', digestNumber: 7, title: 'い' },
      ],
      '2026-07-30',
    )
    expect(reply, '前提が変わっている: 「一覧」が番号を振り直している').toContain('7. い')

    for (const def of GROUP_CHANNELS) {
      const renumber = getChannelCommandGuide(def.id)!.limitations.find((l) => l.includes('付け直します'))
      expect(renumber, `${def.id}: 番号の付け直しの注意が無い`).toBeDefined()
      // 1文目＝付け直しが起きる場面。ここに合図の名前が出ると「打つと番号が変わる」と読める
      expect(
        renumber!.split('。')[0],
        `${def.id}: 実装と逆のことを言っている: ${renumber}`,
      ).not.toContain(LIST_COMMAND_INPUT)
    }
  })
})

/**
 * 見本の形を1つにそろえる。
 * 案内自身が「『タスク追加』のあとには空白を1つ入れてください」という規則を立てているのに、
 * 見本の側が「完了3」と空白なしで書かれていると、読み手は「空白は要らない」と覚えてしまう。
 */
describe('打つ見本の形をそろえる', () => {
  const SAMPLE_WITHOUT_SPACE_RE = /完了[0-9０-９]/

  it('使い方案内の「完了 N」の見本には、必ず区切りの空白が入っている', () => {
    for (const def of GROUP_CHANNELS) {
      const guide = getChannelCommandGuide(def.id)!
      const texts = [...allUserFacingTexts(def.id), ...guide.commands.map((c) => c.input ?? '')]
      for (const text of texts) {
        expect(text, `${def.id}: 区切りの空白が無い見本: ${text}`).not.toMatch(SAMPLE_WITHOUT_SPACE_RE)
      }
    }
  })

  it('練習の文面の見本も同じ形（案内と練習で書き方が割れない）', () => {
    for (const text of [TUTORIAL_INTRO_TEXT, buildTutorialAddedText(3, TUTORIAL_PRACTICE_TITLE)]) {
      expect(text, `区切りの空白が無い見本: ${text}`).not.toMatch(SAMPLE_WITHOUT_SPACE_RE)
    }
  })
})

/**
 * 声に出して読んだときに引っかからないか。
 */
describe('読み上げて引っかからない', () => {
  it('何を指すのか分からない指示語を使わない（「そのタスク」）', () => {
    for (const def of GROUP_CHANNELS) {
      for (const text of allUserFacingTexts(def.id)) {
        expect(text, `${def.id}: 何を指すのか分からない: ${text}`).not.toContain('そのタスク')
      }
    }
  })

  it('初めて読む人に「もう一度」と言わない（ヘルプは初回にも読まれる）', () => {
    for (const def of GROUP_CHANNELS) {
      for (const text of allUserFacingTexts(def.id)) {
        expect(text, `${def.id}: 初めての読み手に合わない: ${text}`).not.toMatch(/もう一度|再度/)
      }
    }
  })
})

describe('renderBotProfileText', () => {
  it.each(GROUP_CHANNELS.map((c) => [c.id, c.label]))(
    '%s: プロフィール欄に貼る文章は空でなく上限内',
    (id) => {
      const text = renderBotProfileText(id as string)
      expect(text).not.toBeNull()
      expect(text!.length).toBeGreaterThan(0)
      expect(text!.length, `${id}: 長すぎる（${text!.length}字）`).toBeLessThanOrEqual(
        BOT_PROFILE_TEXT_MAX_LENGTH,
      )
    },
  )

  it('打つ文字列が無い項目（ボタン操作）はプロフィール欄に出さない', () => {
    const text = renderBotProfileText('line')!
    expect(text).not.toContain('・null')
    expect(text).not.toContain('undefined')
  })
})

/**
 * 貼り先の入力欄が短いチャットがある（長い版は入りきらない）。
 * 短い版は「打つ合図」に絞るが、**そのチャットでしか起きない致命的な注意だけは落とさない**
 * （Chatwork の「返信」ボタンは、知らずに使うと合図が一切効かない）。
 */
describe('renderBotProfileShortText', () => {
  it.each(GROUP_CHANNELS.map((c) => [c.id, c.label]))(
    '%s: 短い版は空でなく上限内に収まる',
    (id) => {
      const short = renderBotProfileShortText(id as string)
      expect(short).not.toBeNull()
      expect(short!.length).toBeGreaterThan(0)
      expect(short!.length, `${id}: 短い版が長すぎる（${short!.length}字）`).toBeLessThanOrEqual(
        BOT_PROFILE_SHORT_TEXT_MAX_LENGTH,
      )
      expect(short!.length, `${id}: 長い版より短くない`).toBeLessThan(renderBotProfileText(id as string)!.length)
    },
  )

  it('短い版でも、日々使う合図はそのまま真似できる（実際の読み取りに通る）', () => {
    for (const def of GROUP_CHANNELS) {
      const short = renderBotProfileShortText(def.id)!
      for (const command of getChannelCommandGuide(def.id)!.commands) {
        if (!command.input || command.omitFromProfile) continue
        expect(short, `${def.id}: 合図が落ちている（${command.input}）`).toContain(command.input)
      }
    }
  })

  /**
   * 貼り紙に載せない合図（練習）へ、貼り紙だけを読んだ人が辿り着けるか。
   * 載せないと決めた以上、**ヘルプ経由の道が繋がっていること**が条件になる。
   */
  it('貼り紙に載せない合図には、ヘルプの返事から辿り着ける', () => {
    for (const def of GROUP_CHANNELS) {
      const omitted = getChannelCommandGuide(def.id)!.commands.filter(
        (c) => c.input && c.omitFromProfile,
      )
      expect(omitted.length, `${def.id}: 対象が無い`).toBeGreaterThan(0)

      const profile = renderBotProfileText(def.id)!
      const help = renderHelpReplyText(def.id)!
      for (const command of omitted) {
        // 貼り紙には出さない（字数を日々の合図に使う）
        expect(profile, `${def.id}: 貼り紙に出ている（${command.input}）`).not.toContain(
          `・${command.input}`,
        )
        // ヘルプの返事には必ず出す（ここが唯一の入口になるため）
        expect(help, `${def.id}: ヘルプに出ていない（${command.input}）`).toContain(command.input!)
      }
      // 貼り紙にヘルプの合図が載っていること＝道が繋がっていることの前提
      expect(profile, `${def.id}: 貼り紙からヘルプに辿れない`).toContain('ヘルプ')
    }
  })

  it('チャネル固有の致命的な注意は、短い版にも残す', () => {
    const chatworkShort = renderBotProfileShortText('chatwork')!
    expect(chatworkShort, 'Chatworkの「返信」ボタンの注意が落ちている').toContain('返信')
    for (const def of GROUP_CHANNELS) {
      const critical = CHANNEL_COMMAND_TRAITS[def.id]!.shortCriticalNote
      const short = renderBotProfileShortText(def.id)!
      if (critical) {
        expect(short, `${def.id}: 致命的な注意が落ちている`).toContain(critical)
      } else {
        expect(short, `${def.id}: 余計な注意書きが入っている`).not.toContain('※')
      }
    }
  })

  it('短い版に一般の注意書きは入れない（入りきらないため長い版に任せる）', () => {
    for (const def of GROUP_CHANNELS) {
      const short = renderBotProfileShortText(def.id)!
      for (const limitation of getChannelCommandGuide(def.id)!.limitations) {
        expect(short, `${def.id}: 一般の注意書きまで入っている`).not.toContain(limitation)
      }
      expect(short, `${def.id}: 補足まで入っている`).not.toContain('メンション')
    }
  })

  it('未知のチャネル名は null', () => {
    expect(renderBotProfileShortText('unknown_channel')).toBeNull()
    expect(renderBotProfileShortText('whatsapp')).toBeNull()
  })
})

describe('renderHelpReplyText', () => {
  it('チャット内の返信には、概要・合図・注意書きが全部入る', () => {
    const guide = getChannelCommandGuide('discord')!
    const text = renderHelpReplyText('discord')!
    expect(text).toContain(guide.summary)
    for (const command of guide.commands) {
      if (command.input) expect(text).toContain(command.input)
    }
    for (const limitation of guide.limitations) {
      expect(text).toContain(limitation)
    }
  })

  it('チャットごとに事情の違いが文章に出る（Chatworkの「返信」ボタンの注意）', () => {
    expect(renderHelpReplyText('chatwork')).toContain('返信')
    expect(renderHelpReplyText('discord')).not.toContain('Chatwork')
  })
})

/**
 * 貼り先の呼び名。「グループの説明欄」と全チャット同じ言い方をすると、実際のメニューに
 * その名前が無くて探せない（Discord は「トピック」、LINE は「ノート」…）。
 * 実際の名前で呼ぶ。
 */
describe('getChannelPastePlacement', () => {
  const EXPECTED_NAME: Record<string, string> = {
    line: 'ノート',
    slack: 'チャンネル',
    discord: 'トピック',
    chatwork: '概要',
    telegram: 'グループ',
    teams: 'チャネル',
    google_chat: 'スペース',
  }

  it.each(GROUP_CHANNELS.map((c) => [c.id, c.label]))(
    '%s: 当社の秘書のときは、そのチャットに実在する場所の名前で呼ぶ',
    (id) => {
      const placement = getChannelPastePlacement(id as string, 'platform')!
      expect(placement).not.toBeNull()
      expect(placement.heading, `${id}: 実際の名前になっていない`).toContain(EXPECTED_NAME[id as string])
      expect(placement.note.length).toBeGreaterThan(0)
    },
  )

  it('全チャットで同じ見出しにならない（呼び名がチャットごとに違う）', () => {
    const headings = GROUP_CHANNELS.map((c) => getChannelPastePlacement(c.id, 'platform')!.heading)
    expect(new Set(headings).size, '見出しが使い回されている').toBeGreaterThan(1)
  })

  it('事務所の秘書のときは、これまでどおりプロフィール欄が貼り先', () => {
    for (const def of GROUP_CHANNELS) {
      const placement = getChannelPastePlacement(def.id, 'org')!
      expect(placement.heading).toContain('プロフィール')
      expect(placement.note).toContain('相手先の方がいつでも読める')
    }
  })

  it('どちらでも社内用語・専門用語を出さない', () => {
    const forbidden = /(bot|Bot|ボット|プラットフォーム|コンソール|レジストリ)/
    for (const def of GROUP_CHANNELS) {
      for (const owner of ['platform', 'org'] as const) {
        const placement = getChannelPastePlacement(def.id, owner)!
        expect(placement.heading).not.toMatch(forbidden)
        expect(placement.note).not.toMatch(forbidden)
      }
    }
  })

  it('未知のチャネル名は null', () => {
    expect(getChannelPastePlacement('unknown_channel', 'platform')).toBeNull()
    expect(getChannelPastePlacement('whatsapp', 'org')).toBeNull()
  })
})
