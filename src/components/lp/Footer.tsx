'use client'

import { motion } from 'framer-motion'
import { ArrowRight } from '@phosphor-icons/react'

export function LPFooter() {
    return (
        <footer className="bg-slate-950 text-white py-24 relative overflow-hidden">
            {/* Glow */}
            <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[300px] bg-amber-500/10 blur-[100px] pointer-events-none"></div>

            <div className="container mx-auto px-6 relative z-10 text-center">
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true }}
                    className="max-w-3xl mx-auto"
                >
                    <h2 className="text-4xl lg:text-6xl font-black mb-8 tracking-tight leading-[1.15]">
                        「管理」のために、<br />
                        時間を使わない。
                    </h2>
                    <p className="text-xl text-slate-400 mb-12">
                        AgentPMがあれば、あなたは「つくる」ことに集中できます。<br />
                        報告も、見積もりも、進捗管理も——AIとポータルが引き受けます。
                    </p>

                    <div className="flex flex-col sm:flex-row gap-4 justify-center">
                        <motion.button
                            whileHover={{ scale: 1.05 }}
                            whileTap={{ scale: 0.95 }}
                            className="px-10 py-5 bg-amber-500 text-white rounded-xl font-bold text-xl shadow-2xl shadow-amber-500/20 flex items-center justify-center gap-2"
                        >
                            無料で始める
                            <ArrowRight weight="bold" />
                        </motion.button>
                    </div>

                    <div className="mt-12 flex flex-col items-center gap-6">
                        <div className="flex gap-6 text-sm text-slate-500">
                            <a href="/terms" className="hover:text-slate-300 transition-colors">利用規約</a>
                            <a href="/privacy" className="hover:text-slate-300 transition-colors">プライバシーポリシー</a>
                            <a href="/pricing" className="hover:text-slate-300 transition-colors">料金プラン</a>
                        </div>
                        <p className="text-sm text-slate-600">
                            © 2026 Sorekara Inc. All rights reserved.
                        </p>
                    </div>
                </motion.div>
            </div>
        </footer>
    )
}
