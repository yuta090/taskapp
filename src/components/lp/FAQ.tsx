'use client'

import { motion, AnimatePresence } from 'framer-motion'
import { useState } from 'react'
import { CaretDown } from '@phosphor-icons/react'
import Link from 'next/link'

const faqCategories = [
  {
    category: '導入について',
    items: [
      {
        q: '導入にどのくらいの時間がかかりますか？',
        a: 'アカウント作成から最初のプロジェクト立ち上げまで、最短5分で完了します。テンプレートを選んですぐに始められます。',
      },
      {
        q: 'Backlogから移行できますか？',
        a: 'はい。BacklogのCSVエクスポートをインポートするだけで、タスク・マイルストーンが自動で登録されます。チャットサポートで移行のお手伝いもしています。',
      },
      {
        q: '既存ツールと並行運用できますか？',
        a: 'はい。移行期間を設けて徐々に切り替えることをおすすめしています。全社のJira/Backlogを置き換える必要はなく、チーム単位で併用できます。',
      },
    ],
  },
  {
    category: 'セキュリティについて',
    items: [
      {
        q: 'データのセキュリティは大丈夫ですか？',
        a: 'TLS暗号化（通信）、AES-256暗号化（保管）、行レベルセキュリティ（RLS）により、データは厳重に保護されています。全操作の監査ログも記録しています。',
      },
      {
        q: 'SSO/SAML認証に対応していますか？',
        a: 'はい。Business以上のプランでSSO/SAML認証（Google Workspace、Azure AD、Okta等）に対応しています。',
      },
      {
        q: 'ポータルURLの安全性は？',
        a: 'トークンベースで個別発行しており、URLの推測は不可能です。表示セクションの制御も管理者側で設定できます。',
      },
    ],
  },
  {
    category: '機能について',
    items: [
      {
        q: 'BacklogやJiraもAI対応では？',
        a: 'はい、対応しています。AgentPMの違いは、AI操作がポータル・ボール・見積もりまで自動で連鎖する点です。個別のAI対応ではなく、クライアントワーク全体が繋がっている設計です。',
      },
      {
        q: 'クライアントのポータル利用に費用はかかりますか？',
        a: 'いいえ。全プランで完全無料です。招待数の制限もありません。',
      },
      {
        q: 'いつでも解約できますか？',
        a: 'はい、いつでも解約可能です。解約後も請求期間の終了まではサービスをご利用いただけます。データのエクスポートも解約前にいつでも実行できます。',
      },
    ],
  },
]

function FAQItem({ q, a, index }: { q: string; a: string; index: number }) {
  const [open, setOpen] = useState(false)
  const answerId = `faq-answer-${index}`

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      whileInView={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.03 }}
      viewport={{ once: true }}
      className="border-b border-slate-200 last:border-b-0"
    >
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between py-4 text-left gap-4 group"
        aria-expanded={open}
        aria-controls={answerId}
      >
        <span className="font-bold text-sm text-slate-800 group-hover:text-amber-600 transition-colors">
          {q}
        </span>
        <CaretDown
          size={16}
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
            <p className="pb-4 text-sm text-slate-600 leading-relaxed pr-8">
              {a}
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}

export function FAQ() {
  let globalIndex = 0

  return (
    <section id="faq" className="py-20 bg-white border-t border-slate-100">
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

        <div className="max-w-3xl mx-auto space-y-8">
          {faqCategories.map((cat) => (
            <div key={cat.category}>
              <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">{cat.category}</h3>
              <div className="bg-white rounded-2xl border border-slate-200 px-6">
                {cat.items.map((faq) => {
                  const idx = globalIndex++
                  return <FAQItem key={idx} q={faq.q} a={faq.a} index={idx} />
                })}
              </div>
            </div>
          ))}
        </div>

        <motion.div
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          className="text-center mt-8"
        >
          <Link
            href="/pricing#faq"
            className="text-sm text-amber-600 font-bold hover:text-amber-700 transition-colors"
          >
            料金プランに関するFAQはこちら →
          </Link>
        </motion.div>
      </div>
    </section>
  )
}
