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

  it('既定では上に出る', () => {
    render(
      <Tooltip content="説明テキスト">
        <button>対象</button>
      </Tooltip>
    )
    expect(screen.getByRole('tooltip').className).toContain('bottom-full')
  })

  // ヘッダー内の要素では上に出すと見切れるため、下に出せるようにする
  it('placement="bottom" のときは下に出る', () => {
    render(
      <Tooltip content="説明テキスト" placement="bottom">
        <button>対象</button>
      </Tooltip>
    )
    const tooltip = screen.getByRole('tooltip')
    expect(tooltip.className).toContain('top-full')
    expect(tooltip.className).not.toContain('bottom-full')
  })
})
