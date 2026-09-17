'use client'

import { LPHeader } from '@/components/lp/Header'
import { LPFooter } from '@/components/lp/Footer'
import { CTABand } from '@/components/lp/CTABand'
import { motion } from 'framer-motion'
import { ArrowRight, ChatCircle, ListChecks, Receipt, GitBranch, Robot, CalendarBlank } from '@phosphor-icons/react'
import Link from 'next/link'

/* ─── Data ─── */
// 実装状況の出どころ:
//   チャット      src/lib/channels/registry.ts（status: ga | beta | planned）
//   タスクツール  src/lib/task-sync/implemented.ts
//   見積・請求    src/lib/accounting/types.ts
// 新しく足したら、ここも直す

type Status = 'ga' | 'beta' | 'planned'

const STATUS_LABEL: Record<Status, { text: string; className: string }> = {
  ga: { text: '使えます', className: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  beta: { text: 'お試し中', className: 'bg-amber-50 text-amber-700 border-amber-200' },
  planned: { text: '準備中', className: 'bg-slate-100 text-slate-500 border-slate-200' },
}

const groups = [
  {
    icon: ChatCircle,
    title: 'チャット',
    lead: 'AI秘書がこの部屋に入り、会話からタスクを拾います。相手先とのグループにも入れます。',
    items: [
      { name: 'LINE', status: 'ga' as Status, note: '共通LINE／自社LINEの両方' },
      { name: 'Slack', status: 'ga' as Status, note: '' },
      { name: 'Chatwork', status: 'beta' as Status, note: '' },
      { name: 'Google Chat', status: 'beta' as Status, note: '' },
      { name: 'Microsoft Teams', status: 'beta' as Status, note: '' },
      { name: 'Discord', status: 'beta' as Status, note: '' },
      { name: 'メール', status: 'planned' as Status, note: '' },
    ],
  },
  {
    icon: ListChecks,
    title: 'いま使っているタスク管理ツール',
    lead: '乗り換えは要りません。いまのツールとタスクをやりとりできます。',
    items: [
      { name: 'Backlog', status: 'ga' as Status, note: '' },
      { name: 'Jooto', status: 'ga' as Status, note: '' },
      { name: 'Jira', status: 'ga' as Status, note: '' },
      { name: 'Redmine', status: 'ga' as Status, note: '' },
      { name: 'Asana', status: 'ga' as Status, note: '' },
      { name: 'Trello', status: 'ga' as Status, note: '' },
      { name: 'Linear', status: 'ga' as Status, note: '' },
      { name: 'Notion', status: 'ga' as Status, note: '' },
      { name: 'kintone', status: 'ga' as Status, note: '' },
      { name: 'Google Tasks', status: 'ga' as Status, note: '完了すると双方に反映' },
    ],
  },
  {
    icon: Receipt,
    title: '見積書・請求書',
    lead: '承認された見積もりから、そのまま書類を作れます。会計の帳簿には触りません。',
    items: [
      { name: 'freee請求書', status: 'ga' as Status, note: '' },
      { name: 'マネーフォワード クラウド請求書', status: 'ga' as Status, note: '' },
      { name: 'Misoca', status: 'ga' as Status, note: '' },
    ],
  },
  {
    icon: GitBranch,
    title: '開発',
    lead: 'プルリクエストや課題を、案件のタスクに結びつけます。',
    items: [
      { name: 'GitHub', status: 'ga' as Status, note: 'PRの取り込みで担当者へ通知' },
    ],
  },
  {
    icon: CalendarBlank,
    title: '予定',
    lead: '日程調整の結果を、そのままカレンダーに入れます。',
    items: [
      { name: 'Google カレンダー', status: 'ga' as Status, note: '' },
    ],
  },
  {
    icon: Robot,
    title: 'AIから直接つなぐ',
    lead: 'お使いのAIから、AgentPMのタスクや議事録を直接さわれます。',
    items: [
      { name: 'MCP（Claude Code など手元のAIツール）', status: 'ga' as Status, note: 'APIキーを発行してつなぐ' },
      { name: 'ブラウザのAIから直接つなぐ', status: 'planned' as Status, note: 'ChatGPT などの「コネクタ」対応' },
      { name: 'コマンドライン（agentpm）', status: 'ga' as Status, note: 'npm から入れて使う' },
    ],
  },
]

/* ─── Page ─── */

export default function IntegrationsPage() {
  return (
    <main className="font-sans antialiased text-slate-900 bg-surface min-h-screen">
      <LPHeader />

      {/* ──── Hero ──── */}
      <section className="pt-32 pb-20 bg-slate-50">
        <div className="container mx-auto px-6 text-center max-w-3xl">
          <div
            className="inline-block px-3 py-1 mb-4 text-xs font-bold tracking-wide text-amber-600 bg-amber-100 rounded-full"
          >
            連携できるサービス
          </div>
          <h1
            className="text-4xl lg:text-5xl font-bold mb-6 text-slate-900"
          >
            いま使っているものは、<br className="hidden sm:block" />
            そのまま使えます。
          </h1>
          <p
            className="text-lg text-slate-600 leading-relaxed"
          >
            チャットもタスク管理ツールも、乗り換える必要はありません。<br className="hidden md:block" />
            お客様に新しいツールを覚えていただく手間もかかりません。
          </p>
        </div>
      </section>

      {/* ──── グループ ──── */}
      <section className="py-20 bg-surface">
        <div className="container mx-auto px-6 max-w-4xl space-y-14">
          {groups.map((group, gi) => (
            <motion.div
              key={group.title}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              transition={{ delay: gi * 0.04 }}
              viewport={{ once: true }}
            >
              <div className="flex items-center gap-3 mb-2">
                <div className="w-10 h-10 rounded-xl bg-amber-50 flex items-center justify-center shrink-0">
                  <group.icon size={22} weight="duotone" className="text-amber-600" />
                </div>
                <h2 className="text-2xl font-bold text-slate-900">{group.title}</h2>
              </div>
              <p className="text-sm text-slate-600 leading-relaxed mb-5 pl-[52px]">{group.lead}</p>

              <div className="grid sm:grid-cols-2 gap-3">
                {group.items.map((item) => {
                  const badge = STATUS_LABEL[item.status]
                  return (
                    <div
                      key={item.name}
                      className="flex items-center justify-between gap-3 bg-surface rounded-xl border border-slate-200 px-4 py-3.5"
                    >
                      <div className="min-w-0">
                        <div className="text-sm font-bold text-slate-800 truncate">{item.name}</div>
                        {item.note && <div className="text-xs text-slate-400 mt-0.5 truncate">{item.note}</div>}
                      </div>
                      <span className={`text-[11px] font-bold px-2 py-1 rounded-md border shrink-0 ${badge.className}`}>
                        {badge.text}
                      </span>
                    </div>
                  )
                })}
              </div>
            </motion.div>
          ))}
        </div>
      </section>

      {/* ──── 補足 ──── */}
      <section className="py-16 bg-slate-50">
        <div className="container mx-auto px-6 max-w-3xl">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="bg-surface rounded-2xl border border-slate-200 p-8"
          >
            <h2 className="text-xl font-bold text-slate-900 mb-4">言葉の意味</h2>
            <dl className="space-y-3 text-sm mb-8">
              <div className="flex gap-3">
                <dt className="font-bold text-emerald-700 shrink-0 w-20">使えます</dt>
                <dd className="text-slate-600">送受信とも動いています。本番の案件で使えます。</dd>
              </div>
              <div className="flex gap-3">
                <dt className="font-bold text-amber-700 shrink-0 w-20">お試し中</dt>
                <dd className="text-slate-600">送信は動いています。受け取り側や細かい機能はこれから広げます。</dd>
              </div>
              <div className="flex gap-3">
                <dt className="font-bold text-slate-500 shrink-0 w-20">準備中</dt>
                <dd className="text-slate-600">これから作ります。時期はまだお約束できません。</dd>
              </div>
            </dl>

            <p className="text-sm text-slate-600 leading-relaxed mb-5">
              お使いのツールが見当たらない場合はご相談ください。よく求められるものから順に足しています。
              連携の数で料金は変わりません。
            </p>
            <Link
              href="/contact?topic=integration"
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-amber-500 text-white font-bold rounded-lg hover:bg-amber-600 transition-colors text-sm"
            >
              つなぎたいツールを相談する
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
