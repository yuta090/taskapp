'use client'

import React from 'react'
import { Check, Minus } from '@phosphor-icons/react'
import { motion } from 'framer-motion'


export function FeatureComparison() {
    const features = [
        {
            category: 'AIプロジェクト管理',
            desc: 'AIがあなたの代わりに実作業を行います',
            items: [
                {
                    name: 'AIタスク生成 (MCP連携)',
                    desc: 'CursorやTerminalから直接タスクを作成・更新',
                    starter: '月50回',
                    freelance: '無制限',
                    business: '無制限'
                },
                {
                    name: 'AI週次レポート自動生成',
                    desc: '1週間の進捗を要約し、報告メールを下書き',
                    starter: '〇 (自分宛のみ)',
                    freelance: '◎ (送信まで可)',
                    business: '◎ (送信まで可)'
                },
                {
                    name: 'AI見積もり作成',
                    desc: '仕様変更に伴う追加見積もりをAIが試算',
                    starter: false,
                    freelance: '◎',
                    business: '◎'
                },
                {
                    name: 'ボールオーナーシップ機能',
                    desc: '「誰のターンか」を可視化し、催促を自動化',
                    starter: '〇',
                    freelance: '◎ (外部含む)',
                    business: '◎ (外部含む)'
                },
            ]
        },
        {
            category: 'クライアントポータル',
            desc: 'ここが最大の課金メリットです',
            items: [
                {
                    name: 'ポータルの作成',
                    desc: '進捗共有用の専用URLを発行',
                    starter: 'プレビューのみ',
                    freelance: '〇 (共有可能)',
                    business: '〇 (共有可能)'
                },
                {
                    name: 'ガントチャート共有',
                    desc: 'リアルタイムなスケジュール共有',
                    starter: false,
                    freelance: '◎',
                    business: '◎'
                },
                {
                    name: '見積もり承認フロー',
                    desc: 'ポータル上でワンクリックで発注承認完了',
                    starter: false,
                    freelance: '◎',
                    business: '◎'
                },
                {
                    name: '独自ドメイン (CNAME)',
                    desc: 'ポータルのURLを自社ドメインに',
                    starter: false,
                    freelance: '◎',
                    business: '◎'
                },
            ]
        },
        {
            category: 'チーム・組織管理',
            desc: '組織での利用に特化した機能',
            items: [
                {
                    name: 'チームメンバー数',
                    desc: 'プロジェクトに参加できる内部メンバー',
                    starter: '1人 (自分のみ)',
                    freelance: '1人 (自分のみ)',
                    business: '無制限'
                },
                {
                    name: '権限ロール設定',
                    desc: '閲覧のみ、編集可などの詳細な権限管理',
                    starter: false,
                    freelance: false,
                    business: '◎'
                },
                {
                    name: '監査ログ (Audit Logs)',
                    desc: '「誰がいつ何をしたか」の証跡保存',
                    starter: false,
                    freelance: false,
                    business: '◎'
                },
                {
                    name: '請求書払い (Invoice)',
                    desc: '月末締め翌月末払いなどの対応',
                    starter: false,
                    freelance: false,
                    business: '◎'
                },
            ]
        }
    ]

    const renderValue = (value: string | boolean) => {
        if (value === true || value === '◎') return <Check weight="bold" className="text-amber-500 mx-auto" size={20} />
        if (value === '〇') return <div className="text-amber-500 font-bold text-center">〇</div>
        if (value === false) return <Minus weight="bold" className="text-slate-200 mx-auto" size={20} />
        return <span className="text-sm font-bold text-slate-700">{value}</span>
    }

    return (
        <section className="py-24 bg-white">
            <div className="container mx-auto px-6">
                <div className="text-center mb-16">
                    <h2 className="text-3xl font-bold text-slate-900 mb-4">機能比較表</h2>
                    <p className="text-slate-500">
                        あなたの働き方に最適なプランをお選びください。<br />
                        まずはStarterプランで機能を試し、クライアントワークが発生したらFreelanceへ移行するのがおすすめです。
                    </p>
                </div>

                <div className="overflow-x-auto pb-4">
                    <table className="w-full min-w-[900px] border-collapse">
                        <thead>
                            <tr>
                                <th className="p-4 text-left w-1/3 align-bottom">
                                    <span className="text-xs text-slate-400 font-normal">機能名 / 詳細</span>
                                </th>
                                <th className="p-4 w-1/5 text-center align-bottom pb-6">
                                    <div className="text-lg font-bold text-slate-900 mb-1">Starter</div>
                                    <div className="text-xs text-slate-500 font-normal">個人・学習用</div>
                                </th>
                                <th className="p-4 w-1/5 text-center align-bottom pb-6 bg-amber-50/50 rounded-t-xl border-t-4 border-amber-500 relative">
                                    <div className="absolute -top-10 left-0 right-0 text-center">
                                        <span className="bg-amber-500 text-white text-[10px] font-bold px-2 py-1 rounded-full shadow-sm">
                                            RECOMMENDED
                                        </span>
                                    </div>
                                    <div className="text-xl font-bold text-amber-600 mb-1">Freelance</div>
                                    <div className="text-xs text-amber-700/70 font-normal">フリーランス</div>
                                </th>
                                <th className="p-4 w-1/5 text-center align-bottom pb-6">
                                    <div className="text-lg font-bold text-slate-900 mb-1">Business</div>
                                    <div className="text-xs text-slate-500 font-normal">チーム・組織</div>
                                </th>
                            </tr>
                        </thead>
                        <tbody>
                            {features.map((section) => (
                                <React.Fragment key={section.category}>
                                    <tr className="bg-slate-50/80 border-y border-slate-100">
                                        <td colSpan={1} className="p-4 pt-8 pb-3">
                                            <div className="text-sm font-bold text-slate-900">{section.category}</div>
                                            <div className="text-xs text-slate-500 mt-0.5">{section.desc}</div>
                                        </td>
                                        <td className="p-4 pt-8 pb-3 bg-slate-50/80"></td>
                                        <td className="p-4 pt-8 pb-3 bg-amber-50/30 border-x border-amber-100/50"></td>
                                        <td className="p-4 pt-8 pb-3 bg-slate-50/80"></td>
                                    </tr>
                                    {section.items.map((item, i) => (
                                        <tr key={item.name} className="border-b border-slate-100 hover:bg-slate-50/30 transition-colors group">
                                            <td className="p-4 py-5">
                                                <div className="flex flex-col">
                                                    <span className="text-sm font-medium text-slate-700 group-hover:text-slate-900 transition-colors">
                                                        {item.name}
                                                    </span>
                                                    <span className="text-xs text-slate-400 mt-1 font-normal">
                                                        {item.desc}
                                                    </span>
                                                </div>
                                            </td>
                                            <td className="p-4 py-5 text-center bg-white">
                                                {renderValue(item.starter)}
                                            </td>
                                            <td className="p-4 py-5 text-center bg-amber-50/10 border-x border-amber-100/50 relative">
                                                {/* Highlights row if it's a key feature for Freelance */}
                                                {item.freelance === '◎' && (
                                                    <div className="absolute inset-0 bg-amber-100/20 pointer-events-none mix-blend-multiply" />
                                                )}
                                                <div className="relative z-10">
                                                    {renderValue(item.freelance)}
                                                </div>
                                            </td>
                                            <td className="p-4 py-5 text-center bg-white">
                                                {renderValue(item.business)}
                                            </td>
                                        </tr>
                                    ))}
                                </React.Fragment>
                            ))}
                        </tbody>
                    </table>
                </div>

                <div className="mt-8 text-center">
                    <a href="/signup" className="inline-flex items-center gap-2 text-amber-600 font-bold hover:text-amber-700 hover:underline transition-colors">
                        すべての機能を確認する
                        <Check size={16} />
                    </a>
                </div>
            </div>
        </section>
    )
}
