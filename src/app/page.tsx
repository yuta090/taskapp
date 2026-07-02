import { LPHeader } from '@/components/lp/Header'
import { Hero } from '@/components/lp/Hero'
import { Problem } from '@/components/lp/Problem'
import { Solution } from '@/components/lp/Solution'
import { FeatureAI } from '@/components/lp/FeatureAI'
import { FeaturePortal } from '@/components/lp/FeaturePortal'
import { FeatureBall } from '@/components/lp/FeatureBall'
import { FeatureAgency } from '@/components/lp/FeatureAgency'
import { CompetitorComparison } from '@/components/lp/CompetitorComparison'
import { QuickStart } from '@/components/lp/QuickStart'
import { Testimonials } from '@/components/lp/Testimonials'
import { CTABand } from '@/components/lp/CTABand'
import { FAQ } from '@/components/lp/FAQ'
import { LPFooter } from '@/components/lp/Footer'
import { FloatingCTA } from '@/components/lp/FloatingCTA'

export default function Home() {
  return (
    <main className="font-sans antialiased text-slate-900 bg-white selection:bg-amber-100 selection:text-amber-900">
      <LPHeader />
      <Hero />
      <Problem />
      <Solution />
      <FeatureAI />
      <FeaturePortal />
      <FeatureBall />
      <FeatureAgency />
      <CompetitorComparison />
      <QuickStart />
      <Testimonials />
      <CTABand />
      <FAQ />
      <LPFooter />
      <FloatingCTA />
    </main>
  )
}
