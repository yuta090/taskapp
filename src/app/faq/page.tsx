'use client'

import { useState } from 'react'
import { LPHeader } from '@/components/lp/Header'
import { LPFooter } from '@/components/lp/Footer'
import { CTABand } from '@/components/lp/CTABand'
import { motion } from 'framer-motion'
import { CaretDown, ArrowRight } from '@phosphor-icons/react'
import Link from 'next/link'

/* ─── Data ─── */

const sections = [
  {
    title: '料金とプラン',
    items: [
      {
        q: '相手先（クライアント）の利用に追加料金はかかりますか？',
        a: 'かかりません。全プランで無料です。人数の制限もありません。数えるのは自社のスタッフだけです。',
      },
      {
        q: '上限に達したらどうなりますか？',
        a: '今あるプロジェクトやつないだグループが止まることはありません。新しく作るときだけご案内が出ます。枠を増やしたい場合は、画面から見積もりをご依頼いただけます。承認いただくと、その場で枠が増えます。',
      },
      {
        q: '連携の数で料金は変わりますか？',
        a: '変わりません。Proに全部含まれています。',
      },
      {
        q: '支払い方法は何がありますか？',
        a: 'クレジットカードに対応しています。Enterpriseでは請求書払いも承ります。お申し込み後にご案内します。',
      },
    ],
  },
  {
    title: '相手先（クライアント）',
    items: [
      {
        q: '相手先はどうやって画面に入りますか？',
        a: '招待メールから、パスワードを一度だけ決めていただきます。以降はブラウザだけで、進捗の確認・見積もりの承認・依頼の起票ができます。',
      },
      {
        q: '承認のたびにログインしてもらう必要がありますか？',
        a: 'ありません。承認だけは、メールに届いたリンクをその場で押せば終わります。このリンクは一度使うと無効になり、期限も切れます。',
      },
      {
        q: '社内のやりとりまで相手先に見えませんか？',
        a: '見えません。タスク1件ごとに「相手先に見せる／見せない」を決めます。既定は見せない設定です。原価や社内のコメントは相手先の画面に出ません。',
      },
      {
        q: '相手先がタスクを書き換えられますか？',
        a: 'できません。相手先ができるのは、見ること・コメントすること・承認すること・依頼を起票することだけです。',
      },
    ],
  },
  {
    title: 'AI秘書とチャット',
    items: [
      {
        q: 'AI秘書はどこで動きますか？',
        a: 'LINE・Slack・Chatwork・Google Chat・Microsoft Teams・Discord のグループに入って動きます。お客様とのグループにも入れます。',
      },
      {
        q: '会話の内容を全部読まれるのが不安です。',
        a: 'グループごとに、拾い方を選べます。「全部見る」「呼ばれたときだけ」「止める」の3つです。呼ばれたときだけにすれば、メンションされた発言だけを扱います。',
      },
      {
        q: '自社の名前でお客様に届きますか？',
        a: 'Proなら届きます。自社のLINE公式アカウントから配信できます。開通の手続きはこちらで代行します。無料プランは共通のアカウントからの配信になります。',
      },
      {
        q: 'AIが勝手にタスクを作って混乱しませんか？',
        a: '拾った内容は「申し送り」として溜まり、人が確認してからタスクになります。無料プランは1日1回のまとめ、Proはその場で届きます。',
      },
    ],
  },
  {
    title: 'セキュリティ',
    items: [
      {
        q: 'データはどう守られていますか？',
        a: '通信はTLSで暗号化し、保存したデータもディスク上で暗号化されています。加えて、データベース側で「誰がどの行を読めるか」を制限しているため、他社のデータは出てきません。操作は監査ログに残ります。',
      },
      {
        q: '二要素認証は使えますか？',
        a: '使えます。認証アプリの6桁コードでログインする方式です。設定画面からご自身で有効にできます。',
      },
      {
        q: 'ISO 27001 や SOC 2 は取得していますか？',
        a: '現時点では取得していません。暗号化・アクセス制限・監査ログの対応状況は、情報システム部門向けのチェックシートにまとめてお渡しします。',
      },
      {
        q: 'SSO（シングルサインオン）に対応していますか？',
        a: 'まだ対応していません。検討中です。導入の条件になる場合はご相談ください。',
      },
    ],
  },
  {
    title: 'データと解約',
    items: [
      {
        q: 'いま使っているツールからデータを移せますか？',
        a: '移せます。書き出したCSVをそのまま取り込めます。移している間は、前のツールと並べて使って構いません。',
      },
      {
        q: 'データを取り出せますか？',
        a: '取り出せます。タスクはいつでもCSVで書き出せます。アップロードしたファイルもそのままダウンロードできます。',
      },
      {
        q: '解約したらデータはどうなりますか？',
        a: '解約の前に書き出していただけます。取り出し方が分からない場合はサポートがお手伝いします。',
      },
    ],
  },
]

