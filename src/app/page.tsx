import { LPHeader } from '@/components/lp/Header'
import { Hero } from '@/components/lp/Hero'
import { Problem } from '@/components/lp/Problem'
import { Solution } from '@/components/lp/Solution'
import { FeatureTerminal } from '@/components/lp/FeatureTerminal'
import { FeatureBall } from '@/components/lp/FeatureBall'
import { FeaturePortal } from '@/components/lp/FeaturePortal'
import { DayInLife } from '@/components/lp/DayInLife'
import { Workflow } from '@/components/lp/Workflow'
import { Features } from '@/components/lp/Features'
import { FeatureComparison } from '@/components/lp/FeatureComparison'
import { Testimonials } from '@/components/lp/Testimonials'
import { FAQ } from '@/components/lp/FAQ'
import { LPFooter } from '@/components/lp/Footer'

export default function Home() {
  return (
    <main className="font-sans antialiased text-slate-900 bg-white selection:bg-amber-100 selection:text-amber-900">
      <LPHeader />
      <Hero />
      <Problem />
      <Solution />
      <FeatureTerminal />
      <FeatureBall />
      <FeaturePortal />
      <DayInLife />
      <Workflow />
      <Features />
      <FeatureComparison />
      <Testimonials />
      <FAQ />
      <LPFooter />
    </main>
  )
}
