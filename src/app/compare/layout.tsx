import type { Metadata } from 'next'

// ページ本体が 'use client' なので metadata はここに置く（/shindan と同じ型）
// 他社名は出さない方針（本文と同じく A社・B社 表記）
export const metadata: Metadata = {
  title: 'ツール比較 | AgentPM',
  description:
    'クライアントワーク向けのプロジェクト管理ツールと、チャットからタスクを拾うツールを、機能と料金で並べました。AgentPMが向く場合と、他のツールのほうが合う場合を、どちらも載せています。',
  alternates: { canonical: 'https://agentpm.app/compare' },
  openGraph: {
    title: 'AgentPMが向く場合と、向かない場合',
    description: '相手先ポータル・ボール管理・見積もり連動・チャット連携を、主要ツールと比べました。',
    url: 'https://agentpm.app/compare',
    type: 'website',
    locale: 'ja_JP',
  },
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children
}
