'use client'

import { motion } from 'framer-motion'
import { Check, X, Info } from '@phosphor-icons/react'

const comparisonData = [
    {
        category: "基本機能",
        items: [
            { name: "プロジェクト数", starter: "1つ", freelance: "無制限", business: "無制限" },
            { name: "タスク数", starter: "無制限", freelance: "無制限", business: "無制限" },
            { name: "ストレージ容量", starter: "1GB", freelance: "100GB", business: "1TB~" },
        ]
    },
    {
        category: "クライアントワーク",
        items: [
            { name: "ゲスト招待 (クライアント)", starter: "-", freelance: "無制限 (無料)", business: "無制限 (無料)" },
            { name: "クライアントポータル", starter: "プレビューのみ", freelance: "共有・承認・コメント", business: "高機能版 (カスタム可)" },
            { name: "見積もり・請求書作成", starter: "-", freelance: "利用可能", business: "利用可能" },
            { name: "Slack / Chatwork 通知", starter: "-", freelance: "各社チャンネル連携", business: "各社チャンネル連携" },
            { name: "独自ドメイン", starter: "-", freelance: "利用可能", business: "利用可能" },
        ]
    },
    {
        category: "AI & 自動化",
        items: [
            { name: "使用AIモデル", starter: "Standard", freelance: "Claude 3.5 Sonnet", business: "Claude 3.5 Sonnet" },
            { name: "AIタスク作成", starter: "月50回", freelance: "無制限", business: "無制限" },
            { name: "週次レポート自動生成", starter: "自分宛のみ", freelance: "あり", business: "あり (チーム集計可)" },
            { name: "AIへのコンテクスト付与", starter: "限定的", freelance: "プロジェクト全体", business: "組織全体" },
        ]
    },
    {
        category: "管理 & サポート",
        items: [
            { name: "チームメンバー管理", starter: "-", freelance: "-", business: "利用可能" },
            { name: "SSO (シングルサインオン)", starter: "-", freelance: "-", business: "利用可能" },
            { name: "監査ログ", starter: "-", freelance: "30日", business: "無制限" },
            { name: "サポート", starter: "コミュニティ", freelance: "メール (24h以内)", business: "Priority (Slack可)" },
        ]
    }
]

export function FeatureComparison() {
    return (
        <div className="py-20 bg-white">
            <div className="container mx-auto px-6">
                <div className="max-w-5xl mx-auto bg-white rounded-3xl shadow-xl border border-slate-200 overflow-hidden">
                    <div className="p-8 md:p-12 border-b border-slate-100 bg-slate-50/30">
                        <h3 className="text-2xl font-bold text-slate-900 text-center">機能比較</h3>
                    </div>
                    <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse min-w-[600px]">
                            <thead>
                                <tr className="bg-slate-50/50">
                                    <th className="p-4 md:p-6 w-1/3 min-w-[200px]"></th>
                                    <th className="p-4 md:p-6 text-center font-bold text-slate-900 min-w-[140px]">Starter</th>
                                    <th className="p-4 md:p-6 text-center font-bold text-amber-600 min-w-[140px] bg-amber-50/30">Freelance</th>
                                    <th className="p-4 md:p-6 text-center font-bold text-slate-900 min-w-[140px]">Business</th>
                                </tr>
                            </thead>
                            <tbody>
                                {comparisonData.map((category, catIndex) => (
                                    <>
                                        <tr key={category.category} className="bg-slate-50 border-y border-slate-200/60">
                                            <td colSpan={4} className="px-6 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider">
                                                {category.category}
                                            </td>
                                        </tr>
                                        {category.items.map((item, itemIndex) => (
                                            <tr key={item.name} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/50 transition-colors">
                                                <td className="p-4 md:px-6 md:py-4 text-sm font-medium text-slate-700 flex items-center gap-2">
                                                    {item.name}
                                                    <Info size={14} className="text-slate-400 cursor-help" />
                                                </td>
                                                <td className="p-4 md:px-6 md:py-4 text-center text-sm text-slate-600">
                                                    {item.starter === '-' ? <X size={16} className="mx-auto text-slate-300" /> : item.starter}
                                                </td>
                                                <td className="p-4 md:px-6 md:py-4 text-center text-sm font-bold text-slate-900 bg-amber-50/10">
                                                    {item.freelance === '-' ? <X size={16} className="mx-auto text-slate-300" /> : item.freelance}
                                                </td>
                                                <td className="p-4 md:px-6 md:py-4 text-center text-sm text-slate-600">
                                                    {item.business === '-' ? <X size={16} className="mx-auto text-slate-300" /> : item.business}
                                                </td>
                                            </tr>
                                        ))}
                                    </>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        </div>
    )
}
