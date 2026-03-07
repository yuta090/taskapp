'use client'

import { motion, AnimatePresence } from 'framer-motion'
import { useState } from 'react'
import { CaretDown } from '@phosphor-icons/react'

const faqs = [
    {
        q: '無料トライアル期間中に課金されますか？',
        a: 'いいえ。14日間の無料トライアル中は一切課金されません。トライアル終了前にメールでお知らせしますので、継続しない場合はそのまま放置いただければ自動で終了します。',
    },
    {
        q: '導入にどのくらいの時間がかかりますか？',
        a: 'アカウント作成から最初のプロジェクト立ち上げまで、最短5分で完了します。既存のGitHubリポジトリやSlackワークスペースとの連携もワンクリックで設定できます。',
    },
    {
        q: 'データのセキュリティは大丈夫ですか？',
        a: 'すべてのデータはAES-256で暗号化して保存しています。通信はTLS 1.3で暗号化され、監査ログにより「誰が・いつ・何をしたか」をすべて記録しています。',
    },
    {
        q: '既存のプロジェクト管理ツールから移行できますか？',
        a: 'はい。CSV形式でのインポートに対応しています。また、GitHub Issues や Linear からの移行ツールも提供しています。移行に関するサポートもお気軽にご相談ください。',
    },
    {
        q: 'クライアントもアカウントが必要ですか？',
        a: 'いいえ。クライアントにはポータル専用のURLを共有するだけです。アカウント登録やアプリのインストールは一切不要で、ブラウザからすぐに確認・承認ができます。',
    },
    {
        q: 'いつでも解約できますか？',
        a: 'はい、いつでも解約可能です。解約後も請求期間の終了まではサービスをご利用いただけます。データのエクスポートも解約前にいつでも実行できます。',
    },
]

function FAQItem({ q, a, index }: { q: string; a: string; index: number }) {
    const [open, setOpen] = useState(false)
    const answerId = `faq-answer-${index}`

    return (
        <motion.div
            initial={{ opacity: 0, y: 10 }}
            whileInView={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.05 }}
            viewport={{ once: true }}
            className="border-b border-slate-200 last:border-b-0"
        >
            <button
                onClick={() => setOpen(!open)}
                className="w-full flex items-center justify-between py-5 text-left gap-4 group"
                aria-expanded={open}
                aria-controls={answerId}
            >
                <span className="font-bold text-slate-800 group-hover:text-amber-600 transition-colors">
                    {q}
                </span>
                <CaretDown
                    size={18}
                    weight="bold"
                    className={`text-slate-400 shrink-0 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
                />
            </button>
            <AnimatePresence initial={false}>
                {open && (
                    <motion.div
                        id={answerId}
                        role="region"
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2 }}
                        className="overflow-hidden"
                    >
                        <p className="pb-5 text-slate-600 leading-relaxed pr-8">
                            {a}
                        </p>
                    </motion.div>
                )}
            </AnimatePresence>
        </motion.div>
    )
}

export function FAQ() {
    return (
        <section className="py-20 bg-white border-t border-slate-100">
            <div className="container mx-auto px-6">
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true }}
                    className="text-center mb-16"
                >
                    <h2 className="text-3xl font-bold text-slate-900 mb-4">よくある質問</h2>
                    <p className="text-slate-500">ご不明な点はお気軽にお問い合わせください</p>
                </motion.div>

                <div className="max-w-3xl mx-auto bg-white rounded-2xl border border-slate-200 p-6 md:p-8">
                    {faqs.map((faq, i) => (
                        <FAQItem key={i} q={faq.q} a={faq.a} index={i} />
                    ))}
                </div>
            </div>
        </section>
    )
}