/* ─── Accordion ─── */

function FaqItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="border-b border-slate-200 last:border-0">
      <button
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex items-start justify-between w-full py-5 text-left gap-4"
      >
        <span className="text-[15px] font-bold text-slate-900">{q}</span>
        <CaretDown
          size={18}
          weight="bold"
          className={`text-slate-400 shrink-0 mt-0.5 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>
      <div hidden={!open} className="pb-5 -mt-1">
        <p className="text-sm text-slate-600 leading-relaxed">{a}</p>
      </div>
    </div>
  )
}

/* ─── Page ─── */

export default function FaqPage() {
  return (
    <main className="font-sans antialiased text-slate-900 bg-surface min-h-screen">
      <LPHeader />

      {/* ──── Hero ──── */}
      <section className="pt-32 pb-16 bg-slate-50">
        <div className="container mx-auto px-6 text-center max-w-3xl">
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="inline-block px-3 py-1 mb-4 text-xs font-bold tracking-wide text-amber-600 bg-amber-100 rounded-full"
          >
            よくある質問
          </motion.div>
          <motion.h1
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="text-4xl lg:text-5xl font-bold mb-6 text-slate-900"
          >
            よく聞かれること。
          </motion.h1>
          <motion.p
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="text-lg text-slate-600 leading-relaxed"
          >
            料金・相手先・チャット・セキュリティ・データの5つに分けました。
          </motion.p>
        </div>
      </section>

      {/* ──── 本体 ──── */}
      <section className="py-16 bg-surface">
        <div className="container mx-auto px-6 max-w-3xl space-y-12">
          {sections.map((section, si) => (
            <motion.div
              key={section.title}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              transition={{ delay: si * 0.03 }}
              viewport={{ once: true }}
            >
              <h2 className="text-xl font-bold text-slate-900 mb-2">{section.title}</h2>
              <div className="bg-surface rounded-2xl border border-slate-200 px-6">
                {section.items.map((item) => (
                  <FaqItem key={item.q} q={item.q} a={item.a} />
                ))}
              </div>
            </motion.div>
          ))}
        </div>
      </section>

      {/* ──── 見つからないとき ──── */}
      <section className="py-16 bg-slate-50">
        <div className="container mx-auto px-6 max-w-3xl">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="bg-surface rounded-2xl border border-slate-200 p-8 text-center"
          >
            <h2 className="text-xl font-bold text-slate-900 mb-3">答えが見つからないとき</h2>
            <p className="text-sm text-slate-600 leading-relaxed mb-6">
              操作の手順はマニュアルにまとめています。それでも分からないことは、直接お聞きください。
            </p>
            <div className="flex flex-wrap gap-3 justify-center">
              <Link
                href="/contact"
                className="inline-flex items-center gap-2 px-6 py-3 bg-amber-500 text-white font-bold rounded-lg hover:bg-amber-600 transition-colors text-sm"
              >
                質問する
                <ArrowRight weight="bold" size={14} />
              </Link>
              <Link
                href="/docs/manual"
                className="inline-flex items-center gap-2 px-6 py-3 bg-surface border border-slate-300 text-slate-700 font-bold rounded-lg hover:bg-slate-50 transition-colors text-sm"
              >
                マニュアルを見る
              </Link>
            </div>
          </motion.div>
        </div>
      </section>

      <CTABand />
      <LPFooter />
    </main>
  )
}
