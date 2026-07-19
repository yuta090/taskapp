import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ConnectionFlowSection } from '@/components/secretary/ConnectionFlowSection'

/**
 * 接続フローの状態別表示マトリクス（codex/fable合意）:
 * - self + connected       : QR＋アクションを「別の端末をつなぐ」に畳む
 * - counterparty + connected: QRのみ「QRを表示」に畳む。アクションは常時表示
 * - group                  : 接続済みでも畳まない
 * - 未接続(ready)等         : すべて展開
 */

const slots = {
  summary: <div data-testid="slot-summary">summary</div>,
  qr: <div data-testid="slot-qr">qr</div>,
  action: <div data-testid="slot-action">action</div>,
  detail: <div data-testid="slot-detail">detail</div>,
  stepsHint: <div data-testid="slot-hint">hint</div>,
}

describe('ConnectionFlowSection', () => {
  it('loading中はQR/アクションを出さずスケルトンを表示（ちらつき防止）', () => {
    render(<ConnectionFlowSection kind="counterparty" state="loading" {...slots} />)
    expect(screen.getByTestId('connect-flow-skeleton')).toBeInTheDocument()
    expect(screen.queryByTestId('slot-qr')).not.toBeInTheDocument()
    expect(screen.queryByTestId('slot-action')).not.toBeInTheDocument()
    expect(screen.getByTestId('connection-flow-section')).toHaveAttribute('data-mode', 'loading')
  })

  it('未接続(ready)はQR・アクションを最初から展開する', () => {
    render(<ConnectionFlowSection kind="self" state="ready" {...slots} />)
    expect(screen.getByTestId('slot-qr')).toBeInTheDocument()
    expect(screen.getByTestId('slot-action')).toBeInTheDocument()
    expect(screen.queryByTestId('connect-reopen-toggle')).not.toBeInTheDocument()
  })

  it('self+connected: QR/アクションは畳まれ、detailと再表示ボタンだけ見える', () => {
    render(<ConnectionFlowSection kind="self" state="connected" {...slots} />)
    expect(screen.getByTestId('slot-detail')).toBeInTheDocument()
    expect(screen.getByTestId('connect-reopen-toggle')).toHaveTextContent('別の端末をつなぐ')
    // 畳まれているのでQR/アクションは未表示
    expect(screen.queryByTestId('slot-qr')).not.toBeInTheDocument()
    expect(screen.queryByTestId('slot-action')).not.toBeInTheDocument()
    // 開くと出る
    fireEvent.click(screen.getByTestId('connect-reopen-toggle'))
    expect(screen.getByTestId('slot-qr')).toBeInTheDocument()
    expect(screen.getByTestId('slot-action')).toBeInTheDocument()
  })

  it('counterparty+connected: アクションと手順ヒントは常時表示、QRのみ畳む', () => {
    render(<ConnectionFlowSection kind="counterparty" state="connected" {...slots} />)
    // アクション(追加でつなぐ)と手順ヒントは常時見える → 発行ボタン単体で出さない
    expect(screen.getByTestId('slot-action')).toBeInTheDocument()
    expect(screen.getByTestId('slot-hint')).toBeInTheDocument()
    // QRは畳まれる
    expect(screen.queryByTestId('slot-qr')).not.toBeInTheDocument()
    expect(screen.getByTestId('connect-showqr-toggle')).toHaveTextContent('QRを表示')
    fireEvent.click(screen.getByTestId('connect-showqr-toggle'))
    expect(screen.getByTestId('slot-qr')).toBeInTheDocument()
  })

  it('group+connected: 自動では畳まない（QR展開のまま・トグルなし）', () => {
    render(<ConnectionFlowSection kind="group" state="connected" {...slots} />)
    expect(screen.getByTestId('slot-qr')).toBeInTheDocument()
    expect(screen.queryByTestId('connect-reopen-toggle')).not.toBeInTheDocument()
    expect(screen.queryByTestId('connect-showqr-toggle')).not.toBeInTheDocument()
  })

  it('data-mode属性で解決モードを公開する', () => {
    const { rerender } = render(<ConnectionFlowSection kind="self" state="connected" {...slots} />)
    expect(screen.getByTestId('connection-flow-section')).toHaveAttribute('data-mode', 'collapse-onboarding')
    rerender(<ConnectionFlowSection kind="counterparty" state="connected" {...slots} />)
    expect(screen.getByTestId('connection-flow-section')).toHaveAttribute('data-mode', 'collapse-qr')
    rerender(<ConnectionFlowSection kind="group" state="ready" {...slots} />)
    expect(screen.getByTestId('connection-flow-section')).toHaveAttribute('data-mode', 'expanded')
  })
})
