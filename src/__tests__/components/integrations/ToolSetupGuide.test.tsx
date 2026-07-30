import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ToolSetupGuide } from '@/components/integrations/ToolSetupGuide'
import { getSetupGuide } from '@/lib/integrations/setupGuides'
import { INTEGRATIONS } from '@/lib/integrations/registry'

/**
 * ToolSetupGuide — 「連携のしかた」ボタン。押すと手順が開く（モーダル禁止のため開閉パネル）。
 * 手順の中身は setupGuides.ts（単一の真実源）から引く。画面ごとに文言を書かない。
 */
describe('ToolSetupGuide', () => {
  const openGuide = () => fireEvent.click(screen.getByRole('button', { name: /連携のしかた/ }))

  it('既定では閉じていて、ボタンだけが見える', () => {
    render(<ToolSetupGuide guideKey="backlog" />)
    expect(screen.getByRole('button', { name: /連携のしかた/ })).toBeInTheDocument()
    // 閉じている間は手順をDOMに残さない（読み上げにも出さない）
    expect(screen.queryByText(getSetupGuide('backlog')!.steps[0])).not.toBeInTheDocument()
  })

  it('ボタンを押すと手順が出る', () => {
    render(<ToolSetupGuide guideKey="backlog" />)
    openGuide()
    const guide = getSetupGuide('backlog')!
    expect(screen.getByText(guide.summary)).toBeInTheDocument()
    for (const step of guide.steps) {
      expect(screen.getByText(step)).toBeInTheDocument()
    }
  })

  it('もう一度押すと閉じる', () => {
    render(<ToolSetupGuide guideKey="backlog" />)
    openGuide()
    openGuide()
    expect(screen.queryByText(getSetupGuide('backlog')!.steps[0])).not.toBeInTheDocument()
  })

  it('手順が無いツール(planned)では何も描画しない（空のボタンを置かない）', () => {
    const { container } = render(<ToolSetupGuide guideKey="wrike" />)
    expect(container).toBeEmptyDOMElement()
  })

  it('公式ドキュメントのリンクはレジストリのsetupUrlを使う（二重管理しない）', () => {
    render(<ToolSetupGuide guideKey="backlog" />)
    openGuide()
    const link = screen.getByRole('link', { name: /公式の手順/ })
    expect(link).toHaveAttribute('href', INTEGRATIONS.backlog.setupUrl)
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'))
  })

  it('setupUrlが無いツール(multica)ではリンクを出さない', () => {
    render(<ToolSetupGuide guideKey="multica" />)
    openGuide()
    expect(screen.queryByRole('link', { name: /公式の手順/ })).not.toBeInTheDocument()
  })

  it('defaultOpen で最初から開いた状態にできる（未接続のときの案内用）', () => {
    render(<ToolSetupGuide guideKey="zoom" defaultOpen />)
    expect(screen.getByText(getSetupGuide('zoom')!.steps[0])).toBeInTheDocument()
  })

  it('気をつけることがあるツールは注意書きも出す(chatwork)', () => {
    render(<ToolSetupGuide guideKey="chatwork" />)
    openGuide()
    for (const note of getSetupGuide('chatwork')!.notes ?? []) {
      expect(screen.getByText(note)).toBeInTheDocument()
    }
  })

  it('開閉状態を支援技術に伝える(aria-expanded)', () => {
    render(<ToolSetupGuide guideKey="backlog" />)
    const button = screen.getByRole('button', { name: /連携のしかた/ })
    expect(button).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(button)
    expect(button).toHaveAttribute('aria-expanded', 'true')
  })
})
