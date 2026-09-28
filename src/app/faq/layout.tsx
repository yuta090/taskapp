import type { Metadata } from 'next'

// ページ本体が 'use client' なので metadata はここに置く（/shindan と同じ型）
export const metadata: Metadata = {
  title: 'よくある質問 | AgentPM',
  description:
    '料金、相手先（クライアント）の使い方、AI秘書とチャット連携、セキュリティ、データの取り出しと解約。よく聞かれることを5つに分けて答えています。',
  alternates: { canonical: 'https://agentpm.app/faq' },
  openGraph: {
    title: 'よく聞かれること',
    description: '料金・相手先・チャット・セキュリティ・データの5分類でまとめました。',
    url: 'https://agentpm.app/faq',
    type: 'website',
    locale: 'ja_JP',
  },
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children
}
