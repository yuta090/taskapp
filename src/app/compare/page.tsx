'use client'

import { LPHeader } from '@/components/lp/Header'
import { LPFooter } from '@/components/lp/Footer'
import { CTABand } from '@/components/lp/CTABand'
import { motion } from 'framer-motion'
import { Check, X, ArrowRight, FileArrowDown, ShieldCheck, Lock, ClockCounterClockwise, ChatCircle, ArrowSquareOut } from '@phosphor-icons/react'
import Link from 'next/link'

/* ─── Rating badge component ─── */

function RatingBadge({ value }: { value: string }) {
  if (value === '---') return <span className="text-slate-300 font-medium">---</span>
  if (value.startsWith('\u25CE')) {
    const rest = value.slice(1).trim()
    return <span className="text-emerald-500 font-bold">{'\u25CE'}{rest ? <span className="text-xs ml-0.5">{rest}</span> : null}</span>
  }
  if (value.startsWith('\u25CB')) {
    const rest = value.slice(1).trim()
    return <span className="text-blue-500 font-bold">{'\u25CB'}{rest ? <span className="text-xs ml-0.5">{rest}</span> : null}</span>
  }
  if (value.startsWith('\u25B3')) {
    const rest = value.slice(1).trim()
    return <span className="text-amber-500 font-bold">{'\u25B3'}{rest ? <span className="text-xs ml-0.5">{rest}</span> : null}</span>
  }
  if (value.startsWith('\u00D7')) return <span className="text-slate-300 font-medium">{'\u00D7'}</span>
  return <span className="text-slate-500 text-xs">{value}</span>
}

/* ─── Data ─── */

const mainComparisonRows = [
  { feature: '日本語UI', agentpm: '\u25CB', backlog: '\u25CB', jira: '\u25B3 翻訳ベース', linear: '\u00D7 英語のみ', redmine: '\u25CB' },
  { feature: 'AI/CLI操作', agentpm: '\u25CE スキル+CLI', backlog: '\u25CB AIアシスタント', jira: '\u25CB Rovo', linear: '\u25CB', redmine: '\u00D7' },
  { feature: 'ポータル（アカウント不要）', agentpm: '\u25CE', backlog: '\u00D7 要アカウント', jira: '\u00D7 別製品', linear: '\u00D7', redmine: '\u00D7' },
  { feature: 'ボール管理', agentpm: '\u25CE', backlog: '\u00D7', jira: '\u00D7', linear: '\u00D7', redmine: '\u00D7' },
  { feature: '代理店モード', agentpm: '\u25CE', backlog: '\u00D7', jira: '\u00D7', linear: '\u00D7', redmine: '\u00D7' },
  { feature: '見積もり・承認連動', agentpm: '\u25CE', backlog: '\u00D7', jira: '\u00D7', linear: '\u00D7', redmine: '\u00D7' },
  { feature: '仕様書・証跡の一体管理', agentpm: '\u25CE', backlog: '\u25B3 Wiki別', jira: '\u25B3 Confluence別', linear: '\u00D7', redmine: '\u25B3' },
  { feature: 'SSO/SAML', agentpm: '\u25CB Business以上', backlog: '\u25CB Premium以上', jira: '\u25CB', linear: '\u25CB', redmine: '\u25B3' },
  { feature: 'GitHub連携', agentpm: '\u25CB', backlog: '\u25CB', jira: '\u25CE', linear: '\u25CE', redmine: '\u25B3' },
  { feature: 'テンプレ\u2192当日稼働', agentpm: '\u25CE', backlog: '\u25CB', jira: '\u25B3', linear: '\u25CB', redmine: '\u25B3' },
  { feature: 'エンタープライズ', agentpm: '\u25CB SSO/監査対応', backlog: '\u25CB', jira: '\u25CE', linear: '\u25CB', redmine: '\u25B3' },
]

