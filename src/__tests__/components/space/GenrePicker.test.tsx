import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { GenrePicker, GenrePreview } from '@/components/space/GenrePicker'
import { getPreset } from '@/lib/presets'

describe('GenrePicker', () => {
  it('9ジャンルのカードと白紙ボタンを表示する', () => {
    render(<GenrePicker onSelect={vi.fn()} />)
    expect(screen.getByText('Web/アプリ開発')).toBeInTheDocument()
    expect(screen.getByText('建設・建築')).toBeInTheDocument()
    expect(screen.getByText(/白紙から始める/)).toBeInTheDocument()
  })

  it('カードの件数表記はホームを文書数に含めない', () => {
    render(<GenrePicker onSelect={vi.fn()} />)
    // 文書3 + ホーム / MS5 のジャンルが複数ある（デザイン制作・コンサル等）
    expect(screen.getAllByText('文書 3件＋ホーム / MS 5件').length).toBeGreaterThan(0)
    // 文書4 + ホーム / MS6 のジャンルも複数ある（業務システム開発・建設等）
    expect(screen.getAllByText('文書 4件＋ホーム / MS 6件').length).toBeGreaterThan(0)
    // 旧表記（ホーム込みカウント）が残っていない
    expect(screen.queryByText(/^Wiki \d+件/)).not.toBeInTheDocument()
  })
})

describe('GenrePreview', () => {
  it('推奨連携をラベル表示する', () => {
    render(<GenrePreview preset={getPreset('event')} />)
    // event: google_calendar, slack, video_conference
    expect(screen.getByText(/Googleカレンダー/)).toBeInTheDocument()
    expect(screen.getByText(/Slack/)).toBeInTheDocument()
    expect(screen.getByText(/ビデオ会議/)).toBeInTheDocument()
  })

  it('作成されるWikiとマイルストーンを一覧する', () => {
    render(<GenrePreview preset={getPreset('consulting')} />)
    expect(screen.getByText(/調査レポート/)).toBeInTheDocument()
    expect(screen.getByText(/現状分析 → 課題整理 → 提案/)).toBeInTheDocument()
  })

  it('blankプリセットは何も表示しない', () => {
    const { container } = render(<GenrePreview preset={getPreset('blank')} />)
    expect(container).toBeEmptyDOMElement()
  })
})
