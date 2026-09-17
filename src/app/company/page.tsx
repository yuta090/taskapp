'use client'

import { LPHeader } from '@/components/lp/Header'
import { LPFooter } from '@/components/lp/Footer'
import { CTABand } from '@/components/lp/CTABand'
import { motion } from 'framer-motion'
import { ArrowSquareOut, ArrowRight } from '@phosphor-icons/react'
import Link from 'next/link'

/* ─── Data ─── */
// 事実の出どころ: 特定商取引法に基づく表記（/tokushoho）と skara.co.jp。
// ⚠ 記載の無い項目（設立年月・資本金など）は、確認が取れるまで載せない。

const profile = [
  { label: '会社名', value: '株式会社ソレカラ' },
  { label: '代表者', value: '代表取締役 高橋木綿子' },
  { label: '所在地', value: '〒130-0021 東京都墨田区緑3丁目2番地1 シティインデックス錦糸町402号室' },
  { label: 'サービスに関するお問い合わせ', value: 'support@agentpm.app' },
]

const business = [
  '定型業務の自動化',
  '仕事の進め方の設計',
  '社内でAIを使える人を育てる',
  '採用のお手伝い',
]

/* ─── Page ─── */

export default function CompanyPage() {
  return (
    <main className="font-sans antialiased text-slate-900 bg-surface min-h-screen">
      <LPHeader />

      {/* ──── Hero ──── */}
      <section className="pt-32 pb-20 bg-slate-50">
        <div className="container mx-auto px-6 text-center max-w-3xl">
          <div className="inline-block px-3 py-1 mb-4 text-xs font-bold tracking-wide text-amber-600 bg-amber-100 rounded-full">
            運営会社
          </div>
          <h1 className="text-4xl lg:text-5xl font-bold mb-6 text-slate-900">
            AgentPMを作っている<br className="hidden sm:block" />
            会社のこと。
          </h1>
          <p className="text-lg text-slate-600 leading-relaxed">
            AgentPMは、株式会社ソレカラが開発・運営しています。
          </p>
        </div>
      </section>

      {/* ──── 何をしている会社か ──── */}
      <section className="py-20 bg-surface">
        <div className="container mx-auto px-6 max-w-3xl">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
          >
            <h2 className="text-2xl font-bold text-slate-900 mb-4">何をしている会社か</h2>
            <p className="text-slate-600 text-sm leading-relaxed mb-6">
              中小企業がAIを日々の仕事に取り入れるまでを手伝っています。ツールを渡して終わりにはせず、仕事の進め方から一緒に決めます。
            </p>
            <ul className="grid sm:grid-cols-2 gap-3 mb-8">
              {business.map((b) => (
                <li key={b} className="bg-slate-50 rounded-xl border border-slate-200 px-5 py-4 text-sm text-slate-700">
                  {b}
                </li>
              ))}
            </ul>
            <a
              href="https://skara.co.jp"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-sm font-bold text-amber-600 hover:text-amber-700 transition-colors"
            >
              コーポレートサイトを見る
              <ArrowSquareOut size={14} weight="bold" />
            </a>
          </motion.div>
        </div>
      </section>

      {/* ──── なぜAgentPMを作ったか ──── */}
      <section className="py-20 bg-slate-50">
        <div className="container mx-auto px-6 max-w-3xl">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
          >
            <h2 className="text-2xl font-bold text-slate-900 mb-4">なぜAgentPMを作ったか</h2>
            <div className="space-y-4 text-sm text-slate-600 leading-relaxed">
              <p>
                仕事が止まる理由の多くは、作業が難しいからではありません。資料が届かない、確認の返事が来ない、誰が次に動くか分からない。詰まっているのは、たいてい相手を待っている時間です。
              </p>
              <p>
                ここは担当者が頑張っても縮みません。催促するのは気を使いますし、どこまで頼んだかを覚えておくのも骨が折れます。だから後回しになり、気づいたときには納期が迫っています。
              </p>
              <p>
                AgentPMは、この相手待ちの時間を引き受けるために作りました。いま誰の番かを画面に出し、期限が近づけば秘書が声をかけます。お客様には専用の画面を用意したので、わざわざ報告しなくても進み具合が伝わります。
              </p>
            </div>
          </motion.div>
        </div>
      </section>

      {/* ──── 会社概要 ──── */}
      <section className="py-20 bg-surface">
        <div className="container mx-auto px-6 max-w-3xl">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
          >
            <h2 className="text-2xl font-bold text-slate-900 mb-6">会社概要</h2>
            <dl className="bg-surface rounded-2xl border border-slate-200 overflow-hidden">
              {profile.map((row) => (
                <div
                  key={row.label}
                  className="flex flex-col sm:flex-row gap-1 sm:gap-6 px-6 py-5 border-b border-slate-100 last:border-b-0"
                >
                  <dt className="text-sm font-bold text-slate-500 sm:w-64 shrink-0">{row.label}</dt>
                  <dd className="text-sm text-slate-800">{row.value}</dd>
                </div>
              ))}
            </dl>

            <div className="mt-6 flex flex-wrap gap-4">
              <Link
                href="/tokushoho"
                className="inline-flex items-center gap-1.5 text-sm font-bold text-amber-600 hover:text-amber-700 transition-colors"
              >
                特定商取引法に基づく表記
                <ArrowRight weight="bold" size={14} />
              </Link>
              <Link
                href="/privacy"
                className="inline-flex items-center gap-1.5 text-sm font-bold text-amber-600 hover:text-amber-700 transition-colors"
              >
                プライバシーポリシー
                <ArrowRight weight="bold" size={14} />
              </Link>
              <Link
                href="/terms"
                className="inline-flex items-center gap-1.5 text-sm font-bold text-amber-600 hover:text-amber-700 transition-colors"
              >
                利用規約
                <ArrowRight weight="bold" size={14} />
              </Link>
            </div>
          </motion.div>
        </div>
      </section>

      <CTABand />
      <LPFooter />
    </main>
  )
}
