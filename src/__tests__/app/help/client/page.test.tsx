import React from 'react'
import { describe, it, expect } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import ClientHelpPage from '@/app/help/client/page'

describe('ClientHelpPage (/help/client)', () => {
  it('renders the getting-started steps', () => {
    render(<ClientHelpPage />)
    expect(screen.getByText('1. 招待メールを開く')).toBeInTheDocument()
    expect(screen.getByText('2. ポータルに参加する')).toBeInTheDocument()
    expect(screen.getByText('3. 「要対応」から確認する')).toBeInTheDocument()
  })

  it('renders a #glossary section with client-facing terms', () => {
    render(<ClientHelpPage />)
    const glossary = document.getElementById('glossary')
    expect(glossary).toBeInTheDocument()
    const withinGlossary = within(glossary as HTMLElement)
    expect(withinGlossary.getByText('黄色（Amber）のバッジ')).toBeInTheDocument()
    expect(withinGlossary.getByText('承認・修正依頼')).toBeInTheDocument()
    expect(withinGlossary.getByText('要対応')).toBeInTheDocument()
  })

  it('links back to the portal', () => {
    render(<ClientHelpPage />)
    expect(screen.getByRole('link', { name: '戻る' })).toHaveAttribute('href', '/portal')
  })
})
