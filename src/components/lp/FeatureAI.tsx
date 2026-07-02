'use client'

import { motion } from 'framer-motion'
import { Terminal, ShieldCheck, ClockCounterClockwise, Lock } from '@phosphor-icons/react'

const codeExamples = [
  {
    label: 'タスクを自然言語で作成・分割',
    code: '> 「auth_v2.mdを読んで、ログイン機能のタスクを4つに分割して」',
  },
  {
    label: 'タスク完了 → ボールが自動でクライアントへ',
    code: '> task_update status=done → ボール移動 → ポータルに通知',
  },
  {
    label: '見積もりを即時作成',
    code: '> 「追加機能の見積もり、単価1万円で」→ ¥160,000',
  },
]

const mcpTools = [
  'タスク管理', 'ボール操作', 'マイルストーン', 'レビュー・承認',
  '会議・議事録', 'Wiki', '日程調整', 'アクティビティ',
  'クライアント管理', 'スペース管理',
]

const safetyItems = [
  { icon: ClockCounterClockwise, text: '操作履歴からワンクリック復元' },
  { icon: Lock, text: '権限設定でAI操作を制限可能' },
  { icon: ShieldCheck, text: '全操作が監査ログに記録' },
]

export function FeatureAI() {
  return (
    <section id="for-developers" className="py-20 bg-slate-50 relative overflow-hidden">
      <div className="container mx-auto px-6">
        <div className="grid lg:grid-cols-2 gap-16 items-center">
          {/* Text Side */}
          <motion.div
            initial={{ opacity: 0, x: -30 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
          >
            <div className="text-amber-500 font-bold tracking-wider uppercase mb-4 text-sm">For Developers</div>
            <h2 className="text-3xl lg:text-4xl font-bold text-slate-900 mb-6 leading-[1.15]">
              普段使うAIが、<br />
              <span className="text-amber-500">そのままPMツール</span>になる。
            </h2>
            <p className="text-base text-slate-600 mb-8 leading-relaxed">
              Claude Code、ChatGPT、Gemini、ターミナル——<br />
              いつもの環境からタスクの作成・更新・完了ができます。<br />
              12種類のMCPツールで、管理画面を開く必要はありません。
            </p>

            {/* Safety */}
            <div className="flex flex-wrap gap-4">
              {safetyItems.map((item, i) => (
                <div key={i} className="flex items-center gap-2 text-sm text-slate-600 bg-white px-4 py-2 rounded-lg border border-slate-200">
                  <item.icon size={16} className="text-green-600 shrink-0" weight="bold" />
                  <span>{item.text}</span>
                </div>
              ))}
            </div>
          </motion.div>

          {/* Code Examples Side */}
          <motion.div
            initial={{ opacity: 0, x: 30 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
          >
            <div className="bg-[#1e1e2e] rounded-2xl shadow-2xl overflow-hidden border border-slate-700/50">
              {/* Window Header */}
              <div className="bg-[#181825] px-4 py-3 flex items-center gap-2 border-b border-white/5">
                <div className="flex gap-2">
                  <div className="w-3 h-3 rounded-full bg-[#ff5f56]" />
                  <div className="w-3 h-3 rounded-full bg-[#ffbd2e]" />
                  <div className="w-3 h-3 rounded-full bg-[#27c93f]" />
                </div>
                <div className="ml-4 flex items-center gap-2 text-xs text-slate-400 font-mono">
                  <Terminal size={14} />
                  <span>AgentPM MCP</span>
                </div>
              </div>

              {/* Code Examples */}
              <div className="p-6 space-y-6 font-mono text-sm">
                {codeExamples.map((ex, i) => (
                  <motion.div
                    key={i}
                    initial={{ opacity: 0, y: 10 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.15 }}
                    viewport={{ once: true }}
                  >
                    <div className="text-slate-500 text-xs mb-1.5"># {ex.label}</div>
                    <div className="text-amber-300 bg-slate-800/50 px-4 py-3 rounded-lg border border-slate-700/50">
                      {ex.code}
                    </div>
                  </motion.div>
                ))}
              </div>

              {/* MCP Tools */}
              <div className="px-6 pb-6">
                <div className="text-xs text-slate-500 mb-3">対応MCPツール（12種）</div>
                <div className="flex flex-wrap gap-2">
                  {mcpTools.map((tool, i) => (
                    <span key={i} className="text-xs text-slate-400 bg-slate-800 px-2.5 py-1 rounded border border-slate-700/50">
                      {tool}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  )
}
