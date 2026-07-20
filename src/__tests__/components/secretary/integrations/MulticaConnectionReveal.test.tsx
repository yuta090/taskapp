import React from 'react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { MulticaConnectionReveal } from '@/components/secretary/integrations/MulticaConnectionReveal'

/**
 * MulticaConnectionReveal — multica接続の作成直後、multica側へ貼る設定ブロック
 * (webhook_url/connection_id/send_secret/receive_secret)を一度きり表示する。
 * SecretRevealと同じ「二度と表示されない」視覚言語を踏襲する。
 */

const PROPS = {
  webhookUrl: 'https://taskapp.example.com/api/connectors/multica/events',
  connectionId: 'conn-1',
  sendSecret: 'send_abc123',
  receiveSecret: 'recv_abc123',
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('MulticaConnectionReveal', () => {
  it('4つの値と一度きりの警告文言を表示する', () => {
    render(<MulticaConnectionReveal {...PROPS} onDismiss={vi.fn()} />)

    expect(screen.getByText(PROPS.webhookUrl)).toBeInTheDocument()
    expect(screen.getByText(PROPS.connectionId)).toBeInTheDocument()
    expect(screen.getByText(PROPS.sendSecret)).toBeInTheDocument()
    expect(screen.getByText(PROPS.receiveSecret)).toBeInTheDocument()
    expect(screen.getByText(/この画面を離れると再表示できません/)).toBeInTheDocument()
  })

  it('各値にコピーボタンがあり、クリップボードへ書き込む', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText } })

    render(<MulticaConnectionReveal {...PROPS} onDismiss={vi.fn()} />)

    const copyButtons = screen.getAllByRole('button', { name: /コピー/ })
    expect(copyButtons).toHaveLength(4)

    await act(async () => {
      fireEvent.click(copyButtons[2]) // send_secret
    })
    expect(writeText).toHaveBeenCalledWith(PROPS.sendSecret)
  })

  it('閉じるとonDismissを呼ぶ', () => {
    const onDismiss = vi.fn()
    render(<MulticaConnectionReveal {...PROPS} onDismiss={onDismiss} />)
    fireEvent.click(screen.getByRole('button', { name: /閉じる|破棄/ }))
    expect(onDismiss).toHaveBeenCalled()
  })
})