const agencyComparisonRows = [
  { feature: '原価/売値の分離表示', agentpm: true, others: '手動管理' },
  { feature: 'ベンダーポータル', agentpm: true, others: 'アカウント共有必要' },
  { feature: '3段階承認フロー', agentpm: true, others: 'カスタム開発必要' },
  { feature: 'マージン自動計算', agentpm: true, others: 'Excel別管理' },
  { feature: 'クライアントへの原価非表示', agentpm: true, others: '運用ルール対応' },
]

const backlogGapRows = [
  { feature: 'ガントチャート', starter: false, standard: true },
  { feature: 'バーンダウンチャート', starter: false, standard: true },
  { feature: 'テンプレート機能', starter: false, standard: true },
  { feature: 'IP制限', starter: false, standard: true },
  { feature: 'プロジェクト数', starter: '5', standard: '100' },
]

const priceComparisonRows = [
  { size: '5名', agentpm: '¥4,980', agentpmPlan: 'Team', backlog: '¥17,600', backlogPlan: 'Standard', diff: '-¥12,620' },
  { size: '10名', agentpm: '¥4,980', agentpmPlan: 'Team', backlog: '¥17,600', backlogPlan: 'Standard', diff: '-¥12,620' },
  { size: '15名', agentpm: '¥6,880', agentpmPlan: 'Team', backlog: '¥17,600', backlogPlan: 'Standard', diff: '-¥10,720' },
  { size: '20名', agentpm: '¥14,800', agentpmPlan: 'Business', backlog: '¥17,600', backlogPlan: 'Standard', diff: '-¥2,800' },
  { size: '30名', agentpm: '¥14,800', agentpmPlan: 'Business', backlog: '¥17,600', backlogPlan: 'Standard', diff: '-¥2,800' },
]

const fitForAgentPM = [
  'クライアント向けポータルが欲しい',
  'ボール管理で「誰待ち？」を明確にしたい',
  'AI/CLIで日報・進捗管理を自動化したい',
  '仕様書・議事録・証跡を一体管理したい',
  '代理店モードで原価/売値を分離したい',
  'テンプレートで当日稼働したい',
  'SSO/SAMLでセキュアに運用したい',
]

const fitForOthers = [
  {
    tool: 'Backlog',
    reasons: [
      '社内開発チームのみで使い、外部共有が不要',
      'Wiki・Git・課題管理の統合UIが好き',
      '日本語サポートの手厚さを重視',
    ],
  },
  {
    tool: 'Jira',
    reasons: [
      '500名以上のエンタープライズ規模',
      'Atlassian製品群（Confluence・Bitbucket）と統合したい',
      '高度なワークフローカスタマイズが必要',
    ],
  },
  {
    tool: 'Linear',
    reasons: [
      '社内SaaS開発チームでスプリントに集中したい',
      'GitHub Issuesからの移行を検討中',
      '英語UIで構わない',
    ],
  },
]

const approvalPackItems = [
  {
    title: '比較表PDF',
    description: '本ページの内容をA4にまとめた社内配布用資料',
    icon: FileArrowDown,
  },
  {
    title: 'ROI試算シート',
    description: '工数削減効果を自社の人件費で試算できるExcel',
    icon: FileArrowDown,
  },
  {
    title: 'セキュリティチェックシート',
    description: '情シス向け。暗号化・認証・監査ログ対応状況',
    icon: ShieldCheck,
  },
  {
    title: '移行計画テンプレート',
    description: 'Backlog等からの移行スケジュール雛形',
    icon: FileArrowDown,
  },
]

const enterpriseReady = [
  { label: 'SSO/SAML対応済み', done: true },
  { label: 'TLS 1.3 + AES-256暗号化', done: true },
  { label: 'Row Level Security (RLS)', done: true },
  { label: '監査ログ', done: true },
]

const enterprisePlanned = [
  { label: 'SCIM プロビジョニング', when: 'Q4 2026' },
  { label: '細粒度権限管理', when: '2027' },
  { label: 'SLA保証', when: '2027' },
  { label: 'ISO 27001', when: '2026年内' },
  { label: 'SOC 2', when: '2027' },
]

