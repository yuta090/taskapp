'use client'

import { motion } from 'framer-motion'
import { Prohibit, EyeSlash, ToggleLeft } from '@phosphor-icons/react'

const reassurancePoints = [
  { icon: Prohibit, text: 'しつこくしない（無視すれば黙る。再通知は本人操作のときだけ）' },
  { icon: EyeSlash, text: '相手先の前では急かさない（グループには中立な期限一覧のみ）' },
  { icon: ToggleLeft, text: '事務所ごと・個人ごとにいつでもオフ' },
]

export function FeatureReminder() {
  return (
    <section id="for-deadlines" className="py-20 bg-slate-50 relative overflow-hidden">
      <div className="container mx-auto px-6">
        <div className="grid lg:grid-cols-2 gap-16 items-center">
          {/* Text Side */}
          <motion.div
            initial={{ opacity: 0, x: -30 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
          >
            <div className="text-amber-500 font-bold tracking-wider uppercase mb-4 text-sm">For Deadlines</div>
            <h2 className="text-3xl lg:text-4xl font-bold text-slate-900 mb-6 leading-[1.15]">
              締切は、<br />
              <span className="text-amber-500">秘書が見ています。</span>
            </h2>
            <p className="text-base text-slate-600 mb-8 leading-relaxed">
              タスクに期限を入れておくだけ。当日と超過時に、担当者本人へそっと確認が届きます。<br />
              やってあれば[完了した]を1タップ。まだなら、そのまま対応するだけです。
            </p>

            {/* Reassurance */}
            <div className="flex flex-wrap gap-3">
              {reassurancePoints.map((item, i) => (
                <div key={i} className="flex items-center gap-2 text-sm text-slate-600 bg-white px-4 py-2 rounded-lg border border-slate-200">
                  <item.icon size={16} className="text-green-600 shrink-0" weight="bold" />
                  <span>{item.text}</span>
                </div>
              ))}
            </div>
          </motion.div>

          {/* Chat Mock Side */}
          <motion.div
            initial={{ opacity: 0, x: 30 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
          >
            <div className="max-w-sm mx-auto bg-white rounded-3xl shadow-2xl border border-slate-200/60 overflow-hidden">
              {/* Chat Header */}
              <div className="bg-green-500 px-5 py-3 flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center text-white font-bold text-sm shrink-0">
                  秘
                </div>
                <div>
                  <div className="text-white font-bold text-sm leading-tight">agentpm秘書</div>
                  <div className="text-green-100 text-[11px] leading-tight">個別トーク</div>
                </div>
              </div>

              {/* Chat Body */}
              <div className="p-5 bg-slate-50">
                <div className="bg-white rounded-2xl rounded-tl-sm shadow-sm border border-slate-100 p-4">
                  <p className="text-sm text-slate-700 leading-relaxed">
                    「見積書の提出」が本日期限です。<br />
                    ・完了済みでしたら、下の[完了した]を押してください。<br />
                    ・まだの場合は、ご対応をお願いします。
                  </p>
                </div>

                {/* Mock action buttons (postback / non-interactive) */}
                <div className="mt-3 flex flex-col gap-2">
                  <span className="bg-amber-500 text-white text-sm font-bold text-center px-4 py-2.5 rounded-xl shadow-lg shadow-amber-200 pointer-events-none select-none">
                    完了した
                  </span>
                  <div className="grid grid-cols-2 gap-2">
                    <span className="bg-white text-slate-600 text-xs font-bold text-center px-3 py-2 rounded-xl border border-slate-200 pointer-events-none select-none">
                      対応中
                    </span>
                    <span className="bg-white text-slate-600 text-xs font-bold text-center px-3 py-2 rounded-xl border border-slate-200 pointer-events-none select-none">
                      明日また確認
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  )
}
