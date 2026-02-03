'use client'

import { motion, AnimatePresence } from 'framer-motion'
import { useEffect, useRef, useState } from 'react'
import { TerminalWindow, Cpu, User, CheckCircle, Code, PaperPlaneTilt, ChatCircleDots } from '@phosphor-icons/react'

type Message = {
    id: string
    role: 'user' | 'assistant' | 'system'
    content: React.ReactNode
    type?: 'text' | 'tool_log'
}

export function FeatureTerminal() {
    const [messages, setMessages] = useState<Message[]>([])
    const [isTyping, setIsTyping] = useState(false)
    const scrollRef = useRef<HTMLDivElement>(null)

    const scenario = [
        // Scene 1: Requirement Analysis
        {
            role: 'user',
            delay: 1000,
            content: "auth_v2.md を読んで、ログイン機能の実装タスクを分割して。\n実装予定の日程も出して。",
        },
        {
            role: 'system',
            type: 'tool_log',
            delay: 1000,
            content: (
                <div className="flex flex-col gap-1">
                    <div className="flex items-center gap-2 text-indigo-300">
                        <Cpu size={14} className="animate-pulse" />
                        <span>Reading: auth_v2.md...</span>
                    </div>
                </div>
            )
        },
        {
            role: 'assistant',
            delay: 1500,
            content: (
                <div>
                    要件定義書に基づき、以下の4タスクに分割しました（合計16h）：
                    <ul className="mt-2 space-y-1 text-xs text-slate-300 pl-4 list-disc marker:text-indigo-500">
                        <li>DBスキーマ設計 (2h) → 2/10</li>
                        <li>認証API実装 (6h) → 2/11</li>
                        <li>ログイン画面UI実装 (5h) → 2/12</li>
                        <li>結合テスト (3h) → 2/13</li>
                    </ul>
                </div>
            )
        },
        // Scene 2 & 3: Estimate & Registration
        {
            role: 'user',
            delay: 2000,
            content: "OK。単価1万円で概算見積もりを作成して。\nあとTaskAppに私を担当者で登録。マイルストーンは「ログイン機能レビュー」。",
        },
        {
            role: 'system',
            type: 'tool_log',
            delay: 1000,
            content: (
                <div className="space-y-2">
                    <div className="flex items-center gap-2 text-amber-300">
                        <Code size={14} />
                        <span>Running: bulk_create_task</span>
                    </div>
                    <div className="pl-5 text-slate-500 text-[10px] font-mono border-l-2 border-slate-700">
                        <div>--assign @me</div>
                        <div>--milestone "Login Review"</div>
                        <div>--rate 10000</div>
                    </div>
                </div>
            )
        },
        {
            role: 'assistant',
            delay: 1500,
            content: (
                <div>
                    <div className="flex items-center gap-2 text-green-400 font-bold mb-2">
                        <CheckCircle size={16} weight="fill" />
                        <span>完了しました</span>
                    </div>
                    <p>4件のタスクを登録し、マイルストーンを設定しました。</p>
                    <div className="mt-3 bg-slate-800 p-3 rounded-lg border border-slate-700">
                        <div className="flex justify-between items-center mb-1">
                            <span className="text-slate-400">概算見積もり</span>
                            <span className="text-xl font-bold text-amber-400">¥160,000</span>
                        </div>
                        <div className="text-xs text-slate-500">担当者: @User (Me)</div>
                    </div>
                </div>
            )
        },
        // Scene 4: Slack Notification
        {
            role: 'user',
            delay: 2000,
            content: "#ABC社様のチャンネルに見積もり完了依頼のメッセージを送って。",
        },
        {
            role: 'system',
            type: 'tool_log',
            delay: 1000,
            content: (
                <div className="space-y-2">
                    <div className="flex items-center gap-2 text-purple-300">
                        <ChatCircleDots size={14} />
                        <span>Running: send_chat_message</span>
                    </div>
                    <div className="pl-5 text-slate-500 text-[10px] font-mono border-l-2 border-slate-700">
                        <div>--channel "#ABC社様"</div>
                        <div>--text "お世話になっております。見積もりが完了しました..."</div>
                    </div>
                </div>
            )
        },
        {
            role: 'assistant',
            delay: 1500,
            content: (
                <div>
                    <div className="flex items-center gap-2 text-green-400 font-bold mb-2">
                        <PaperPlaneTilt size={16} weight="fill" />
                        <span>送信完了</span>
                    </div>
                    Slackチャンネル <span className="text-indigo-300 font-mono bg-indigo-500/10 px-1 rounded">#ABC社様</span> にメッセージを送信しました。
                </div>
            )
        }
    ]

    useEffect(() => {
        let currentIndex = 0
        let mounted = true

        const runScenario = async () => {
            while (mounted && currentIndex < scenario.length) {
                const step = scenario[currentIndex]

                // User message appears immediately after previous step's delay
                if (step.role === 'user') {
                    await new Promise(r => setTimeout(r, step.delay))
                } else {
                    // Show typing indicator for assistant
                    setIsTyping(true)
                    await new Promise(r => setTimeout(r, step.delay))
                    setIsTyping(false)
                }

                if (!mounted) break

                setMessages(prev => [...prev, {
                    id: Math.random().toString(36),
                    role: step.role as any,
                    content: step.content,
                    type: step.type as any
                }])

                currentIndex++
            }
        }

        runScenario()

        return () => { mounted = false }
    }, [])

    // Auto scroll
    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight
        }
    }, [messages, isTyping])

    return (
        <section className="py-32 bg-white overflow-hidden relative">
            <div className="container mx-auto px-6">
                <div className="grid lg:grid-cols-2 gap-16 items-center">
                    {/* Text Side - Unchanged */}
                    <motion.div
                        initial={{ opacity: 0, x: -50 }}
                        whileInView={{ opacity: 1, x: 0 }}
                        viewport={{ once: true }}
                        className="order-2 lg:order-1"
                    >
                        <div className="text-amber-500 font-bold tracking-wider uppercase mb-4 text-sm">Feature 01</div>
                        <h2 className="text-4xl lg:text-5xl font-bold text-slate-900 mb-6 leading-[1.15]">
                            AIで、<br />コマンド一つで操作。
                        </h2>
                        <p className="text-lg text-slate-600 mb-8 leading-relaxed">
                            Claude、ChatGPT、Gemini——普段使っているAIやターミナルがプロジェクト管理ツールになります。
                            管理画面を開くためにブラウザを行ったり来たりする必要はもうありません。
                        </p>
                        <ul className="space-y-4">
                            {['自然言語でタスク作成', '進捗の自動更新', 'CLIからワンコマンドで操作'].map((item, i) => (
                                <motion.li
                                    key={i}
                                    initial={{ opacity: 0, x: -20 }}
                                    whileInView={{ opacity: 1, x: 0 }}
                                    transition={{ delay: 0.2 + (i * 0.1) }}
                                    className="flex items-center gap-3 text-slate-700 font-medium"
                                >
                                    <span className="w-6 h-6 rounded-full bg-green-100 text-green-600 flex items-center justify-center text-sm">✓</span>
                                    {item}
                                </motion.li>
                            ))}
                        </ul>
                    </motion.div>

                    {/* Visual Side (Animated Chat) */}
                    <motion.div
                        initial={{ opacity: 0, scale: 0.95 }}
                        whileInView={{ opacity: 1, scale: 1 }}
                        viewport={{ once: true }}
                        className="order-1 lg:order-2"
                    >
                        <div className="relative z-10 bg-[#1e1e2e] rounded-2xl shadow-2xl overflow-hidden border border-slate-700/50 font-sans h-[500px] flex flex-col">
                            {/* Window Header */}
                            <div className="bg-[#181825] px-4 py-3 flex items-center gap-2 border-b border-white/5 shrink-0">
                                <div className="flex gap-2">
                                    <div className="w-3 h-3 rounded-full bg-[#ff5f56]" />
                                    <div className="w-3 h-3 rounded-full bg-[#ffbd2e]" />
                                    <div className="w-3 h-3 rounded-full bg-[#27c93f]" />
                                </div>
                                <div className="ml-4 flex items-center gap-2 text-xs text-slate-400 font-mono">
                                    <TerminalWindow size={14} />
                                    <span>TaskApp Agent</span>
                                </div>
                            </div>

                            {/* Chat Area */}
                            <div ref={scrollRef} className="flex-1 overflow-y-auto p-6 space-y-6 scroll-smooth">
                                <AnimatePresence initial={false}>
                                    {messages.map((msg) => (
                                        <motion.div
                                            key={msg.id}
                                            initial={{ opacity: 0, y: 20 }}
                                            animate={{ opacity: 1, y: 0 }}
                                            className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                                        >
                                            {/* Tool Log Style */}
                                            {msg.type === 'tool_log' ? (
                                                <div className="w-full max-w-[90%] bg-black/30 rounded-lg border border-indigo-500/20 p-3 text-xs font-mono text-indigo-300 ml-12">
                                                    {msg.content}
                                                </div>
                                            ) : (
                                                /* Standard Chat Style */
                                                <div className={`flex gap-3 max-w-[90%] ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
                                                    <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${msg.role === 'user' ? 'bg-slate-700' : 'bg-indigo-600'
                                                        }`}>
                                                        {msg.role === 'user' ? <User size={16} color="white" /> : <Cpu size={16} color="white" />}
                                                    </div>
                                                    <div className={`p-4 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap ${msg.role === 'user'
                                                        ? 'bg-amber-600 text-white rounded-tr-none'
                                                        : 'bg-[#313244] text-slate-200 rounded-tl-none border border-white/5 shadow-lg'
                                                        }`}>
                                                        {msg.content}
                                                    </div>
                                                </div>
                                            )}
                                        </motion.div>
                                    ))}
                                </AnimatePresence>

                                {/* Typing Indicator */}
                                {isTyping && (
                                    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex gap-3 ml-0">
                                        <div className="w-8 h-8 rounded-full bg-indigo-600 flex items-center justify-center shrink-0">
                                            <Cpu size={16} color="white" />
                                        </div>
                                        <div className="bg-[#313244] px-4 py-3 rounded-2xl rounded-tl-none border border-white/5 flex gap-1 items-center h-10">
                                            <span className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce [animation-delay:-0.3s]"></span>
                                            <span className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce [animation-delay:-0.15s]"></span>
                                            <span className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce"></span>
                                        </div>
                                    </motion.div>
                                )}
                            </div>
                        </div>

                        {/* Decorative Background Elements */}
                        <div className="absolute -top-10 -right-10 w-40 h-40 bg-amber-500 rounded-full opacity-10 blur-3xl -z-10 animate-pulse"></div>
                        <div className="absolute -bottom-10 -left-10 w-40 h-40 bg-indigo-500 rounded-full opacity-10 blur-3xl -z-10 animate-pulse delay-1000"></div>
                    </motion.div>
                </div>
            </div>
        </section>
    )
}
