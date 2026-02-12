'use client'

import { motion } from 'framer-motion'
import Image from 'next/image'
import { User, PaperPlaneTilt, ArrowRight, ArrowLeft, Clock, CheckCircle } from '@phosphor-icons/react'
import { SkewSeparator } from './Separators'
import { useState, useEffect } from 'react'

export function FeatureBall() {
    return (
        <section className="pt-48 pb-24 bg-slate-900 text-white relative overflow-hidden">
            <SkewSeparator position="top" color="fill-white" />

            {/* Background Pattern */}
            <div className="absolute inset-0 opacity-10" style={{ backgroundImage: 'radial-gradient(#475569 1px, transparent 1px)', backgroundSize: '32px 32px' }}></div>

            <div className="container mx-auto px-6 relative z-10">
                <div className="text-center max-w-4xl mx-auto mb-16">

                    <h2 className="text-3xl lg:text-5xl font-bold mb-6 leading-[1.15]">
                        誰の担当か、<br />
                        もう聞かなくていい。
                    </h2>
                    <p className="text-lg text-slate-400 font-medium leading-relaxed">
                        すべてのタスクは「ボール」を持っています。<br className="hidden md:block" />
                        「クライアント確認待ち」ならボールは相手に。「修正作業中」ならボールは自分に。<br className="hidden md:block" />
                        責任の所在が常に明確なため、余計な進捗確認が不要になります。
                    </p>
                </div>

                {/* Interactive Demo */}
                <div className="max-w-5xl mx-auto bg-slate-800/50 backdrop-blur-xl rounded-3xl border border-slate-700 p-8 lg:p-12 shadow-2xl relative overflow-hidden">

                    <BallAnimationDemo />

                    <div className="mt-10 pt-8 border-t border-slate-700 flex flex-col md:flex-row items-center justify-center gap-6 text-sm text-slate-400">
                        <div className="flex items-center gap-2">
                            <Clock size={16} className="text-amber-500" />
                            <span>ボール保持中のみタイマー進行</span>
                        </div>
                        <div className="hidden md:block w-1 h-1 bg-slate-600 rounded-full"></div>
                        <div className="flex items-center gap-2">
                            <CheckCircle size={16} className="text-green-500" />
                            <span>責任の所在が100%明確化</span>
                        </div>
                    </div>
                </div>
            </div>
        </section>
    )
}

