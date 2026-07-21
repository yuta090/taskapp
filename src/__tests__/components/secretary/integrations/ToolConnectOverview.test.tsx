import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ToolConnectOverview } from '@/components/secretary/integrations/ToolConnectOverview'
import { INTEGRATIONS } from '@/lib/integrations/registry'

/**
 * ToolConnectOverview — ツール連携カタログの詳細概要(ChannelConnectOverview踏襲)。
 * planned/catalog/export のツールに使う汎用ペイン。orgIdは未使用のため受け取らない
 * (このコンポーネントはツール定義の説明のみで、org固有の状態を扱わない)。
 */
describe('ToolConnectOverview', () => {
  it('label・方向(双方向同期)・setupUrlリンクを表示する(google_tasks)', () => {
    render(<ToolConnectOverview def={INTEGRATIONS.google_tasks} />)
    expect(screen.getByText('Google Tasks')).toBeInTheDocument()
    expect(screen.getByText('双方向同期')).toBeInTheDocument()
    const link = screen.getByText('詳細を開く').closest('a')
    expect(link).toHaveAttribute('href', INTEGRATIONS.google_tasks.setupUrl)
  })

  it('proOnlyツールはProバッジを表示する(google_tasks)', () => {
    render(<ToolConnectOverview def={INTEGRATIONS.google_tasks} />)
    expect(screen.getByText('Pro')).toBeInTheDocument()
  })

  it('plannedツールは「近日対応」を明示する(backlog)', () => {
    render(<ToolConnectOverview def={INTEGRATIONS.backlog} />)
    expect(screen.getByText(/近日対応/)).toBeInTheDocument()
  })

  it('setupUrlが無ければリンクを表示しない(multica)', () => {
    render(<ToolConnectOverview def={INTEGRATIONS.multica} />)
    expect(screen.queryByText('詳細を開く')).not.toBeInTheDocument()
  })

  it('notesがあれば説明文を表示する', () => {
    render(<ToolConnectOverview def={INTEGRATIONS.multica} />)
    expect(screen.getByText(INTEGRATIONS.multica.notes!)).toBeInTheDocument()
  })

  it('csv_export(書き出し)はプロジェクト設定のデータエクスポート導線を正確に案内する(偽の書き出しボタンは置かない)', () => {
    render(<ToolConnectOverview def={INTEGRATIONS.csv_export} />)
    expect(screen.getByText('CSVエクスポート')).toBeInTheDocument()
    expect(screen.getByText('書き出し')).toBeInTheDocument()
    expect(screen.getByText(/各プロジェクトの.*設定.*データエクスポート.*から書き出せます/)).toBeInTheDocument()
    // このorg横断コンソールには偽の書き出しボタンを置かない
    expect(screen.queryByRole('button', { name: /エクスポート/ })).not.toBeInTheDocument()
  })
})
