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
        a: 'かかりません。全プランで無料、人数の制限もありません。料金がかかるのは、自社のスタッフの人数だけです。',
      },
      {
        q: '上限に達したらどうなりますか？',
        a: '動いているプロジェクトはそのまま使えます。上限のお知らせが出るのは、新しく作ろうとしたときだけです。画面から見積もりをご依頼いただき、承認いただくと上限が上がります。',
      },
      {
        q: '連携の数で料金は変わりますか？',
        a: '変わりません。Proにすべて含まれています。',
      },
      {
        q: '支払い方法は何がありますか？',
        a: 'クレジットカードに対応しています。Enterpriseなら請求書払いも承りますので、お申し込みのあとにご案内します。',
      },
    ],
  },
  {
    title: '相手先（クライアント）',
    items: [
      {
        q: '相手先はどうやって画面に入りますか？',
        a: '招待メールから、パスワードを一度だけ決めていただきます。あとはブラウザさえあれば、進捗の確認も、見積もりの承認も、依頼を出すこともできます。',
      },
      {
        q: '承認のたびにログインしてもらう必要がありますか？',
        a: 'ありません。承認だけは、メールに届いたリンクをその場で押せば終わります。なお、このリンクは一度使うと無効になり、期限も切れます。',
      },
      {
        q: '社内のやりとりまで相手先に見えませんか？',
        a: '見えません。タスク1件ごとに「相手先に見せる／見せない」を決めます。はじめは見せない設定です。原価も社内のコメントも、相手先の画面には出ません。',
      },
      {
        q: '相手先がタスクを書き換えられますか？',
        a: 'できません。相手先にできるのは、見る・コメントする・承認する・依頼を出す。この4つだけです。',
      },
    ],
  },
  {
    title: 'AI秘書とチャット',
    items: [
      {
        q: 'AI秘書はどこで動きますか？',
        a: 'いま使えるのはLINEとSlackです。Chatwork・Google Chat・Microsoft Teams・Discord はお試し中。いずれも社内だけでなく、お客様とのグループに入れます。',
      },
      {
        q: '会話の内容を全部読まれませんか？',
        a: '拾い方はグループごとに選べます。「毎時まとめて」「メンション時のみ（即時）」「取り込まない」の3つです。メンション時のみにしておけば、名前を出された発言しか見ません。Proなら両方を組み合わせた4つめも選べます。',
      },
      {
        q: '自社の名前でお客様に届きますか？',
        a: 'Proなら届きます。自社のLINE公式アカウントから届き、開通の手続きはこちらで代行します。無料プランの場合は、共通のアカウントから届きます。'
      },
      {
        q: 'AIが勝手にタスクを作って混乱しませんか？',
        a: '拾った内容は「申し送り」として溜まり、人が確認してから初めてタスクになります。届くタイミングは、無料プランなら1日1回のまとめ、Proならその場です。',
      },
    ],
  },
  {
    title: 'セキュリティ',
    items: [
      {
        q: 'データはどう守られていますか？',
        a: '通信はTLSで暗号化し、保存したあとのデータもディスクの上で暗号化しています。さらに「誰がどこまで見てよいか」をデータベースの側で決めているので、他社のデータが混ざることはありません。操作はすべて記録に残ります。',
      },
      {
        q: '二要素認証は使えますか？',
        a: '使えます。認証アプリに出る6桁の数字を、パスワードと一緒に入れる方式です。設定画面からご自身で有効にしてください。',
      },
      {
        q: 'ISO 27001 や SOC 2 は取得していますか？',
        a: '現時点では取得していません。暗号化・アクセス制限・記録の残り方については、情報システム部門向けのチェックシートにまとめてお渡ししています。',
      },
      {
        q: 'SSO（シングルサインオン）に対応していますか？',
        a: 'まだ対応していません。検討はしています。導入の条件になるようでしたら、一度ご相談ください。',
      },
    ],
  },
  {
    title: 'データと解約',
    items: [
      {
        q: 'いま使っているツールからデータを移せますか？',
        a: '移せます。書き出したCSVを、そのまま取り込めます。移している間、前のツールと並べて使っていただいて構いません。',
      },
      {
        q: 'データを取り出せますか？',
        a: '取り出せます。タスクはいつでもCSVに書き出せますし、アップロードしたファイルもそのままダウンロードできます。',
      },
      {
        q: '解約したらデータはどうなりますか？',
        a: '解約の前に書き出していただけます。やり方が分からなければ、サポートがお手伝いします。',
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
          <div
            className="inline-block px-3 py-1 mb-4 text-xs font-bold tracking-wide text-amber-600 bg-amber-100 rounded-full"
          >
            よくある質問
          </div>
          <h1
            className="text-4xl lg:text-5xl font-bold mb-6 text-slate-900"
          >
            よく聞かれることに答えます。
          </h1>
          <p
            className="text-lg text-slate-600 leading-relaxed"
          >
            料金とプラン、相手先、AI秘書とチャット、セキュリティ、データと解約。この5つに分けました。
          </p>
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
              操作の手順はマニュアルにまとめてあります。それでも分からないことは、直接お聞きください。
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