function BallAnimationDemo() {
    // Start with developer having the ball
    const [ballOwner, setBallOwner] = useState<'developer' | 'client'>('developer')

    useEffect(() => {
        const timer = setInterval(() => {
            setBallOwner(prev => prev === 'developer' ? 'client' : 'developer')
        }, 3000)
        return () => clearInterval(timer)
    }, [])

    return (
        <div className="relative">
            {/* Status Bar */}
            <div className="absolute -top-8 -left-8 -right-8 h-1.5 bg-slate-700 lg:-top-12 lg:-left-12 lg:-right-12">
                <motion.div
                    className="h-full bg-amber-500 shadow-[0_0_20px_rgba(245,158,11,0.8)]"
                    initial={{ width: "50%" }}
                    animate={{ width: ballOwner === 'developer' ? "50%" : "0%" }} // Simple indicator logic
                    transition={{ duration: 0.5 }}
                />
            </div>

            <div className="grid md:grid-cols-3 gap-4 items-center relative mt-8">

                {/* Client Side (Left) */}
                <motion.div
                    className={`relative rounded-3xl p-6 border-2 transition-all duration-500 ${ballOwner === 'client'
                            ? 'bg-slate-800 border-green-500 shadow-[0_0_30px_rgba(34,197,94,0.2)] opacity-100'
                            : 'bg-slate-800/30 border-slate-700 opacity-50 grayscale'
                        }`}
                >
                    {ballOwner === 'client' && (
                        <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-green-500 text-slate-900 text-xs font-bold px-3 py-1 rounded-full whitespace-nowrap z-10">
                            ボール保持中
                        </div>
                    )}

                    <div className="flex flex-col items-center text-center">
                        <div className="w-20 h-20 mb-4 rounded-full bg-slate-700 overflow-hidden border-2 border-slate-600 relative">
                            <Image src="/img/lp/feature_ball_client.png" alt="Client" fill className="object-cover" sizes="80px" />
                        </div>
                        <div className={`font-bold text-lg mb-1 ${ballOwner === 'client' ? 'text-green-400' : 'text-slate-500'}`}>クライアント</div>
                        <div className="text-xs text-slate-500 font-mono">CLIENT</div>
                    </div>
                </motion.div>


                {/* Center Ball & Arrows */}
                <div className="flex flex-col items-center justify-center gap-6 relative h-full">

                    {/* Upper Arrow (Dev -> Client) - Fixed Position */}
                    <motion.div
                        className="flex items-center gap-2 text-xs font-mono font-bold"
                        animate={{
                            opacity: ballOwner === 'client' ? 1 : 0.2,
                            x: ballOwner === 'client' ? -10 : 0
                        }}
                    >
                        <ArrowLeft size={24} weight="bold" className="text-green-400" />
                        <span className="text-green-400">Review</span>
                    </motion.div>

                    {/* The Static Ball */}
                    <motion.div
                        className="relative w-24 h-24 flex items-center justify-center"
                        animate={{ y: [0, -5, 0] }}
                        transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
                    >
                        <div className={`absolute inset-0 rounded-full blur-xl transition-colors duration-500 ${ballOwner === 'developer' ? 'bg-amber-500/30' : 'bg-green-500/30'}`}></div>
                        <Image src="/img/lp/feature_ball.png" alt="Task Ball" fill className="object-contain drop-shadow-2xl z-10" sizes="96px" />

                        {/* Status Label on Ball */}
                        <div className={`absolute -bottom-6 whitespace-nowrap px-3 py-1 rounded-full text-xs font-bold border ${ballOwner === 'developer'
                                ? 'bg-amber-900/50 border-amber-500/50 text-amber-400'
                                : 'bg-green-900/50 border-green-500/50 text-green-400'
                            }`}>
                            {ballOwner === 'developer' ? '作業中' : '確認中'}
                        </div>
                    </motion.div>

                    {/* Lower Arrow (Client -> Dev) - Fixed Position */}
                    <motion.div
                        className="flex items-center gap-2 text-xs font-mono font-bold"
                        animate={{
                            opacity: ballOwner === 'developer' ? 1 : 0.2,
                            x: ballOwner === 'developer' ? 10 : 0
                        }}
                    >
                        <span className="text-amber-400">Fix / Task</span>
                        <ArrowRight size={24} weight="bold" className="text-amber-400" />
                    </motion.div>

                </div>


                {/* Developer Side (Right) */}
                <motion.div
                    className={`relative rounded-3xl p-6 border-2 transition-all duration-500 ${ballOwner === 'developer'
                            ? 'bg-slate-800 border-amber-500 shadow-[0_0_30px_rgba(245,158,11,0.2)] opacity-100'
                            : 'bg-slate-800/30 border-slate-700 opacity-50 grayscale'
                        }`}
                >
                    {ballOwner === 'developer' && (
                        <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-amber-500 text-slate-900 text-xs font-bold px-3 py-1 rounded-full whitespace-nowrap z-10">
                            ボール保持中
                        </div>
                    )}

                    <div className="flex flex-col items-center text-center">
                        <div className="w-32 h-20 mb-4 rounded-xl bg-slate-700 overflow-hidden border-2 border-slate-600 relative">
                            <Image src="/img/lp/scene_team_group.png" alt="Developer Team" fill className="object-cover" sizes="128px" />
                        </div>
                        <div className={`font-bold text-lg mb-1 ${ballOwner === 'developer' ? 'text-amber-400' : 'text-slate-500'}`}>開発チーム</div>
                        <div className="text-xs text-slate-500 font-mono">SPECIALISTS</div>
                    </div>
                </motion.div>

            </div>
        </div>
    )
}
