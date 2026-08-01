import { describe, it, expect } from 'vitest'
import {
  normalizeCommandToken,
  parseHelpCommand,
  parseAddTaskCommand,
  parseSkipCommand,
  parseListCommand,
  parsePracticeCommand,
  parseCompleteWithoutNumberCommand,
  matchAddTaskPrefix,
} from '@/lib/channels/textCommands'

/**
 * チャット内の合図（コマンド）の読み取り。
 *
 * ここが守る約束は2つだけ:
 *   1. **打った人には必ず届く** — 全角・大文字・前後の空白・末尾の「？」程度のゆらぎは吸収する
 *   2. **打っていない人には絶対に発火しない** — 「ヘルプが欲しい」のような普通の会話で
 *      秘書が割り込むと、グループの会話そのものを壊す（完全一致で判定する）
 */
describe('normalizeCommandToken', () => {
  it('前後の空白・全角空白を落とす', () => {
    expect(normalizeCommandToken('  ヘルプ 　')).toBe('ヘルプ')
  })

  it('全角の英数字を半角にそろえる', () => {
    expect(normalizeCommandToken('ｈｅｌｐ')).toBe('help')
  })

  it('大文字は小文字にそろえる', () => {
    expect(normalizeCommandToken('HELP')).toBe('help')
  })

  it('文中の空白（全角含む）も全て落とす', () => {
    expect(normalizeCommandToken('使い　方')).toBe('使い方')
  })
})

describe('parseHelpCommand', () => {
  it.each(['ヘルプ', 'help', 'ｈｅｌｐ', 'HELP', ' 使い方 ', 'つかいかた', 'コマンド', 'ヘルプ？', 'ヘルプ!', 'ヘルプ。'])(
    '「%s」は使い方の合図として読む',
    (text) => {
      expect(parseHelpCommand(text)).toBe(true)
    },
  )

  it.each(['ヘルプが欲しい', 'helpful', '使い方を教えて', 'このヘルプ機能どう？', '', 'コマンドライン'])(
    '「%s」では発火しない（普通の会話に割り込まない）',
    (text) => {
      expect(parseHelpCommand(text)).toBe(false)
    },
  )
})

describe('parseAddTaskCommand', () => {
  it('「タスク追加 見積もりを送る」は内容だけを取り出す', () => {
    expect(parseAddTaskCommand('タスク追加 見積もりを送る')).toEqual({ title: '見積もりを送る' })
  })

  it('全角スペースや「：」区切りでも内容を取り出す', () => {
    expect(parseAddTaskCommand('タスク追加　見積もりを送る')).toEqual({ title: '見積もりを送る' })
    expect(parseAddTaskCommand('タスク追加：見積もりを送る')).toEqual({ title: '見積もりを送る' })
  })

  it('「タスク追加」だけなら内容は空として返す（合図としては読む）', () => {
    expect(parseAddTaskCommand('タスク追加')).toEqual({ title: '' })
    expect(parseAddTaskCommand('  タスク追加  ')).toEqual({ title: '' })
  })

  it('文中に出てくるだけでは発火しない（先頭のみ）', () => {
    expect(parseAddTaskCommand('明日タスク追加する')).toBeNull()
    expect(parseAddTaskCommand('タスクを追加して')).toBeNull()
    expect(parseAddTaskCommand('')).toBeNull()
  })

  it.each([
    'タスク追加ってどうやるの？',
    'タスク追加の使い方を教えて',
    'タスク追加したい',
    'タスク追加機能はありますか',
  ])('「%s」は質問なので発火しない（区切りなしで続く文字は内容と見なさない）', (text) => {
    expect(parseAddTaskCommand(text)).toBeNull()
  })

  it.each([
    ['タスク追加 見積もりを送る', '見積もりを送る'],
    ['タスク追加：見積もり', '見積もり'],
    ['タスク追加　見積もり', '見積もり'],
    ['タスク追加: 見積もり', '見積もり'],
  ])('「%s」は区切りがあるので成立する', (text, title) => {
    expect(parseAddTaskCommand(text)).toEqual({ title })
  })

  it('内容は50字で切り詰める（申し送りタスクの上限と同じ）', () => {
    const long = 'あ'.repeat(80)
    const parsed = parseAddTaskCommand(`タスク追加 ${long}`)
    expect(parsed).not.toBeNull()
    expect(parsed!.title).toHaveLength(50)
  })

  it('改行を含む内容でも1行のタイトルにする', () => {
    const parsed = parseAddTaskCommand('タスク追加 見積もりを\n送る')
    expect(parsed).not.toBeNull()
    expect(parsed!.title).not.toContain('\n')
  })
})

