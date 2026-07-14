'use client'

import { LPHeader } from '@/components/lp/Header'
import { LPFooter } from '@/components/lp/Footer'
import { CTABand } from '@/components/lp/CTABand'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Check,
  X,
  User,
  UsersThree,
  Buildings,
  Briefcase,
  CaretDown,
  ArrowRight,
  CheckSquare,
  TreeStructure,
} from '@phosphor-icons/react'
import { useState } from 'react'
import Link from 'next/link'

/* ------------------------------------------------------------------ */
/*  Plan data                                                          */
/* ------------------------------------------------------------------ */

type Plan = {
  name: string
  price: { annual: string; monthly: string }
  period: string
  target: string
  description: string
  icon: React.ElementType
  features: string[]
  notIncluded: string[]
  cta: string
  primary: boolean
  tag?: string
  subText?: { annual: string; monthly: string }
  extraNote?: string
}

const plans: Plan[] = [
  {
    name: 'Free',
    price: { annual: '¥0', monthly: '¥0' },
    period: '/月',
    target: '個人・お試し',
    description: 'AIタスク管理の快適さを、まずは個人で体験。',
    icon: User,
    features: [
      '内部メンバー5名まで',
      '1プロジェクト',
      'ポータル参加者: 無制限',
      'CLI基本操作',
      'スキル2種（回数制限あり）',
      'ポータル（閲覧・承認・起票・見積もり）',
      'ボール管理',
      'Wiki・議事録（30日保持）',
      'レビュー・承認（1段階）',
      'テンプレート3件',
      '日程調整（1対1のみ）',
      '監査ログ（7日保持）',
    ],
    notIncluded: ['CSVエクスポート', '多段階承認', '全スキル'],
    cta: '無料で始める',
    primary: false,
  },
  {
    name: 'Team',
    price: { annual: '¥4,980', monthly: '¥6,480' },
    period: '/月',
    target: '小規模チーム（受託開発・Web制作）',
    description: 'Freeの全機能+制限解除。チーム運用を本格化。',
    icon: UsersThree,
    features: [
      '内部メンバー10名（超過 +¥380/人）',
      '5プロジェクト',
      'ポータル参加者: 無制限',
      '全スキル',
      'Wiki・議事録（無制限保持）',
      '多段階レビュー・承認フロー',
      'テンプレート無制限',
      '日程調整（複数候補・自動通知）',
      '監査ログ（1年保持）',
      'CSVエクスポート',
      'チャットサポート',
    ],
    notIncluded: [],
    cta: '無料トライアルを始める',
    primary: true,
    tag: 'おすすめ',
    subText: {
      annual: '年払いで年間¥17,760お得',
      monthly: '14日間無料トライアル',
    },
  },
  {
    name: 'Business',
    price: { annual: '¥14,800', monthly: '¥18,800' },
    period: '/月',
    target: '中規模チーム・全社導入',
    description: 'Teamの全機能。大規模チーム向け。',
    icon: Buildings,
    features: [
      '内部メンバー30名（超過 +¥330/人）',
      'プロジェクト無制限',
      'ポータル参加者: 無制限',
      'Teamの全機能',
      '監査ログ（3年保持）',
      '優先チャットサポート',
    ],
    notIncluded: [],
    cta: '無料トライアルを始める',
    primary: false,
    subText: {
      annual: '年払いで年間¥48,000お得',
      monthly: '14日間無料トライアル',
    },
  },
  {
    name: 'Agency',
    price: { annual: '¥24,800', monthly: '¥31,800' },
    period: '/月',
    target: '代理店・複数社管理',
    description: 'Businessの全機能+代理店モード。複数社を一元管理。',
    icon: Briefcase,
    features: [
      '内部メンバー50名（超過 +¥280/人）',
      'プロジェクト無制限',
      'ポータル参加者: 無制限',
      'Businessの全機能',
      '代理店モード（原価・マージン・売値）',
      'ベンダーポータル',
      '3段階承認フロー',
      '複数組織管理',
      '導入支援',
    ],
    notIncluded: [],
    cta: '無料トライアルを始める',
    primary: false,
    subText: {
      annual: '年払いで年間¥84,000お得',
      monthly: '14日間無料トライアル',
    },
  },
]

