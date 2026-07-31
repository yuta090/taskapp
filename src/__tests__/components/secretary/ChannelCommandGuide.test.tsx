import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { ChannelCommandGuide } from '@/components/secretary/ChannelCommandGuide'
import {
  BOT_PROFILE_COPY_FAILED_MESSAGE,
  PROFILE_TEXT_LONG_HINT,
  PROFILE_TEXT_SHORT_HINT,
} from '@/components/secretary/botProfilePlacement'
import {
  getChannelCommandGuide,
  getChannelPastePlacement,
  renderBotProfileText,
  renderBotProfileShortText,
} from '@/lib/channels/commandGuides'

/**
 * ChannelCommandGuide — 接続ページの「使い方（コマンド一覧）」ボタン。
 *
 * 中身は commandGuides.ts（単一の真実源）から引く。画面ごとに文言を書かないので、
 * このテストでも文言を再掲せず、必ず catalog から取った値と突き合わせる。
 * （文言をテストに写すと、直したときに2箇所直す羽目になり必ずズレる）
 */
describe('ChannelCommandGuide', () => {
  beforeEach(() => {
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    })
  })

  const openGuide = () =>
    fireEvent.click(screen.getByRole('button', { name: /使い方（コマンド一覧）/ }))

  it('既定では閉じていて、ボタンだけが見える', () => {
    render(<ChannelCommandGuide channel="discord" />)
    expect(screen.getByRole('button', { name: /使い方（コマンド一覧）/ })).toBeInTheDocument()
    // 閉じている間は中身をDOMに残さない（読み上げにも出さない）
    expect(screen.queryByText(getChannelCommandGuide('discord')!.summary)).not.toBeInTheDocument()
  })

  it('ボタンを押すと、そのチャットで打てる合図と注意書きが出る', () => {
    render(<ChannelCommandGuide channel="discord" />)
    openGuide()
    const guide = getChannelCommandGuide('discord')!
    expect(screen.getByText(guide.summary)).toBeInTheDocument()
    for (const command of guide.commands) {
      if (command.input) expect(screen.getByText(command.input)).toBeInTheDocument()
      expect(screen.getByText(command.effect)).toBeInTheDocument()
    }
    for (const limitation of guide.limitations) {
      expect(screen.getByText(limitation)).toBeInTheDocument()
    }
  })

  it('もう一度押すと閉じる', () => {
    render(<ChannelCommandGuide channel="discord" />)
    openGuide()
    openGuide()
    expect(screen.queryByText(getChannelCommandGuide('discord')!.summary)).not.toBeInTheDocument()
  })

  it('タスクを完了にする送り方が、打つ文字列つきで必ず出る', () => {
    render(<ChannelCommandGuide channel="discord" defaultOpen />)
    // 言い方は commandGuides.ts が正本（秘書の返事に合わせて「完了にする」で統一している）
    const complete = getChannelCommandGuide('discord')!.commands.find((c) => c.input?.startsWith('完了'))
    expect(complete, '完了の送り方が案内に無い').toBeDefined()
    expect(screen.getByText(complete!.input!)).toBeInTheDocument()
    expect(screen.getByText(complete!.effect)).toBeInTheDocument()
    // 番号が要ることの説明も同じ場所に出る
    expect(screen.getByText(complete!.note!)).toBeInTheDocument()
  })

  it('使い方が無いチャネル（1:1専用のWhatsApp）では何も描画しない', () => {
    const { container } = render(<ChannelCommandGuide channel="whatsapp" />)
    expect(container).toBeEmptyDOMElement()
  })

  it('打つ文字列が無い操作（LINEのボタン）は、説明だけを出す', () => {
    render(<ChannelCommandGuide channel="line" defaultOpen />)
    const buttonOnly = getChannelCommandGuide('line')!.commands.filter((c) => c.input === null)
    expect(buttonOnly.length).toBeGreaterThan(0)
    for (const command of buttonOnly) {
      expect(screen.getByText(command.effect)).toBeInTheDocument()
    }
  })

  it('チャネルごとの注意書きが出る（Chatworkの「返信」ボタン）', () => {
    render(<ChannelCommandGuide channel="chatwork" defaultOpen />)
    const chatworkNote = getChannelCommandGuide('chatwork')!.limitations.find((l) =>
      l.includes('Chatworkの「返信」ボタン'),
    )
    expect(chatworkNote).toBeDefined()
    expect(screen.getByText(chatworkNote!)).toBeInTheDocument()
  })

  it('開閉状態を支援技術に伝える(aria-expanded)', () => {
    render(<ChannelCommandGuide channel="slack" />)
    const button = screen.getByRole('button', { name: /使い方（コマンド一覧）/ })
    expect(button).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(button)
    expect(button).toHaveAttribute('aria-expanded', 'true')
  })

  it('defaultOpen で最初から開いた状態にできる', () => {
    render(<ChannelCommandGuide channel="telegram" defaultOpen />)
    expect(screen.getByText(getChannelCommandGuide('telegram')!.summary)).toBeInTheDocument()
  })
})

