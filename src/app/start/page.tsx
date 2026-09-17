'use client'

import { LPHeader } from '@/components/lp/Header'
import { LPFooter } from '@/components/lp/Footer'
import { CTABand } from '@/components/lp/CTABand'
import { motion } from 'framer-motion'
import { ArrowRight, Check } from '@phosphor-icons/react'
import Link from 'next/link'

/* ─── Data ─── */

const steps = [
  {
    n: 1,
    title: '登録する',
    time: '3分',
    body: 'メールアドレスとパスワードだけで始められます。クレジットカードは要りません。',
    details: ['無料プランはプロジェクト3件・社内メンバー5名まで', '相手先は無料プランでも人数無制限'],
  },
  {
    n: 2,
    title: 'プロジェクトを作る',
    time: '5分',
    body: '業種のテンプレートを選ぶと、Wikiのページとマイルストーンが最初から入った状態で立ち上がります。',
    details: [
      'テンプレートは10種類（Web制作・システム開発・デザイン・動画・イベント・建設・士業・コンサル・マーケティング・新規事業）',
      '白紙から作ることもできます',
    ],
  },
  {
    n: 3,
    title: '相手先を招待する',
    time: '3分',
    body: 'メールで招待を送ります。相手先はパスワードを一度決めるだけで、専用の画面に入れます。',
    details: ['何人招いても無料', '見せると決めたタスクだけが相手の画面に出ます（既定は見せません）'],
  },
  {
    n: 4,
    title: 'チャットをつなぐ',
    time: '5分〜',
    body: 'AI秘書を、いつも使っているチャットのグループに入れます。ここから会話がタスクになります。',
    details: [
      '共通LINEなら、グループに招待して合言葉を入れるだけ',
      '自社のLINE公式アカウントを使う場合は、開通をこちらで代行します',
    ],
  },
  {
    n: 5,
    title: 'いまのツールから移す',
    time: '案件による',
    body: '既存のタスクはCSVで持ってこられます。移している間は、前のツールと並べて使って構いません。',
    details: ['書き出したCSVをそのまま取り込めます', 'いまのタスク管理ツールとつないだまま使うこともできます'],
  },
]

const support = [
  { title: 'チャットで質問する', body: '使い方の質問に、画面の中から聞けます。' },
  { title: '導入の相談をする', body: '15分で、御社の進め方に合わせた組み立てをご提案します。' },
  { title: 'マニュアルを読む', body: '画面ごとの操作を、写真つきでまとめています。' },
]

/* ─── Page ─── */

export default function StartPage() {
  return (
    <main className="font-sans antialiased text-slate-900 bg-surface min-h-screen">
      <LPHeader />

      {/* ──── Hero ──── */}
      <section className="pt-32 pb-20 bg-slate-50">
        <div className="container mx-auto px-6 text-center max-w-3xl">
          <div
            className="inline-block px-3 py-1 mb-4 text-xs font-bold tracking-wide text-amber-600 bg-amber-100 rounded-full"
          >
            導入の流れ
          </div>
          <h1
            className="text-4xl lg:text-5xl font-bold mb-6 text-slate-900"
          >
            登録した日から、<br className="hidden sm:block" />
            案件を動かせます。
          </h1>
          <p
            className="text-lg text-slate-600 leading-relaxed"
          >
            登録からチャット連携まで、あわせて20分ほど。<br className="hidden md:block" />
            いま使っているツールを止める必要はありません。
          </p>
        </div>
      </section>

      {/* ──── ステップ ──── */}
      <section className="py-20 bg-surface">
        <div className="container mx-auto px-6 max-w-3xl">
          <div className="space-y-5">
            {steps.map((step, i) => (
              <motion.div
                key={step.n}
                initial={{ opacity: 0, y: 16 }}
                whileInView={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05 }}
                viewport={{ once: true }}
                className="bg-surface rounded-2xl border border-slate-200 p-6 lg:p-8"
              >
                <div className="flex items-start gap-4">
                  <div className="w-10 h-10 rounded-full bg-amber-500 text-white font-bold flex items-center justify-center shrink-0">
                    {step.n}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-3 mb-2 flex-wrap">
                      <h2 className="text-xl font-bold text-slate-900">{step.title}</h2>
                      <span className="text-xs font-bold text-amber-600 bg-amber-50 px-2 py-0.5 rounded">
                        目安 {step.time}
                      </span>
                    </div>
                    <p className="text-sm text-slate-600 leading-relaxed mb-4">{step.body}</p>
                    <ul className="space-y-2">
                      {step.details.map((d) => (
                        <li key={d} className="flex items-start gap-2.5 text-sm text-slate-500">
                          <Check weight="bold" className="text-emerald-500 shrink-0 mt-0.5" size={15} />
                          <span>{d}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ──── 困ったとき ──── */}
      <section className="py-20 bg-slate-50">
        <div className="container mx-auto px-6 max-w-4xl">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-center mb-10"
          >
            <h2 className="text-3xl font-bold text-slate-900 mb-4">つまずいたら</h2>
            <p className="text-slate-500 text-sm">3つの窓口があります。どれでも構いません。</p>
          </motion.div>

          <div className="grid md:grid-cols-3 gap-4 mb-10">
            {support.map((s, i) => (
              <motion.div
                key={s.title}
                initial={{ opacity: 0, y: 12 }}
                whileInView={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05 }}
                viewport={{ once: true }}
                className="bg-surface rounded-2xl border border-slate-200 p-6"
              >
                <h3 className="font-bold text-slate-900 mb-2">{s.title}</h3>
                <p className="text-sm text-slate-600 leading-relaxed">{s.body}</p>
              </motion.div>
            ))}
          </div>

          <motion.div
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
            className="flex flex-wrap gap-3 justify-center"
          >
            <Link
              href="/signup"
              className="inline-flex items-center gap-2 px-6 py-3 bg-amber-500 text-white font-bold rounded-lg hover:bg-amber-600 transition-colors text-sm"
            >
              無料で始める
              <ArrowRight weight="bold" size={14} />
            </Link>
            <Link
              href="/contact"
              className="inline-flex items-center gap-2 px-6 py-3 bg-surface border border-slate-300 text-slate-700 font-bold rounded-lg hover:bg-slate-50 transition-colors text-sm"
            >
              15分で相談する
            </Link>
            <Link
              href="/docs/manual"
              className="inline-flex items-center gap-2 px-6 py-3 bg-surface border border-slate-300 text-slate-700 font-bold rounded-lg hover:bg-slate-50 transition-colors text-sm"
            >
              マニュアルを見る
            </Link>
          </motion.div>
        </div>
      </section>

      <CTABand />
      <LPFooter />
    </main>
  )
}
