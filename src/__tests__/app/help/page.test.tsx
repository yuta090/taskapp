import React from 'react'
import { describe, it, expect } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import HelpPage from '@/app/help/page'

describe('HelpPage (/help)', () => {
  it('renders the getting-started steps', () => {
    render(<HelpPage />)
    expect(screen.getByText('1. タスクを作成する')).toBeInTheDocument()
    expect(screen.getByText('2. メンバー・クライアントを招待する')).toBeInTheDocument()
    expect(screen.getByText('3. クライアントに公開する')).toBeInTheDocument()
  })

  it('renders a #glossary section with the core terms', () => {
    render(<HelpPage />)
    const glossary = document.getElementById('glossary')
    expect(glossary).toBeInTheDocument()
    const withinGlossary = within(glossary as HTMLElement)
    expect(withinGlossary.getByText('ボール（ball）')).toBeInTheDocument()
    expect(withinGlossary.getByText('クライアントに公開（Amber-500バッジ）')).toBeInTheDocument()
    expect(withinGlossary.getByText('承認・修正依頼')).toBeInTheDocument()
    expect(withinGlossary.getByText('マイルストーン')).toBeInTheDocument()
    expect(withinGlossary.getByText(/^スペック/)).toBeInTheDocument()
  })

  it('renders the main screens overview', () => {
    render(<HelpPage />)
    expect(screen.getByText('受信トレイ')).toBeInTheDocument()
    expect(screen.getByText('マイタスク')).toBeInTheDocument()
    expect(screen.getByText('ガントチャート')).toBeInTheDocument()
    expect(screen.getByText('バーンダウンチャート')).toBeInTheDocument()
  })

  it('links back to the internal inbox', () => {
    render(<HelpPage />)
    expect(screen.getByRole('link', { name: '戻る' })).toHaveAttribute('href', '/inbox')
  })
})
