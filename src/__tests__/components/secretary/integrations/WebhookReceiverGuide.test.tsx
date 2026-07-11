import React from 'react'
import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { WebhookReceiverGuide } from '@/components/secretary/integrations/WebhookReceiverGuide'

/**
 * WebhookReceiverGuide — 受信側向けの署名検証・冪等性の説明（折りたたみ）。
 * docs/spec/AI_SECRETARY_STAGE3_INTEGRATIONS.md §2-3/§5: 署名フォーマット・at-least-once・
 * event_keyでdedupe・occurred_atでLWWを明記する。
 */

describe('WebhookReceiverGuide', () => {
  it('初期状態は折りたたまれている', () => {
    render(<WebhookReceiverGuide />)
    expect(screen.queryByText(/X-AgentPM-Signature/)).not.toBeInTheDocument()
  })

  it('開くと署名検証方法・at-least-once・event_key・occurred_atの説明を表示する', () => {
    render(<WebhookReceiverGuide />)
    fireEvent.click(screen.getByRole('button', { name: /受信側の実装方法/ }))

    expect(screen.getByText(/X-AgentPM-Signature/)).toBeInTheDocument()
    expect(screen.getByText(/at-least-once/)).toBeInTheDocument()
    expect(screen.getByText(/event_key/)).toBeInTheDocument()
    expect(screen.getByText(/occurred_at/)).toBeInTheDocument()
  })
})
