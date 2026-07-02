'use client'

import { motion } from 'framer-motion'
import { EnvelopeSimple, Folders, Robot, ShareNetwork, ShieldCheck, ClockCounterClockwise, Lock, Stamp } from '@phosphor-icons/react'

const steps = [
  {
    icon: EnvelopeSimple,
    title: 'アカウント作成',
    desc: 'メールだけ。Google/GitHubでも可',
  },
  {
    icon: Folders,
    title: 'テンプレートから選択',
    desc: '受託開発/Web制作/アプリ開発',
  },
  {
    icon: Robot,
    title: 'タスク登録',
    desc: 'CSVインポート or AIに指示して自動作成',
  },
  {
    icon: ShareNetwork,
    title: 'チーム招待 & ポータルURL共有',
    desc: 'クライアントに送るだけ',
  },
]

const safetyItems = [
  { icon: ShieldCheck, text: '全操作は監査ログに記録されます' },
  { icon: Lock, text: '権限設定でAI経由の操作範囲を制限できます' },
  { icon: ClockCounterClockwise, text: '操作履歴から過去の状態に復元可能です' },
  { icon: Stamp, text: '金額変更・ステータス変更は承認フロー経由に設定可能' },
]

export function QuickStart() {
  return (
    <section className="py-20 bg-white relative overflow-hidden">
      <div className="container mx-auto px-6">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="text-center mb-16"
        >
          <span className="text-xs font-bold tracking-[0.2em] uppercase text-amber-500 mb-3 block">Getting Started</span>
          <h2 className="text-3xl lg:text-4xl font-bold text-slate-900 mb-4">5分で始められる。</h2>
        </motion.div>

        {/* Steps */}
        <div className="max-w-4xl mx-auto grid sm:grid-cols-2 lg:grid-cols-4 gap-6 mb-16">
          {steps.map((step, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.1 }}
              viewport={{ once: true }}
              className="relative text-center"
            >
              <div className="w-14 h-14 rounded-2xl bg-amber-50 text-amber-600 flex items-center justify-center mx-auto mb-4 border border-amber-100">
                <step.icon size={28} weight="duotone" />
              </div>
              <div className="absolute -top-2 -left-2 w-7 h-7 rounded-full bg-amber-500 text-white text-xs font-bold flex items-center justify-center shadow-sm sm:left-auto sm:right-[calc(50%+20px)]">
                {i + 1}
              </div>
              <h3 className="font-bold text-slate-900 mb-1">{step.title}</h3>
              <p className="text-sm text-slate-500">{step.desc}</p>
            </motion.div>
          ))}
        </div>

        {/* Migration Support */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="max-w-3xl mx-auto grid md:grid-cols-2 gap-6"
        >
          <div className="bg-slate-50 rounded-2xl p-6 border border-slate-200">
            <h3 className="font-bold text-slate-900 mb-3">Backlogからの移行</h3>
            <ul className="space-y-2 text-sm text-slate-600">
              <li className="flex items-start gap-2">
                <span className="text-green-600 shrink-0 mt-0.5">&#10003;</span>
                CSV エクスポート → インポートでタスク・マイルストーン移行
              </li>
              <li className="flex items-start gap-2">
                <span className="text-green-600 shrink-0 mt-0.5">&#10003;</span>
                移行中も既存ツールと並行運用OK
              </li>
              <li className="flex items-start gap-2">
                <span className="text-green-600 shrink-0 mt-0.5">&#10003;</span>
                チャットサポートで移行をお手伝い
              </li>
            </ul>
          </div>

          <div className="bg-slate-50 rounded-2xl p-6 border border-slate-200">
            <h3 className="font-bold text-slate-900 mb-3">AI操作の安全性</h3>
            <p className="text-xs text-slate-500 mb-3">「AIが勝手に変なことしないか心配...」</p>
            <ul className="space-y-2">
              {safetyItems.map((item, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-slate-600">
                  <item.icon size={16} className="text-green-600 shrink-0 mt-0.5" weight="bold" />
                  <span>{item.text}</span>
                </li>
              ))}
            </ul>
          </div>
        </motion.div>
      </div>
    </section>
  )
}
