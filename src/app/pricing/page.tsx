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
  price: string
  period: string
  target: string
  description: string
  icon: React.ElementType
  features: string[]
  notIncluded: string[]
  cta: string
  ctaHref?: string
  primary: boolean
  tag?: string
  subText?: string
  extraNote?: string
}

/**
 * 実装（src/lib/billing/entitlements.ts の PLAN_LIMITS / PLAN_FEATURES）と一致させること。
 * ここに書いた上限がそのまま製品の挙動になる。数値を変えるときは両方直す。
 */
const plans: Plan[] = [
  {
    name: 'Free',
    price: '¥0',
    period: '/月',
    target: '個人・お試し',
    description: 'まずは無料で、チームの仕事を1か所にまとめる。',
    icon: User,
    features: [
      'プロジェクト 3件',
      '社内メンバー 5名',
      '相手先（クライアント）は無制限',
      'チャット連携 3グループ',
      'AIが会話からタスクを拾う（夜間まとめ）',
      'ポータル（閲覧・承認・起票・見積もり）',
      'ボール管理（次に動く人が一目で分かる）',
      'ツール連携（Google Tasks・Notion 等）',
    ],
    notIncluded: ['自社LINEでの配信', '即時通知', '1対1の個別メッセージ'],
    cta: '無料で始める',
    ctaHref: '/signup',
    primary: false,
  },
  {
    name: 'Pro',
    price: '¥14,800',
    period: '/月',
    target: '事務所・制作会社・受託開発',
    description: '自社の名前で、相手先に即時で届く。仕事の取りこぼしをなくす。',
    icon: Buildings,
    features: [
      'プロジェクト 30件',
      '社内メンバー 30名',
      '相手先（クライアント）は無制限',
      'チャット連携 50グループ',
      '自社のLINE公式アカウントで配信（白ラベル）',
      '担当者への1対1メッセージ',
      '即時通知・時刻リマインド',
      'LINE以外のチャット（Slack / Teams 等）',
      'ツール連携は追加料金なし',
      '枠が足りなくなったら見積もりで追加',
    ],
    notIncluded: [],
    cta: '申し込む',
    ctaHref: '/contact?plan=pro',
    primary: true,
    tag: 'おすすめ',
    subText: '税別 / 開通は当社が代行します',
  },
  {
    name: 'Enterprise',
    price: '個別見積り',
    period: '',
    target: '大規模・複数社管理',
    description: '上限なし。請求書払い・導入支援・個別の条件に対応します。',
    icon: Briefcase,
    features: [
      'プロジェクト・メンバー・グループすべて無制限',
      'Proの全機能',
      '代理店モード（原価・マージン・売値）',
      '複数組織の管理',
      '請求書払い',
      '導入支援',
    ],
    notIncluded: [],
    cta: '相談する',
    ctaHref: '/contact?plan=enterprise',
    primary: false,
    subText: '内容に応じてお見積もりします',
  },
]

/* ------------------------------------------------------------------ */
/*  Backlog comparison rows                                            */
/* ------------------------------------------------------------------ */

const backlogRows = [
  { team: '5名', agentpm: '¥14,800 (Pro)', backlog: '¥2,970 (Starter)', diff: '+¥11,830', positive: false },
  { team: '10名', agentpm: '¥14,800 (Pro)', backlog: '¥17,600 (Standard)', diff: '-¥2,800', positive: true },
  { team: '20名', agentpm: '¥14,800 (Pro)', backlog: '¥17,600 (Standard)', diff: '-¥2,800', positive: true },
  { team: '30名', agentpm: '¥14,800 (Pro)', backlog: '¥17,600 (Standard)', diff: '-¥2,800', positive: true },
]

/* ------------------------------------------------------------------ */
/*  Upgrade triggers                                                   */
/* ------------------------------------------------------------------ */

const upgradeTriggers = [
  '4つ目のプロジェクトを作りたい',
  '社内メンバーが6人目になった',
  'チャット連携を4件以上つなぎたい',
  '自社のLINE公式アカウントで届けたい',
  'まとめてではなく、すぐに通知してほしい',
  'LINE以外のチャット（Slack / Teams 等）も取り込みたい',
]

/* ------------------------------------------------------------------ */
/*  Common features                                                    */
/* ------------------------------------------------------------------ */

const commonFeatures = [
  '相手先（クライアント）の利用は全プラン無料・人数制限なし',
  'ツール連携（Google Tasks・Notion・kintone 等）は追加料金なし',
  '上限に達しても、今あるものは止まりません（新しく作るときだけご案内します）',
  '枠が足りなくなったら、お見積もりで追加できます',
  'クレジットカード登録不要で無料プランを開始できます',
  'データのエクスポートはいつでも可能',
]

