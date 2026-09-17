'use client'

import { LPHeader } from '@/components/lp/Header'
import { LPFooter } from '@/components/lp/Footer'
import { CTABand } from '@/components/lp/CTABand'
import { motion } from 'framer-motion'
import { ArrowRight, Terminal, CheckCircle, Notebook, LinkSimple, FileCsv, Robot } from '@phosphor-icons/react'
import Link from 'next/link'

/* ─── Data ─── */
// コマンドは src/lib/cli-manifest.ts の定義に合わせる。増減したらここも直す

const chapters = [
  {
    icon: Terminal,
    label: '01 立ち上げ',
    title: '企画が決まったら、まとめて登録する',
    body:
      '画面をひとつずつ開く必要はありません。コマンドを打てば、マイルストーンもタスクも一度に作れます。前の企画のタスク一覧をCSVで持ってくれば、そのまま使い回せます。',
    code: [
      'agentpm milestone create --name "企画確定" --due-date 2026-10-15',
      'agentpm task import --file tasks.csv --no-dry-run',
    ],
    note: '取り込みの前に、何件をどう登録するかを一覧で出します。そのまま入れるときだけ --no-dry-run を付けます。',
  },
  {
    icon: CheckCircle,
    label: '02 確認',
    title: '上司の確認を、口頭でなく記録で取る',
    body:
      '確認してほしいタスクで承認を依頼すると、相手の受信トレイに届きます。いつ、誰が承認したかは記録に残るので、あとで「言った」「聞いていない」にはなりません。',
    code: ['agentpm review open --task-id <タスクID>'],
    note: '承認する側は、画面でもメールのリンクからでも押せます。',
  },
  {
    icon: Notebook,
    label: '03 会議の前',
    title: '議題を議事録に書いておく',
    body:
      '議事録は、会議が始まる前から書けます。議題を並べ、気づいたことをメモとして足していけます。当日はそれを見ながら進めるだけです。',
    code: ['agentpm minutes append --meeting-id <会議ID> --content "## 議題: 予算の枠と公開日"'],
    note: '画面では「/」を押すと、見出し・チェックリスト・折りたたみを差し込めます。',
  },
  {
    icon: LinkSimple,
    label: '04 会議中',
    title: '決まったことと、資料をその場で結びつける',
    body:
      '議事録の本文から、Wikiのページにも、過去の議事録にも、ファイルにも直接リンクを貼れます。あとで「あの資料どこだっけ」と探さずに済みます。決まったことには「決定」の印を付けられます。',
    code: [],
    note: '',
  },
  {
    icon: Terminal,
    label: '05 会議のあと',
    title: '文字起こしを貼れば、議事録の続きになる',
    body:
      '文字起こしやメモを、そのまま議事録に足せます。チェックリストの行からタスクを作れるので、持ち帰った宿題が抜け落ちません。',
    code: [
      'agentpm minutes append --meeting-id <会議ID> --content "$(cat mtg.txt)"',
      'agentpm minutes taskify --meeting-id <会議ID> --dry-run',
      'agentpm minutes taskify --meeting-id <会議ID>',
    ],
    note: '--dry-run を付けると、作らずに候補だけ見られます。',
  },
  {
    icon: FileCsv,
    label: '06 資料',
    title: '資料を1か所に集め、表はその場で直す',
    body:
      'PDFも画像もCSVも、案件のファイル置き場にまとめられます。CSVは表として開き、その場で書き換えられます。別のソフトで開いて保存し直す手間はありません。',
    code: ['agentpm file upload --file ./list.csv'],
    note: '',
  },
  {
    icon: Robot,
    label: '07 AI',
    title: '外のAIからも、同じ案件をさわれる',
    body:
      'APIキーを発行すれば、Claude Code など手元のAIツールからつなげます。「いま止まっているタスクは？」と聞けば答えますし、そのまま登録までできます。AI経由で動かした分も記録に残ります。',
    code: [],
    note: '鍵は1つのプロジェクトだけに絞ることもできます。いつでも止められます。ブラウザのChatGPTから直接つなぐ方式は準備中です。',
  },
]

