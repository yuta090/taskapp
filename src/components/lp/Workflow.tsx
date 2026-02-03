'use client'

import { motion } from 'framer-motion'
import { ArrowRight } from '@phosphor-icons/react'

export function Workflow() {
    const steps = [
        { num: "01", title: "AI起案", desc: "チャットや仕様書からタスク自動生成" },
        { num: "02", title: "見積", desc: "仕様変更に伴う追加費用を即座に提示" },
        { num: "03", title: "承認", desc: "クライアントはポータルでワンクリック承認" },
        { num: "04", title: "実装", desc: "開発に集中。完了報告も自動化" }
    ]

    return (
        <section className="py-24 bg-white border-t border-slate-100">
            <div className="container mx-auto px-6">
                <div className="text-center mb-16">
                    <h2 className="text-3xl font-bold text-slate-900">ベストプラクティスを組み込んだワークフロー</h2>
                    <p className="text-slate-500 mt-4">迷わない。止まらない。スムーズなアウトプット。</p>
                    <div className="mt-12 max-w-3xl mx-auto">
                        <img src="/img/lp/feature_workflow_iso.png" alt="Workflow Pipeline" className="w-full h-auto object-contain" />
                    </div>
                </div>

                <div className="grid md:grid-cols-4 gap-4">
                    {steps.map((step, i) => (
                        <motion.div
                            key={i}
                            initial={{ opacity: 0, y: 20 }}
                            whileInView={{ opacity: 1, y: 0 }}
                            transition={{ delay: i * 0.1 }}
                            className="relative group cursor-default"
                        >
                            <div className="bg-slate-50 border border-slate-100 p-6 rounded-2xl h-full transition-all duration-300 group-hover:bg-amber-50 group-hover:border-amber-100 group-hover:-translate-y-1 group-hover:shadow-lg relative overflow-hidden">
                                {/* Decor Number */}
                                <div className="absolute -right-4 -bottom-4 text-9xl font-black text-slate-200/50 group-hover:text-amber-200/50 transition-colors select-none pointer-events-none z-0">
                                    {step.num}
                                </div>
                                <div className="relative z-10">
                                    <div className="text-4xl font-black text-slate-200 mb-4 group-hover:text-amber-500 transition-colors">{step.num}</div>
                                    <h3 className="text-lg font-bold text-slate-800 mb-2">{step.title}</h3>
                                    <p className="text-sm text-slate-600">{step.desc}</p>
                                </div>
                            </div>

                            {/* Connector Arrow (Except last) */}
                            {i !== steps.length - 1 && (
                                <div className="hidden md:block absolute top-1/2 -right-6 -translate-y-1/2 z-10 text-slate-300">
                                    <ArrowRight size={24} weight="bold" />
                                </div>
                            )}
                        </motion.div>
                    ))}
                </div>
            </div>
        </section>
    )
}
