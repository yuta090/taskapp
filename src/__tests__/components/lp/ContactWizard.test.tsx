import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { ContactWizard } from '@/components/lp/ContactWizard'

/**
 * ミツモア型ステップウィザード（/contact 相談フォーム）
 *
 * Q1 お困りごと(複数) → Q2 チーム規模(単一・自動前進) → Q3 連絡手段(複数)
 * → Q4 相手先の数(単一・自動前進) → Q5 自由記述(任意) → Q6 連絡先(送信)
 */

const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>

function fillPain(...labels: string[]) {
  for (const label of labels) {
    fireEvent.click(screen.getByRole('checkbox', { name: label }))
  }
}

function goNext() {
  fireEvent.click(screen.getByRole('button', { name: '次へ' }))
}

/** Q1〜Q4を既定値で進め、Q5(任意)をスキップしてQ6まで到達する */
async function advanceToContactStep() {
  fillPain('LINEやチャットの依頼が、流れて消えてしまう')
  goNext()
  await waitForStep('チームの人数は？')
  fireEvent.click(screen.getByRole('radio', { name: '1人' })) // Q2 auto-advance
  await waitForStep('社外とのやり取りに使っているものは？')
  fireEvent.click(screen.getByRole('checkbox', { name: 'LINE' }))
  goNext()
  await waitForStep('やり取りする相手先（顧問先・クライアント）はどのくらい？')
  fireEvent.click(screen.getByRole('radio', { name: '〜5社' })) // Q4 auto-advance
  await waitForStep('いまの状況やお気持ちを、そのまま教えてください')
  fireEvent.click(screen.getByRole('button', { name: 'スキップ' }))
  await waitForStep('最後に、ご連絡先を教えてください')
}

async function waitForStep(heading: string | RegExp) {
  await waitFor(() => expect(screen.getByRole('heading', { name: heading })).toBeInTheDocument())
}

