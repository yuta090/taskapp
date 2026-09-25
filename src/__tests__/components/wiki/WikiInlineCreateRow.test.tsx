import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { WikiInlineCreateRow } from '@/components/wiki/WikiInlineCreateRow'

describe('WikiInlineCreateRow', () => {
  it('Enter で入力した名前を確定する', () => {
    const onSubmit = vi.fn()
    render(<WikiInlineCreateRow onSubmit={onSubmit} onCancel={vi.fn()} />)
    const input = screen.getByRole('textbox')
    fireEvent.change(input, { target: { value: '議事録' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onSubmit).toHaveBeenCalledWith('議事録')
  })

  it('空のまま Enter しても確定しない', () => {
    const onSubmit = vi.fn()
    render(<WikiInlineCreateRow onSubmit={onSubmit} onCancel={vi.fn()} />)
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' })
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('前後の空白だけなら確定しない', () => {
    const onSubmit = vi.fn()
    render(<WikiInlineCreateRow onSubmit={onSubmit} onCancel={vi.fn()} />)
    const input = screen.getByRole('textbox')
    fireEvent.change(input, { target: { value: '   ' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('Escape で onCancel が呼ばれる', () => {
    const onCancel = vi.fn()
    render(<WikiInlineCreateRow onSubmit={vi.fn()} onCancel={onCancel} />)
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' })
    expect(onCancel).toHaveBeenCalledTimes(1)
  })
})