/* ------------------------------------------------------------------ */
/*  FAQ                                                                */
/* ------------------------------------------------------------------ */

const faqItems = [
  {
    q: '相手先（クライアント）の利用に追加料金はかかりますか？',
    a: 'いいえ。全プランで無料です。人数の制限もありません。',
  },
  {
    q: '「メンバー」に相手先も含まれますか？',
    a: 'いいえ。数えるのは自社のスタッフだけです。相手先の方は何人招いても無料です。',
  },
  {
    q: '上限に達したらどうなりますか？',
    a: '今あるプロジェクトやつないだグループが止まることはありません。新しく作るときだけご案内が出ます。枠を増やしたい場合は、画面から見積もりをご依頼いただけます（承認いただくとその場で枠が増えます）。',
  },
  {
    q: 'ツール連携（Google Tasks・Notion・kintone 等）は別料金ですか？',
    a: 'いいえ。Proに全部含まれています。連携の数で金額は変わりません。',
  },
  {
    q: '無料プランからの移行は簡単ですか？',
    a: 'はい。データはそのまま引き継がれます。自社LINEでの配信は当社が開通を代行します。',
  },
  {
    q: 'プランを上げたら、相手先に共有済みのポータルURLは変わりますか？',
    a: 'いいえ。URLはそのまま継続します。相手先への再共有は不要です。',
  },
  {
    q: '支払い方法は？',
    a: 'クレジットカードのほか、Enterpriseでは請求書払いにも対応します。お申し込み後にご案内します。',
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
    <div className="bg-surface rounded-2xl border border-slate-200 p-8 max-w-xl mx-auto">
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
              <p className="text-slate-700 font-medium mb-4">
                Q2. 社内メンバー5名以内・プロジェクト3件以内で収まりますか？
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => setStep(2)}
                  className="flex-1 py-3 px-4 rounded-lg border border-slate-200 text-slate-700 font-medium hover:bg-slate-50 transition-colors"
                >
                  いいえ（もっと必要）
                </button>
                <button
                  onClick={() => setResult('Free')}
                  className="flex-1 py-3 px-4 rounded-lg bg-amber-500 text-white font-medium hover:bg-amber-600 transition-colors"
                >
                  はい
                </button>
              </div>
            </div>
          )}
          {step === 2 && (
            <div>
              <p className="text-slate-700 font-medium mb-4">
                Q3. 上限なし・請求書払い・代理店モードが必要ですか？
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => setResult('Pro')}
                  className="flex-1 py-3 px-4 rounded-lg border border-slate-200 text-slate-700 font-medium hover:bg-slate-50 transition-colors"
                >
                  いいえ
                </button>
                <button
                  onClick={() => setResult('Enterprise')}
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
              相手先（クライアント）の利用は全プラン無料・人数制限なし。
              <br />
              まずは無料で試して、チームに合うか確認できます。
            </motion.p>

          </div>

          {/* ======================================================== */}
          {/*  PLAN CARDS                                               */}
          {/* ======================================================== */}
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6 max-w-6xl mx-auto items-start">
            {plans.map((plan, index) => {
              const price = plan.price
              const sub = plan.subText ?? ''

              return (
                <motion.div
                  key={plan.name}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.08 + 0.3 }}
                  className={`relative bg-surface rounded-2xl shadow-xl overflow-hidden border transition-all duration-300 flex flex-col ${
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
                      href={plan.ctaHref ?? '/signup'}
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
      <section className="py-20 bg-surface">
        <div className="container mx-auto px-6">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="max-w-4xl mx-auto"
          >
            <h2 className="text-2xl lg:text-3xl font-bold text-center mb-3 text-slate-900">
              チーム規模別の月額比較
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
                <p className="text-slate-400 text-xs mb-2">ツール費用（Pro）</p>
                <p className="text-2xl font-bold text-white">¥14,800</p>
                <p className="text-slate-500 text-xs mt-1">/月（税別）</p>
              </div>
              <div className="bg-amber-500/10 rounded-xl border border-amber-500/30 p-6 text-center">
                <p className="text-amber-400 text-xs mb-2">ROI</p>
                <p className="text-2xl font-bold text-amber-400">1.2〜3.2x</p>
                <p className="text-amber-400/60 text-xs mt-1">保守的に見てもツール代を上回る</p>
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
      <section className="py-20 bg-surface">
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
              以下のどれかに当てはまったら、Pro（¥14,800/月・税別）への移行をご検討ください。
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
                  1つでもチェック → Proがおすすめ
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
      <section className="py-16 bg-surface">
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
      <section id="faq" className="py-20 bg-surface">
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
            <div className="bg-surface rounded-2xl border border-slate-200 divide-y divide-slate-200 px-6">
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
