'use client'

import { motion } from 'framer-motion'
import { Star } from '@phosphor-icons/react'

const testimonials = [
    {
        name: '田中 健太',
        role: 'CTO',
        company: '株式会社クラフトテック',
        industry: 'SaaS開発',
        quote: '報告書作成やクライアントへの進捗共有に毎週3時間以上かけていました。AgentPMを導入してからは、AIが自動で週次レポートを作成してくれるので、その時間をまるごと開発に回せています。',
        metric: '週3時間の削減',
    },
    {
        name: '鈴木 美咲',
        role: 'プロジェクトマネージャー',
        company: 'デジタルフロント合同会社',
        industry: 'Web制作',
        quote: '5案件を並行していると「あの件どうなった？」のチャットが止まらなくて。ポータルを共有してからは、クライアントが自分で確認してくれるようになり、問い合わせが激減しました。',
        metric: '問い合わせ70%減',
    },
    {
        name: '山本 大輔',
        role: 'フリーランスエンジニア',
        company: '個人事業主',
        industry: '受託開発',
        quote: '見積もりの作成と送付が一番面倒でした。今はAIに「追加機能の見積もり出して」と言うだけ。ポータルで承認まで完結するので、請求漏れもなくなりました。',
        metric: '請求漏れゼロ',
    },
]

export function Testimonials() {
    return (
        <section className="py-20 bg-slate-50 border-t border-slate-100">
            <div className="container mx-auto px-6">
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true }}
                    className="text-center mb-16"
                >
                    <span className="text-xs font-bold tracking-[0.2em] uppercase text-amber-500 mb-3 block">Voice</span>
                    <h2 className="text-3xl font-bold text-slate-900 mb-4">導入チームの声</h2>
                    <p className="text-slate-500">AgentPMを使っているチームからのフィードバック</p>
                </motion.div>

                <div className="grid md:grid-cols-3 gap-8 max-w-6xl mx-auto">
                    {testimonials.map((t, i) => (
                        <motion.div
                            key={i}
                            initial={{ opacity: 0, y: 20 }}
                            whileInView={{ opacity: 1, y: 0 }}
                            transition={{ delay: i * 0.1 }}
                            viewport={{ once: true }}
                            className="bg-slate-50 rounded-2xl p-8 border border-slate-100 flex flex-col"
                        >
                            {/* Stars */}
                            <div className="flex gap-0.5 mb-4">
                                {[...Array(5)].map((_, j) => (
                                    <Star key={j} size={16} weight="fill" className="text-amber-400" />
                                ))}
                            </div>

                            {/* Quote */}
                            <p className="text-slate-700 leading-relaxed flex-1 mb-6">
                                {t.quote}
                            </p>

                            {/* Metric badge */}
                            <div className="inline-flex self-start bg-amber-50 text-amber-700 text-xs font-bold px-3 py-1 rounded-full border border-amber-100 mb-6">
                                {t.metric}
                            </div>

                            {/* Author */}
                            <div className="border-t border-slate-200 pt-4">
                                <div className="flex items-center gap-3">
                                    <div className="w-10 h-10 rounded-full bg-slate-200 flex items-center justify-center text-slate-500 font-bold text-sm">
                                        {t.name[0]}
                                    </div>
                                    <div>
                                        <div className="font-bold text-slate-800 text-sm">{t.name}</div>
                                        <div className="text-xs text-slate-500">{t.role} / {t.company}</div>
                                    </div>
                                </div>
                            </div>
                        </motion.div>
                    ))}
                </div>
            </div>
        </section>
    )
}
