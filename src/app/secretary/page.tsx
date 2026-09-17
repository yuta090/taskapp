'use client'

import { LPHeader } from '@/components/lp/Header'
import { LPFooter } from '@/components/lp/Footer'
import { CTABand } from '@/components/lp/CTABand'
import { motion } from 'framer-motion'
import { ArrowRight, Check, ChatCircle, Eye, BellRinging, IdentificationCard, ShieldCheck } from '@phosphor-icons/react'
import Link from 'next/link'

/* ─── Data ─── */
// 事実の出どころ:
//   チャネルと状態      src/lib/channels/registry.ts
//   拾い方の3段階      src/lib/channels/store.ts の PickupMode
//   打てる合図          src/lib/channels/commandGuides.ts
//   無料/Proの差        src/app/pricing/page.tsx の plans と entitlements.ts

const flow = [
  {
    n: 1,
    title: 'いつものグループに招く',
    body: 'お客様とのLINEグループでも、社内のSlackでも構いません。秘書を1人、メンバーとして加えるだけです。相手先に新しいツールを覚えていただく必要はありません。',
  },
  {
    n: 2,
    title: '会話から、やることを拾う',
    body: '「来週までに見積もりください」のような一言を拾います。拾ったものはいきなりタスクにはならず、申し送りとして溜まります。',
  },
  {
    n: 3,
    title: '人が見て、タスクにする',
    body: '溜まった申し送りを見て、要るものだけタスクにします。AIが勝手に増やして散らかることはありません。',
  },
  {
    n: 4,
    title: '期限が近づいたら、秘書が聞く',
    body: '期限の前に本人へ声をかけ、終わっているかを確かめます。終わっていなければ、角の立たない言い方で催促します。',
  },
]

const pickupModes = [
  {
    label: 'すべて見る',
    body: 'グループの会話を全部読んで、やることらしい発言を拾います。取りこぼしがいちばん少ない設定です。',
  },
  {
    label: '呼ばれたときだけ',
    body: '名前を呼ばれた発言だけを扱います。雑談が多いグループや、読まれるのが気になる場合はこちら。',
  },
  {
    label: '止める',
    body: '拾いません。グループに居るだけの状態です。',
  },
]

const commands = [
  { input: '一覧', effect: '終わっていないタスクを番号付きでお送りします' },
  { input: '完了 3', effect: 'その番号のタスクを完了にします' },
  { input: 'タスク追加 見積もりを送る', effect: 'その場でタスクを1件お預かりします' },
  { input: 'ヘルプ', effect: '使い方をお送りします' },
  { input: '練習', effect: 'タスクの登録と完了を、その場で練習できます' },
]

const channels = [
  { name: 'LINE', status: '使えます' },
  { name: 'Slack', status: '使えます' },
  { name: 'Chatwork', status: 'お試し中' },
  { name: 'Google Chat', status: 'お試し中' },
  { name: 'Microsoft Teams', status: 'お試し中' },
  { name: 'Discord', status: 'お試し中' },
]

const planRows = [
  { feature: '会話からやることを拾う', free: 'あり', pro: 'あり' },
  { feature: '届くタイミング', free: '1日1回のまとめ', pro: 'その場で' },
  { feature: '相手に表示される名前', free: '共通のアカウント', pro: '自社のLINE公式アカウント' },
  { feature: '担当者への1対1メッセージ', free: '—', pro: 'あり' },
  { feature: '時刻を決めたリマインド', free: '—', pro: 'あり' },
  { feature: 'LINE以外のチャット', free: '—', pro: 'あり' },
  { feature: 'つなげるグループ数', free: '3グループ', pro: '50グループ' },
]

/* ─── Page ─── */

