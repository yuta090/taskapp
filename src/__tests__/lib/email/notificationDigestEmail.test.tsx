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

  it('未承諾の招待があれば末尾に節を出す', async () => {
    const html = await render(
      createElement(NotificationDigestEmail, {
        appName: 'AgentPM',
        displayName: '田中',
        sections,
        totalCount: 3,
        pendingInvites: {
          count: 2,
          items: [
            { email: 'a@example.com', spaceName: 'プロジェクトC' },
            { email: 'b@example.com', spaceName: null },
          ],
        },
        appUrl: 'https://app.example.com',
        settingsUrl: 'https://app.example.com/settings/notifications',
      }),
    )
    expect(html).toContain('未承諾の招待')
    expect(html).toContain('招待を再送するには')
    expect(html).toContain('a@example.com')
    expect(html).toContain('プロジェクトC')
    expect(html).toContain('b@example.com')
  })

  it('未承諾の招待が無ければ節を出さない', async () => {
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
    expect(html).not.toContain('未承諾の招待')
  })
})

describe('NotificationDigestEmail — 即時のまとめ', () => {
  // 即時メールには、返事待ち（承認依頼など）だけでなく、承認・差し戻しの結果のような
  // 「返事は要らないがすぐ確認してほしい」お知らせも載る。「返事を待っている件」と書くと中身と合わない
  it('見出しと注記が「すぐ確認してほしい件」の言い方になる', async () => {
    const html = await render(
      createElement(NotificationDigestEmail, {
        appName: 'AgentPM',
        displayName: '田中',
        sections,
        totalCount: 3,
        variant: 'immediate',
        appUrl: 'https://app.example.com',
        settingsUrl: 'https://app.example.com/settings/notifications',
      }),
    )
    expect(html).toContain('すぐ確認してほしい件が3件あります')
    expect(html).toContain('承認依頼や承認・差し戻しの結果など、すぐ確認してほしい件だけをお送りしています')
    expect(html).not.toContain('あなたの返事を待っている件')
    expect(html).not.toContain('今日の更新が3件あります')
    expect(html).not.toContain('このメールは1日1回のまとめ通知です')
  })

  it('variant を省略すると今までどおり日次まとめの文面', async () => {
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
    expect(html).toContain('このメールは1日1回のまとめ通知です')
  })
})
