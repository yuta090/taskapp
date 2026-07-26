import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Hint } from '@/components/secretary/Hint'

/**
 * Hint — 補足説明を「?」アイコンの後ろに隠す小さな開閉パネル。
 *
 * 「つなぐ」画面の認知負荷を下げるための共通部品。画面には *いま何をするか* だけを残し、
 * 「なぜ必要か」「例外はなにか」といった補足はここへ寄せる（既定は閉じている）。
 * モーダルは使わない（UI_RULES: ダイアログ禁止）。
 */
describe('Hint', () => {
  it('既定では補足文を表示しない（?ボタンだけ）', () => {
    render(<Hint label="合言葉">15分で失効します</Hint>)

    expect(screen.queryByText('15分で失効します')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /合言葉/ })).toHaveAttribute('aria-expanded', 'false')
  })

  it('クリックで補足文が開き、もう一度押すと閉じる', () => {
    render(<Hint label="合言葉">15分で失効します</Hint>)
    const toggle = screen.getByRole('button', { name: /合言葉/ })

    fireEvent.click(toggle)
    expect(screen.getByText('15分で失効します')).toBeInTheDocument()
    expect(toggle).toHaveAttribute('aria-expanded', 'true')

    fireEvent.click(toggle)
    expect(screen.queryByText('15分で失効します')).not.toBeInTheDocument()
  })

  // 見た目の細部（色・大きさ）はテストしない（スタイルのみでテストが脆くなるため）。
  // ただし「開いている?が見分けられる」ことは操作上の要件なので、状態が見た目に
  // 反映されていること自体は確認する。
  it('開いている間は閉じているときと見た目が変わる', () => {
    render(<Hint label="合言葉">15分で失効します</Hint>)
    const toggle = screen.getByRole('button', { name: /合言葉/ })
    const closedClass = toggle.className

    fireEvent.click(toggle)
    expect(toggle.className).not.toBe(closedClass)
  })
})
