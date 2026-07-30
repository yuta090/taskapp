import type { Metadata } from 'next'
import { LPHeader } from '@/components/lp/Header'
import { LPFooter } from '@/components/lp/Footer'
import './shindan.css'

// タスク滞留診断(multica-prj/shindan-app から移植)。スタイルは .shindan にスコープ済み

export const metadata: Metadata = {
  title: 'タスク滞留診断（無料・約3分） | AgentPM',
  description:
    '仕事が止まりやすい「滞留タイプ」を選択式の設問で自己診断。滞留レーダー・仕事を進める6つの力・量の負荷が図で分かります。無料・結果までメール登録不要。',
  alternates: { canonical: 'https://agentpm.app/shindan' },
  openGraph: {
    title: 'タスク滞留診断（無料・約3分）',
    description: '仕事が止まりやすいタイプと、どこから手を打てばいいかが分かります。',
    url: 'https://agentpm.app/shindan',
    type: 'website',
    locale: 'ja_JP',
  },
}

export default function ShindanLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="font-sans antialiased text-slate-900">
      <LPHeader />
      <div className="shindan">
        <div className="mesh" aria-hidden="true">
          <i className="m1" />
          <i className="m2" />
          <i className="m3" />
        </div>
        <div className="wrap" style={{ paddingTop: 104, minHeight: '80vh' }}>{children}</div>
      </div>
      <LPFooter />
    </main>
  )
}
