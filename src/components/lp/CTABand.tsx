'use client'

import { motion } from 'framer-motion'
import { ArrowRight } from '@phosphor-icons/react'
import Link from 'next/link'

export function CTABand() {
  return (
    <section className="py-16 bg-slate-900 text-white relative overflow-hidden">
      <div className="absolute inset-0 opacity-10" style={{ backgroundImage: 'radial-gradient(#475569 1px, transparent 1px)', backgroundSize: '32px 32px' }} />
      <div className="container mx-auto px-6 text-center relative z-10">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
        >
          <h2 className="text-2xl lg:text-3xl font-bold mb-4">
            まずは無料で試してみませんか？
          </h2>
          <p className="text-slate-400 mb-8">
            14日間無料トライアル。クレジットカード登録不要。
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link
              href="/signup"
              className="inline-flex items-center justify-center gap-2 px-8 py-4 bg-amber-500 text-white font-bold rounded-xl shadow-lg shadow-amber-500/20 hover:bg-amber-600 transition-colors"
            >
              無料で始める
              <ArrowRight weight="bold" size={16} />
            </Link>
            <Link
              href="/contact"
              className="inline-flex items-center justify-center gap-2 px-8 py-4 bg-white/10 text-white font-bold rounded-xl border border-white/20 hover:bg-white/20 transition-colors"
            >
              デモを申し込む
            </Link>
          </div>
        </motion.div>
      </div>
    </section>
  )
}