/* ─── Page ─── */

export default function WorkflowPage() {
  return (
    <main className="font-sans antialiased text-slate-900 bg-surface min-h-screen">
      <LPHeader />

      {/* ──── Hero ──── */}
      <section className="pt-32 pb-20 bg-slate-50">
        <div className="container mx-auto px-6 text-center max-w-3xl">
          <div
            className="inline-block px-3 py-1 mb-4 text-xs font-bold tracking-wide text-amber-600 bg-amber-100 rounded-full"
          >
            使い方
          </div>
          <h1
            className="text-4xl lg:text-5xl font-bold mb-6 text-slate-900"
          >
            新しい企画を1本、<br className="hidden sm:block" />
            最初から最後まで。
          </h1>
          <p
            className="text-lg text-slate-600 leading-relaxed"
          >
            立ち上げから会議、決まったことの記録、資料集めまで。<br className="hidden md:block" />
            社内の企画でも、お客様の案件でも、進め方は同じです。
          </p>
        </div>
      </section>

      {/* ──── 章立て ──── */}
      <section className="py-20 bg-surface">
        <div className="container mx-auto px-6 max-w-3xl space-y-6">
          {chapters.map((c, i) => (
            <motion.div
              key={c.label}
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.04 }}
              viewport={{ once: true }}
              className="bg-surface rounded-2xl border border-slate-200 p-6 lg:p-8"
            >
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-xl bg-amber-50 flex items-center justify-center shrink-0">
                  <c.icon size={21} weight="duotone" className="text-amber-600" />
                </div>
                <span className="text-xs font-bold tracking-widest text-slate-400">{c.label}</span>
              </div>

              <h2 className="text-xl lg:text-2xl font-bold text-slate-900 mb-3">{c.title}</h2>
              <p className="text-sm text-slate-600 leading-relaxed mb-5">{c.body}</p>

              {c.code.length > 0 && (
                <div className="bg-slate-900 rounded-xl p-4 overflow-x-auto mb-3">
                  <pre className="text-[13px] leading-relaxed text-slate-100 font-mono">
                    {c.code.map((line) => (
                      <div key={line}>
                        <span className="text-slate-500 select-none">$ </span>
                        {line}
                      </div>
                    ))}
                  </pre>
                </div>
              )}

              {c.note && <p className="text-xs text-slate-400 leading-relaxed">{c.note}</p>}
            </motion.div>
          ))}
        </div>
      </section>

      {/* ──── まとめ ──── */}
      <section className="py-20 bg-slate-50">
        <div className="container mx-auto px-6 max-w-3xl">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="bg-surface rounded-2xl border border-slate-200 p-8 lg:p-10"
          >
            <h2 className="text-2xl font-bold text-slate-900 mb-4">全部が1か所にあると、何が変わるか</h2>
            <p className="text-slate-600 text-sm leading-relaxed mb-6">
              会議で決まったこと、その根拠になった資料、そこから生まれたタスク、承認した人。これらをばらばらのツールに置くと、3か月後には誰もたどれなくなります。同じ場所に置いてあれば、AIに「この企画の経緯を教えて」と聞くだけで済みます。
            </p>
            <div className="flex flex-wrap gap-3">
              <Link
                href="/signup"
                className="inline-flex items-center gap-2 px-6 py-3 bg-amber-500 text-white font-bold rounded-lg hover:bg-amber-600 transition-colors text-sm"
              >
                無料で試す
                <ArrowRight weight="bold" size={14} />
              </Link>
              <Link
                href="/docs/manual"
                className="inline-flex items-center gap-2 px-6 py-3 bg-surface border border-slate-300 text-slate-700 font-bold rounded-lg hover:bg-slate-50 transition-colors text-sm"
              >
                コマンドの一覧を見る
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
