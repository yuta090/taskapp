'use client'

import { LPHeader } from '@/components/lp/Header'
import { LPFooter } from '@/components/lp/Footer'
import { CTABand } from '@/components/lp/CTABand'
import { motion } from 'framer-motion'
import { Check, ArrowRight, ShieldCheck, Lock, ClockCounterClockwise, Key, UserCircle, Database } from '@phosphor-icons/react'
import Link from 'next/link'

/* ─── Data ─── */

// 掲げてよいのは、コード・インフラで裏が取れているものだけ
const implemented = [
  {
    icon: Lock,
    title: '通信と保管の暗号化',
    body: 'ブラウザとサーバーの間はTLSで暗号化しています。保存したデータもディスク上で暗号化されています。',
  },
  {
    icon: ShieldCheck,
    title: '持ち主だけが見える仕組み',
    body: 'データベース側で「誰がどの行を読めるか」を制限しています（RLS）。画面の作り方を間違えても、他社のデータは出てきません。',
  },
  {
    icon: ClockCounterClockwise,
    title: '監査ログ',
    body: '誰がいつ何を変えたかを記録しています。AIやCLI経由の操作も同じように残ります。',
  },
  {
    icon: UserCircle,
    title: '二要素認証',
    body: 'パスワードに加えて、認証アプリの6桁コードでログインできます。設定画面からご自身で有効にできます。',
  },
  {
    icon: Key,
    title: 'APIキーの範囲を絞れる',
    body: 'AIやCLIから使う鍵は、1つのプロジェクトだけに絞るか、自分が入っているプロジェクト全体にするかを選べます。いつでも止められます。',
  },
  {
    icon: Database,
    title: 'データの持ち出し',
    body: 'タスクはいつでもCSVで書き出せます。アップロードしたファイルもそのまま取り出せます。',
  },
]

const portalPoints = [
  {
    q: '相手先はどうやって入りますか？',
    a: '招待メールから、パスワードを一度だけ決めて入ります。誰でも開けるURLではありません。社内メンバーとは別の画面で、見える範囲も別です。人数は何人招いても無料です。',
  },
  {
    q: '見せたくないものまで見えませんか？',
    a: 'タスク1件ごとに「相手先に見せる／見せない」を決めます。既定は見せません。原価や社内のやりとりは相手先の画面に出ません。',
  },
  {
    q: '承認のたびにログインが要りますか？',
    a: '要りません。承認だけはメールに届いたリンクから、その場で押せます。このリンクは一度使うと無効になり、期限も切れます。',
  },
  {
    q: '相手先が社内のタスクを書き換えられますか？',
    a: 'できません。相手先ができるのは、見ること・コメントすること・承認すること・依頼を起票することだけです。',
  },
]

// 時期を約束できるのは自社で実装するものだけ。第三者認証の取得時期は約束しない
const planned = [
  'SSO / SAML でのログイン',
  'SCIM によるアカウントの自動作成・削除',
  '役割をさらに細かく分ける権限管理',
  '稼働率の保証（SLA）',
]

/* ─── Page ─── */

