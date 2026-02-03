'use client'

import { Hero } from '@/components/lp/Hero'
import { Problem } from '@/components/lp/Problem'
import { Solution } from '@/components/lp/Solution'
import { FeatureTerminal } from '@/components/lp/FeatureTerminal'
import { FeatureBall } from '@/components/lp/FeatureBall'
import { FeaturePortal } from '@/components/lp/FeaturePortal'
import { DayInLife } from '@/components/lp/DayInLife'
import { Features } from '@/components/lp/Features'
import { LPFooter } from '@/components/lp/Footer'

export default function Home() {
  return (
    <main className="font-sans antialiased text-slate-900 bg-white selection:bg-amber-100 selection:text-amber-900">
      <Hero />
      <Problem />
      <Solution />
      <FeatureTerminal />
      <FeatureBall />
      <FeaturePortal />
      <DayInLife />
      <Features />
      <LPFooter />
    </main>
  )
}