export default function SecretaryPage() {
  return (
    <main className="font-sans antialiased text-slate-900 bg-surface min-h-screen">
      <LPHeader />

      {/* ──── Hero ──── */}
      <section className="pt-32 pb-20 bg-slate-50">
        <div className="container mx-auto px-6 text-center max-w-3xl">
          <div className="inline-block px-3 py-1 mb-4 text-xs font-bold tracking-wide text-amber-600 bg-amber-100 rounded-full">
            AI秘書
          </div>
          <h1 className="text-4xl lg:text-5xl font-bold mb-6 text-slate-900">
            チャットの会話は、<br className="hidden sm:block" />
            そのままにしておく。
          </h1>
          <p className="text-lg text-slate-600 leading-relaxed">
            秘書がグループに入って、やることを拾い、期限を追いかけます。<br className="hidden md:block" />
            お客様にもチームにも、新しいツールを覚えていただく必要はありません。
          </p>
        </div>
      </section>

      {/* ──── 流れ ──── */}
      <section className="py-20 bg-surface">
        <div className="container mx-auto px-6 max-w-3xl">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-center mb-12"
          >
            <h2 className="text-3xl font-bold text-slate-900 mb-4">どう動くか</h2>
            <p className="text-slate-500 text-sm">4つの手順です。難しい設定はありません。</p>
          </motion.div>

          <div className="space-y-4">
            {flow.map((step, i) => (
              <motion.div
                key={step.n}
                initial={{ opacity: 0, y: 14 }}
                whileInView={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05 }}
                viewport={{ once: true }}
                className="bg-surface rounded-2xl border border-slate-200 p-6 flex items-start gap-4"
              >
                <div className="w-9 h-9 rounded-full bg-amber-500 text-white font-bold text-sm flex items-center justify-center shrink-0">
                  {step.n}
                </div>
                <div className="min-w-0">
                  <h3 className="font-bold text-slate-900 mb-1.5">{step.title}</h3>
                  <p className="text-sm text-slate-600 leading-relaxed">{step.body}</p>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ──── 読まれるのが不安な方へ ──── */}
      <section className="py-20 bg-slate-50">
        <div className="container mx-auto px-6 max-w-3xl">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
          >
            <div className="flex items-center gap-3 mb-3">
              <Eye size={24} weight="duotone" className="text-amber-600" />
              <h2 className="text-2xl font-bold text-slate-900">どこまで読むかは、選べます</h2>
            </div>
            <p className="text-sm text-slate-600 leading-relaxed mb-6">
              「会話を全部読まれるのは困る」という声は多いので、グループごとに3段階から選べるようにしています。
              あとから変えられます。
            </p>

            <div className="grid sm:grid-cols-3 gap-3">
              {pickupModes.map((m) => (
                <div key={m.label} className="bg-surface rounded-xl border border-slate-200 p-5">
                  <div className="font-bold text-slate-900 mb-2 text-[15px]">{m.label}</div>
                  <p className="text-xs text-slate-600 leading-relaxed">{m.body}</p>
                </div>
              ))}
            </div>
          </motion.div>
        </div>
      </section>

      {/* ──── 打てる合図 ──── */}
      <section className="py-20 bg-surface">
        <div className="container mx-auto px-6 max-w-3xl">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
          >
            <div className="flex items-center gap-3 mb-3">
              <ChatCircle size={24} weight="duotone" className="text-amber-600" />
              <h2 className="text-2xl font-bold text-slate-900">チャットから、そのまま操作できます</h2>
            </div>
            <p className="text-sm text-slate-600 leading-relaxed mb-6">
              画面を開かなくても、グループに打つだけで済みます。覚えるのは5つだけです。
            </p>

            <div className="bg-surface rounded-2xl border border-slate-200 overflow-hidden">
              {commands.map((c) => (
                <div
                  key={c.input}
                  className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 px-5 py-4 border-b border-slate-100 last:border-b-0"
                >
                  <code className="text-sm font-mono bg-slate-900 text-slate-100 px-3 py-1.5 rounded-md shrink-0 self-start">
                    {c.input}
                  </code>
                  <span className="text-sm text-slate-600">{c.effect}</span>
                </div>
              ))}
            </div>
            <p className="text-xs text-slate-400 mt-3">
              LINEでは、届いたお知らせのボタンを押しても完了にできます。
            </p>
          </motion.div>
        </div>
      </section>

      {/* ──── 対応チャット ──── */}
      <section className="py-20 bg-slate-50">
        <div className="container mx-auto px-6 max-w-3xl">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
          >
            <h2 className="text-2xl font-bold text-slate-900 mb-6">入れる場所</h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-6">
              {channels.map((c) => (
                <div
                  key={c.name}
                  className="bg-surface rounded-xl border border-slate-200 px-4 py-3.5 flex items-center justify-between gap-2"
                >
                  <span className="text-sm font-bold text-slate-800 truncate">{c.name}</span>
                  <span
                    className={`text-[11px] font-bold px-2 py-1 rounded-md border shrink-0 ${
                      c.status === '使えます'
                        ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                        : 'bg-amber-50 text-amber-700 border-amber-200'
                    }`}
                  >
                    {c.status}
                  </span>
                </div>
              ))}
            </div>
            <Link
              href="/integrations"
              className="inline-flex items-center gap-1.5 text-sm font-bold text-amber-600 hover:text-amber-700 transition-colors"
            >
              連携できるサービスの一覧へ
              <ArrowRight weight="bold" size={14} />
            </Link>
          </motion.div>
        </div>
      </section>

      {/* ──── 無料とProの違い ──── */}
      <section className="py-20 bg-surface">
        <div className="container mx-auto px-6 max-w-3xl">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
          >
            <div className="flex items-center gap-3 mb-3">
              <IdentificationCard size={24} weight="duotone" className="text-amber-600" />
              <h2 className="text-2xl font-bold text-slate-900">無料とProの違い</h2>
            </div>
            <p className="text-sm text-slate-600 leading-relaxed mb-6">
              大きな違いは2つ。<span className="font-bold text-slate-900">誰の名前で相手に届くか</span>と、
              <span className="font-bold text-slate-900">いつ届くか</span>です。
            </p>

            <div className="bg-surface rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
              <div className="overflow-x-auto">
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200">
                      <th className="p-4 text-left text-sm font-bold text-slate-700">できること</th>
                      <th className="p-4 text-center text-sm font-bold text-slate-500">無料</th>
                      <th className="p-4 text-center text-sm font-bold text-amber-600 bg-amber-50/50">Pro</th>
                    </tr>
                  </thead>
                  <tbody>
                    {planRows.map((row) => (
                      <tr key={row.feature} className="border-b border-slate-100 last:border-b-0">
                        <td className="p-4 text-sm text-slate-700 font-medium">{row.feature}</td>
                        <td className="p-4 text-center text-sm text-slate-500">{row.free}</td>
                        <td className="p-4 text-center text-sm text-slate-900 font-medium bg-amber-50/30">{row.pro}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="mt-5 flex flex-wrap items-center gap-4">
              <Link
                href="/pricing"
                className="inline-flex items-center gap-2 px-5 py-2.5 bg-amber-500 text-white font-bold rounded-lg hover:bg-amber-600 transition-colors text-sm"
              >
                料金を見る
                <ArrowRight weight="bold" size={14} />
              </Link>
              <p className="text-xs text-slate-400">自社のLINE公式アカウントでの配信は、開通をこちらで代行します。</p>
            </div>
          </motion.div>
        </div>
      </section>

      {/* ──── 安心して使うために ──── */}
      <section className="py-20 bg-slate-50">
        <div className="container mx-auto px-6 max-w-3xl">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="bg-surface rounded-2xl border border-slate-200 p-8"
          >
            <div className="flex items-center gap-3 mb-5">
              <ShieldCheck size={24} weight="duotone" className="text-amber-600" />
              <h2 className="text-2xl font-bold text-slate-900">勝手に増やしません</h2>
            </div>
            <ul className="space-y-3 mb-6">
              {[
                '拾ったものは申し送りとして溜まり、人が見てからタスクになります',
                'グループごとに、どこまで読むかを3段階で選べます',
                'つないだグループはいつでも外せます',
                '秘書が行った操作も、ふつうの操作と同じように記録に残ります',
              ].map((t) => (
                <li key={t} className="flex items-start gap-2.5 text-sm text-slate-600">
                  <Check weight="bold" className="text-emerald-500 shrink-0 mt-0.5" size={16} />
                  <span>{t}</span>
                </li>
              ))}
            </ul>
            <Link
              href="/security"
              className="inline-flex items-center gap-1.5 text-sm font-bold text-amber-600 hover:text-amber-700 transition-colors"
            >
              セキュリティの詳しい説明へ
              <ArrowRight weight="bold" size={14} />
            </Link>
          </motion.div>
        </div>
      </section>

      {/* ──── 業種別 ──── */}
      <section className="py-16 bg-surface">
        <div className="container mx-auto px-6 max-w-3xl text-center">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
          >
            <BellRinging size={28} weight="duotone" className="text-amber-600 mx-auto mb-4" />
            <h2 className="text-2xl font-bold text-slate-900 mb-3">業種ごとの動きも見られます</h2>
            <p className="text-sm text-slate-600 leading-relaxed mb-6">
              税理士・社労士・建設の元請け・行政書士・賃貸管理・司法書士・人事労務・保険代理店。
              それぞれ回収する書類が違うので、業種ごとにページを用意しています。
            </p>
            <Link
              href="/"
              className="inline-flex items-center gap-1.5 text-sm font-bold text-amber-600 hover:text-amber-700 transition-colors"
            >
              業種別のページを見る
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
