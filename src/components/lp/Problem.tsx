'use client'

import { motion } from 'framer-motion'
import Image from 'next/image'
import { Clock, ChatCircleDots, Calculator } from '@phosphor-icons/react'

function ProblemCard({ icon: Icon, title, desc, delay, rotation, baloon }: any) {
    return (
        <motion.div
            initial={{ opacity: 0, y: 50, rotate: rotation }}
            whileInView={{ opacity: 1, y: 0, rotate: rotation }}
            whileHover={{ y: -10, rotate: 0, scale: 1.05, zIndex: 10 }}
            viewport={{ once: true, margin: "-100px" }}
            transition={{ duration: 0.5, delay: delay, type: "spring", stiffness: 100 }}
            className="bg-white p-8 rounded-3xl shadow-xl border-2 border-slate-100 flex flex-col items-start gap-4 relative group overflow-hidden"
        >
            {/* Baloon Gimmick */}
            {baloon && (
                <motion.div
                    initial={{ opacity: 0, scale: 0 }}
                    whileInView={{ opacity: 1, scale: 1 }}
                    transition={{ delay: delay + 0.5, type: "spring" }}
                    className="absolute -top-10 -right-4 bg-slate-800 text-white text-xs font-bold px-4 py-2 rounded-xl rounded-bl-none shadow-lg z-20 whitespace-nowrap"
                >
                    {baloon}
                </motion.div>
            )}

            {/* Background Texture Icon */}
            <div className="absolute -right-8 -bottom-8 text-slate-100/50 transform rotate-12 group-hover:rotate-0 transition-transform duration-500 pointer-events-none select-none">
                <Icon size={200} weight="fill" />
            </div>

            <div className="relative z-10">
                <div className="w-14 h-14 rounded-2xl bg-rose-50 text-rose-500 flex items-center justify-center text-3xl mb-2 group-hover:bg-rose-500 group-hover:text-white transition-colors duration-300">
                    <Icon weight="duotone" />
                </div>
                <h3 className="text-xl font-bold text-slate-800">{title}</h3>
                <p className="text-slate-600 leading-relaxed">{desc}</p>
            </div>
        </motion.div>
    )
}

import { TornPaperSeparator, PixelSeparator } from './Separators'

export function Problem() {
    return (
        <section className="py-32 bg-slate-50 relative overflow-hidden">
            <TornPaperSeparator position="top" color="fill-white" />

            {/* Background Patterns */}
            <div className="absolute top-0 left-0 w-full h-20 bg-gradient-to-b from-slate-50 to-transparent z-10"></div>

            {/* Content ... */}
            <div className="container mx-auto px-6 relative z-10">
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true }}
                    className="text-center max-w-2xl mx-auto mb-20 relative"
                >
                    <h2 className="text-3xl lg:text-5xl font-bold text-slate-900 mb-6 leading-[1.15]">
                        「つくる時間」より、<br />
                        <span className="text-rose-500">調整する時間</span>の方が長くないですか？
                    </h2>
                    <p className="text-lg text-slate-600">
                        プロジェクトを進める人は、常に3つの役割を同時にこなしています。<br />
                        その結果、一番大事な「つくる」が犠牲になっています。
                    </p>
                </motion.div>

                <div className="grid lg:grid-cols-2 gap-12 items-center mb-20">
                    <motion.div
                        initial={{ opacity: 0, scale: 0.9 }}
                        whileInView={{ opacity: 1, scale: 1 }}
                        transition={{ delay: 0.2 }}
                        viewport={{ once: true }}
                        className="relative order-2 lg:order-1"
                    >
                        <div className="relative z-10 bg-white rounded-3xl overflow-hidden shadow-sm border border-slate-100 p-8 transform rotate-3 hover:rotate-0 transition-transform duration-500">
                            <Image
                                src="/img/lp/pain_double_management.png"
                                alt="Overwhelmed by tools: Excel, PowerPoint, and Task Apps"
                                width={448}
                                height={336}
                                className="w-full h-auto max-w-md mx-auto object-contain"
                            />
                        </div>
                        <div className="absolute inset-0 bg-rose-100 rounded-3xl transform -rotate-3 scale-105 -z-10"></div>
                    </motion.div>

                    <div className="grid gap-6 order-1 lg:order-2">
                        <ProblemCard
                            icon={Calculator}
                            title="進捗の二重管理"
                            desc="顧客用はExcel、内部用はLinear。PMはただ情報を書き写すだけの「転記ロボット」になり、本来のマネジメント業務が疎かになっています。"
                            delay={0}
                            rotation={0}
                            baloon="また転記作業...！？"
                        />
                        <ProblemCard
                            icon={ChatCircleDots}
                            title="終わらないチャット"
                            desc="集中して実装している最中に飛んでくる「あの件どうなった？」の通知。思考が分断され、復帰に数十分かかる。"
                            delay={0.2}
                            rotation={0}
                            baloon="進捗どうですか...？"
                        />
                        <ProblemCard
                            icon={Clock}
                            title="マルチタスクの限界"
                            desc="5つの案件を並行しながら、「どのクライアントに何を返信待ちか」を脳内で管理し続けるストレス。"
                            delay={0.4}
                            rotation={0}
                            baloon="人手が足りない..."
                        />
                    </div>
                </div>
            </div>

            <PixelSeparator position="bottom" color="fill-white" />
        </section >
    )
}
