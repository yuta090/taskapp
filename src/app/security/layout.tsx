import type { Metadata } from 'next'

// ページ本体が 'use client' なので metadata はここに置く（/shindan と同じ型）
export const metadata: Metadata = {
  title: 'セキュリティ | AgentPM',
  description:
    '通信と保管の暗号化、持ち主だけが見える仕組み、監査ログ、二要素認証。相手先ポータルのしくみと、これから対応するものを分けてまとめています。',
  alternates: { canonical: 'https://agentpm.app/security' },
  openGraph: {
    title: 'お預かりしたものを、どう守っているか',
    description: '暗号化・アクセス制限・監査ログの対応状況を、情報システム部門向けにまとめました。',
    url: 'https://agentpm.app/security',
    type: 'website',
    locale: 'ja_JP',
  },
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children
}