describe('parseSkipCommand', () => {
  it.each(['あとで', 'スキップ', 'skip', ' あとで。'])('「%s」は中断の合図として読む', (text) => {
    expect(parseSkipCommand(text)).toBe(true)
  })

  it.each(['あとでやります', 'skipped', 'やめるつもりはない', ''])(
    '「%s」では発火しない',
    (text) => {
      expect(parseSkipCommand(text)).toBe(false)
    },
  )

  // 「やめる」は案内していない語で、普通の会話（「この件やめる」への相づち等）で
  // 単独で送られうる。案内している逃げ道は『あとで』だけなので語彙をそこに絞る。
  it.each(['やめる', 'やめます', '中止'])('「%s」は普通の会話なので中断にしない', (text) => {
    expect(parseSkipCommand(text)).toBe(false)
  })
})

/**
 * 「タスク追加 ○○」の**読み取りの正本**。LINE もこの関数を使う（自前の前方一致をやめた）。
 * 返すのは「合図として消す範囲」なので、LINE 側は本文からこの範囲を消してタイトルにできる。
 */
describe('matchAddTaskPrefix', () => {
  it('合図として消す範囲は「タスク追加＋区切り」まで（内容はそのまま残る）', () => {
    expect(matchAddTaskPrefix('タスク追加 見積もりを送る')).toEqual({
      index: 0,
      length: 'タスク追加 '.length,
      rest: '見積もりを送る',
    })
  })

  it('先頭に空白があってもその分まで含めて消す', () => {
    expect(matchAddTaskPrefix('  タスク追加　見積もり')).toEqual({
      index: 0,
      length: '  タスク追加　'.length,
      rest: '見積もり',
    })
  })

  it('区切りが無い質問文では成立しない（誤爆させない）', () => {
    expect(matchAddTaskPrefix('タスク追加ってどうやるの？')).toBeNull()
  })

  it('parseAddTaskCommand と同じ読み取りである（正本が1本）', () => {
    const text = 'タスク追加: 見積もりを送る'
    const matched = matchAddTaskPrefix(text)
    expect(matched).not.toBeNull()
    expect(parseAddTaskCommand(text)).toEqual({ title: matched!.rest })
  })
})

describe('parseListCommand', () => {
  it.each(['一覧', 'リスト', 'タスク一覧', ' 一覧 ', '一覧？', 'いちらん'])(
    '「%s」は一覧の合図として読む',
    (text) => {
      expect(parseListCommand(text)).toBe(true)
    },
  )

  it.each(['一覧を出して', 'タスク一覧はどこ？', 'リストアップ', '', '完了1'])(
    '「%s」では発火しない（普通の会話に割り込まない）',
    (text) => {
      expect(parseListCommand(text)).toBe(false)
    },
  )
})

describe('parseCompleteWithoutNumberCommand', () => {
  it.each(['完了', ' 完了 ', '完了。', '完了！'])('番号なしの「%s」は案内の合図として読む', (text) => {
    expect(parseCompleteWithoutNumberCommand(text)).toBe(true)
  })

  it.each(['完了1', '完了 1', '1完了', '完了しました', '対応完了です', ''])(
    '「%s」では発火しない（番号つき・報告文は別の扱い）',
    (text) => {
      expect(parseCompleteWithoutNumberCommand(text)).toBe(false)
    },
  )
})

/**
 * 「練習」— 使い方の練習をもう一度やる合図。
 *
 * 練習は1グループ1回きりで、「あとで」で抜けた人・24時間放置した人・あとから参加した人は
 * 二度と見られなかった。使い方が分からない人ほど最初に「あとで」と言うので、そこが片手落ちだった。
 */
describe('parsePracticeCommand（練習をやり直す合図）', () => {
  it('「練習」「れんしゅう」を合図として読む', () => {
    for (const text of ['練習', 'れんしゅう', ' 練習 ', '練習。', 'れんしゅう？']) {
      expect(parsePracticeCommand(text), text).toBe(true)
    }
  })

  it('ふつうの会話では発火しない（厳格一致）', () => {
    for (const text of [
      '練習しておきます',
      '明日練習します',
      'そろそろ練習しないと',
      '練習の日程を決めましょう',
      '',
    ]) {
      expect(parsePracticeCommand(text), text).toBe(false)
    }
  })

  it('ほかの合図とは混ざらない', () => {
    for (const text of ['ヘルプ', '一覧', '完了', 'あとで', 'タスク追加 見積もり']) {
      expect(parsePracticeCommand(text), text).toBe(false)
    }
  })
})
