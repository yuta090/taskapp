'use client'

import { motion } from 'framer-motion'
import Image from 'next/image'
import { CheckCircle, ShieldCheck, CurrencyJpy } from '@phosphor-icons/react'

export function FeaturePortal() {
    return (
        <section className="py-32 bg-slate-50 relative overflow-hidden">
            <div className="container mx-auto px-6">
                <div className="grid lg:grid-cols-2 gap-16 items-center">
                    {/* Visual Side (Glass Cards) */}
                    <motion.div
                        initial={{ opacity: 0, x: -50 }}
                        whileInView={{ opacity: 1, x: 0 }}
                        viewport={{ once: true }}
                        className="relative h-[600px] flex items-center justify-center -ml-10 lg:ml-0"
                    >
                        {/* Background Decoration */}
                        <div className="absolute inset-0 bg-gradient-to-tr from-blue-100 to-indigo-50 rounded-full scale-90 opacity-50 blur-3xl" />

                        {/* 1. Character Image (Back Layer) */}
                        <motion.div
                            whileHover={{ scale: 1.02 }}
                            className="absolute left-0 top-10 w-3/4 max-w-sm z-0 opacity-90 grayscale-[20%]"
                        >
                            <Image
                                src="/img/lp/scene_client_relief.png"
                                alt="安心するクライアント"
                                width={384}
                                height={384}
                                className="w-full h-auto drop-shadow-xl mask-image-gradient-b-transparent"
                            />
                            {/* Client Label */}
                            <div className="absolute -left-4 top-10 bg-white px-4 py-2 rounded-full shadow-lg border border-slate-100 flex items-center gap-2">
                                <div className="w-3 h-3 rounded-full bg-green-500"></div>
                                <span className="font-bold text-slate-700 text-sm">クライアント</span>
                            </div>
                        </motion.div>

                        {/* 2. Portal UI Card (Front Layer) */}
                        <motion.div
                            initial={{ y: 40, opacity: 0 }}
                            whileInView={{ y: 0, opacity: 1 }}
                            transition={{ delay: 0.2 }}
                            className="absolute -right-4 bottom-20 w-full max-w-md bg-white/95 backdrop-blur-xl rounded-2xl shadow-2xl border border-slate-200/60 p-6 z-10 font-sans"
                        >
                            {/* Header */}
                            <div className="flex justify-between items-center mb-6 border-b border-slate-100 pb-4">
                                <div>
                                    <div className="text-xs text-slate-500 font-bold mb-1">PROJECT PORTAL</div>
                                    <div className="font-bold text-slate-800 text-lg">ECサイトリニューアル</div>
                                </div>
                                <div className="text-right">
                                    <div className="text-sm font-bold text-indigo-600">82% 完了</div>
                                    <div className="w-24 h-2 bg-slate-100 rounded-full mt-1 overflow-hidden">
                                        <div className="bg-indigo-500 w-[82%] h-full rounded-full" />
                                    </div>
                                </div>
                            </div>

                            {/* Gantt Chart Lite */}
                            <div className="space-y-4 mb-6">
                                <div className="space-y-2">
                                    <div className="flex justify-between text-sm">
                                        <span className="text-slate-600 font-medium">1. 要件定義・設計</span>
                                        <span className="text-indigo-600 text-xs bg-indigo-50 px-2 py-0.5 rounded flex items-center gap-1">✔ 完了</span>
                                    </div>
                                    <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden">
                                        <div className="bg-indigo-500/30 w-full h-full" />
                                    </div>
                                </div>

                                <div className="space-y-2 opacity-50">
                                    <div className="flex justify-between text-sm">
                                        <span className="text-slate-600 font-medium">2. デザイン制作</span>
                                        <span className="text-slate-500 text-xs bg-slate-50 px-2 py-0.5 rounded">完了</span>
                                    </div>
                                    <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden">
                                        <div className="bg-indigo-500/20 w-full h-full" />
                                    </div>
                                </div>

                                <div className="space-y-2">
                                    <div className="flex justify-between text-sm">
                                        <span className="text-slate-800 font-bold">3. フロントエンド実装</span>
                                        <span className="text-amber-600 text-xs bg-amber-50 px-2 py-0.5 rounded animate-pulse">● 進行中</span>
                                    </div>
                                    <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden flex">
                                        <div className="bg-amber-500 w-[60%] h-full rounded-full shadow-[0_0_10px_rgba(245,158,11,0.5)]" />
                                    </div>
                                    <div className="flex justify-between text-xs text-slate-400 mt-1 pl-1">
                                        <span>Authentication</span>
                                        <span>Dashboard</span>
                                        <span>Settings</span>
                                    </div>
                                </div>
                            </div>

                            {/* Action Item */}
                            <div className="bg-rose-50 border border-rose-100 rounded-xl p-4 flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <div className="bg-white p-2 rounded-lg text-rose-500 shadow-sm">
                                        <CurrencyJpy size={20} weight="bold" />
                                    </div>
                                    <div>
                                        <div className="text-xs font-bold text-rose-500 mb-0.5">承認待ちのアクション</div>
                                        <div className="text-sm font-bold text-slate-800">追加機能見積もり (¥120,000)</div>
                                    </div>
                                </div>
                                <button className="bg-rose-500 hover:bg-rose-600 text-white text-xs font-bold px-4 py-2 rounded-lg shadow-lg shadow-rose-200 transition-colors">
                                    確認する
                                </button>
                            </div>

                        </motion.div>

                        {/* Floating Badge (Approval) replaced by the UI card action, removed old one to avoid clutter */}

                    </motion.div>

                    {/* Text Side */}
                    <motion.div
                        initial={{ opacity: 0, x: 50 }}
                        whileInView={{ opacity: 1, x: 0 }}
                        viewport={{ once: true }}
                        className="order-1 lg:order-2"
                    >
                        <div className="text-amber-500 font-bold tracking-wider uppercase mb-4 text-sm">Feature 03</div>
                        <h2 className="text-4xl lg:text-5xl font-bold text-slate-900 mb-6 leading-[1.15]">
                            進捗が見える。<br />だから安心できる。
                        </h2>
                        <p className="text-lg text-slate-600 mb-8 leading-relaxed">
                            クライアントには、整理された専用画面を提供。<br />
                            現在のフェーズ、金額、スケジュールが一目でわかります。<br />
                            「今どうなってるの？」と聞かれる前に、答えが見えています。
                        </p>

                        <button className="text-amber-600 font-bold hover:text-amber-700 flex items-center gap-2 group">
                            ポータル画面のデモを見る
                            <span className="group-hover:translate-x-1 transition-transform">→</span>
                        </button>
                    </motion.div>
                </div>
            </div>
        </section>
    )
}