export default function SecurityPage() {
  return (
    <main className="font-sans antialiased text-slate-900 bg-surface min-h-screen">
      <LPHeader />

      {/* ──── Hero ──── */}
      <section className="pt-32 pb-20 bg-slate-50">
        <div className="container mx-auto px-6 text-center max-w-3xl">
          <div
            className="inline-block px-3 py-1 mb-4 text-xs font-bold tracking-wide text-amber-600 bg-amber-100 rounded-full"
          >
            セキュリティ
          </div>
          <h1
            className="text-4xl lg:text-5xl font-bold mb-6 text-slate-900"
          >
            お預かりしたものを、<br className="hidden sm:block" />
            どう守っているか。
          </h1>
          <p
            className="text-lg text-slate-600 leading-relaxed"
          >
            情報システム部門やお客様から聞かれることを、先にまとめました。<br className="hidden md:block" />
            実際に動いているものと、これから作るものを分けて書いています。
          </p>
        </div>
      </section>

      {/* ──── 対応済み ──── */}
      <section className="py-20 bg-surface">
        <div className="container mx-auto px-6 max-w-5xl">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-center mb-12"
          >
            <h2 className="text-3xl font-bold text-slate-900 mb-4">いま動いているもの</h2>
            <p className="text-slate-500 text-sm">この6つは実装済みで、いますぐ使えます。</p>
          </motion.div>

          <div className="grid md:grid-cols-2 gap-5">
            {implemented.map((item, i) => (
              <motion.div
                key={item.title}
                initial={{ opacity: 0, y: 12 }}
                whileInView={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05 }}
                viewport={{ once: true }}
                className="bg-surface rounded-2xl border border-slate-200 p-6"
              >
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-9 h-9 rounded-lg bg-amber-50 flex items-center justify-center shrink-0">
                    <item.icon size={20} weight="duotone" className="text-amber-600" />
                  </div>
                  <h3 className="font-bold text-slate-900">{item.title}</h3>
                </div>
                <p className="text-sm text-slate-600 leading-relaxed">{item.body}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ──── 相手先ポータル ──── */}
      <section className="py-20 bg-slate-50">
        <div className="container mx-auto px-6 max-w-3xl">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-center mb-12"
          >
            <h2 className="text-3xl font-bold text-slate-900 mb-4">相手先ポータルのしくみ</h2>
            <p className="text-slate-500 text-sm leading-relaxed">
              お客様に使っていただく画面なので、ここはよく質問されます。
            </p>
          </motion.div>

          <div className="space-y-4">
            {portalPoints.map((item, i) => (
              <motion.div
                key={item.q}
                initial={{ opacity: 0, y: 12 }}
                whileInView={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05 }}
                viewport={{ once: true }}
                className="bg-surface rounded-2xl border border-slate-200 p-6"
              >
                <h3 className="font-bold text-slate-900 mb-2 text-[15px]">{item.q}</h3>
                <p className="text-sm text-slate-600 leading-relaxed">{item.a}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ──── これから ──── */}
      <section className="py-20 bg-surface">
        <div className="container mx-auto px-6 max-w-3xl">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
          >
            <h2 className="text-2xl font-bold text-slate-900 mb-4">これから作るもの</h2>
            <p className="text-slate-600 text-sm leading-relaxed mb-6">
              大きな組織で必要になるものを検討しています。時期はまだお約束できません。
              導入の条件になる場合は、ご相談ください。
            </p>
            <ul className="grid sm:grid-cols-2 gap-3 mb-8">
              {planned.map((item) => (
                <li key={item} className="flex items-start gap-2.5 bg-slate-50 rounded-xl border border-slate-200 p-4">
                  <span className="text-slate-400 shrink-0 mt-0.5">-</span>
                  <span className="text-sm text-slate-600">{item}</span>
                </li>
              ))}
            </ul>

            <div className="bg-amber-50 rounded-2xl border border-amber-200 p-6">
              <div className="flex items-start gap-3">
                <Check weight="bold" className="text-amber-600 shrink-0 mt-0.5" size={20} />
                <div>
                  <h3 className="font-bold text-slate-900 mb-1.5">情報システム部門向けの資料をお渡しします</h3>
                  <p className="text-sm text-slate-600 leading-relaxed mb-4">
                    暗号化・認証・監査ログ・データの置き場所をまとめたチェックシートをご用意しています。
                    稟議に使える形でお送りします。
                  </p>
                  <Link
                    href="/contact?topic=security"
                    className="inline-flex items-center gap-2 px-5 py-2.5 bg-amber-500 text-white font-bold rounded-lg hover:bg-amber-600 transition-colors text-sm"
                  >
                    資料を請求する
                    <ArrowRight weight="bold" size={14} />
                  </Link>
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      </section>

      <CTABand />
      <LPFooter />
    </main>
  )
}
