'use client'

import { motion } from 'framer-motion'
import { User, Robot, ArrowRight } from '@phosphor-icons/react'

export function Solution() {
    const routineYourTasks = [
        { label: "AIとタスク・マイルストーンを作成", desc: "コーディングAIと会話して計画" },
        { label: "GitHubでマージ / Slack報告", desc: "開発作業はいつも通り" },
        { label: "確認して送信", desc: "週次レポートをチェック" },
    ]

    const routineAiTasks = [
        { label: "MCP経由でタスクを自動起票", desc: "いつものAIから直接タスク化" },
        { label: "進捗・ステータスを自動連携", desc: "マージでレビュー依頼、完了報告はSlackへ" },
        { label: "週次レポートを自動作成", desc: "下書きから送信まで自動化" },
    ]

    const additionalYourTasks = [
        { label: "仕様を決める", desc: "追加要件をチャットで相談" },
    ]

    const additionalAiTasks = [
        { label: "見積もりを自動生成", desc: "即座に金額化して提示" },
    ]

    return (
        <section className="py-24 bg-white relative overflow-hidden">
            <div className="container mx-auto px-6">
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true }}
                    className="text-center max-w-3xl mx-auto mb-16"
                >
                    <h2 className="text-3xl lg:text-5xl font-bold text-slate-900 mb-6 leading-[1.15]">
                        「つくる」以外は、<br />
                        <span className="text-amber-500">AIに任せる</span>仕組みです
                    </h2>
                    <p className="text-lg text-slate-600">
                        あなたは本当に必要なことだけに集中。<br />
                        管理・報告・調整はTaskAppとAIが引き受けます。
                    </p>
                </motion.div>

                {/* Comparison Grid */}
                <div className="max-w-6xl mx-auto">
                    <div className="grid md:grid-cols-2 gap-8 lg:gap-16 relative">

                        {/* Center Icon (Floating Badge) - Desktop Only */}
                        <div className="hidden md:flex absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-20">
                            <div className="bg-white p-3 rounded-full shadow-xl border border-slate-100 text-slate-300">
                                <ArrowRight size={24} weight="bold" />
                            </div>
                        </div>

                        {/* Your Tasks (Human) */}
                        <motion.div
                            initial={{ opacity: 0, x: -30 }}
                            whileInView={{ opacity: 1, x: 0 }}
                            viewport={{ once: true }}
                            className="relative h-full"
                        >
                            <div className="h-full bg-white rounded-[2rem] p-8 lg:p-10 shadow-lg shadow-slate-200/50 border border-slate-100 relative overflow-hidden group hover:shadow-xl transition-shadow duration-300">
                                <div className="absolute top-0 left-0 w-full h-2 bg-slate-200"></div>

                                <div className="flex items-center gap-4 mb-8">
                                    <div className="w-14 h-14 rounded-2xl bg-slate-100 text-slate-600 flex items-center justify-center shadow-inner">
                                        <User size={28} weight="fill" />
                                    </div>
                                    <div>
                                        <h3 className="text-2xl font-bold text-slate-800">あなたがやること</h3>
                                        <p className="text-slate-500 font-medium">シンプルに、本質だけ</p>
                                    </div>
                                </div>

                                {/* Routine Tasks */}
                                <ul className="space-y-6 mb-8">
                                    {routineYourTasks.map((task, i) => (
                                        <motion.li
                                            key={i}
                                            initial={{ opacity: 0, y: 10 }}
                                            whileInView={{ opacity: 1, y: 0 }}
                                            transition={{ delay: i * 0.1 }}
                                            viewport={{ once: true }}
                                            className="flex items-start gap-4 p-4 rounded-xl hover:bg-slate-50 transition-colors duration-200"
                                        >
                                            <span className="w-8 h-8 rounded-full bg-slate-100 text-slate-500 flex items-center justify-center text-sm font-bold flex-shrink-0 mt-0.5 shadow-sm border border-slate-200">
                                                {i + 1}
                                            </span>
                                            <div>
                                                <div className="font-bold text-slate-800 text-lg mb-1">{task.label}</div>
                                                <div className="text-sm text-slate-500 leading-relaxed">{task.desc}</div>
                                            </div>
                                        </motion.li>
                                    ))}
                                </ul>

                                {/* Additional Tasks Header */}
                                <div className="relative py-2 px-4 mb-4 bg-amber-50 rounded-lg border border-amber-100">
                                    <span className="text-sm font-bold text-amber-800 flex items-center gap-2">
                                        <div className="w-1.5 h-1.5 rounded-full bg-amber-500"></div>
                                        追加開発・変更も
                                    </span>
                                </div>

                                <ul className="space-y-6">
                                    {additionalYourTasks.map((task, i) => (
                                        <motion.li
                                            key={`add-${i}`}
                                            initial={{ opacity: 0, y: 10 }}
                                            whileInView={{ opacity: 1, y: 0 }}
                                            transition={{ delay: 0.3 + i * 0.1 }}
                                            viewport={{ once: true }}
                                            className="flex items-start gap-4 p-4 rounded-xl hover:bg-slate-50 transition-colors duration-200"
                                        >
                                            <span className="w-8 h-8 rounded-full bg-amber-100 text-amber-600 flex items-center justify-center text-sm font-bold flex-shrink-0 mt-0.5 shadow-sm border border-amber-200">
                                                +
                                            </span>
                                            <div>
                                                <div className="font-bold text-slate-800 text-lg mb-1">{task.label}</div>
                                                <div className="text-sm text-slate-500 leading-relaxed">{task.desc}</div>
                                            </div>
                                        </motion.li>
                                    ))}
                                </ul>
                            </div>
                        </motion.div>

                        {/* AI Tasks (Machine) */}
                        <motion.div
                            initial={{ opacity: 0, x: 30 }}
                            whileInView={{ opacity: 1, x: 0 }}
                            viewport={{ once: true }}
                            className="relative h-full"
                        >
                            {/* Glow Effect */}
                            <div className="absolute -inset-0.5 bg-gradient-to-br from-amber-300 to-orange-400 rounded-[2rem] opacity-30 blur-lg dark:opacity-40"></div>

                            <div className="h-full relative bg-white/80 backdrop-blur-sm rounded-[2rem] p-8 lg:p-10 border border-amber-100 shadow-2xl shadow-amber-500/10 group hover:shadow-orange-500/20 transition-all duration-300">
                                <div className="absolute top-0 left-0 w-full h-2 bg-gradient-to-r from-amber-400 to-orange-500"></div>

                                <div className="flex items-center gap-4 mb-8">
                                    <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-amber-100 to-orange-100 text-amber-600 flex items-center justify-center shadow-inner border border-amber-50">
                                        <Robot size={28} weight="fill" />
                                    </div>
                                    <div>
                                        <h3 className="text-2xl font-bold text-slate-900">TaskApp + AI</h3>
                                        <p className="text-amber-600 font-bold">自動化で手間ゼロ</p>
                                    </div>
                                </div>

                                {/* Routine Tasks */}
                                <ul className="space-y-6 mb-8">
                                    {routineAiTasks.map((task, i) => (
                                        <motion.li
                                            key={i}
                                            initial={{ opacity: 0, y: 10 }}
                                            whileInView={{ opacity: 1, y: 0 }}
                                            transition={{ delay: i * 0.1 + 0.2 }}
                                            viewport={{ once: true }}
                                            className="flex items-start gap-4 p-4 rounded-xl bg-gradient-to-r from-amber-50/50 to-transparent border border-amber-50/50 hover:border-amber-100 transition-colors duration-200"
                                        >
                                            <div className="w-8 h-8 rounded-full bg-amber-100 text-amber-600 flex items-center justify-center text-sm font-bold flex-shrink-0 mt-0.5 shadow-sm border border-amber-200">
                                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                                                </svg>
                                            </div>
                                            <div>
                                                <div className="font-bold text-slate-900 text-lg mb-1">{task.label}</div>
                                                <div className="text-sm text-slate-600 leading-relaxed opacity-90">{task.desc}</div>
                                            </div>
                                        </motion.li>
                                    ))}
                                </ul>

                                {/* Additional Tasks Header */}
                                <div className="relative py-2 px-4 mb-4 bg-amber-100 rounded-lg border border-amber-200/50">
                                    <span className="text-sm font-bold text-amber-800 flex items-center gap-2">
                                        <div className="w-1.5 h-1.5 rounded-full bg-amber-600"></div>
                                        追加開発・変更も
                                    </span>
                                </div>

                                <ul className="space-y-6">
                                    {additionalAiTasks.map((task, i) => (
                                        <motion.li
                                            key={`add-${i}`}
                                            initial={{ opacity: 0, y: 10 }}
                                            whileInView={{ opacity: 1, y: 0 }}
                                            transition={{ delay: 0.3 + i * 0.1 + 0.2 }}
                                            viewport={{ once: true }}
                                            className="flex items-start gap-4 p-4 rounded-xl bg-gradient-to-r from-amber-50/50 to-transparent border border-amber-50/50 hover:border-amber-100 transition-colors duration-200"
                                        >
                                            <div className="w-8 h-8 rounded-full bg-amber-100 text-amber-600 flex items-center justify-center text-sm font-bold flex-shrink-0 mt-0.5 shadow-sm border border-amber-200">
                                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                                                </svg>
                                            </div>
                                            <div>
                                                <div className="font-bold text-slate-900 text-lg mb-1">{task.label}</div>
                                                <div className="text-sm text-slate-600 leading-relaxed opacity-90">{task.desc}</div>
                                            </div>
                                        </motion.li>
                                    ))}
                                </ul>
                            </div>
                        </motion.div>
                    </div>
                </div>

                {/* Image Placeholder */}

            </div>
        </section>
    )
}
