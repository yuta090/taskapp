import { describe, it, expect } from 'vitest'
import {
  BOT_PROFILE_COPY_FAILED_MESSAGE,
  PROFILE_TEXT_LONG_LABEL,
  PROFILE_TEXT_LONG_HINT,
  PROFILE_TEXT_SHORT_LABEL,
  PROFILE_TEXT_SHORT_HINT,
  resolveChannelBotOwnership,
  resolveLineBotOwnership,
} from '@/components/secretary/botProfilePlacement'
import { CHANNELS } from '@/lib/channels/registry'

/**
 * 貼り先の出し分け（純関数）。
 *
 * 発端: Discord では秘書のアカウントを当社が持っていて、利用者はプロフィール欄を編集できない。
 * それなのに「プロフィール欄に貼ってください」と案内していて、貼り先が存在しなかった。
 * 「どちらの秘書か」で貼り先が変わるので、その分岐だけを純関数に出して固定する。
 */
describe('resolveChannelBotOwnership — レジストリから秘書の持ち主を決める', () => {
  it('当社が用意する秘書（Discord / Google Chat）は共通あつかい', () => {
    expect(resolveChannelBotOwnership(CHANNELS.discord)).toBe('platform')
    expect(resolveChannelBotOwnership(CHANNELS.google_chat)).toBe('platform')
  })

  it('事務所が自分で登録する秘書（Slack / Chatwork / Telegram / Teams）は自社あつかい', () => {
    expect(resolveChannelBotOwnership(CHANNELS.slack)).toBe('org')
    expect(resolveChannelBotOwnership(CHANNELS.chatwork)).toBe('org')
    expect(resolveChannelBotOwnership(CHANNELS.telegram)).toBe('org')
    expect(resolveChannelBotOwnership(CHANNELS.teams)).toBe('org')
  })

  it('チャネルが分からないときは共通あつかいに倒す（無い貼り先を案内しない）', () => {
    expect(resolveChannelBotOwnership(null)).toBe('platform')
    expect(resolveChannelBotOwnership(undefined)).toBe('platform')
  })
})

describe('resolveLineBotOwnership — LINEは利用状態で持ち主が変わる', () => {
  it('自社のLINEを登録している org だけが自社あつかい', () => {
    expect(resolveLineBotOwnership('own')).toBe('org')
  })

  it('共通LINEを使っている org は共通あつかい（プロフィール欄は当社が持つ）', () => {
    expect(resolveLineBotOwnership('granted')).toBe('platform')
    expect(resolveLineBotOwnership('requested')).toBe('platform')
    expect(resolveLineBotOwnership('none')).toBe('platform')
    expect(resolveLineBotOwnership('unavailable')).toBe('platform')
  })
})

/**
 * 貼り先の**文言**はここには無い（チャットごとに呼び名が違うので commandGuides 側が正本）。
 * ここが持つのは「誰が持っているか」の判定だけ。文言を2箇所に持つと、全チャット共通の
 * 「グループの説明欄」に逆戻りして、その名前のメニューが無いチャットで貼れなくなる。
 */
describe('貼り先の文言はここに持たない', () => {
  it('画面に出す見出し・補足は commandGuides が持つ（この場所には無い）', async () => {
    const placementModule = await import('@/components/secretary/botProfilePlacement')
    expect(Object.keys(placementModule)).not.toContain('getBotProfilePlacement')
  })

  it('この場所が持つ利用者向けの言葉にも、社内用語を出さない', () => {
    const forbidden = /(bot|Bot|ボット|プラットフォーム|コンソール|registry|共有Bot)/
    expect(PROFILE_TEXT_LONG_LABEL).not.toMatch(forbidden)
    expect(PROFILE_TEXT_SHORT_LABEL).not.toMatch(forbidden)
    expect(BOT_PROFILE_COPY_FAILED_MESSAGE).not.toMatch(forbidden)
  })
})

describe('長い版と短い版の見出し', () => {
  it('どちらを使うか一目で分かる補足が付く', () => {
    expect(PROFILE_TEXT_LONG_HINT).toContain('ふだん')
    expect(PROFILE_TEXT_SHORT_HINT).toContain('字数の少ない欄')
  })

  it('長い版と短い版の呼び名が重ならない', () => {
    expect(PROFILE_TEXT_LONG_LABEL).not.toBe(PROFILE_TEXT_SHORT_LABEL)
  })
})

describe('コピーできなかったときの言い方', () => {
  it('押しても無反応に見せず、手でコピーする手順を書く', () => {
    expect(BOT_PROFILE_COPY_FAILED_MESSAGE).toContain('コピーできませんでした')
    expect(BOT_PROFILE_COPY_FAILED_MESSAGE).toContain('選んで')
  })
})
