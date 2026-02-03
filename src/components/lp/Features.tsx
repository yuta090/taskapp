'use client'

import { motion } from 'framer-motion'
import {
    Terminal,
    GithubLogo,
    CurrencyJpy,
    Envelope,
    FileCsv,
    ShieldCheck
} from '@phosphor-icons/react'

export function Features() {
    const features = [
        {
            icon: Terminal,
            title: "MCP対応",
            desc: "Claude / ChatGPT / Gemini から直接操作可能",
            color: "bg-indigo-100 text-indigo-600"
        },
        {
            icon: GithubLogo,
            title: "GitHub連携",
            desc: "PR・Issueを自動でタスクに紐付け",
            color: "bg-slate-100 text-slate-700"
        },
        {
            icon: CurrencyJpy,
            title: "仕様→見積もり",
            desc: "追加要件を即座に金額提示、ポータルで承認",
            color: "bg-amber-100 text-amber-600"
        },
        {
            icon: Envelope,
            title: "週次レポート",
            desc: "AIが下書き、あなたは確認して送信するだけ",
            color: "bg-blue-100 text-blue-600"
        },
        {
            icon: FileCsv,
            title: "CSV出力",
            desc: "freee等の会計ソフト、Excel、各種ツールと連携",
            color: "bg-green-100 text-green-600"
        },
        {
            icon: ShieldCheck,
            title: "監査ログ",
            desc: "誰が・いつ・何を決定したか、証跡付きで記録",
            color: "bg-purple-100 text-purple-600"
        },
    ]

    return (
        <section className="py-24 bg-slate-50 border-t border-slate-100">
            <div className="container mx-auto px-6">
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true }}
                    className="text-center mb-16"
                >
                    <h2 className="text-3xl font-bold text-slate-900 mb-4">主な機能</h2>
                    <p className="text-slate-500">開発チームの生産性を最大化する機能群</p>
                </motion.div>

                <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6 max-w-5xl mx-auto">
                    {features.map((feature, i) => (
                        <motion.div
                            key={i}
                            initial={{ opacity: 0, y: 20 }}
                            whileInView={{ opacity: 1, y: 0 }}
                            transition={{ delay: i * 0.05 }}
                            viewport={{ once: true }}
                            whileHover={{ y: -4 }}
                            className="bg-white rounded-2xl p-6 border border-slate-100 shadow-sm hover:shadow-md transition-all duration-300 cursor-default"
                        >
                            <div className={`w-12 h-12 rounded-xl ${feature.color} flex items-center justify-center mb-4`}>
                                <feature.icon size={24} weight="duotone" />
                            </div>
                            <h3 className="text-lg font-bold text-slate-800 mb-2">{feature.title}</h3>
                            <p className="text-sm text-slate-600 leading-relaxed">{feature.desc}</p>
                        </motion.div>
                    ))}
                </div>
            </div>
        </section>
    )
}
