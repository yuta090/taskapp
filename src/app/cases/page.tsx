'use client'

import { LPHeader } from '@/components/lp/Header'
import { LPFooter } from '@/components/lp/Footer'
import { CTABand } from '@/components/lp/CTABand'
import { motion } from 'framer-motion'
import { ArrowRight, Quotes } from '@phosphor-icons/react'
import Link from 'next/link'

/* ─── Data ─── */
/**
 * 導入事例。
 *
 * ⚠ **お客様の許諾を取ったものだけを入れる。** 作り話は書かない。
 *   許諾の取り方・聞くこと・記事の形は docs/marketing/CASE_STUDY_KIT.md に手順がある。
 *   会社名を伏せる場合も「東京都・受託開発・10名」の形なら十分に効く。
 *
 * ⚠ **`cases` が空のあいだ、このページは公開パスに登録しない。**
 *   中身が1件も無いページは「使われていない」印象を与えるため。
 *   1件でも入ったら src/lib/routes/publicPaths.ts と src/app/sitemap.ts に '/cases' を足し、
 *   ヘッダーの「活用シーン」とフッターから導線をつなぐ。
 *
 * 数字は台帳（お客様から伺った実数）にあるものだけ。読みやすさのために補わない。
 */
type Case = {
  /** お客様の言葉をそのまま1文 */
  headline: string
  /** 実名／「東京都・受託開発・10名」のような匿名表記 */
  company: string
  industry: string
  size: string
  /** 導入前に困っていたこと（3〜4行） */
  before: string
  /** 導入後に変わったこと（3〜4行） */
  after: string
  /** 1〜2個だけ。多いと嘘くさくなる */
  numbers: { label: string; value: string }[]
  /** 使いにくいところ・つまずいたところ。ここを書くと他が信じてもらえる */
  honest: string
}

const cases: Case[] = []

/* ─── Page ─── */

export default function CasesPage() {
  return (
    <main className="font-sans antialiased text-slate-900 bg-surface min-h-screen">
      <LPHeader />

      <section className="pt-32 pb-16 bg-slate-50">
        <div className="container mx-auto px-6 text-center max-w-3xl">
          <div className="inline-block px-3 py-1 mb-4 text-xs font-bold tracking-wide text-amber-600 bg-amber-100 rounded-full">
            導入事例
          </div>
          <h1 className="text-4xl lg:text-5xl font-bold mb-6 text-slate-900">
            使っている会社の話。
          </h1>
          <p className="text-lg text-slate-600 leading-relaxed">
            導入前に何に困っていて、いま何が変わったか。<br className="hidden md:block" />
            うまくいかなかったところも、そのまま載せています。
          </p>
        </div>
      </section>

      <section className="py-16 bg-surface">
        <div className="container mx-auto px-6 max-w-3xl space-y-8">
          {cases.map((c, i) => (
            <motion.article
              key={c.company}
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              transition={{ delay: Math.min(i, 3) * 0.05 }}
              viewport={{ once: true }}
              className="bg-surface rounded-2xl border border-slate-200 p-6 lg:p-8"
            >
              <Quotes size={28} weight="fill" className="text-amber-400 mb-3" />
              <h2 className="text-xl lg:text-2xl font-bold text-slate-900 mb-4 leading-snug">{c.headline}</h2>

              <dl className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-slate-500 mb-6">
                <div><dt className="inline font-bold">会社</dt><dd className="inline ml-1.5">{c.company}</dd></div>
                <div><dt className="inline font-bold">業種</dt><dd className="inline ml-1.5">{c.industry}</dd></div>
                <div><dt className="inline font-bold">規模</dt><dd className="inline ml-1.5">{c.size}</dd></div>
              </dl>

              {c.numbers.length > 0 && (
                <div className="flex flex-wrap gap-3 mb-6">
                  {c.numbers.map((n) => (
                    <div key={n.label} className="bg-amber-50 rounded-xl border border-amber-200 px-5 py-3">
                      <div className="text-xs text-slate-500 mb-0.5">{n.label}</div>
                      <div className="text-xl font-bold text-slate-900">{n.value}</div>
                    </div>
                  ))}
                </div>
              )}

              <div className="space-y-4 text-sm text-slate-600 leading-relaxed">
                <div>
                  <h3 className="font-bold text-slate-900 mb-1">導入する前</h3>
                  <p>{c.before}</p>
                </div>
                <div>
                  <h3 className="font-bold text-slate-900 mb-1">いま</h3>
                  <p>{c.after}</p>
                </div>
                <div className="bg-slate-50 rounded-xl border border-slate-200 p-5">
                  <h3 className="font-bold text-slate-900 mb-1">正直なところ</h3>
                  <p>{c.honest}</p>
                </div>
              </div>
            </motion.article>
          ))}
        </div>
      </section>

      <section className="py-16 bg-slate-50">
        <div className="container mx-auto px-6 max-w-3xl">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="bg-surface rounded-2xl border border-slate-200 p-8 text-center"
          >
            <h2 className="text-xl font-bold text-slate-900 mb-3">近い業種の話を聞きたい方へ</h2>
            <p className="text-sm text-slate-600 leading-relaxed mb-6">
              御社と近い規模・業種での使い方を、15分でご説明します。
              まだ載せていない事例もあるので、遠慮なくお聞きください。
            </p>
            <Link
              href="/contact?topic=cases"
              className="inline-flex items-center gap-2 px-6 py-3 bg-amber-500 text-white font-bold rounded-lg hover:bg-amber-600 transition-colors text-sm"
            >
              近い事例を聞く
              <ArrowRight weight="bold" size={14} />
            </Link>
          </motion.div>
        </div>
      </section>

      <CTABand />
      <LPFooter />
    </main>
  )
}
