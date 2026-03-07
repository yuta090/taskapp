'use client'

import { motion } from 'framer-motion'
import { ArrowRight } from '@phosphor-icons/react'
import Link from 'next/link'

const productLinks = [
    { href: '/#features', label: '機能' },
    { href: '/pricing', label: '料金プラン' },
    { href: '/contact', label: 'お問い合わせ' },
]

const legalLinks = [
    { href: '/terms', label: '利用規約' },
    { href: '/privacy', label: 'プライバシーポリシー' },
    { href: '/tokushoho', label: '特定商取引法に基づく表記' },
]

const companyLinks = [
    { href: 'https://skara.co.jp', label: '会社概要' },
]

export function LPFooter() {
    return (
        <footer className="bg-slate-950 text-white relative overflow-hidden">
            {/* Glow */}
            <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[300px] bg-amber-500/10 blur-[100px] pointer-events-none"></div>

            {/* CTA Section */}
            <div className="container mx-auto px-6 relative z-10 text-center pt-24 pb-16">
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
                        <motion.div whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
                            <Link
                                href="/signup"
                                className="px-10 py-5 bg-amber-500 text-white rounded-xl font-bold text-xl shadow-2xl shadow-amber-500/20 flex items-center justify-center gap-2"
                            >
                                無料で始める
                                <ArrowRight weight="bold" />
                            </Link>
                        </motion.div>
                    </div>
                </motion.div>
            </div>

            {/* Footer Links */}
            <div className="border-t border-slate-800">
                <div className="container mx-auto px-6 py-12">
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
                        {/* Brand */}
                        <div className="col-span-2 md:col-span-1">
                            <div className="flex items-center gap-2 mb-4">
                                <div className="w-7 h-7 bg-amber-500 rounded-md flex items-center justify-center">
                                    <span className="text-white font-bold text-xs">A</span>
                                </div>
                                <span className="font-bold text-lg">AgentPM</span>
                            </div>
                            <p className="text-sm text-slate-500 leading-relaxed">
                                AIネイティブの<br />プロジェクト管理クラウド
                            </p>
                        </div>

                        {/* Product */}
                        <div>
                            <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-4">プロダクト</h4>
                            <ul className="space-y-2.5">
                                {productLinks.map((link) => (
                                    <li key={link.href}>
                                        <Link href={link.href} className="text-sm text-slate-500 hover:text-slate-300 transition-colors">
                                            {link.label}
                                        </Link>
                                    </li>
                                ))}
                            </ul>
                        </div>

                        {/* Legal */}
                        <div>
                            <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-4">法務</h4>
                            <ul className="space-y-2.5">
                                {legalLinks.map((link) => (
                                    <li key={link.href}>
                                        <Link href={link.href} className="text-sm text-slate-500 hover:text-slate-300 transition-colors">
                                            {link.label}
                                        </Link>
                                    </li>
                                ))}
                            </ul>
                        </div>

                        {/* Company */}
                        <div>
                            <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-4">運営</h4>
                            <ul className="space-y-2.5">
                                {companyLinks.map((link) => (
                                    <li key={link.href}>
                                        <Link href={link.href} className="text-sm text-slate-500 hover:text-slate-300 transition-colors">
                                            {link.label}
                                        </Link>
                                    </li>
                                ))}
                                <li className="text-sm text-slate-500">Sorekara Inc.</li>
                            </ul>
                        </div>
                    </div>

                    {/* Bottom bar */}
                    <div className="mt-12 pt-6 border-t border-slate-800 text-center">
                        <p className="text-xs text-slate-600">
                            &copy; 2026 Sorekara Inc. All rights reserved.
                        </p>
                    </div>
                </div>
            </div>
        </footer>
    )
}
