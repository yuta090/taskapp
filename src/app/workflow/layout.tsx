import type { Metadata } from 'next'

// ページ本体が 'use client' なので metadata はここに置く（/shindan と同じ型）
export const metadata: Metadata = {
  title: '使い方（企画を1本動かす） | AgentPM',
  description:
    '立ち上げ・上司の承認・会議の議題・議事録からのタスク化・資料集め・AIからの操作まで、新しい企画を1本動かす順番でたどります。コマンドの例つき。',
  alternates: { canonical: 'https://agentpm.app/workflow' },
  openGraph: {
    title: '新しい企画を1本、最初から最後まで',
    description: '立ち上げから会議、決まったことの記録、資料集めまでを実際の順番で。',
    url: 'https://agentpm.app/workflow',
    type: 'website',
    locale: 'ja_JP',
  },
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children
}
