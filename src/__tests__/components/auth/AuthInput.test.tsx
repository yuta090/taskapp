import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { AuthInput } from '@/components/auth/AuthInput'

describe('AuthInput', () => {
  it('should not show error text or aria-invalid by default', () => {
    render(<AuthInput label="メールアドレス" />)

    const input = screen.getByLabelText('メールアドレス')
    expect(input).not.toHaveAttribute('aria-invalid', 'true')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('should show error text and aria-invalid when error prop is set', () => {
    render(<AuthInput label="メールアドレス" error="メールアドレスの形式が正しくありません" />)

    const input = screen.getByLabelText('メールアドレス')
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByText('メールアドレスの形式が正しくありません')).toBeInTheDocument()
  })

  it('should apply red border styling when error is set', () => {
    render(<AuthInput label="メールアドレス" error="必須です" />)

    const input = screen.getByLabelText('メールアドレス')
    expect(input.className).toMatch(/border-red/)
  })

  it('should show a required mark on the label when required', () => {
    render(<AuthInput label="組織名" required />)

    const mark = screen.getByText('*')
    expect(mark).toHaveAttribute('aria-hidden', 'true')
    expect(mark.className).toMatch(/text-red-500/)
  })

  it('should not show a required mark when not required', () => {
    render(<AuthInput label="組織名" />)

    expect(screen.queryByText('*')).not.toBeInTheDocument()
  })

  it('should toggle password visibility when type is password', () => {
    render(<AuthInput label="パスワード" type="password" defaultValue="hunter2" />)

    const input = screen.getByLabelText('パスワード') as HTMLInputElement
    expect(input).toHaveAttribute('type', 'password')

    const toggle = screen.getByLabelText('パスワードを表示')
    fireEvent.click(toggle)

    expect(input).toHaveAttribute('type', 'text')
    expect(screen.getByLabelText('パスワードを隠す')).toBeInTheDocument()
  })

  it('should not show password toggle for non-password inputs', () => {
    render(<AuthInput label="メールアドレス" type="email" />)

    expect(screen.queryByLabelText('パスワードを表示')).not.toBeInTheDocument()
  })
})
