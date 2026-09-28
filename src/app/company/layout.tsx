import type { Metadata } from 'next'

// ページ本体が 'use client' なので metadata はここに置く（/shindan と同じ型）
export const metadata: Metadata = {
  title: '運営会社 | AgentPM',
  description:
    'AgentPM は株式会社ソレカラが開発・運営しています。中小企業が「AIと共に働く会社」になるまでを手伝う会社です。会社概要と、AgentPMが向き合っている課題をまとめています。',
  alternates: { canonical: 'https://agentpm.app/company' },
  openGraph: {
    title: 'AgentPMを作っている会社のこと',
    description: '株式会社ソレカラが開発・運営しています。',
    url: 'https://agentpm.app/company',
    type: 'website',
    locale: 'ja_JP',
  },
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children
}
