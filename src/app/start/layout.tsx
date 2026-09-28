import type { Metadata } from 'next'

// ページ本体が 'use client' なので metadata はここに置く（/shindan と同じ型）
export const metadata: Metadata = {
  title: '導入の流れ | AgentPM',
  description:
    '登録からチャット連携まで、あわせて20分ほど。5つの手順と目安時間、いま使っているツールからの移し方をまとめています。',
  alternates: { canonical: 'https://agentpm.app/start' },
  openGraph: {
    title: '登録した日から、案件を動かせます',
    description: '登録・プロジェクト作成・相手先の招待・チャット連携・データ移行の5ステップ。',
    url: 'https://agentpm.app/start',
    type: 'website',
    locale: 'ja_JP',
  },
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children
}
