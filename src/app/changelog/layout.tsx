import type { Metadata } from 'next'

// ページ本体が 'use client' なので metadata はここに置く（/shindan と同じ型）
export const metadata: Metadata = {
  title: '更新情報 | AgentPM',
  description:
    'AgentPM の更新情報です。議事録の同時編集、タスクのコメントと通知、二要素認証、請求書の外部連携、CSVの表編集など、画面で気づく変更をまとめています。',
  alternates: { canonical: 'https://agentpm.app/changelog' },
  openGraph: {
    title: 'AgentPM の更新情報',
    description: 'お客様が画面で気づく変更だけを載せています。',
    url: 'https://agentpm.app/changelog',
    type: 'website',
    locale: 'ja_JP',
  },
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children
}