/* ─── Page Component ─── */

export default function ComparePage() {
  return (
    <main className="font-sans antialiased text-slate-900 bg-white min-h-screen">
      <LPHeader />

      {/* ──── Hero ──── */}
      <section className="pt-32 pb-20 bg-slate-50">
        <div className="container mx-auto px-6 text-center max-w-3xl">
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="inline-block px-3 py-1 mb-4 text-xs font-bold tracking-wider text-amber-600 uppercase bg-amber-100 rounded-full"
          >
            Honest Comparison
          </motion.div>
          <motion.h1
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="text-4xl lg:text-5xl font-bold mb-6 text-slate-900"
          >
            正直に比べます。
          </motion.h1>
          <motion.p
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="text-lg text-slate-600 mb-8 leading-relaxed"
          >
            PMツールはたくさんあります。AgentPMが向いているケース、<br className="hidden md:block" />
            他ツールが向いているケースを正直にお伝えします。
          </motion.p>
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="space-y-1"
          >
            <p className="text-xs text-slate-400">
              ※ 2026年3月時点、各社公式サイト公開情報に基づく当社調べ
            </p>
            <p className="text-xs text-slate-400">
              ※ 各製品の最新情報は公式サイトをご確認ください
            </p>
          </motion.div>
        </div>
      </section>

      {/* ──── TCO概要 ──── */}
      <section className="py-16 bg-white">
        <div className="container mx-auto px-6 max-w-3xl">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="bg-gradient-to-br from-slate-50 to-amber-50/30 rounded-2xl border border-slate-200 p-8 lg:p-10"
          >
            <h2 className="text-xl font-bold text-slate-900 mb-4">
              PMツール選びで、月額だけ比較していませんか？
            </h2>
            <p className="text-slate-600 text-sm leading-relaxed mb-4">
              本当に比較すべきは「ツール代」ではなく「報告・確認・承認にかけている時間」です。
              5名チームの場合、報告・転記・催促だけで月
              <span className="font-bold text-slate-900">¥24,000〜¥72,000</span>
              の人件費がかかっています。
            </p>
            <Link
              href="/pricing#tco"
              className="inline-flex items-center gap-1.5 text-sm font-bold text-amber-600 hover:text-amber-700 transition-colors"
            >
              詳しい試算は料金ページのTCO比較へ
              <ArrowRight weight="bold" size={14} />
            </Link>
          </motion.div>
        </div>
      </section>

      {/* ──── 機能比較表 ──── */}
      <section className="py-20 bg-slate-50">
        <div className="container mx-auto px-6">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-center mb-12"
          >
            <span className="text-xs font-bold tracking-[0.2em] uppercase text-slate-400 mb-3 block">Feature Comparison</span>
            <h2 className="text-3xl font-bold text-slate-900 mb-4">機能比較表</h2>
            <p className="text-slate-500 max-w-2xl mx-auto text-sm leading-relaxed">
              クライアントワークに必要な機能を中心に、主要PMツールと比較しました。
            </p>
          </motion.div>

          {/* Desktop Table */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="hidden lg:block max-w-5xl mx-auto"
          >
            <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
              <div className="overflow-x-auto">
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200">
                      <th className="p-4 text-left text-sm font-bold text-slate-700 w-[220px] sticky left-0 bg-slate-50 z-10">機能</th>
                      <th className="p-4 text-center text-sm font-bold text-amber-600 bg-amber-50/50">AgentPM</th>
                      <th className="p-4 text-center text-sm font-bold text-slate-700">Backlog</th>
                      <th className="p-4 text-center text-sm font-bold text-slate-700">Jira</th>
                      <th className="p-4 text-center text-sm font-bold text-slate-700">Linear</th>
                      <th className="p-4 text-center text-sm font-bold text-slate-700">Redmine</th>
                    </tr>
                  </thead>
                  <tbody>
                    {mainComparisonRows.map((row, i) => (
                      <tr key={i} className="border-b border-slate-100 last:border-b-0 hover:bg-slate-50/50 transition-colors">
                        <td className="p-4 text-sm text-slate-700 font-medium sticky left-0 bg-white z-10">{row.feature}</td>
                        <td className="p-4 text-center bg-amber-50/30"><RatingBadge value={row.agentpm} /></td>
                        <td className="p-4 text-center"><RatingBadge value={row.backlog} /></td>
                        <td className="p-4 text-center"><RatingBadge value={row.jira} /></td>
                        <td className="p-4 text-center"><RatingBadge value={row.linear} /></td>
                        <td className="p-4 text-center"><RatingBadge value={row.redmine} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="mt-4 flex flex-wrap gap-4 justify-center text-xs text-slate-400">
              <span><span className="text-emerald-500 font-bold">{'\u25CE'}</span> = 特に優れている</span>
              <span><span className="text-blue-500 font-bold">{'\u25CB'}</span> = 対応</span>
              <span><span className="text-amber-500 font-bold">{'\u25B3'}</span> = 一部対応</span>
              <span><span className="text-slate-300">{'\u00D7'}</span> = 非対応</span>
            </div>
          </motion.div>

          {/* Mobile Cards */}
          <div className="lg:hidden max-w-md mx-auto space-y-3">
            {mainComparisonRows.map((row, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 10 }}
                whileInView={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.03 }}
                viewport={{ once: true }}
                className="bg-white rounded-xl p-4 border border-slate-200"
              >
                <div className="text-sm text-slate-700 font-medium mb-2">{row.feature}</div>
                <div className="grid grid-cols-5 gap-2 text-center">
                  <div>
                    <div className="text-[10px] text-amber-600 font-bold mb-1">AgentPM</div>
                    <RatingBadge value={row.agentpm} />
                  </div>
                  <div>
                    <div className="text-[10px] text-slate-400 mb-1">Backlog</div>
                    <RatingBadge value={row.backlog} />
                  </div>
                  <div>
                    <div className="text-[10px] text-slate-400 mb-1">Jira</div>
                    <RatingBadge value={row.jira} />
                  </div>
                  <div>
                    <div className="text-[10px] text-slate-400 mb-1">Linear</div>
                    <RatingBadge value={row.linear} />
                  </div>
                  <div>
                    <div className="text-[10px] text-slate-400 mb-1">Redmine</div>
                    <RatingBadge value={row.redmine} />
                  </div>
                </div>
              </motion.div>
            ))}
            <div className="flex flex-wrap gap-3 justify-center text-xs text-slate-400 pt-2">
              <span><span className="text-emerald-500 font-bold">{'\u25CE'}</span> 特に優れている</span>
              <span><span className="text-blue-500 font-bold">{'\u25CB'}</span> 対応</span>
              <span><span className="text-amber-500 font-bold">{'\u25B3'}</span> 一部対応</span>
              <span><span className="text-slate-300">{'\u00D7'}</span> 非対応</span>
            </div>
          </div>
        </div>
      </section>

      {/* ──── 代理店モード詳細比較 ──── */}
      <section className="py-20 bg-white">
        <div className="container mx-auto px-6">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-center mb-12"
          >
            <span className="text-xs font-bold tracking-[0.2em] uppercase text-slate-400 mb-3 block">Agency Mode</span>
            <h2 className="text-3xl font-bold text-slate-900 mb-4">代理店モード詳細比較</h2>
            <p className="text-slate-500 max-w-2xl mx-auto text-sm leading-relaxed">
              代理店・制作会社の「原価管理」に特化した機能は、AgentPMだけ。
            </p>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="max-w-3xl mx-auto"
          >
            <div className="grid md:grid-cols-2 gap-6">
              {/* AgentPM Card */}
              <div className="bg-amber-50/50 rounded-2xl border border-amber-200 p-6">
                <div className="flex items-center gap-2 mb-6">
                  <div className="w-8 h-8 bg-amber-500 rounded-lg flex items-center justify-center">
                    <span className="text-white font-bold text-xs">A</span>
                  </div>
                  <span className="font-bold text-lg text-slate-900">AgentPM</span>
                </div>
                <ul className="space-y-4">
                  {agencyComparisonRows.map((row) => (
                    <li key={row.feature} className="flex items-start gap-3">
                      <Check weight="bold" className="text-emerald-500 shrink-0 mt-0.5" size={18} />
                      <span className="text-sm text-slate-700 font-medium">{row.feature}</span>
                    </li>
                  ))}
                </ul>
              </div>

              {/* Others Card */}
              <div className="bg-slate-50 rounded-2xl border border-slate-200 p-6">
                <div className="flex items-center gap-2 mb-6">
                  <div className="w-8 h-8 bg-slate-300 rounded-lg flex items-center justify-center">
                    <span className="text-white font-bold text-xs">...</span>
                  </div>
                  <span className="font-bold text-lg text-slate-500">他ツール</span>
                </div>
                <ul className="space-y-4">
                  {agencyComparisonRows.map((row) => (
                    <li key={row.feature} className="flex items-start gap-3">
                      <X weight="bold" className="text-slate-300 shrink-0 mt-0.5" size={18} />
                      <div>
                        <span className="text-sm text-slate-500">{row.feature}</span>
                        <span className="block text-xs text-slate-400 mt-0.5">{row.others}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </motion.div>
        </div>
      </section>

      {/* ──── なぜBacklog Standardと比較するのか？ ──── */}
      <section className="py-20 bg-slate-50">
        <div className="container mx-auto px-6 max-w-4xl">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-center mb-12"
          >
            <span className="text-xs font-bold tracking-[0.2em] uppercase text-slate-400 mb-3 block">Why Standard?</span>
            <h2 className="text-2xl lg:text-3xl font-bold text-slate-900 mb-4">
              なぜBacklog Standardと比較するのか？
            </h2>
            <p className="text-slate-500 max-w-2xl mx-auto text-sm leading-relaxed">
              Backlog Starterプラン（¥2,970/月）は一見安価ですが、受託・制作で必要な機能が含まれていません。
            </p>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
          >
            <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm mb-6">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200">
                    <th className="p-4 text-left text-sm font-bold text-slate-700">機能</th>
                    <th className="p-4 text-center text-sm font-bold text-slate-400">
                      <div>Starter</div>
                      <div className="text-xs font-normal text-slate-400">¥2,970/月</div>
                    </th>
                    <th className="p-4 text-center text-sm font-bold text-slate-700">
                      <div>Standard</div>
                      <div className="text-xs font-normal text-slate-500">¥17,600/月</div>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {backlogGapRows.map((row, i) => (
                    <tr key={i} className="border-b border-slate-100 last:border-b-0">
                      <td className="p-4 text-sm text-slate-700 font-medium">{row.feature}</td>
                      <td className="p-4 text-center">
                        {typeof row.starter === 'boolean' ? (
                          row.starter ? (
                            <Check weight="bold" className="text-emerald-500 mx-auto" size={18} />
                          ) : (
                            <X weight="bold" className="text-slate-300 mx-auto" size={18} />
                          )
                        ) : (
                          <span className="text-sm text-slate-500">{row.starter}</span>
                        )}
                      </td>
                      <td className="p-4 text-center">
                        {typeof row.standard === 'boolean' ? (
                          row.standard ? (
                            <Check weight="bold" className="text-emerald-500 mx-auto" size={18} />
                          ) : (
                            <X weight="bold" className="text-slate-300 mx-auto" size={18} />
                          )
                        ) : (
                          <span className="text-sm text-slate-700 font-medium">{row.standard}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex items-center justify-between bg-amber-50 rounded-xl border border-amber-200 p-4">
              <p className="text-sm text-amber-800">
                <span className="font-bold">結論：</span>受託・制作では Standard（¥17,600/月）が実質スタートライン
              </p>
              <a
                href="https://backlog.com/ja/pricing/"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs text-amber-600 hover:text-amber-700 font-medium shrink-0 ml-4"
              >
                出典
                <ArrowSquareOut size={12} />
              </a>
            </div>
          </motion.div>
        </div>
      </section>

      {/* ──── 料金比較 ──── */}
      <section className="py-20 bg-white">
        <div className="container mx-auto px-6 max-w-4xl">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-center mb-12"
          >
            <span className="text-xs font-bold tracking-[0.2em] uppercase text-slate-400 mb-3 block">Price Comparison</span>
            <h2 className="text-3xl font-bold text-slate-900 mb-4">料金比較</h2>
            <p className="text-slate-500 max-w-2xl mx-auto text-sm leading-relaxed">
              同等機能で比較した場合、AgentPMは最大で月¥12,620お得です。
            </p>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
          >
            <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
              <div className="overflow-x-auto">
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200">
                      <th className="p-4 text-left text-sm font-bold text-slate-700">チーム規模</th>
                      <th className="p-4 text-center text-sm font-bold text-amber-600 bg-amber-50/50">AgentPM</th>
                      <th className="p-4 text-center text-sm font-bold text-slate-700">Backlog（実質）</th>
                      <th className="p-4 text-center text-sm font-bold text-emerald-600">差額</th>
                    </tr>
                  </thead>
                  <tbody>
                    {priceComparisonRows.map((row, i) => (
                      <tr key={i} className="border-b border-slate-100 last:border-b-0 hover:bg-slate-50/50 transition-colors">
                        <td className="p-4 text-sm text-slate-700 font-medium">{row.size}</td>
                        <td className="p-4 text-center bg-amber-50/30">
                          <div className="text-sm font-bold text-slate-900">{row.agentpm}</div>
                          <div className="text-xs text-slate-400">{row.agentpmPlan}</div>
                        </td>
                        <td className="p-4 text-center">
                          <div className="text-sm font-medium text-slate-700">{row.backlog}</div>
                          <div className="text-xs text-slate-400">{row.backlogPlan}</div>
                        </td>
                        <td className="p-4 text-center">
                          <span className="text-sm font-bold text-emerald-600">{row.diff}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <p className="text-xs text-slate-400 mt-4 text-center">
              ※ AgentPM Team: ¥4,980/月（10名まで）、Business: ¥14,800/月（30名まで）。Backlog Standard: ¥17,600/月（30名まで）。
            </p>
            <p className="text-xs text-slate-400 mt-1 text-center">
              ※ 2026年3月時点の当社調査。各社の価格・条件は変更される場合があります。
            </p>
          </motion.div>
        </div>
      </section>

      {/* ──── 向いているチーム ──── */}
      <section className="py-20 bg-slate-50">
        <div className="container mx-auto px-6 max-w-5xl">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-center mb-12"
          >
            <span className="text-xs font-bold tracking-[0.2em] uppercase text-slate-400 mb-3 block">Best Fit</span>
            <h2 className="text-3xl font-bold text-slate-900 mb-4">向いているチーム</h2>
          </motion.div>

          <div className="grid lg:grid-cols-2 gap-8">
            {/* AgentPM向き */}
            <motion.div
              initial={{ opacity: 0, x: -20 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              className="bg-white rounded-2xl border border-amber-200 p-8"
            >
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 bg-amber-500 rounded-xl flex items-center justify-center shadow-lg shadow-amber-500/20">
                  <span className="text-white font-bold text-sm">A</span>
                </div>
                <div>
                  <h3 className="text-lg font-bold text-slate-900">AgentPMが向いているチーム</h3>
                  <p className="text-xs text-slate-500">クライアントワーク中心の方に</p>
                </div>
              </div>
              <ul className="space-y-3">
                {fitForAgentPM.map((item) => (
                  <li key={item} className="flex items-start gap-3 text-sm text-slate-700">
                    <Check weight="bold" className="text-amber-500 shrink-0 mt-0.5" size={18} />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-6 pt-4 border-t border-amber-100">
                <Link
                  href="/signup"
                  className="inline-flex items-center gap-2 px-6 py-3 bg-amber-500 text-white font-bold rounded-lg hover:bg-amber-600 transition-colors text-sm shadow-lg shadow-amber-500/20"
                >
                  無料で始める
                  <ArrowRight weight="bold" size={14} />
                </Link>
              </div>
            </motion.div>

            {/* 他ツール向き */}
            <motion.div
              initial={{ opacity: 0, x: 20 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              className="space-y-4"
            >
              {fitForOthers.map((item) => (
                <div key={item.tool} className="bg-white rounded-2xl border border-slate-200 p-6">
                  <h3 className="text-base font-bold text-slate-700 mb-3">{item.tool} が向いているケース</h3>
                  <ul className="space-y-2">
                    {item.reasons.map((reason) => (
                      <li key={reason} className="flex items-start gap-2.5 text-sm text-slate-600">
                        <span className="text-slate-400 shrink-0 mt-0.5">-</span>
                        <span>{reason}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </motion.div>
          </div>
        </div>
      </section>

      {/* ──── 大規模チーム（50名以上）の方へ ──── */}
      <section className="py-20 bg-slate-900 text-white relative overflow-hidden">
        <div className="absolute inset-0 opacity-10" style={{ backgroundImage: 'radial-gradient(#475569 1px, transparent 1px)', backgroundSize: '32px 32px' }} />
        <div className="container mx-auto px-6 max-w-4xl relative z-10">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-center mb-12"
          >
            <span className="text-xs font-bold tracking-[0.2em] uppercase text-slate-400 mb-3 block">Enterprise</span>
            <h2 className="text-3xl font-bold mb-4">大規模チーム（50名以上）の方へ</h2>
            <p className="text-slate-400 max-w-2xl mx-auto text-sm leading-relaxed">
              エンタープライズ向けのセキュリティ要件にも対応しています。
            </p>
          </motion.div>

          <div className="grid md:grid-cols-2 gap-8">
            {/* 対応済み */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              className="bg-white/5 backdrop-blur rounded-2xl border border-white/10 p-6"
            >
              <div className="flex items-center gap-2 mb-5">
                <ShieldCheck weight="fill" className="text-emerald-400" size={20} />
                <h3 className="font-bold text-white">対応済み</h3>
              </div>
              <ul className="space-y-3">
                {enterpriseReady.map((item) => (
                  <li key={item.label} className="flex items-center gap-3">
                    <Check weight="bold" className="text-emerald-400 shrink-0" size={16} />
                    <span className="text-sm text-slate-300">{item.label}</span>
                  </li>
                ))}
              </ul>
            </motion.div>

            {/* 対応予定 */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: 0.1 }}
              className="bg-white/5 backdrop-blur rounded-2xl border border-white/10 p-6"
            >
              <div className="flex items-center gap-2 mb-5">
                <ClockCounterClockwise weight="fill" className="text-amber-400" size={20} />
                <h3 className="font-bold text-white">対応予定</h3>
              </div>
              <ul className="space-y-3">
                {enterprisePlanned.map((item) => (
                  <li key={item.label} className="flex items-center gap-3">
                    <span className="text-xs font-mono text-amber-400 bg-amber-400/10 px-2 py-0.5 rounded shrink-0 w-[80px] text-center">{item.when}</span>
                    <span className="text-sm text-slate-300">{item.label}</span>
                  </li>
                ))}
              </ul>
            </motion.div>
          </div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.2 }}
            className="mt-8 bg-white/5 backdrop-blur rounded-2xl border border-white/10 p-6"
          >
            <h3 className="font-bold text-white mb-3">導入パターン</h3>
            <div className="flex flex-col md:flex-row items-start md:items-center gap-4 text-sm text-slate-300">
              <div className="flex items-center gap-2">
                <span className="w-6 h-6 rounded-full bg-amber-500/20 text-amber-400 flex items-center justify-center text-xs font-bold">1</span>
                <span>部門導入</span>
              </div>
              <ArrowRight weight="bold" className="text-slate-600 hidden md:block" size={14} />
              <div className="flex items-center gap-2">
                <span className="w-6 h-6 rounded-full bg-amber-500/20 text-amber-400 flex items-center justify-center text-xs font-bold">2</span>
                <span>SSO連携</span>
              </div>
              <ArrowRight weight="bold" className="text-slate-600 hidden md:block" size={14} />
              <div className="flex items-center gap-2">
                <span className="w-6 h-6 rounded-full bg-amber-500/20 text-amber-400 flex items-center justify-center text-xs font-bold">3</span>
                <span>他部門展開</span>
              </div>
            </div>
          </motion.div>
        </div>
      </section>

      {/* ──── 稟議パック ──── */}
      <section id="approval-pack" className="py-20 bg-white">
        <div className="container mx-auto px-6 max-w-4xl">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-center mb-12"
          >
            <span className="text-xs font-bold tracking-[0.2em] uppercase text-slate-400 mb-3 block">Approval Pack</span>
            <h2 className="text-3xl font-bold text-slate-900 mb-4">稟議パック</h2>
            <p className="text-slate-500 max-w-2xl mx-auto text-sm leading-relaxed">
              社内稟議に必要な資料をまとめてダウンロードできます。
            </p>
          </motion.div>

          <div className="grid sm:grid-cols-2 gap-6 max-w-3xl mx-auto">
            {approvalPackItems.map((item, i) => (
              <motion.div
                key={item.title}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.1 }}
                className="bg-slate-50 rounded-2xl border border-slate-200 p-6 hover:border-amber-300 hover:shadow-md transition-all cursor-pointer group"
              >
                <div className="w-12 h-12 bg-amber-100 rounded-xl flex items-center justify-center mb-4 group-hover:bg-amber-200 transition-colors">
                  <item.icon weight="duotone" size={24} className="text-amber-600" />
                </div>
                <h3 className="text-base font-bold text-slate-900 mb-1.5">{item.title}</h3>
                <p className="text-sm text-slate-500 leading-relaxed">{item.description}</p>
              </motion.div>
            ))}
          </div>

          <motion.p
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
            className="text-xs text-slate-400 text-center mt-6"
          >
            ※ ダウンロードにはメールアドレスの入力が必要です
          </motion.p>
        </div>
      </section>

      {/* ──── 移行について ──── */}
      <section className="py-16 bg-slate-50">
        <div className="container mx-auto px-6 max-w-3xl">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-center mb-8"
          >
            <span className="text-xs font-bold tracking-[0.2em] uppercase text-slate-400 mb-3 block">Migration</span>
            <h2 className="text-2xl font-bold text-slate-900 mb-4">移行について</h2>
            <p className="text-slate-500 text-sm">
              既存ツールからの移行もサポートしています。
            </p>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="flex flex-col sm:flex-row items-center justify-center gap-6 sm:gap-10"
          >
            {[
              { icon: Lock, label: 'CSVインポート対応' },
              { icon: ClockCounterClockwise, label: '並行運用OK' },
              { icon: ChatCircle, label: 'チャットサポート' },
            ].map((item) => (
              <div key={item.label} className="flex items-center gap-3">
                <div className="w-10 h-10 bg-emerald-100 rounded-lg flex items-center justify-center">
                  <item.icon weight="duotone" size={20} className="text-emerald-600" />
                </div>
                <span className="text-sm font-medium text-slate-700">{item.label}</span>
              </div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* ──── CTA Band ──── */}
      <CTABand />

      <LPFooter />
    </main>
  )
}
