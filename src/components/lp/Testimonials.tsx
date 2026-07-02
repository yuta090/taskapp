'use client'

import { motion } from 'framer-motion'
import { Star } from '@phosphor-icons/react'

const testimonials = [
  {
    name: '佐々木 拓也',
    role: 'エンジニア',
    company: '株式会社クラフトテック',
    industry: 'SaaS開発 / 8名 / 3ヶ月',
    quote: 'Claude Codeからタスク更新。管理画面を開くことがなくなった。',
    metric: '管理画面操作: 5-6回/日 → 0回',
  },
  {
    name: '鈴木 美咲',
    role: 'PM',
    company: 'デジタルフロント合同会社',
    industry: 'Web制作 / 5案件並行 / 4ヶ月',
    quote: 'ボール管理で誰待ちか一目瞭然。進捗報告チャットが激減した。',
    metric: '進捗問い合わせ: 週15回 → 3回（-80%）',
  },
  {
    name: '山本 大輔',
    role: 'フリーランスエンジニア',
    company: '個人事業主',
    industry: '受託開発 / 3案件 / 2ヶ月',
    quote: '見積もりから承認までポータルで完結。請求漏れがゼロになった。',
    metric: '請求漏れ: 月1-2件 → ゼロ',
  },
  {
    name: '渡辺 真理',
    role: 'ディレクター',
    company: '株式会社メディアブリッジ',
    industry: 'Web制作代理店 / 3社管理 / 3ヶ月',
    quote: '原価管理がExcelから一画面に。マージン計算ミスがゼロ。',
    metric: '月末請求: 2日 → 半日（-75%）',
  },
]

export function Testimonials() {
  return (
    <section className="py-20 bg-slate-50 border-t border-slate-100">
      <div className="container mx-auto px-6">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="text-center mb-16"
        >
          <span className="text-xs font-bold tracking-[0.2em] uppercase text-amber-500 mb-3 block">Voice</span>
          <h2 className="text-3xl font-bold text-slate-900 mb-4">導入チームの声</h2>
          <p className="text-slate-500">AgentPMを使っているチームからのフィードバック</p>
        </motion.div>

        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6 max-w-6xl mx-auto">
          {testimonials.map((t, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.1 }}
              viewport={{ once: true }}
              className="bg-white rounded-2xl p-6 border border-slate-100 flex flex-col shadow-sm"
            >
              {/* Stars */}
              <div className="flex gap-0.5 mb-3">
                {[...Array(5)].map((_, j) => (
                  <Star key={j} size={14} weight="fill" className="text-amber-400" />
                ))}
              </div>

              {/* Quote */}
              <p className="text-sm text-slate-700 leading-relaxed flex-1 mb-4">
                {t.quote}
              </p>

              {/* Metric badge */}
              <div className="inline-flex self-start bg-amber-50 text-amber-700 text-xs font-bold px-3 py-1.5 rounded-full border border-amber-100 mb-4">
                {t.metric}
              </div>

              {/* Author */}
              <div className="border-t border-slate-100 pt-3">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-full bg-slate-100 flex items-center justify-center text-slate-500 font-bold text-xs">
                    {t.name[0]}
                  </div>
                  <div>
                    <div className="font-bold text-slate-800 text-sm">{t.name}</div>
                    <div className="text-xs text-slate-500">{t.role} / {t.company}</div>
                  </div>
                </div>
                <div className="text-[10px] text-slate-400 mt-2">{t.industry}</div>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  )
}