/**
 * 貼り先の出し分け。
 * Discord・Google Chat・共通LINE は秘書のアカウントを当社が持っていて、利用者は
 * プロフィール欄を編集できない。**存在しない貼り先を案内しない**のがここの要点。
 *
 * さらに、代わりの貼り先は**チャットごとに実在するメニュー名**で呼ぶ。
 * 全チャット同じ「グループの説明欄」と言うと、その名前のメニューが見つからず貼れない
 * （Discord は「トピック」、LINE は「ノート」…）。
 */
describe('ChannelCommandGuide — 貼り先の出し分け', () => {
  beforeEach(() => {
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    })
  })

  it('当社が持つ秘書（Discord）: そのチャットに実在する場所の名前で貼り先を言う', () => {
    render(<ChannelCommandGuide channel="discord" defaultOpen />)
    const placement = getChannelPastePlacement('discord', 'platform')!
    expect(screen.getByText(placement.heading)).toBeInTheDocument()
    expect(screen.getByText(placement.note)).toBeInTheDocument()
  })

  it('当社が持つ秘書（Discord）: 編集できないプロフィール欄を貼り先として案内しない', () => {
    render(<ChannelCommandGuide channel="discord" defaultOpen />)
    expect(screen.queryByText(getChannelPastePlacement('discord', 'org')!.heading)).not.toBeInTheDocument()
  })

  it('当社が持つ秘書（Google Chat）も同じ扱い', () => {
    render(<ChannelCommandGuide channel="google_chat" defaultOpen />)
    expect(screen.getByText(getChannelPastePlacement('google_chat', 'platform')!.heading)).toBeInTheDocument()
  })

  it('事務所が登録した秘書（Slack）: これまでどおりプロフィール欄が貼り先', () => {
    render(<ChannelCommandGuide channel="slack" defaultOpen />)
    const placement = getChannelPastePlacement('slack', 'org')!
    expect(screen.getByText(placement.heading)).toBeInTheDocument()
    expect(screen.getByText(placement.note)).toBeInTheDocument()
  })

  it('LINE: 共通LINE（botOwnership=platform）では「ノート」を貼り先にする', () => {
    render(<ChannelCommandGuide channel="line" botOwnership="platform" defaultOpen />)
    expect(screen.getByText(getChannelPastePlacement('line', 'platform')!.heading)).toBeInTheDocument()
  })

  it('LINE: 自社LINE（botOwnership=org）ではプロフィール欄が貼り先', () => {
    render(<ChannelCommandGuide channel="line" botOwnership="org" defaultOpen />)
    expect(screen.getByText(getChannelPastePlacement('line', 'org')!.heading)).toBeInTheDocument()
  })

  /**
   * ここが今回の要望の根幹。チャットごとの実名が**画面に出ている**ことを直接見る
   * （純関数だけ直して画面から呼んでいなかった、という取りこぼしを防ぐ）。
   */
  it.each([
    ['discord', 'トピック'],
    ['line', 'ノート'],
    ['google_chat', 'スペース'],
  ])('当社が持つ秘書（%s）: 画面に「%s」という実際のメニュー名が出る', (channel, menuName) => {
    render(<ChannelCommandGuide channel={channel} botOwnership="platform" defaultOpen />)
    // 見出しと補足の両方に出るので件数は問わない（「1つも出ていない」を落とすのが目的）
    expect(screen.getAllByText(new RegExp(menuName)).length).toBeGreaterThan(0)
  })

  it('全チャットで同じ貼り先の見出しにならない', () => {
    const headings = ['discord', 'line', 'google_chat'].map((channel) => {
      const { unmount } = render(
        <ChannelCommandGuide channel={channel} botOwnership="platform" defaultOpen />,
      )
      const heading = screen.getByText(getChannelPastePlacement(channel, 'platform')!.heading).textContent
      unmount()
      return heading
    })
    expect(new Set(headings).size, '見出しが使い回されている').toBe(headings.length)
  })
})