/* ------------------------------------------------------------------ */
/*  Backlog comparison rows                                            */
/* ------------------------------------------------------------------ */

const backlogRows = [
  { team: '5名', agentpm: '¥4,980 (Team)', backlog: '¥2,970 (Starter)', diff: '+¥2,010', positive: false },
  { team: '10名', agentpm: '¥4,980 (Team)', backlog: '¥17,600 (Standard)', diff: '-¥12,620', positive: true },
  { team: '15名', agentpm: '¥6,880 (Team+超過)', backlog: '¥17,600 (Standard)', diff: '-¥10,720', positive: true },
  { team: '20名', agentpm: '¥14,800 (Business)', backlog: '¥17,600 (Standard)', diff: '-¥2,800', positive: true },
  { team: '30名', agentpm: '¥14,800 (Business)', backlog: '¥17,600 (Standard)', diff: '-¥2,800', positive: true },
]

/* ------------------------------------------------------------------ */
/*  Upgrade triggers                                                   */
/* ------------------------------------------------------------------ */

const upgradeTriggers = [
  '2案件目のプロジェクトを作りたい',
  'メンバーが6名以上になった',
  '承認を「担当者→PM→クライアント」の多段階にしたい',
  'タスクや工数データをCSVで出力したい',
  '監査ログを7日以上保持したい',
  '/meeting-flow や /scheduling-wizard を使いたい',
]

/* ------------------------------------------------------------------ */
/*  Common features                                                    */
/* ------------------------------------------------------------------ */

const commonFeatures = [
  'クライアントのポータル利用は無料（人数制限なし）',
  'クレジットカード登録不要で無料プラン開始可能',
  'いつでもアップグレード/ダウングレード可能',
  '解約後も請求期間終了まで利用可能',
  'データのエクスポートはいつでも可能',
]

/* ------------------------------------------------------------------ */
/*  FAQ                                                                */
/* ------------------------------------------------------------------ */

const faqItems = [
  {
    q: 'クライアントのポータル利用に追加料金はかかりますか？',
    a: 'いいえ。全プランで無料です。招待数の制限もありません。',
  },
  {
    q: '「ユーザー」にはクライアントも含まれますか？',
    a: 'いいえ。ユーザーはプロジェクトを管理する側（PM・エンジニア等）のみです。',
  },
  {
    q: '無料プランからの移行は簡単ですか？',
    a: 'はい。設定画面からワンクリック。データはそのまま引き継がれます。',
  },
  {
    q: 'プランをアップグレードしたら、クライアントに共有済みのポータルURLは変わりますか？',
    a: 'いいえ。URLはそのまま継続します。クライアントへの再共有は不要です。',
  },
  {
    q: '年払いの場合、途中解約の返金はありますか？',
    a: '月割りでの返金に対応しています。',
  },
  {
    q: '代理店モードだけ試したい場合は？',
    a: 'Agencyプランの14日間無料トライアルで全機能をお試しいただけます。',
  },
  {
    q: 'セキュリティの対応状況を教えてください。',
    a: '通信はTLSで暗号化し、データはデータベース基盤（Supabase / AWS）の保管時暗号化で保護しています。加えて、RLS（行レベルセキュリティ）による組織間のデータ分離と、操作の監査ログを実装しています。第三者認証（ISO 27001・SOC 2）は現時点では取得していません。',
  },
]

/* ------------------------------------------------------------------ */
/*  FAQ Accordion Item                                                 */
/* ------------------------------------------------------------------ */

