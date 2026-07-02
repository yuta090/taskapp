'use client'

import { motion } from 'framer-motion'
import { ArrowDown, CheckCircle } from '@phosphor-icons/react'

const implementedFeatures = [
  'task_pricing テーブル（原価/マージン率/売値）',
  'ロール別権限（admin/editor/client/vendor）',
  'ベンダー提出 → 代理店承認 → クライアント承認の3段階',
  'ポータルでは売値のみ表示',
]

export function FeatureAgency() {
  return (
    <section id="for-agencies" className="py-20 bg-white relative overflow-hidden">
      <div className="container mx-auto px-6">
        <div className="max-w-5xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-center mb-16"
          >
            <div className="text-amber-500 font-bold tracking-wider uppercase mb-4 text-sm">For Agencies</div>
            <h2 className="text-3xl lg:text-4xl font-bold text-slate-900 mb-6 leading-[1.15]">
              原価・マージン・売値を、<br />
              <span className="text-amber-500">一画面で。</span>
            </h2>
            <p className="text-base text-slate-600 max-w-2xl mx-auto leading-relaxed">
              代理店モードなら、制作会社の原価入力 → マージン設定 → クライアントへの売値表示が一画面。<br />
              クライアントには売値だけが見え、原価情報は完全に非公開です。
            </p>
          </motion.div>

          {/* Price Flow */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="max-w-3xl mx-auto mb-16"
          >
            <div className="grid md:grid-cols-3 gap-4 items-center">
              {/* Vendor */}
              <div className="bg-slate-50 rounded-2xl p-6 border border-slate-200 text-center">
                <div className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">制作会社</div>
                <div className="text-sm text-slate-600 mb-3">工数16h x ¥8,000</div>
                <div className="text-2xl font-black text-slate-900">¥128,000</div>
                <div className="text-xs text-slate-400 mt-1">原価</div>
              </div>

              {/* Arrow */}
              <div className="hidden md:flex flex-col items-center gap-2">
                <ArrowDown size={24} className="text-amber-500 rotate-[-90deg]" weight="bold" />
                <span className="text-xs font-bold text-amber-600 bg-amber-50 px-3 py-1 rounded-full">マージン 35%</span>
                <ArrowDown size={24} className="text-amber-500 rotate-[-90deg]" weight="bold" />
              </div>
              <div className="flex md:hidden justify-center py-2">
                <ArrowDown size={24} className="text-amber-500" weight="bold" />
              </div>

              {/* Agency */}
              <div className="bg-amber-50 rounded-2xl p-6 border-2 border-amber-200 text-center relative">
                <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-amber-500 text-white text-[10px] font-bold px-3 py-1 rounded-full whitespace-nowrap">
                  代理店
                </div>
                <div className="text-sm text-slate-600 mb-3 mt-2">マージン 35%</div>
                <div className="text-2xl font-black text-amber-600">¥172,800</div>
                <div className="text-xs text-amber-700 mt-1">売値（クライアント表示）</div>
              </div>
            </div>

            {/* Mobile middle step */}
            <div className="flex md:hidden justify-center py-2">
              <ArrowDown size={24} className="text-slate-400" weight="bold" />
            </div>

            {/* Client view */}
            <div className="mt-6 bg-green-50 rounded-xl p-4 border border-green-200 text-center">
              <div className="text-xs font-bold text-green-700 mb-1">クライアントに見える情報</div>
              <div className="text-lg font-bold text-green-800">¥172,800 のみ表示（原価非公開）</div>
            </div>
          </motion.div>

          {/* Implemented Features */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="max-w-2xl mx-auto"
          >
            <div className="grid sm:grid-cols-2 gap-3">
              {implementedFeatures.map((feature, i) => (
                <div key={i} className="flex items-start gap-3 bg-slate-50 rounded-xl px-4 py-3 border border-slate-100">
                  <CheckCircle size={18} className="text-green-600 shrink-0 mt-0.5" weight="fill" />
                  <span className="text-sm text-slate-700">{feature}</span>
                </div>
              ))}
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  )
}
