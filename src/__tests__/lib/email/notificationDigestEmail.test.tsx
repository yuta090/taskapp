import { describe, it, expect } from 'vitest'
import { createElement } from 'react'
import { render } from '@react-email/components'
import NotificationDigestEmail from '@/lib/email/templates/NotificationDigestEmail'
import type { DigestSection } from '@/lib/notifications/digest'

const sections: DigestSection[] = [
  {
    category: 'task_assigned',
    label: 'あなたにボールが回ってきたタスク',
    items: [
      { title: '請求書を送付する', spaceName: 'プロジェクトA' },
      { title: '契約書の確認', spaceName: null },
    ],
  },
  {
    category: 'review_request',
    label: '承認・レビュー待ち',
    items: [{ title: '見積レビュー', spaceName: 'プロジェクトB' }],
  },
]

describe('NotificationDigestEmail', () => {
  it('セクション・項目・設定リンクを含むHTMLをレンダリングする', async () => {
    const html = await render(
      createElement(NotificationDigestEmail, {
        appName: 'AgentPM',
        displayName: '田中',
        sections,
        totalCount: 3,
        appUrl: 'https://app.example.com',
        settingsUrl: 'https://app.example.com/settings/notifications',
      }),
    )
    expect(html).toContain('今日の更新が3件あります')
    expect(html).toContain('あなたにボールが回ってきたタスク')
    expect(html).toContain('請求書を送付する')
    expect(html).toContain('契約書の確認')
    expect(html).toContain('承認・レビュー待ち')
    expect(html).toContain('見積レビュー')
    // 配信停止/設定への導線
    expect(html).toContain('https://app.example.com/settings/notifications')
    expect(html).toContain('田中')
  })

  it('plainText でも項目が読める', async () => {
    const text = await render(
      createElement(NotificationDigestEmail, {
        appName: 'AgentPM',
        displayName: null,
        sections,
        totalCount: 3,
        appUrl: 'https://app.example.com',
        settingsUrl: 'https://app.example.com/settings/notifications',
      }),
      { plainText: true },
    )
    expect(text).toContain('請求書を送付する')
    expect(text).toContain('見積レビュー')
  })
})
