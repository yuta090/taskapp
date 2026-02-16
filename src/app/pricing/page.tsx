'use client'

import { LPHeader } from '@/components/lp/Header'
import { LPFooter } from '@/components/lp/Footer'
import { FeatureComparison } from '@/components/lp/FeatureComparison'
import { motion } from 'framer-motion'
import { Check, X, Sparkle, Buildings, User } from '@phosphor-icons/react'
import { useState } from 'react'
import { Metadata } from 'next'

// Client components cannot export metadata directly if they are client components.
// We should conceptually separate metadata if needed, but for now we follow the structure.
// If this file is a page, Next.js App Router allows exporting metadata from a server component wrapper,
// or we can move 'use client' down. However, for simplicity and recovery, we'll keep it as 'use client'
// and omission of metadata export in the same file if it causes issues, or assume the user handles SEO elsewhere.
// But usually page.tsx with 'use client' cannot export metadata. 
// Let's make this a client component for functionality.

export default function PricingPage() {
    const [isAnnual, setIsAnnual] = useState(true)

    const plans = [
        {
            name: 'Starter',
            price: '¥0',
            period: '/月',
            description: 'AIタスク管理の快適さを、まずは個人で体験。',
            target: '個人・学習用',
            icon: User,
            features: [
                'プロジェクト数: 1つまで',
                'AIタスク作成 (月50回まで)',
                'GitHub連携',
                'ポータル機能 (閲覧のみ共有可)',
                '週次レポート作成 (自分宛のみ)',
            ],
            notIncluded: [
                'クライアントによる承認・コメント',
                '見積もり・請求書作成',
                'Slack通知連携',
            ],
            cta: '無料で始める',
            primary: false,
        },
        {
            name: 'Freelance',
            price: isAnnual ? '¥2,480' : '¥2,980',
            period: '/月',
            description: 'クライアントワークの「調整業務」を全自動化。',
            target: 'フリーランス・個人事業主',
            icon: Sparkle,
            features: [
                'プロジェクト数: 無制限',
                'AIタスク作成 (無制限)',
                'クライアントポータル (共有・承認)',
                '見積もり・請求書の発行',
                'Slackでの進捗報告・通知',
                '独自ドメイン設定',
            ],
            notIncluded: [
                'チームメンバー管理',
                'SSO (シングルサインオン)',
            ],
            cta: '14日間無料トライアル',
            primary: true,
            tag: '迷ったらこれ',
            subText: isAnnual ? '年払いで年間 ¥6,000 お得' : '月々更新'
        },
        {
            name: 'Business',
            price: '¥1,980',
            period: '/ユーザー/月',
            description: '組織のプロジェクト管理を、AIで標準化。',
            target: '制作会社・開発チーム',
            icon: Buildings,
            features: [
                'すべて無制限',
                'チームメンバー管理・権限設定',
                'プロジェクト横断ダッシュボード',
                '監査ログ・セキュリティ設定',
                '優先サポートデスク',
                '専任の導入支援',
            ],
            notIncluded: [],
            cta: 'チームを作成 (3名〜)',
            primary: false,
            subText: '最低3ユーザーから利用可能'
        },
    ]

    return (
        <main className="font-sans antialiased text-slate-900 bg-slate-50 min-h-screen">
            <LPHeader />

            <div className="pt-32 pb-20">
                <div className="container mx-auto px-6">
                    <div className="text-center max-w-3xl mx-auto mb-16">
                        <motion.div
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            className="inline-block px-3 py-1 mb-4 text-xs font-bold tracking-wider text-amber-600 uppercase bg-amber-100 rounded-full"
                        >
                            Pricing Plans
                        </motion.div>
                        <motion.h1
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: 0.1 }}
                            className="text-4xl lg:text-5xl font-bold mb-6 text-slate-900"
                        >
                            あなたの「時間」を買う価格。
                        </motion.h1>
                        <motion.p
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: 0.2 }}
                            className="text-xl text-slate-600 mb-8"
                        >
                            月額2,480円で、優秀なPMアシスタントを雇えます。<br />
                            報告や調整に使っていた時間を、本来の「つくる」時間へ。
                        </motion.p>

                        {/* Toggle */}
                        <div className="inline-flex items-center bg-white p-1 rounded-xl border border-slate-200 shadow-sm relative mb-8">
                            <button
                                onClick={() => setIsAnnual(false)}
                                className={`px-4 py-2 rounded-lg text-sm font-bold transition-all relative z-10 ${!isAnnual ? 'text-slate-900 shadow-sm bg-white ring-1 ring-slate-200' : 'text-slate-500 hover:text-slate-700'}`}
                            >
                                月払い
                            </button>
                            <button
                                onClick={() => setIsAnnual(true)}
                                className={`px-4 py-2 rounded-lg text-sm font-bold transition-all relative z-10 ${isAnnual ? 'text-slate-900 shadow-sm bg-white ring-1 ring-slate-200' : 'text-slate-500 hover:text-slate-700'}`}
                            >
                                年払い <span className="text-amber-600 text-xs ml-1">-20%</span>
                            </button>
                        </div>
                    </div>

                    <div className="grid md:grid-cols-3 gap-8 max-w-6xl mx-auto items-start">
                        {plans.map((plan, index) => (
                            <motion.div
                                key={plan.name}
                                initial={{ opacity: 0, y: 20 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ delay: index * 0.1 + 0.3 }}
                                className={`relative bg-white rounded-2xl shadow-xl overflow-hidden border transition-all duration-300 ${plan.primary
                                    ? 'border-amber-500 ring-4 ring-amber-500/20 scale-105 z-10'
                                    : 'border-slate-200 hover:border-amber-200'
                                    }`}
                            >
                                {plan.primary && (
                                    <div className="absolute top-0 inset-x-0 h-1.5 bg-gradient-to-r from-amber-400 to-orange-500" />
                                )}
                                {plan.tag && (
                                    <div className="absolute top-4 right-4 bg-amber-100 text-amber-700 text-xs font-bold px-3 py-1 rounded-full">
                                        {plan.tag}
                                    </div>
                                )}

                                <div className="p-8">
                                    <div className="flex items-center gap-3 mb-4">
                                        <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${plan.primary ? 'bg-amber-500 text-white' : 'bg-slate-100 text-slate-600'
                                            }`}>
                                            <plan.icon size={20} weight="fill" />
                                        </div>
                                        <div>
                                            <h3 className="text-lg font-bold text-slate-900">{plan.name}</h3>
                                            <p className="text-xs text-slate-500 font-medium">{plan.target}</p>
                                        </div>
                                    </div>

                                    <div className="flex items-baseline gap-1 mb-2">
                                        <span className="text-4xl font-bold text-slate-900">{plan.price}</span>
                                        {plan.period && <span className="text-slate-500 font-medium text-sm">{plan.period}</span>}
                                    </div>
                                    <p className="text-xs text-amber-600 font-medium h-4 mb-4">
                                        {plan.subText || ''}
                                    </p>

                                    <p className="text-slate-600 mb-8 text-sm leading-relaxed h-10">
                                        {plan.description}
                                    </p>

                                    <button
                                        className={`w-full py-3 px-6 rounded-lg font-bold transition-all ${plan.primary
                                            ? 'bg-amber-500 text-white hover:bg-amber-600 shadow-lg shadow-amber-500/30 hover:shadow-amber-500/40 transform hover:-translate-y-0.5'
                                            : 'bg-slate-100 text-slate-900 hover:bg-slate-200'
                                            }`}
                                    >
                                        {plan.cta}
                                    </button>
                                </div>

                                <div className="p-8 bg-slate-50 border-t border-slate-100 h-full">
                                    <ul className="space-y-4 mb-4">
                                        {plan.features.map((feature) => (
                                            <li key={feature} className="flex items-start gap-3 text-sm text-slate-700 font-medium">
                                                <Check weight="bold" className="text-amber-500 shrink-0 mt-0.5" />
                                                <span>{feature}</span>
                                            </li>
                                        ))}
                                    </ul>
                                    {plan.notIncluded.length > 0 && (
                                        <div className="pt-4 border-t border-slate-200/50">
                                            <ul className="space-y-3">
                                                {plan.notIncluded.map((feature) => (
                                                    <li key={feature} className="flex items-start gap-3 text-sm text-slate-400">
                                                        <X weight="bold" className="shrink-0 mt-0.5" />
                                                        <span>{feature}</span>
                                                    </li>
                                                ))}
                                            </ul>
                                        </div>
                                    )}
                                </div>
                            </motion.div>
                        ))}
                    </div>

                    <div className="mt-12 text-center">
                        <p className="text-slate-500 text-sm mb-2">
                            ※ 年払いプランなら2ヶ月分お得になります。
                        </p>
                    </div>
                </div>
            </div>

            <FeatureComparison />

            <LPFooter />
        </main>
    )
}
