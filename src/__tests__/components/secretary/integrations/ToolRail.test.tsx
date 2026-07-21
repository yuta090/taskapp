import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ToolRail } from '@/components/secretary/integrations/ToolRail'
import { CATEGORY_ORDER, CATEGORY_LABEL, ALL_INTEGRATION_IDS, INTEGRATIONS } from '@/lib/integrations/registry'

/**
 * ToolRail — 「ツール連携」タブの左レール(ツール軸)。ChannelRail(チャネル軸)を踏襲する。
 * レジストリ(src/lib/integrations/registry.ts)を単一の真実の源として駆動する:
 * ルートではなくクライアント状態選択(button + onSelect)。
 */
describe('ToolRail (registry-driven)', () => {
  it('カテゴリ見出しが CATEGORY_ORDER 順に出る', () => {
    render(<ToolRail selectedId="google_tasks" onSelect={vi.fn()} />)
    const headings = screen.getAllByTestId(/^tool-rail-category-/).map((el) => el.textContent)
    const expected = CATEGORY_ORDER.map((c) => CATEGORY_LABEL[c])
    expect(headings).toEqual(expected)
  })

  it('初期表示は主要ツール(featured)だけ — 対応ツールが増えてもレールが長大にならない', () => {
    render(<ToolRail selectedId="google_tasks" onSelect={vi.fn()} />)
    for (const id of ALL_INTEGRATION_IDS) {
      const row = screen.queryByTestId(`tool-rail-${id}`)
      if (INTEGRATIONS[id].featured) {
        expect(row, `${id} is featured but hidden`).toBeInTheDocument()
      } else {
        expect(row, `${id} is not featured but shown initially`).not.toBeInTheDocument()
      }
    }
  })

  it('「すべて表示」で残りのツールが展開され、全ツールが並ぶ', () => {
    render(<ToolRail selectedId="google_tasks" onSelect={vi.fn()} />)
    fireEvent.click(screen.getByTestId('tool-rail-show-all'))
    for (const id of ALL_INTEGRATION_IDS) {
      expect(screen.getByTestId(`tool-rail-${id}`), `${id} missing after expand`).toBeInTheDocument()
    }
  })

  it('展開後は「閉じる」で主要ツールのみに戻る', () => {
    render(<ToolRail selectedId="google_tasks" onSelect={vi.fn()} />)
    fireEvent.click(screen.getByTestId('tool-rail-show-all'))
    fireEvent.click(screen.getByTestId('tool-rail-show-all'))
    const hidden = ALL_INTEGRATION_IDS.find((id) => !INTEGRATIONS[id].featured)!
    expect(screen.queryByTestId(`tool-rail-${hidden}`)).not.toBeInTheDocument()
  })

  it('選択中のツールが featured でなくても必ず表示される（選択が消えない）', () => {
    const hidden = ALL_INTEGRATION_IDS.find((id) => !INTEGRATIONS[id].featured)!
    render(<ToolRail selectedId={hidden} onSelect={vi.fn()} />)
    expect(screen.getByTestId(`tool-rail-${hidden}`)).toHaveAttribute('aria-current', 'page')
  })

  it('plannedツール(microsoft_todo)は「近日」バッジを表示する', () => {
    render(<ToolRail selectedId="google_tasks" onSelect={vi.fn()} />)
    const row = screen.getByTestId('tool-rail-microsoft_todo')
    expect(row).toHaveTextContent('近日')
  })

  it('betaツールがあれば「BETA」バッジを表示する', () => {
    const betaId = ALL_INTEGRATION_IDS.find((id) => INTEGRATIONS[id].status === 'beta')
    if (!betaId) return // 現状betaステータスのツールが無ければスキップ(registryの将来変更に強くする)
    render(<ToolRail selectedId="google_tasks" onSelect={vi.fn()} />)
    expect(screen.getByTestId(`tool-rail-${betaId}`)).toHaveTextContent('BETA')
  })

  it('proOnlyツール(google_tasks)は「Pro」バッジを表示する', () => {
    render(<ToolRail selectedId="google_tasks" onSelect={vi.fn()} />)
    expect(screen.getByTestId('tool-rail-google_tasks')).toHaveTextContent('Pro')
  })

  it('GAでproOnlyでもないツール(webhook)にはバッジが無い', () => {
    render(<ToolRail selectedId="google_tasks" onSelect={vi.fn()} />)
    const row = screen.getByTestId('tool-rail-webhook')
    expect(row).not.toHaveTextContent('近日')
    expect(row).not.toHaveTextContent('BETA')
    expect(row).not.toHaveTextContent('Pro')
  })

  it('クリックでonSelect(id)が呼ばれる(planned含め選択可能)', () => {
    const onSelect = vi.fn()
    render(<ToolRail selectedId="google_tasks" onSelect={onSelect} />)
    fireEvent.click(screen.getByTestId('tool-rail-notion'))
    expect(onSelect).toHaveBeenCalledWith('notion')

    fireEvent.click(screen.getByTestId('tool-rail-backlog'))
    expect(onSelect).toHaveBeenCalledWith('backlog')
  })

  it('選択中の行にaria-current=pageが付く', () => {
    render(<ToolRail selectedId="notion" onSelect={vi.fn()} />)
    expect(screen.getByTestId('tool-rail-notion')).toHaveAttribute('aria-current', 'page')
    expect(screen.getByTestId('tool-rail-webhook')).not.toHaveAttribute('aria-current')
  })
})
