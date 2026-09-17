import type { Metadata } from 'next'

// ページ本体が 'use client' なので metadata はここに置く（/shindan と同じ型）
export const metadata: Metadata = {
  title: '画面を見る | AgentPM',
  description:
    'AgentPM の実際の画面を、登録しなくてもひととおり見られます。ダッシュボード・タスク一覧・議事録・Wiki・ファイル・AI秘書、そして相手先（クライアント）に見える画面を分けて載せています。',
  alternates: { canonical: 'https://agentpm.app/screens' },
  openGraph: {
    title: 'AgentPM の画面を見る',
    description: '社内の画面と、相手先に見える画面を分けて載せています。',
    url: 'https://agentpm.app/screens',
    type: 'website',
    locale: 'ja_JP',
  },
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children
}