describe('ContactWizard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ ok: true }) })
  })

  it('Q1で選択が無いと次へは押せず、選択すると進める', async () => {
    render(<ContactWizard />)

    const nextButton = screen.getByRole('button', { name: '次へ' })
    expect(nextButton).toBeDisabled()

    fillPain('LINEやチャットの依頼が、流れて消えてしまう')
    expect(nextButton).not.toBeDisabled()

    fireEvent.click(nextButton)
    await waitForStep('チームの人数は？')
  })

  it('単一選択(Q2)はタップで自動的に次へ進む', async () => {
    render(<ContactWizard />)
    fillPain('誰がボールを持っているか分からなくなる')
    goNext()
    await waitForStep('チームの人数は？')

    fireEvent.click(screen.getByRole('radio', { name: '2〜5人' }))

    await waitForStep('社外とのやり取りに使っているものは？')
  })

  it('単一選択の320msロック中に連打しても二重前進しない(fake timers)', () => {
    vi.useFakeTimers()
    try {
      render(<ContactWizard />)
      fillPain('LINEやチャットの依頼が、流れて消えてしまう')
      goNext()
      expect(
        screen.getByRole('heading', { name: 'チームの人数は？' })
      ).toBeInTheDocument()

      // ロック中に連打(複数の選択肢を素早くクリック)しても前進は1回だけ
      fireEvent.click(screen.getByRole('radio', { name: '1人' }))
      fireEvent.click(screen.getByRole('radio', { name: '2〜5人' }))
      fireEvent.click(screen.getByRole('radio', { name: '6〜20人' }))

      act(() => {
        vi.advanceTimersByTime(320)
      })
      expect(
        screen.getByRole('heading', { name: '社外とのやり取りに使っているものは？' })
      ).toBeInTheDocument()

      // 保留中のタイマーが複数積まれていた場合、ここでさらに先(Q4)へ進んでしまう
      act(() => {
        vi.advanceTimersByTime(320)
      })
      expect(
        screen.getByRole('heading', { name: '社外とのやり取りに使っているものは？' })
      ).toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })

  it('320msロック中に「戻る」しても、タイマー発火時に強制前進しない(fake timers)', () => {
    vi.useFakeTimers()
    try {
      render(<ContactWizard />)
      fillPain('LINEやチャットの依頼が、流れて消えてしまう')
      goNext()
      expect(screen.getByRole('heading', { name: 'チームの人数は？' })).toBeInTheDocument()

      // ロックが始まった直後に戻る → Q1に戻る
      fireEvent.click(screen.getByRole('radio', { name: '1人' }))
      fireEvent.click(screen.getByRole('button', { name: /戻る/ }))
      expect(
        screen.getByRole('heading', { name: 'いま、どんなことにお困りですか？' })
      ).toBeInTheDocument()

      // 保留中だったタイマーが発火しても、Q2へ弾き返されない
      act(() => {
        vi.advanceTimersByTime(320)
      })
      expect(
        screen.getByRole('heading', { name: 'いま、どんなことにお困りですか？' })
      ).toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })

  it('「← 戻る」で前の画面に戻っても回答が保持されている', async () => {
    render(<ContactWizard />)
    fillPain('LINEやチャットの依頼が、流れて消えてしまう')
    goNext()
    await waitForStep('チームの人数は？')

    fireEvent.click(screen.getByRole('button', { name: /戻る/ }))
    await waitForStep('いま、どんなことにお困りですか？')

    expect(
      screen.getByRole('checkbox', { name: 'LINEやチャットの依頼が、流れて消えてしまう' })
    ).toBeChecked()
  })

  it('Q6でメール形式が不正だと送信されずエラーが表示される', async () => {
    render(<ContactWizard />)
    await advanceToContactStep()

    fireEvent.change(screen.getByLabelText(/お名前/), { target: { value: '山田太郎' } })
    fireEvent.change(screen.getByLabelText(/メールアドレス/), {
      target: { value: 'invalid-email' },
    })
    fireEvent.click(screen.getByRole('button', { name: '相談内容を送信する' }))

    expect(await screen.findByText(/メールアドレスの形式/)).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('お名前が空だと送信されずエラーが表示される', async () => {
    render(<ContactWizard />)
    await advanceToContactStep()

    fireEvent.change(screen.getByLabelText(/メールアドレス/), {
      target: { value: 'yamada@example.com' },
    })
    fireEvent.click(screen.getByRole('button', { name: '相談内容を送信する' }))

    expect(await screen.findByText(/お名前を入力してください/)).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('送信payloadがsource=contact-wizardと選択内容の結合・honeypotを含む', async () => {
    render(<ContactWizard />)
    fillPain('LINEやチャットの依頼が、流れて消えてしまう', '誰がボールを持っているか分からなくなる')
    goNext()
    await waitForStep('チームの人数は？')
    fireEvent.click(screen.getByRole('radio', { name: '2〜5人' }))
    await waitForStep('社外とのやり取りに使っているものは？')
    fireEvent.click(screen.getByRole('checkbox', { name: 'LINE' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Slack' }))
    goNext()
    await waitForStep('やり取りする相手先（顧問先・クライアント）はどのくらい？')
    fireEvent.click(screen.getByRole('radio', { name: '〜5社' }))
    await waitForStep('いまの状況やお気持ちを、そのまま教えてください')
    fireEvent.change(screen.getByRole('textbox', { name: /お気持ち/ }), {
      target: { value: '月末にいつも探しています' },
    })
    fireEvent.click(screen.getByRole('button', { name: '次へ' }))
    await waitForStep('最後に、ご連絡先を教えてください')

    fireEvent.change(screen.getByLabelText(/お名前/), { target: { value: '山田太郎' } })
    fireEvent.change(screen.getByLabelText(/メールアドレス/), {
      target: { value: 'yamada@example.com' },
    })
    fireEvent.change(screen.getByLabelText(/会社名/), { target: { value: '山田事務所' } })
    fireEvent.click(screen.getByRole('button', { name: '相談内容を送信する' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    const [, options] = fetchMock.mock.calls[0]
    const body = JSON.parse((options as RequestInit).body as string)

    expect(body).toMatchObject({
      source: 'contact-wizard',
      email: 'yamada@example.com',
      name: '山田太郎',
      company: '山田事務所',
      message: '月末にいつも探しています',
      pain: 'LINEやチャットの依頼が、流れて消えてしまう、誰がボールを持っているか分からなくなる',
      teamSize: '2〜5人',
      channels: 'LINE、Slack',
      partnerCount: '〜5社',
      website: '',
    })
  })

  it('送信失敗時はエラーを表示し、再送できる', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) })
    render(<ContactWizard />)
    await advanceToContactStep()

    fireEvent.change(screen.getByLabelText(/お名前/), { target: { value: '山田太郎' } })
    fireEvent.change(screen.getByLabelText(/メールアドレス/), {
      target: { value: 'yamada@example.com' },
    })
    fireEvent.click(screen.getByRole('button', { name: '相談内容を送信する' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('送信に失敗しました')
    expect(screen.queryByText('送信ありがとうございます')).not.toBeInTheDocument()

    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) })
    fireEvent.click(screen.getByRole('button', { name: '相談内容を送信する' }))

    await waitFor(() => expect(screen.getByText(/送信ありがとうございます/)).toBeInTheDocument())
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('サンクス画面はQ1の選択に応じてパーソナライズされ、複数該当時は先頭1件のみ表示する', async () => {
    render(<ContactWizard />)
    fillPain('誰がボールを持っているか分からなくなる', 'クライアントからの資料・返事がなかなか集まらない')
    goNext()
    await waitForStep('チームの人数は？')
    fireEvent.click(screen.getByRole('radio', { name: '1人' }))
    await waitForStep('社外とのやり取りに使っているものは？')
    fireEvent.click(screen.getByRole('checkbox', { name: 'LINE' }))
    goNext()
    await waitForStep('やり取りする相手先（顧問先・クライアント）はどのくらい？')
    fireEvent.click(screen.getByRole('radio', { name: '社外とのやり取りは少ない' }))
    await waitForStep('いまの状況やお気持ちを、そのまま教えてください')
    fireEvent.click(screen.getByRole('button', { name: 'スキップ' }))
    await waitForStep('最後に、ご連絡先を教えてください')

    fireEvent.change(screen.getByLabelText(/お名前/), { target: { value: '山田太郎' } })
    fireEvent.change(screen.getByLabelText(/メールアドレス/), {
      target: { value: 'yamada@example.com' },
    })
    fireEvent.click(screen.getByRole('button', { name: '相談内容を送信する' }))

    await waitFor(() => expect(screen.getByText(/送信ありがとうございます/)).toBeInTheDocument())
    expect(
      screen.getByText('資料の回収と催促を秘書AIが代行する機能をご案内できます。')
    ).toBeInTheDocument()
    expect(
      screen.queryByText('"いま誰の番か"を可視化するボール管理をお見せできます。')
    ).not.toBeInTheDocument()
  })

  it('honeypot入力はaria-hiddenかつフォーカス移動対象外である', async () => {
    render(<ContactWizard />)
    await advanceToContactStep()
    const honeypot = document.querySelector('input[name="website"]')
    expect(honeypot).not.toBeNull()
    expect(honeypot).toHaveAttribute('aria-hidden', 'true')
    expect(honeypot).toHaveAttribute('tabindex', '-1')
    expect(honeypot).toHaveAttribute('autocomplete', 'off')
  })
})
