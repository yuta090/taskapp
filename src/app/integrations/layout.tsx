import type { Metadata } from 'next'

// ページ本体が 'use client' なので metadata はここに置く（/shindan と同じ型）
export const metadata: Metadata = {
  title: '連携できるサービス | AgentPM',
  description:
    'LINE・Slack・Teams などのチャット、Backlog・Jira・Notion などのタスク管理、freee・マネーフォワードの請求書、GitHub、MCP対応のAI。いま使っているものはそのまま使えます。',
  alternates: { canonical: 'https://agentpm.app/integrations' },
  openGraph: {
    title: 'いま使っているものは、そのまま使えます',
    description: 'チャットもタスク管理ツールも、乗り換えは要りません。連携の数で料金は変わりません。',
    url: 'https://agentpm.app/integrations',
    type: 'website',
    locale: 'ja_JP',
  },
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children
}
