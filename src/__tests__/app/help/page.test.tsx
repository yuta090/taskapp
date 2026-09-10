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

  it('renders the member role guide', () => {
    render(<HelpPage />)
    const roles = document.getElementById('roles')
    expect(roles).toBeInTheDocument()
    const withinRoles = within(roles as HTMLElement)
    for (const label of ['管理者', '編集者', '閲覧者', 'クライアント', 'ベンダー']) {
      // 「クライアント」は役割一覧と招待時の選択肢の両方に出る
      expect(withinRoles.getAllByText(label).length).toBeGreaterThan(0)
    }
    expect(withinRoles.getByText('招待するときに選ぶ役割')).toBeInTheDocument()
  })

  it('renders the main screens overview', () => {
    render(<HelpPage />)
    expect(screen.getByText('受信トレイ')).toBeInTheDocument()
    expect(screen.getByText('マイタスク')).toBeInTheDocument()
    expect(screen.getByText('ガントチャート')).toBeInTheDocument()
    expect(screen.getByText('バーンダウンチャート')).toBeInTheDocument()
  })

  it('shows real screenshots of the app', () => {
    render(<HelpPage />)
    const screens = document.getElementById('screens')
    expect(screens).toBeInTheDocument()
    const images = (screens as HTMLElement).querySelectorAll('img')
    expect(images.length).toBeGreaterThanOrEqual(3)
    for (const img of images) {
      // 画面写真は public/img/help/ 配下（デモ組織のもの）
      expect(img.getAttribute('src')).toMatch(/^\/img\/help\/.+\.png$/)
      expect(img.getAttribute('alt')).toBeTruthy()
    }
  })

  it('links to the detailed manual pages for the newer features', () => {
    render(<HelpPage />)
    for (const href of [
      '/docs/manual/internal/secretary',
      '/docs/manual/internal/notifications',
      '/docs/manual/internal/files',
      '/docs/manual/internal/integrations',
      '/docs/manual/internal/security',
    ]) {
      expect(document.querySelector(`a[href="${href}"]`), href).toBeInTheDocument()
    }
  })

  it('links back to the internal inbox', () => {
    render(<HelpPage />)
    expect(screen.getByRole('link', { name: '戻る' })).toHaveAttribute('href', '/inbox')
  })
})
