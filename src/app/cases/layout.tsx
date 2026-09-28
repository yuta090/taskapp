import type { Metadata } from 'next'

// ページ本体が 'use client' なので metadata はここに置く（/shindan と同じ型）
export const metadata: Metadata = {
  title: '導入事例 | AgentPM',
  description:
    'AgentPM を使っている会社の話です。導入前に何に困っていて、いま何が変わったか。うまくいかなかったところも載せています。',
  alternates: { canonical: 'https://agentpm.app/cases' },
  openGraph: {
    title: '使っている会社の話',
    description: '導入前の困りごとと、いま変わったこと。正直なところも載せています。',
    url: 'https://agentpm.app/cases',
    type: 'website',
    locale: 'ja_JP',
  },
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children
}
