import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { SecretReveal } from '@/components/secretary/integrations/SecretReveal'

/**
 * SecretReveal — webhook secretの一度だけの表示（作成/ローテーション直後）。
 * docs/spec/AI_SECRETARY_STAGE3_INTEGRATIONS.md §4: 「二度と表示されない」旨を明示し、
 * 呼び出し側が閉じたら再表示不可（stateを親が破棄する前提のためコンポーネント自体は
 * 常に渡されたsecretを表示するだけ＝親が一度きりの管理責任を持つ）。
 */

describe('SecretReveal', () => {
  it('secretと警告文言を表示する', () => {
    render(<SecretReveal secret="whsec_abc123" onDismiss={vi.fn()} />)
    expect(screen.getByText('whsec_abc123')).toBeInTheDocument()
    expect(screen.getByText(/二度と表示され/)).toBeInTheDocument()
  })

  it('コピーボタンでクリップボードに書き込む', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText } })

    render(<SecretReveal secret="whsec_abc123" onDismiss={vi.fn()} />)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /コピー/ }))
    })
    expect(writeText).toHaveBeenCalledWith('whsec_abc123')
  })

  it('閉じるボタンでonDismissを呼ぶ', () => {
    const onDismiss = vi.fn()
    render(<SecretReveal secret="whsec_abc123" onDismiss={onDismiss} />)
    fireEvent.click(screen.getByRole('button', { name: /閉じる/ }))
    expect(onDismiss).toHaveBeenCalled()
  })
})
