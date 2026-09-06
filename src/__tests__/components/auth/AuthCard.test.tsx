import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { AuthCard } from '@/components/auth/AuthCard'

/**
 * AuthCard の幅。ログイン/サインアップは狭いカード(max-w-md)のままで、
 * ジャンル選択のように横に並べる中身がある画面だけ width="wide" で広げられること。
 */
describe('AuthCard', () => {
  it('既定は狭いカード（max-w-md）', () => {
    render(<AuthCard title="T"><div>body</div></AuthCard>)
    const card = screen.getByTestId('auth-card')
    expect(card.className).toContain('max-w-md')
    expect(card.className).not.toContain('max-w-4xl')
  })

  it('width="wide" で広いカード（max-w-4xl）になる', () => {
    render(<AuthCard title="T" width="wide"><div>body</div></AuthCard>)
    const card = screen.getByTestId('auth-card')
    expect(card.className).toContain('max-w-4xl')
    expect(card.className).not.toContain('max-w-md')
  })
})
