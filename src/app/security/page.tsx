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
    title: '通信も、保管しているデータも暗号化しています',
    body: 'ブラウザとサーバーの間はTLSで守っています。保存したあとのデータも、ディスクの上で暗号化されたままです。',
  },
  {
    icon: ShieldCheck,
    title: 'よその会社のデータは、データベースの側で切り離しています',
    body: '「誰がどこまで見てよいか」をデータベースの側で決めています。画面を作る側が間違えても、よその会社のデータが混ざることはありません。'
  },
  {
    icon: ClockCounterClockwise,
    title: '誰がいつ何を変えたか、あとから追えます',
    body: '操作はすべて記録に残ります。AIやコマンドライン経由で動かした分も、人が画面で触ったときと同じように残ります。',
  },
  {
    icon: UserCircle,
    title: 'パスワードのほかに、もう1つの確認を足せます',
    body: '認証アプリに出る6桁の数字を、パスワードと一緒に入れる方式です。使う方ごとに、設定画面から有効にできます。',
  },
  {
    icon: Key,
    title: 'AIから触れる範囲は、絞って渡せます',
    body: '1つのプロジェクトだけに絞るか、自分が入っている全部を対象にするかを選べます。渡したあとでも、いつでも止められます。',
  },
  {
    icon: Database,
    title: 'やめるときも、データは持って出られます',
    body: 'タスクはいつでもCSVで書き出せます。アップロードしたファイルも、そのまま取り出せます。',
  },
]

const portalPoints = [
  {
    q: '相手先はどうやって入りますか？',
    a: '招待メールからパスワードを一度だけ決めていただき、以降はそれでログインします。誰でも開けるURLではありません。社内の画面とは別物で、見える範囲も別に管理しています。',
  },
  {
    q: '見せたくないものまで見えませんか？',
    a: 'タスク1件ごとに「相手先に見せる／見せない」を決めます。既定は見せません。原価や社内のやりとりは相手先の画面に出ません。',
  },
  {
    q: '承認のリンクをメールで送るのは危なくないですか？',
    a: 'リンクは一度使うと無効になり、期限も切れます。押せるのは承認だけで、そこから他の画面には入れません。',
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
            情報システム部門やお客様から聞かれることを、先にまとめておきました。<br className="hidden md:block" />
            すでに動いているものと、これから作るものは分けてあります。
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
            <p className="text-slate-500 text-sm">申し込んだ日から使えます。</p>
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
            <h2 className="text-3xl font-bold text-slate-900 mb-4">相手先の画面は、どう守られているか</h2>
            <p className="text-slate-500 text-sm leading-relaxed">
              お客様が直接ログインする画面なので、見える範囲を社内の画面とは別に管理しています。
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
              大きな組織で求められるものを順に検討しています。ただ、いつ出せるかはまだ約束できません。
              導入の条件になるようでしたら、一度ご相談ください。
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
                    暗号化・認証・記録の残り方・データの置き場所を1枚にまとめてあります。そのまま稟議に添えられる形でお送りします。
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
