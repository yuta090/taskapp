import React from 'react'
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Tooltip } from '@/components/shared/Tooltip'

describe('Tooltip', () => {
  it('renders the trigger content', () => {
    render(
      <Tooltip content="説明テキスト">
        <button>対象</button>
      </Tooltip>
    )
    expect(screen.getByRole('button', { name: '対象' })).toBeInTheDocument()
  })

  it('renders the tooltip text, hidden by default via opacity classes', () => {
    render(
      <Tooltip content="説明テキスト">
        <button>対象</button>
      </Tooltip>
    )
    const tooltip = screen.getByRole('tooltip')
    expect(tooltip).toHaveTextContent('説明テキスト')
    expect(tooltip.className).toContain('opacity-0')
  })

  it('reveals on hover and focus via group classes (no JS state)', () => {
    render(
      <Tooltip content="説明テキスト">
        <button>対象</button>
      </Tooltip>
    )
    const tooltip = screen.getByRole('tooltip')
    expect(tooltip.className).toContain('group-hover/tooltip:opacity-100')
    expect(tooltip.className).toContain('group-focus-within/tooltip:opacity-100')
  })
})
