import type { Metadata } from 'next'

// ページ本体が 'use client' なので metadata はここに置く（/shindan と同じ型）
export const metadata: Metadata = {
  title: 'AI秘書 | AgentPM',
  description:
    'LINE・Slack・Teams などのグループに秘書が入り、会話からやることを拾って期限を追いかけます。どこまで読むかは3段階から選べます。チャットに打つだけでタスクの確認と完了もできます。',
  alternates: { canonical: 'https://agentpm.app/secretary' },
  openGraph: {
    title: 'チャットの会話は、そのままにしておく',
    description: '秘書がグループに入って、やることを拾い、期限を追いかけます。',
    url: 'https://agentpm.app/secretary',
    type: 'website',
    locale: 'ja_JP',
  },
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children
}
