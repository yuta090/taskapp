import React from 'react'
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import Home from '@/app/page'
import { connectedChatServices, connectedToolServices } from '@/lib/lp/connectedServices'
import { INTEGRATIONS } from '@/lib/integrations/registry'

describe('トップページ: 連携できているサービスの流れる帯', () => {
  it('連携サービスのセクションがある', () => {
    render(<Home />)
    expect(screen.getByRole('region', { name: '連携できるサービス' })).toBeInTheDocument()
  })

  it('実装済みのチャット・ツールがすべて並ぶ', () => {
    render(<Home />)
    const section = screen.getByRole('region', { name: '連携できるサービス' })
    const text = section.textContent ?? ''
    for (const s of [...connectedChatServices(), ...connectedToolServices()]) {
      expect(text).toContain(s.label)
    }
  })

  it('未実装（ロードマップ）のツール名は出さない', () => {
    render(<Home />)
    const section = screen.getByRole('region', { name: '連携できるサービス' })
    const text = section.textContent ?? ''
    for (const id of ['wrike', 'clickup', 'monday', 'freee', 'misoca'] as const) {
      expect(text).not.toContain(INTEGRATIONS[id].label)
    }
  })
})