function FAQItem({ item }: { item: { q: string; a: string } }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="border-b border-slate-200 last:border-0">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center justify-between w-full py-5 text-left gap-4"
      >
        <span className="font-semibold text-slate-900 text-sm lg:text-base">{item.q}</span>
        <CaretDown
          weight="bold"
          className={`shrink-0 text-slate-400 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
          size={18}
        />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <p className="pb-5 text-slate-600 text-sm leading-relaxed">{item.a}</p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Plan Diagnosis                                                     */
/* ------------------------------------------------------------------ */

function PlanDiagnosis() {
  const [step, setStep] = useState(0)
  const [result, setResult] = useState<string | null>(null)

  function reset() {
    setStep(0)
    setResult(null)
  }

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-8 max-w-xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <TreeStructure weight="fill" className="text-amber-500" size={24} />
        <h3 className="text-lg font-bold text-slate-900">プラン診断</h3>
      </div>

      {result ? (
        <div className="text-center">
          <p className="text-slate-600 mb-2">あなたにおすすめのプランは...</p>
          <p className="text-2xl font-bold text-amber-600 mb-4">{result}</p>
          <button
            onClick={reset}
            className="text-sm text-slate-500 underline hover:text-slate-700"
          >
            もう一度診断する
          </button>
        </div>
      ) : (
        <>
          {step === 0 && (
            <div>
              <p className="text-slate-700 font-medium mb-4">Q1. チームで使いますか？</p>
              <div className="flex gap-3">
                <button
                  onClick={() => setResult('Free')}
                  className="flex-1 py-3 px-4 rounded-lg border border-slate-200 text-slate-700 font-medium hover:bg-slate-50 transition-colors"
                >
                  いいえ
                </button>
                <button
                  onClick={() => setStep(1)}
                  className="flex-1 py-3 px-4 rounded-lg bg-amber-500 text-white font-medium hover:bg-amber-600 transition-colors"
                >
                  はい
                </button>
              </div>
            </div>
          )}
          {step === 1 && (
            <div>
              <p className="text-slate-700 font-medium mb-4">Q2. メンバーは10名以下ですか？</p>
              <div className="flex gap-3">
                <button
                  onClick={() => setStep(2)}
                  className="flex-1 py-3 px-4 rounded-lg border border-slate-200 text-slate-700 font-medium hover:bg-slate-50 transition-colors"
                >
                  いいえ（11名以上）
                </button>
                <button
                  onClick={() => setResult('Team')}
                  className="flex-1 py-3 px-4 rounded-lg bg-amber-500 text-white font-medium hover:bg-amber-600 transition-colors"
                >
                  はい
                </button>
              </div>
            </div>
          )}
          {step === 2 && (
            <div>
              <p className="text-slate-700 font-medium mb-4">Q3. 制作会社の原価管理が必要ですか？</p>
              <div className="flex gap-3">
                <button
                  onClick={() => setResult('Business')}
                  className="flex-1 py-3 px-4 rounded-lg border border-slate-200 text-slate-700 font-medium hover:bg-slate-50 transition-colors"
                >
                  いいえ
                </button>
                <button
                  onClick={() => setResult('Agency')}
                  className="flex-1 py-3 px-4 rounded-lg bg-amber-500 text-white font-medium hover:bg-amber-600 transition-colors"
                >
                  はい
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

/* ================================================================== */
/*  Page                                                               */
/* ================================================================== */

export default function PricingPage() {
  const [isAnnual, setIsAnnual] = useState(true)

  return (
    <main className="font-sans antialiased text-slate-900 bg-slate-50 min-h-screen">
      <LPHeader />

      {/* ============================================================ */}
      {/*  HERO                                                        */}
      {/* ============================================================ */}
      <section className="pt-32 pb-20">
        <div className="container mx-auto px-6">
          <div className="text-center max-w-3xl mx-auto mb-16">
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="inline-block px-3 py-1 mb-4 text-xs font-bold tracking-wider text-amber-600 uppercase bg-amber-100 rounded-full"
            >
              Pricing Plans
            </motion.div>
            <motion.h1
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
              className="text-4xl lg:text-5xl font-bold mb-6 text-slate-900"
            >
              シンプルな料金。必要な分だけ。
            </motion.h1>
            <motion.p
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
              className="text-xl text-slate-600 mb-8"
            >
              クライアントのポータル利用は全プラン無料。
              <br />
              まずは無料で試して、チームに合うか確認できます。
            </motion.p>

            {/* Toggle */}
            <div className="inline-flex items-center bg-white p-1 rounded-xl border border-slate-200 shadow-sm relative mb-8">
              <button
                onClick={() => setIsAnnual(false)}
                className={`px-4 py-2 rounded-lg text-sm font-bold transition-all relative z-10 ${
                  !isAnnual
                    ? 'text-slate-900 shadow-sm bg-white ring-1 ring-slate-200'
                    : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                月払い
              </button>
              <button
                onClick={() => setIsAnnual(true)}
                className={`px-4 py-2 rounded-lg text-sm font-bold transition-all relative z-10 ${
                  isAnnual
                    ? 'text-slate-900 shadow-sm bg-white ring-1 ring-slate-200'
                    : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                年払い{' '}
                <span className="text-amber-600 text-xs ml-1">-2ヶ月分お得</span>
              </button>
            </div>
          </div>

          {/* ======================================================== */}
          {/*  PLAN CARDS                                               */}
          {/* ======================================================== */}
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6 max-w-7xl mx-auto items-start">
            {plans.map((plan, index) => {
              const price = isAnnual ? plan.price.annual : plan.price.monthly
              const sub = plan.subText
                ? isAnnual
                  ? plan.subText.annual
                  : plan.subText.monthly
                : ''

              return (
                <motion.div
                  key={plan.name}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.08 + 0.3 }}
                  className={`relative bg-white rounded-2xl shadow-xl overflow-hidden border transition-all duration-300 flex flex-col ${
                    plan.primary
                      ? 'border-amber-500 ring-4 ring-amber-500/20 lg:scale-105 z-10'
                      : 'border-slate-200 hover:border-amber-200'
                  }`}
                >
                  {plan.primary && (
                    <div className="absolute top-0 inset-x-0 h-1.5 bg-gradient-to-r from-amber-400 to-orange-500" />
                  )}
                  {plan.tag && (
                    <div className="absolute top-4 right-4 bg-amber-100 text-amber-700 text-xs font-bold px-3 py-1 rounded-full">
                      {plan.tag}
                    </div>
                  )}

                  <div className="p-6 lg:p-8">
                    <div className="flex items-center gap-3 mb-4">
                      <div
                        className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                          plan.primary
                            ? 'bg-amber-500 text-white'
                            : 'bg-slate-100 text-slate-600'
                        }`}
                      >
                        <plan.icon size={20} weight="fill" />
                      </div>
                      <div>
                        <h3 className="text-lg font-bold text-slate-900">{plan.name}</h3>
                        <p className="text-xs text-slate-500 font-medium">{plan.target}</p>
                      </div>
                    </div>

                    <div className="flex items-baseline gap-1 mb-2">
                      <span className="text-3xl lg:text-4xl font-bold text-slate-900">
                        {price}
                      </span>
                      <span className="text-slate-500 font-medium text-sm">{plan.period}</span>
                    </div>
                    <p className="text-xs text-amber-600 font-medium h-4 mb-4">{sub}</p>

                    <p className="text-slate-600 mb-6 text-sm leading-relaxed min-h-[2.5rem]">
                      {plan.description}
                    </p>

                    <Link
                      href="/signup"
                      className={`block w-full py-3 px-6 rounded-lg font-bold transition-all text-center text-sm ${
                        plan.primary
                          ? 'bg-amber-500 text-white hover:bg-amber-600 shadow-lg shadow-amber-500/30 hover:shadow-amber-500/40 transform hover:-translate-y-0.5'
                          : 'bg-slate-100 text-slate-900 hover:bg-slate-200'
                      }`}
                    >
                      {plan.cta}
                    </Link>
                  </div>

                  <div className="p-6 lg:p-8 bg-slate-50 border-t border-slate-100 flex-1">
                    <ul className="space-y-3 mb-4">
                      {plan.features.map((feature) => (
                        <li
                          key={feature}
                          className="flex items-start gap-2.5 text-sm text-slate-700 font-medium"
                        >
                          <Check
                            weight="bold"
                            className="text-amber-500 shrink-0 mt-0.5"
                            size={16}
                          />
                          <span>{feature}</span>
                        </li>
                      ))}
                    </ul>
                    {plan.notIncluded.length > 0 && (
                      <div className="pt-3 border-t border-slate-200/50">
                        <ul className="space-y-2.5">
                          {plan.notIncluded.map((feature) => (
                            <li
                              key={feature}
                              className="flex items-start gap-2.5 text-sm text-slate-400"
                            >
                              <X weight="bold" className="shrink-0 mt-0.5" size={16} />
                              <span>{feature}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                </motion.div>
              )
            })}
          </div>
        </div>
      </section>

      {/* ============================================================ */}
      {/*  BACKLOG COMPARISON TABLE                                     */}
      {/* ============================================================ */}
      <section className="py-20 bg-white">
        <div className="container mx-auto px-6">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="max-w-4xl mx-auto"
          >
            <h2 className="text-2xl lg:text-3xl font-bold text-center mb-3 text-slate-900">
              チーム規模別の月額比較（年払い）
            </h2>
            <p className="text-center text-slate-500 text-sm mb-10">
              ※ Backlog Starterは30名/5PJまで。ガントチャート等はStandard以上が必要です。
            </p>

            <div className="overflow-x-auto rounded-xl border border-slate-200">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50">
                    <th className="text-left font-semibold text-slate-700 px-6 py-4">
                      チーム
                    </th>
                    <th className="text-left font-semibold text-slate-700 px-6 py-4">
                      AgentPM
                    </th>
                    <th className="text-left font-semibold text-slate-700 px-6 py-4">
                      Backlog
                    </th>
                    <th className="text-right font-semibold text-slate-700 px-6 py-4">
                      差額
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {backlogRows.map((row) => (
                    <tr key={row.team} className="border-t border-slate-100">
                      <td className="px-6 py-4 font-medium text-slate-900">{row.team}</td>
                      <td className="px-6 py-4 text-slate-700">{row.agentpm}</td>
                      <td className="px-6 py-4 text-slate-700">{row.backlog}</td>
                      <td
                        className={`px-6 py-4 text-right font-bold ${
                          row.positive ? 'text-emerald-600' : 'text-slate-500'
                        }`}
                      >
                        {row.diff}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </motion.div>
        </div>
      </section>

      {/* ============================================================ */}
      {/*  TCO COMPARISON                                               */}
      {/* ============================================================ */}
      <section id="tco" className="py-20 bg-slate-900 text-white relative overflow-hidden">
        <div
          className="absolute inset-0 opacity-10"
          style={{
            backgroundImage: 'radial-gradient(#475569 1px, transparent 1px)',
            backgroundSize: '32px 32px',
          }}
        />
        <div className="container mx-auto px-6 relative z-10">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="max-w-4xl mx-auto"
          >
            <h2 className="text-2xl lg:text-3xl font-bold text-center mb-3">
              本当のコストはツール代ではない
            </h2>
            <p className="text-center text-slate-400 text-sm mb-12">
              報告・確認・承認・転記に費やしている「人件費」が、プロジェクト管理の本当のコストです。
            </p>

            <div className="bg-slate-800/50 rounded-2xl border border-slate-700 p-6 lg:p-8 mb-8">
              <p className="text-slate-300 text-sm mb-6">
                前提: PM1名 + エンジニア3名 + ディレクター1名 / 受託案件1件 / 時給¥3,000で試算
              </p>

              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-700">
                      <th className="text-left text-slate-400 font-medium pb-3 pr-4">
                        工数カテゴリ
                      </th>
                      <th className="text-right text-slate-400 font-medium pb-3 px-4">
                        保守的
                      </th>
                      <th className="text-right text-slate-400 font-medium pb-3 pl-4">
                        積極的
                      </th>
                    </tr>
                  </thead>
                  <tbody className="text-slate-300">
                    <tr className="border-b border-slate-700/50">
                      <td className="py-3 pr-4">進捗報告の作成</td>
                      <td className="py-3 px-4 text-right">月4h / ¥12,000</td>
                      <td className="py-3 pl-4 text-right">月8h / ¥24,000</td>
                    </tr>
                    <tr className="border-b border-slate-700/50">
                      <td className="py-3 pr-4">クライアントへの転記・共有</td>
                      <td className="py-3 px-4 text-right">月2h / ¥6,000</td>
                      <td className="py-3 pl-4 text-right">月4h / ¥12,000</td>
                    </tr>
                    <tr className="border-b border-slate-700/50">
                      <td className="py-3 pr-4">承認待ちの催促・調整</td>
                      <td className="py-3 px-4 text-right">月2h / ¥6,000</td>
                      <td className="py-3 pl-4 text-right">月4h / ¥12,000</td>
                    </tr>
                    <tr className="border-b border-slate-700/50">
                      <td className="py-3 pr-4">仕様変更の手戻り（発生時）</td>
                      <td className="py-3 px-4 text-right text-slate-500">-</td>
                      <td className="py-3 pl-4 text-right">月8h / ¥24,000</td>
                    </tr>
                    <tr className="font-bold text-white">
                      <td className="pt-4 pr-4">合計</td>
                      <td className="pt-4 px-4 text-right">¥24,000/月</td>
                      <td className="pt-4 pl-4 text-right">¥72,000/月</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            <div className="grid md:grid-cols-3 gap-6">
              <div className="bg-slate-800/50 rounded-xl border border-slate-700 p-6 text-center">
                <p className="text-slate-400 text-xs mb-2">AgentPM削減効果（目安）</p>
                <p className="text-2xl font-bold text-amber-400">¥18,000〜¥48,000</p>
                <p className="text-slate-500 text-xs mt-1">/月</p>
              </div>
              <div className="bg-slate-800/50 rounded-xl border border-slate-700 p-6 text-center">
                <p className="text-slate-400 text-xs mb-2">ツール費用（Team）</p>
                <p className="text-2xl font-bold text-white">¥4,980</p>
                <p className="text-slate-500 text-xs mt-1">/月（年払い）</p>
              </div>
              <div className="bg-amber-500/10 rounded-xl border border-amber-500/30 p-6 text-center">
                <p className="text-amber-400 text-xs mb-2">ROI（保守的でも）</p>
                <p className="text-2xl font-bold text-amber-400">3.6x</p>
                <p className="text-amber-400/60 text-xs mt-1">ツール代の3.6倍の効果</p>
              </div>
            </div>

            <p className="text-center text-slate-500 text-xs mt-6">
              ※ 効果はチーム構成・案件内容・既存の運用方法により異なります。
            </p>
          </motion.div>
        </div>
      </section>

      {/* ============================================================ */}
      {/*  FREE → TEAM UPGRADE TRIGGERS                                 */}
      {/* ============================================================ */}
      <section className="py-20 bg-white">
        <div className="container mx-auto px-6">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="max-w-2xl mx-auto"
          >
            <h2 className="text-2xl lg:text-3xl font-bold text-center mb-3 text-slate-900">
              Freeプランの上限に達した時
            </h2>
            <p className="text-center text-slate-600 text-sm mb-10">
              以下のどれかに当てはまったら、Team（¥4,980/月）への移行をご検討ください。
            </p>

            <div className="bg-slate-50 rounded-2xl border border-slate-200 p-8">
              <ul className="space-y-4">
                {upgradeTriggers.map((trigger) => (
                  <li key={trigger} className="flex items-center gap-3">
                    <CheckSquare weight="fill" className="text-amber-500 shrink-0" size={20} />
                    <span className="text-slate-700 text-sm font-medium">{trigger}</span>
                  </li>
                ))}
              </ul>

              <div className="mt-8 pt-6 border-t border-slate-200 text-center">
                <p className="text-amber-600 font-bold text-sm mb-2">
                  1つでもチェック → Teamがおすすめ
                </p>
                <p className="text-slate-500 text-xs">
                  すべて当てはまらない → Freeのままで十分です
                </p>
              </div>
            </div>
          </motion.div>
        </div>
      </section>

      {/* ============================================================ */}
      {/*  ALL PLANS COMMON                                             */}
      {/* ============================================================ */}
      <section className="py-16 bg-slate-50">
        <div className="container mx-auto px-6">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="max-w-3xl mx-auto text-center"
          >
            <h2 className="text-2xl font-bold text-slate-900 mb-8">全プラン共通</h2>
            <div className="flex flex-wrap justify-center gap-x-8 gap-y-4">
              {commonFeatures.map((feature) => (
                <div key={feature} className="flex items-center gap-2">
                  <Check weight="bold" className="text-amber-500" size={16} />
                  <span className="text-slate-700 text-sm font-medium">{feature}</span>
                </div>
              ))}
            </div>
          </motion.div>
        </div>
      </section>

      {/* ============================================================ */}
      {/*  APPROVAL PACK CTA                                            */}
      {/* ============================================================ */}
      <section className="py-16 bg-white">
        <div className="container mx-auto px-6">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="max-w-2xl mx-auto text-center"
          >
            <h3 className="text-xl font-bold text-slate-900 mb-3">
              稟議・社内検討が必要な方へ
            </h3>
            <p className="text-slate-600 text-sm mb-6">
              比較表・ROI試算・セキュリティチェックシートをまとめた稟議パックをご用意しています。
            </p>
            <Link
              href="/compare#approval-pack"
              className="inline-flex items-center gap-2 px-6 py-3 bg-slate-900 text-white font-bold rounded-lg hover:bg-slate-800 transition-colors text-sm"
            >
              稟議用資料をダウンロード
              <ArrowRight weight="bold" size={16} />
            </Link>
          </motion.div>
        </div>
      </section>

      {/* ============================================================ */}
      {/*  PLAN DIAGNOSIS                                               */}
      {/* ============================================================ */}
      <section className="py-20 bg-slate-50">
        <div className="container mx-auto px-6">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
          >
            <h2 className="text-2xl lg:text-3xl font-bold text-center mb-10 text-slate-900">
              どのプランが合うか分からない方へ
            </h2>
            <PlanDiagnosis />
          </motion.div>
        </div>
      </section>

      {/* ============================================================ */}
      {/*  FAQ                                                          */}
      {/* ============================================================ */}
      <section id="faq" className="py-20 bg-white">
        <div className="container mx-auto px-6">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="max-w-3xl mx-auto"
          >
            <h2 className="text-2xl lg:text-3xl font-bold text-center mb-10 text-slate-900">
              よくある質問
            </h2>
            <div className="bg-white rounded-2xl border border-slate-200 divide-y divide-slate-200 px-6">
              {faqItems.map((item) => (
                <FAQItem key={item.q} item={item} />
              ))}
            </div>
          </motion.div>
        </div>
      </section>

      {/* ============================================================ */}
      {/*  CTA BAND                                                     */}
      {/* ============================================================ */}
      <CTABand />

      <LPFooter />
    </main>
  )
}
