'use client'

import { LPHeader } from '@/components/lp/Header'
import { LPFooter } from '@/components/lp/Footer'
import { CTABand } from '@/components/lp/CTABand'
import { motion } from 'framer-motion'
import { ArrowRight } from '@phosphor-icons/react'
import Image from 'next/image'
import Link from 'next/link'

/* ─── Data ─── */
// 写真は public/img/help/*.webp（マニュアルと同じもの・すべて 1200x750）。
// 撮影はデモ用の組織で行っているので、実在のお客様の名前は写っていない。

const W = 1200
const H = 750

const groups = [
  {
    title: '案件を動かす画面（社内）',
    lead: '案件の状態を見て、タスクを動かす場所です。',
    shots: [
      { src: 'dashboard', caption: 'ダッシュボード', note: '案件の進み具合と、期限が近いもの・過ぎたものが一目で分かります。' },
      { src: 'tasks', caption: 'タスク一覧', note: 'いま誰の番かが、行ごとに出ます。' },
      { src: 'task-inspector', caption: 'タスクの詳細', note: '右側に開くので、一覧を見失わずに済みます。' },
      { src: 'my-tasks', caption: 'マイタスク', note: '自分が抱えているものだけを、案件をまたいで並べられます。' },
      { src: 'inbox', caption: '受信トレイ', note: '承認依頼やコメントなど、自分が動く必要のあるものだけが届きます。' },
      { src: 'gantt', caption: 'ガントチャート', note: '期限を過ぎたものは枠線で分かるようにしています。' },
    ],
  },
  {
    title: '書いて残す画面（社内）',
    lead: '決めたことと、その根拠になった資料を同じ場所に置きます。',
    shots: [
      { src: 'meetings', caption: '会議と議事録', note: '複数人で同時に書けます。誰がどこを書いているかは、色で見分けられます。' },
      { src: 'wiki', caption: 'Wiki', note: '仕様書やルールの置き場です。議事録やタスクから、直接リンクを貼れます。' },
      { src: 'files', caption: 'ファイル', note: '案件ごとの置き場です。説明文と絞り込みで、あとから探せます。' },
      { src: 'files-table', caption: 'CSVを表で開く', note: '別のソフトを開かなくても、その場で書き換えられます。' },
    ],
  },
  {
    title: '相手先が見る画面',
    lead: '社内のやりとりや原価は出ません。見せると決めたものだけが並びます。',
    shots: [
      { src: 'portal-dashboard', caption: '相手先のトップ', note: '対応が必要なものから順に並びます。' },
      { src: 'portal-tasks', caption: '相手先のタスク一覧', note: 'こちらの報告を待たずに、進み具合を確かめられます。' },
      { src: 'portal-requests', caption: '依頼・バグ報告', note: '相手先から直接依頼を出せます。そのまま案件のタスクになります。' },
      { src: 'portal-files', caption: '相手先のファイル', note: '共有した資料だけが見えます。' },
    ],
  },
  {
    title: 'AI秘書の画面',
    lead: 'チャットのつなぎ方と、拾ったものの確認はここでします。',
    shots: [
      { src: 'secretary', caption: '秘書のコンソール', note: 'つないだグループと、拾った申し送りが並びます。' },
      { src: 'secretary-connect', caption: 'チャットをつなぐ', note: 'グループに招いて、合言葉を入れれば終わりです。' },
      { src: 'secretary-approvals', caption: '申し送りの確認', note: '拾ったものに目を通し、要るものだけタスクにします。' },
    ],
  },
]

/* ─── Page ─── */

export default function ScreensPage() {
  return (
    <main className="font-sans antialiased text-slate-900 bg-surface min-h-screen">
      <LPHeader />

      {/* ──── Hero ──── */}
      <section className="pt-32 pb-16 bg-slate-50">
        <div className="container mx-auto px-6 text-center max-w-3xl">
          <div className="inline-block px-3 py-1 mb-4 text-xs font-bold tracking-wide text-amber-600 bg-amber-100 rounded-full">
            画面を見る
          </div>
          <h1 className="text-4xl lg:text-5xl font-bold mb-6 text-slate-900">
            登録しなくても、画面を見られます。
          </h1>
          <p className="text-lg text-slate-600 leading-relaxed">
            実際の画面を、ひととおりご覧いただけます。<br className="hidden md:block" />
            社内の画面と、相手先に見える画面は別です。
          </p>
        </div>
      </section>

      {/* ──── 画面 ──── */}
      <section className="py-16 bg-surface">
        <div className="container mx-auto px-6 max-w-5xl space-y-16">
          {groups.map((group) => (
            <div key={group.title}>
              <motion.div
                initial={{ opacity: 0, y: 16 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                className="mb-8"
              >
                <h2 className="text-2xl font-bold text-slate-900 mb-2">{group.title}</h2>
                <p className="text-sm text-slate-600">{group.lead}</p>
              </motion.div>

              <div className="grid md:grid-cols-2 gap-6">
                {group.shots.map((shot, i) => (
                  <motion.figure
                    key={shot.src}
                    initial={{ opacity: 0, y: 14 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    transition={{ delay: Math.min(i, 3) * 0.04 }}
                    viewport={{ once: true }}
                    className="bg-surface rounded-2xl border border-slate-200 overflow-hidden"
                  >
                    <Image
                      src={`/img/help/${shot.src}.webp`}
                      alt={shot.caption}
                      width={W}
                      height={H}
                      sizes="(max-width: 768px) 100vw, 50vw"
                      className="w-full h-auto border-b border-slate-100"
                    />
                    <figcaption className="p-5">
                      <div className="font-bold text-slate-900 mb-1 text-[15px]">{shot.caption}</div>
                      <p className="text-sm text-slate-600 leading-relaxed">{shot.note}</p>
                    </figcaption>
                  </motion.figure>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ──── 触ってみる ──── */}
      <section className="py-16 bg-slate-50">
        <div className="container mx-auto px-6 max-w-3xl">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="bg-surface rounded-2xl border border-slate-200 p-8 text-center"
          >
            <h2 className="text-xl font-bold text-slate-900 mb-3">実際に触ってみる</h2>
            <p className="text-sm text-slate-600 leading-relaxed mb-6">
              無料プランなら、クレジットカードの登録なしで今すぐ使えます。テンプレートを選べば、タスクもマイルストーンも入った状態で立ち上がります。
            </p>
            <div className="flex flex-wrap gap-3 justify-center">
              <Link
                href="/signup"
                className="inline-flex items-center gap-2 px-6 py-3 bg-amber-500 text-white font-bold rounded-lg hover:bg-amber-600 transition-colors text-sm"
              >
                無料で始める
                <ArrowRight weight="bold" size={14} />
              </Link>
              <Link
                href="/start"
                className="inline-flex items-center gap-2 px-6 py-3 bg-surface border border-slate-300 text-slate-700 font-bold rounded-lg hover:bg-slate-50 transition-colors text-sm"
              >
                導入の流れを見る
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
