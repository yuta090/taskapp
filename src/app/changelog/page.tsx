'use client'

import { LPHeader } from '@/components/lp/Header'
import { LPFooter } from '@/components/lp/Footer'
import { CTABand } from '@/components/lp/CTABand'
import { motion } from 'framer-motion'
import { ArrowRight } from '@phosphor-icons/react'
import Link from 'next/link'

/* ─── Data ─── */
/**
 * 更新情報。新しいものを配列の先頭に足していく。
 *
 * 書き方の約束:
 *   - **お客様が画面で気づくことだけ**を書く。内部の作り替えやテストの追加は載せない
 *   - ブランチ名やコミットの文言をそのまま持ってこない。日常の言葉に直す
 *   - 出した日は、本番へ出した日（develop へのマージ日ではない）
 *   - 種類は「新機能」「改善」「修正」の3つだけ。増やさない
 */

type Kind = '新機能' | '改善' | '修正'

const KIND_STYLE: Record<Kind, string> = {
  新機能: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  改善: 'bg-blue-50 text-blue-700 border-blue-200',
  修正: 'bg-slate-100 text-slate-600 border-slate-200',
}

const entries: { date: string; title: string; items: { kind: Kind; text: string }[] }[] = [
  {
    date: '2026年9月中旬',
    title: '議事録を、みんなで同時に書けるようにしました',
    items: [
      { kind: '新機能', text: '1つの議事録を、複数人で同時に編集できます。誰がどこを書いているかは色で見分けられます。' },
      { kind: '新機能', text: '「/」を押すと、見出し・折りたたみ・チェックリストを差し込めます。' },
      { kind: '新機能', text: '議事録のチェックリストの行から、タスクをまとめて作れるようになりました。' },
      { kind: '新機能', text: '本文からWikiのページやファイル、タスクへ直接リンクを貼れるようになりました。' },
      { kind: '改善', text: '画面の色を暗くできるようになりました（設定から切り替え）。' },
    ],
  },
  {
    date: '2026年9月中旬',
    title: '見落としを減らす通知を足しました',
    items: [
      { kind: '新機能', text: 'タスクにコメントできるようになりました。担当者と承認者、それに過去のコメント参加者へ届きます。' },
      { kind: '新機能', text: '承認の結果が、その場で担当者に届きます。' },
      { kind: '改善', text: 'マイタスクの表示を切り替えられるようにし、未読のコメントも分かるようにしました。' },
      { kind: '改善', text: 'ダッシュボードに、期限切れのタスクと最近のコメントが並ぶようになりました。' },
      { kind: '修正', text: '受信トレイに承認依頼が届かないことがあったのを直しました。' },
    ],
  },
  {
    date: '2026年9月上旬',
    title: 'ログインの安全性と、事務まわりを整えました',
    items: [
      { kind: '新機能', text: '二要素認証を使えるようになりました。認証アプリに出る6桁の数字を、パスワードと一緒に入れる方式です。' },
      { kind: '新機能', text: '見慣れない端末からログインがあったとき、メールでお知らせするようにしました。' },
      { kind: '新機能', text: '承認された見積もりから、freee請求書・マネーフォワード・Misoca で書類を作れるようになりました。' },
      { kind: '新機能', text: 'CSVファイルを表として開き、その場で直せます。' },
      { kind: '改善', text: 'コマンドライン（agentpm）からファイルを送れます。' },
    ],
  },
  {
    date: '2026年7月',
    title: 'AI秘書とファイル置き場を作りました',
    items: [
      { kind: '新機能', text: 'LINEとSlackのグループに秘書を入れられるようになりました。Chatwork・Google Chat・Microsoft Teams・Discord はお試し中です。' },
      { kind: '新機能', text: '会話から拾ったやることを、1日1回まとめてお届けします。' },
      { kind: '新機能', text: '案件ごとのファイル置き場を作りました。相手先の画面からも見られます。' },
      { kind: '新機能', text: 'Google Tasks と連携し、どちらで完了にしても両方に反映されるようにしました。' },
      { kind: '改善', text: 'スマートフォンでも一通り操作できるようにしました。' },
    ],
  },
]

/* ─── Page ─── */

export default function ChangelogPage() {
  return (
    <main className="font-sans antialiased text-slate-900 bg-surface min-h-screen">
      <LPHeader />

      {/* ──── Hero ──── */}
      <section className="pt-32 pb-16 bg-slate-50">
        <div className="container mx-auto px-6 text-center max-w-3xl">
          <div className="inline-block px-3 py-1 mb-4 text-xs font-bold tracking-wide text-amber-600 bg-amber-100 rounded-full">
            更新情報
          </div>
          <h1 className="text-4xl lg:text-5xl font-bold mb-6 text-slate-900">
            どこが変わったかを残しています。
          </h1>
          <p className="text-lg text-slate-600 leading-relaxed">
            お客様が画面で気づく変更だけを載せています。<br className="hidden md:block" />
            表に出ない修正は、毎週入れています。
          </p>
        </div>
      </section>

      {/* ──── 一覧 ──── */}
      <section className="py-16 bg-surface">
        <div className="container mx-auto px-6 max-w-3xl">
          <div className="space-y-10">
            {entries.map((entry, i) => (
              <motion.article
                key={`${entry.date}-${entry.title}`}
                initial={{ opacity: 0, y: 16 }}
                whileInView={{ opacity: 1, y: 0 }}
                transition={{ delay: Math.min(i, 3) * 0.04 }}
                viewport={{ once: true }}
                className="bg-surface rounded-2xl border border-slate-200 p-6 lg:p-8"
              >
                <div className="text-xs font-bold tracking-widest text-slate-400 mb-2">{entry.date}</div>
                <h2 className="text-xl font-bold text-slate-900 mb-5">{entry.title}</h2>
                <ul className="space-y-3">
                  {entry.items.map((item) => (
                    <li key={item.text} className="flex items-start gap-3">
                      <span
                        className={`text-[11px] font-bold px-2 py-0.5 rounded border shrink-0 mt-0.5 ${KIND_STYLE[item.kind]}`}
                      >
                        {item.kind}
                      </span>
                      <span className="text-sm text-slate-600 leading-relaxed">{item.text}</span>
                    </li>
                  ))}
                </ul>
              </motion.article>
            ))}
          </div>
        </div>
      </section>

      {/* ──── 補足 ──── */}
      <section className="py-16 bg-slate-50">
        <div className="container mx-auto px-6 max-w-3xl">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="bg-surface rounded-2xl border border-slate-200 p-8 text-center"
          >
            <h2 className="text-xl font-bold text-slate-900 mb-3">こんな機能がほしい、というご要望</h2>
            <p className="text-sm text-slate-600 leading-relaxed mb-6">
              上に並んでいる機能の多くは、使っている方からの要望で作りました。困っていることがあれば、遠慮なくお聞かせください。
            </p>
            <Link
              href="/contact"
              className="inline-flex items-center gap-2 px-6 py-3 bg-amber-500 text-white font-bold rounded-lg hover:bg-amber-600 transition-colors text-sm"
            >
              要望を伝える
              <ArrowRight weight="bold" size={14} />
            </Link>
          </motion.div>
        </div>
      </section>

      <CTABand />
      <LPFooter />
    </main>
  )
}
