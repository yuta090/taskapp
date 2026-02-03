'use client'

import { motion } from 'framer-motion'
import { Sun, SunHorizon, MoonStars } from '@phosphor-icons/react'

export function DayInLife() {
    return (
        <section className="py-32 bg-slate-900 text-white overflow-hidden relative">
            {/* Ambient Background */}
            <div className="absolute inset-0 bg-gradient-to-b from-slate-900 via-slate-800 to-slate-900 pointer-events-none"></div>

            <div className="container mx-auto px-6 relative z-10 max-w-4xl">
                <h2 className="text-4xl font-bold text-center mb-20 text-white">
                    TaskAppがある<br />
                    <span className="text-amber-500">プロジェクト担当者の1日</span>
                </h2>

                <div className="relative border-l-2 border-slate-700 ml-8 md:ml-0 md:pl-0 space-y-16">

                    {/* Morning */}
                    <motion.div
                        initial={{ opacity: 0, x: -20 }}
                        whileInView={{ opacity: 1, x: 0 }}
                        viewport={{ margin: "-100px" }}
                        className="relative md:grid md:grid-cols-[100px_1fr] md:gap-8 items-start"
                    >
                        <div className="absolute -left-[41px] md:static md:w-full md:flex md:justify-end">
                            <div className="w-20 h-20 rounded-full bg-blue-100 text-blue-500 flex items-center justify-center border-4 border-slate-900 shadow-xl">
                                <Sun size={32} weight="fill" />
                            </div>
                        </div>
                        <div className="pl-6 md:pl-0">
                            <div className="text-blue-300 font-bold mb-1">09:00 AM</div>
                            <h3 className="text-2xl font-bold mb-3">「今日のタスク教えて」</h3>
                            <p className="text-slate-400 leading-relaxed">
                                AIが昨夜のうちに、クライアントからの戻しとGitHubのIssuesを整理済み。<br />
                                あなたは優先順位順に並んだリストを確認し、一番上のタスクに取り掛かるだけ。
                            </p>
                        </div>
                    </motion.div>

                    {/* Noon */}
                    <motion.div
                        initial={{ opacity: 0, x: -20 }}
                        whileInView={{ opacity: 1, x: 0 }}
                        viewport={{ margin: "-100px" }}
                        className="relative md:grid md:grid-cols-[100px_1fr] md:gap-8 items-start"
                    >
                        <div className="absolute -left-[41px] md:static md:w-full md:flex md:justify-end">
                            <div className="w-20 h-20 rounded-full bg-orange-100 text-orange-500 flex items-center justify-center border-4 border-slate-900 shadow-xl">
                                <SunHorizon size={32} weight="fill" />
                            </div>
                        </div>
                        <div className="pl-6 md:pl-0">
                            <div className="text-orange-300 font-bold mb-1">14:00 PM</div>
                            <h3 className="text-2xl font-bold mb-3">「追加機能、見積もりお願い」</h3>
                            <p className="text-slate-400 leading-relaxed">
                                突然のチャットにも慌てない。AIが仕様書から差分を検知し、ドラフト見積もりを作成済み。<br />
                                あなたは内容を確認して、ポータルのURLを送るだけ。作業中断は30秒で済みます。
                            </p>
                        </div>
                    </motion.div>

                    {/* Evening */}
                    <motion.div
                        initial={{ opacity: 0, x: -20 }}
                        whileInView={{ opacity: 1, x: 0 }}
                        viewport={{ margin: "-100px" }}
                        className="relative md:grid md:grid-cols-[100px_1fr] md:gap-8 items-start"
                    >
                        <div className="absolute -left-[41px] md:static md:w-full md:flex md:justify-end">
                            <div className="w-20 h-20 rounded-full bg-indigo-100 text-indigo-500 flex items-center justify-center border-4 border-slate-900 shadow-xl">
                                <MoonStars size={32} weight="fill" />
                            </div>
                        </div>
                        <div className="pl-6 md:pl-0">
                            <div className="text-indigo-300 font-bold mb-1">18:00 PM</div>
                            <h3 className="text-2xl font-bold mb-3">「週次レポート作って」</h3>
                            <p className="text-slate-400 leading-relaxed">
                                帰る前の最後の仕事。これもAIが自動で作成。<br />
                                「つくる」ことに集中した、充実した一日が終わります。
                            </p>
                            <div className="mt-6 p-1 bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
                                <img src="/img/lp/scene_peaceful_evening.png" alt="Relaxing Evening" className="w-full h-auto rounded-lg" />
                            </div>
                        </div>
                    </motion.div>

                </div>
            </div>
        </section>
    )
}