/**
 * 長い版・短い版。貼り先の入力欄には字数の上限があるので、両方その場でコピーできるようにする。
 */
describe('ChannelCommandGuide — 長い版と短い版', () => {
  beforeEach(() => {
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    })
  })

  it('長い版と短い版を、どちらもそのまま画面に出す', () => {
    render(<ChannelCommandGuide channel="discord" defaultOpen />)
    expect(screen.getByTestId('channel-command-guide-profile-text').textContent).toBe(
      renderBotProfileText('discord'),
    )
    expect(screen.getByTestId('channel-command-guide-profile-short-text').textContent).toBe(
      renderBotProfileShortText('discord'),
    )
  })

  it('どちらを使うか一目で分かる補足を添える', () => {
    render(<ChannelCommandGuide channel="discord" defaultOpen />)
    expect(screen.getByText(new RegExp(PROFILE_TEXT_LONG_HINT))).toBeInTheDocument()
    expect(screen.getByText(new RegExp(PROFILE_TEXT_SHORT_HINT))).toBeInTheDocument()
  })

  it('長い版のコピーボタンは長い版を渡す', async () => {
    render(<ChannelCommandGuide channel="discord" defaultOpen />)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /くわしい版をコピー/ }))
    })
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(renderBotProfileText('discord'))
  })

  it('短い版のコピーボタンは短い版を渡す', async () => {
    render(<ChannelCommandGuide channel="discord" defaultOpen />)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /短い版をコピー/ }))
    })
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(renderBotProfileShortText('discord'))
  })

  it('コピーしたら、押した方だけに「コピーしました」と出す', async () => {
    render(<ChannelCommandGuide channel="discord" defaultOpen />)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /短い版をコピー/ }))
    })
    expect(screen.getAllByText('コピーしました')).toHaveLength(1)
  })
})

/**
 * コピーが失敗する環境（権限が無い／クリップボードを持たない）で、押しても無反応に見えない。
 */
describe('ChannelCommandGuide — コピーできなかったとき', () => {
  it('コピーに失敗したら、手でコピーする手順を出す', async () => {
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
    })
    render(<ChannelCommandGuide channel="discord" defaultOpen />)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /くわしい版をコピー/ }))
    })
    expect(screen.getByText(BOT_PROFILE_COPY_FAILED_MESSAGE)).toBeInTheDocument()
    expect(screen.queryByText('コピーしました')).not.toBeInTheDocument()
  })

  it('クリップボードを持たない環境でも画面が落ちず、同じ手順を出す', async () => {
    Object.assign(navigator, { clipboard: undefined })
    render(<ChannelCommandGuide channel="discord" defaultOpen />)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /短い版をコピー/ }))
    })
    expect(screen.getByText(BOT_PROFILE_COPY_FAILED_MESSAGE)).toBeInTheDocument()
  })

  it('失敗したあとにもう一度押して成功したら、失敗の案内を残さない', async () => {
    const writeText = vi
      .fn()
      .mockRejectedValueOnce(new Error('denied'))
      .mockResolvedValueOnce(undefined)
    Object.assign(navigator, { clipboard: { writeText } })
    render(<ChannelCommandGuide channel="discord" defaultOpen />)
    const button = () => screen.getByRole('button', { name: /くわしい版をコピー/ })
    await act(async () => {
      fireEvent.click(button())
    })
    await act(async () => {
      fireEvent.click(button())
    })
    expect(screen.queryByText(BOT_PROFILE_COPY_FAILED_MESSAGE)).not.toBeInTheDocument()
    expect(screen.getByText('コピーしました')).toBeInTheDocument()
  })
})
