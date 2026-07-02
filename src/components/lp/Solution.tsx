'use client'

import { motion } from 'framer-motion'
import { ArrowRight } from '@phosphor-icons/react'

const flowSteps = [
  {
    role: '開発者',
    color: 'bg-indigo-50 border-indigo-200 text-indigo-700',
    actions: ['AIでタスク完了', 'GitHubマージで自動更新'],
  },
  {
    role: 'PM',
    color: 'bg-amber-50 border-amber-200 text-amber-700',
    actions: ['自動で進捗更新', '転記不要'],
  },
  {
    role: 'クライアント',
    color: 'bg-green-50 border-green-200 text-green-700',
    actions: ['ポータルに即反映', 'ワンクリック承認'],
  },
]

export function Solution() {
  return (
    <section className="py-20 bg-white relative overflow-hidden">
      <div className="container mx-auto px-6">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="text-center max-w-3xl mx-auto mb-16"
        >
          <span className="text-xs font-bold tracking-[0.2em] uppercase text-amber-500 mb-3 block">Solution</span>
          <h2 className="text-3xl lg:text-4xl font-bold text-slate-900 mb-6 leading-[1.15]">
            AgentPMなら、1つのツールで<br />
            <span className="text-amber-500">全員の余計な仕事が消える。</span>
          </h2>
          <p className="text-base text-slate-600">
            開発者がタスクを完了すれば、ポータルに即反映。<br />
            クライアントがワンクリックで承認すれば、PMに通知が届く。<br />
            誰も転記しない。誰も催促しない。
          </p>
        </motion.div>

        {/* Flow Diagram */}
        <div className="max-w-4xl mx-auto mb-16">
          <div className="grid md:grid-cols-3 gap-4 items-start">
            {flowSteps.map((step, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.15 }}
                viewport={{ once: true }}
                className="relative"
              >
                <div className={`rounded-2xl p-6 border-2 ${step.color}`}>
                  <div className="text-xs font-bold uppercase tracking-wider mb-3 opacity-70">{step.role}</div>
                  <ul className="space-y-2">
                    {step.actions.map((action, j) => (
                      <li key={j} className="text-sm font-medium flex items-center gap-2">
                        <span className="w-1.5 h-1.5 rounded-full bg-current opacity-50" />
                        {action}
                      </li>
                    ))}
                  </ul>
                </div>
                {/* Arrow between cards */}
                {i < flowSteps.length - 1 && (
                  <div className="hidden md:flex absolute -right-4 top-1/2 -translate-y-1/2 z-10">
                    <ArrowRight size={20} className="text-amber-400" weight="bold" />
                  </div>
                )}
              </motion.div>
            ))}
          </div>

          {/* Agency row */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.5 }}
            viewport={{ once: true }}
            className="mt-4 flex justify-center"
          >
            <div className="bg-slate-50 border-2 border-slate-200 text-slate-700 rounded-2xl px-6 py-4 text-center">
              <div className="text-xs font-bold uppercase tracking-wider mb-1 text-slate-500">代理店</div>
              <div className="text-sm font-medium">原価 → マージン → 売値を一画面管理</div>
            </div>
          </motion.div>
        </div>

        {/* Honest Competitor Positioning */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="max-w-3xl mx-auto bg-slate-50 rounded-2xl p-8 border border-slate-200"
        >
          <h3 className="text-sm font-bold text-slate-900 mb-4">他ツールとの違い（正直に）</h3>
          <p className="text-sm text-slate-600 mb-4 leading-relaxed">
            AIやMCPへの対応は各ツールで進んでいます。
          </p>
          <ul className="space-y-3 text-sm text-slate-600 mb-6">
            <li className="flex items-start gap-2">
              <span className="font-bold text-slate-800 shrink-0 w-16">Backlog:</span>
              <span>AIアシスタント搭載、MCP対応。ただしクライアント共有にはアカウント作成が必要</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="font-bold text-slate-800 shrink-0 w-16">Jira:</span>
              <span>Rovo AIは強力。ただし導入が複雑で、クライアント向けポータルは別製品</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="font-bold text-slate-800 shrink-0 w-16">Linear:</span>
              <span>開発者体験は最高。ただし日本語UI未対応、クライアント向け機能なし</span>
            </li>
          </ul>
          <div className="bg-amber-50 rounded-xl p-4 border border-amber-100">
            <p className="text-sm font-bold text-amber-800">
              AgentPMの違いは、AI x クライアントポータル x ボール管理が<br className="hidden md:block" />
              最初から1つに統合されていること。<br />
              <span className="font-normal text-amber-700">個別の機能ではなく「全員が繋がる仕組み」が強みです。</span>
            </p>
          </div>
        </motion.div>
      </div>
    </section>
  )
}
