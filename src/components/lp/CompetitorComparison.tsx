'use client'

import { motion } from 'framer-motion'
import { ArrowRight } from '@phosphor-icons/react'
import Link from 'next/link'

const rows = [
  { feature: 'ポータル（アカウント不要）', agentpm: true, others: false, note: '他ツールは全員アカウント必要' },
  { feature: 'ボール管理', agentpm: true, others: false, note: '「誰待ち？」の可視化' },
  { feature: '代理店モード', agentpm: true, others: false, note: '原価/売値の分離管理' },
  { feature: '見積もり・承認連動', agentpm: true, others: false, note: 'ポータルからワンクリック承認' },
  { feature: '仕様書・証跡の一体管理', agentpm: true, others: false, note: 'Wiki・議事録・承認が一元化' },
]

export function CompetitorComparison() {
  return (
    <section className="py-20 bg-slate-50 relative overflow-hidden">
      <div className="container mx-auto px-6">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="text-center mb-12"
        >
          <span className="text-xs font-bold tracking-[0.2em] uppercase text-slate-400 mb-3 block">Only in AgentPM</span>
          <h2 className="text-3xl font-bold text-slate-900 mb-4">他ツールにはない機能</h2>
          <p className="text-slate-500 max-w-2xl mx-auto text-sm leading-relaxed">
            Backlog・Jira・Linear・Redmine——どれにもない機能が、AgentPMにはあります。
          </p>
        </motion.div>

        <div className="max-w-2xl mx-auto space-y-3">
          {rows.map((row, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 10 }}
              whileInView={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }}
              viewport={{ once: true }}
              className="bg-white rounded-xl p-5 border border-slate-200 flex items-center justify-between gap-4"
            >
              <div className="flex items-center gap-3">
                <span className="text-amber-500 font-bold text-lg">◎</span>
                <div>
                  <div className="text-sm font-bold text-slate-800">{row.feature}</div>
                  <div className="text-xs text-slate-400 mt-0.5">{row.note}</div>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-xs text-slate-400">他ツール</span>
                <span className="text-slate-300 font-bold">×</span>
              </div>
            </motion.div>
          ))}
        </div>

        <motion.div
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          className="text-center mt-8"
        >
          <Link
            href="/compare"
            className="inline-flex items-center gap-2 text-amber-600 font-bold text-sm hover:text-amber-700 transition-colors"
          >
            全機能の詳しい比較を見る
            <ArrowRight weight="bold" size={14} />
          </Link>
          <p className="text-xs text-slate-400 mt-3">
            ※ 2026年3月時点、各社公式サイト公開情報に基づく当社調べ
          </p>
        </motion.div>
      </div>
    </section>
  )
}
