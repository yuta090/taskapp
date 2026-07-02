import { LPHeader } from '@/components/lp/Header'
import { FeatureTerminal } from '@/components/lp/FeatureTerminal'
import { FeatureAI } from '@/components/lp/FeatureAI'
import { FeatureBall } from '@/components/lp/FeatureBall'
import { FeaturePortal } from '@/components/lp/FeaturePortal'
import { FeatureAgency } from '@/components/lp/FeatureAgency'
import { DayInLife } from '@/components/lp/DayInLife'
import { Workflow } from '@/components/lp/Workflow'
import { Features } from '@/components/lp/Features'
import { CTABand } from '@/components/lp/CTABand'
import { LPFooter } from '@/components/lp/Footer'

export const metadata = {
  title: '機能紹介 | AgentPM',
  description: 'AgentPMの全機能を詳しく紹介。AI駆動のタスク管理、クライアントポータル、ボール管理、代理店モードなど。',
}

export default function FeaturesPage() {
  return (
    <main className="font-sans antialiased text-slate-900 bg-white selection:bg-amber-100 selection:text-amber-900">
      <LPHeader />
      <div className="pt-16" />
      <FeatureTerminal />
      <FeatureAI />
      <FeaturePortal />
      <FeatureBall />
      <FeatureAgency />
      <Workflow />
      <Features />
      <DayInLife />
      <CTABand />
      <LPFooter />
    </main>
  )
}
