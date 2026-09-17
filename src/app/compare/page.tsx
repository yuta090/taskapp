'use client'

import { LPHeader } from '@/components/lp/Header'
import { LPFooter } from '@/components/lp/Footer'
import { CTABand } from '@/components/lp/CTABand'
import { motion } from 'framer-motion'
import { Check, X, ArrowRight, FileArrowDown, ShieldCheck, Lock, ClockCounterClockwise, ChatCircle } from '@phosphor-icons/react'
import Link from 'next/link'
import { AgentPmMark } from '@/components/brand/AgentPmMark'

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
  if (value.startsWith('\u00D7')) {
    const rest = value.slice(1).trim()
    return <span className="text-slate-300 font-medium">{'\u00D7'}{rest ? <span className="text-xs ml-0.5 text-slate-400">{rest}</span> : null}</span>
  }
  return <span className="text-slate-500 text-xs">{value}</span>
}

/* \u2500\u2500\u2500 Comparison table (desktop table + mobile cards) \u2500\u2500\u2500 */

type ComparisonRow = { feature: string; values: string[] }

function ComparisonLegend() {
  return (
    <div className="mt-4 flex flex-wrap gap-4 justify-center text-xs text-slate-400">
      <span><span className="text-emerald-500 font-bold">{'\u25CE'}</span> = 特に優れている</span>
      <span><span className="text-blue-500 font-bold">{'\u25CB'}</span> = 対応</span>
      <span><span className="text-amber-500 font-bold">{'\u25B3'}</span> = 一部対応</span>
      <span><span className="text-slate-300">{'\u00D7'}</span> = 非対応</span>
    </div>
  )
}

function ComparisonTable({ columns, rows }: { columns: string[]; rows: ComparisonRow[] }) {
  // 列が6つになると横が足りないので、表は幅を広げ、モバイルは3列×2段に折り返す
  const wide = columns.length >= 6
  const shellWidth = wide ? 'max-w-6xl' : 'max-w-5xl'
  const mobileGrid = wide ? 'grid-cols-3 gap-y-3' : 'grid-cols-5'
  return (
    <>
      {/* Desktop Table */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        className={`hidden lg:block ${shellWidth} mx-auto`}
      >
        <div className="bg-surface rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  <th className="p-4 text-left text-sm font-bold text-slate-700 w-[240px] sticky left-0 bg-slate-50 z-10">機能</th>
                  {columns.map((col, i) => (
                    <th
                      key={col}
                      className={`p-4 text-center text-sm font-bold ${i === 0 ? 'text-amber-600 bg-amber-50/50' : 'text-slate-700'}`}
                    >
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.feature} className="border-b border-slate-100 last:border-b-0 hover:bg-slate-50/50 transition-colors">
                    <td className="p-4 text-sm text-slate-700 font-medium sticky left-0 bg-surface z-10">{row.feature}</td>
                    {row.values.map((value, i) => (
                      <td key={columns[i]} className={`p-4 text-center ${i === 0 ? 'bg-amber-50/30' : ''}`}>
                        <RatingBadge value={value} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <ComparisonLegend />
      </motion.div>

      {/* Mobile Cards */}
      <div className="lg:hidden max-w-md mx-auto space-y-3">
        {rows.map((row, i) => (
          <motion.div
            key={row.feature}
            initial={{ opacity: 0, y: 10 }}
            whileInView={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.03 }}
            viewport={{ once: true }}
            className="bg-surface rounded-xl p-4 border border-slate-200"
          >
            <div className="text-sm text-slate-700 font-medium mb-2">{row.feature}</div>
            <div className={`grid ${mobileGrid} gap-1.5 text-center`}>
              {row.values.map((value, j) => (
                <div key={columns[j]} className="flex flex-col min-w-0">
                  {/* 列名が2行に折れても記号の高さがずれないよう、ラベル側を固定高さにする */}
                  <div className={`text-[10px] leading-tight mb-1 h-[1.1rem] flex items-end justify-center ${j === 0 ? 'text-amber-600 font-bold' : 'text-slate-400'}`}>{columns[j]}</div>
                  {/* 長い英単語が隣の列にはみ出さないようにする */}
                  <div className="leading-tight break-words"><RatingBadge value={value} /></div>
                </div>
              ))}
            </div>
          </motion.div>
        ))}
        <ComparisonLegend />
      </div>
    </>
  )
}

/* ─── Data ─── */

// 表A: クライアントワーク（相手先がいる仕事）向けのプロジェクト管理
// 2026-09-17 調査。根拠と出典は docs/marketing/COMPETITIVE_LANDSCAPE_2026-09.md
const pmComparisonColumns = ['AgentPM', 'A社', 'B社', 'C社', 'D社', 'E社']

const pmComparisonRows = [
  { feature: '相手先専用の画面がある', values: ['◎', '×', '×', '△ 共有リンクのみ', '△ 公開ページのみ', '○ 英語のみ'] },
  { feature: '相手先は何人招いても無料', values: ['◎', '○ 人数無制限プラン', '× 1人ごと', '× 1人ごと', '× 1人ごと', '× 1人ごと'] },
  { feature: '承認はメールから1クリック', values: ['◎', '×', '×', '×', '×', '△'] },
  { feature: 'ボール管理（次に動く人）', values: ['◎', '×', '×', '×', '×', '△'] },
  { feature: '見積もり→承認→請求', values: ['◎', '×', '×', '×', '×', '○'] },
  { feature: '代理店モード（原価と売値を分ける）', values: ['◎', '×', '×', '×', '×', '△'] },
  { feature: '仕様書・議事録・証跡が同じ場所', values: ['◎', '△ 別の場所', '△ 別の製品', '△ 文書機能のみ', '◎', '△'] },
  { feature: 'チャットの会話から自動でタスク化', values: ['◎', '×', '×', '△ 手動で登録', '○ チャット・メール', '×'] },
  { feature: 'ガント・バーンダウン', values: ['◎', '○ 上位プラン', '○', '△ ロードマップ', '△', '○'] },
  { feature: '日本語のUIと国内サポート', values: ['◎', '◎', '△ 翻訳ベース', '× 英語のみ', '○', '× 英語のみ'] },
  { feature: 'AIから直接操作（MCP・CLI）', values: ['○', '○', '◎', '◎', '◎', '×'] },
  { feature: '人数が増えても定額', values: ['○ 30名まで', '◎ 人数無制限', '× 1人ごと', '× 1人ごと', '× 1人ごと', '× 1人ごと'] },
  { feature: 'SSO/SAML・細かい権限管理', values: ['× 検討中', '○ 上位プラン', '◎', '○', '○', '○'] },
]

// 表B: チャットの会話からタスクを拾うAI秘書
const secretaryComparisonColumns = ['AgentPM', 'F社', 'G社', 'H社', 'I社']

const secretaryComparisonRows = [
  { feature: '相手先とのグループに入れる', values: ['◎', '○ LINEのみ', '△ 社内中心', '△ 社内中心', '×'] },
  { feature: 'LINEグループに対応', values: ['◎', '◎', '×', '×', '×'] },
  { feature: 'そのほかのチャット（Slack・Teams 等）', values: ['○', '△ 転送のみ', '◎ 自社内', '◎ 自社内', '○ 一部のみ'] },
  { feature: '自社の名前で相手に届く', values: ['◎ 自社LINE', '× 共通Bot固定', '◎', '◎', '×'] },
  { feature: '拾ったタスクが案件の進行に乗る', values: ['◎', '△ カンバン止まり', '×', '△', '○'] },
  { feature: '期限リマインドと完了の確認', values: ['◎', '△', '×', '×', '△'] },
  { feature: '承認と決定事項の証跡', values: ['◎', '×', '×', '×', '×'] },
]

const agencyComparisonRows = [
  { feature: '原価/売値の分離表示', agentpm: true, others: '手動管理' },
  { feature: 'ベンダーポータル', agentpm: true, others: 'アカウント共有必要' },
  { feature: '3段階承認フロー', agentpm: true, others: 'カスタム開発必要' },
  { feature: 'マージン自動計算', agentpm: true, others: 'Excel別管理' },
  { feature: 'クライアントへの原価非表示', agentpm: true, others: '運用ルール対応' },
]

// Backlog は 2027-01-01 に4プラン\u21923プランへ改定。出典: https://nulab.com/ja/info/backlog-plan-renewal/
const backlogPlanChangeRows = [
  {
    label: 'いちばん安いプラン',
    current: '最安プラン ¥2,700\n30名・5プロジェクト',
    next: '最安プラン ¥21,000\n15名・30プロジェクト',
  },
  {
    label: '受託・制作で実際に使える線',
    current: '標準プラン ¥16,000\n人数無制限・100プロジェクト',
    next: '標準プラン ¥36,300\n人数・プロジェクト無制限',
  },
  {
    label: 'AIアシスタント',
    current: '上位プラン ¥27,000 以上',
    next: '標準プラン以上',
  },
  {
    label: '切り替えの時期',
    current: '2026年12月31日まで新規契約できる',
    next: '2027年1月1日から。既存契約は次の更新日に移る',
  },
]

const priceComparisonRows = [
  { size: '5名 / 3プロジェクト', agentpm: '¥0', agentpmPlan: 'Free', backlogNow: '¥2,700', backlogNowPlan: '最安プラン', backlogNext: '¥21,000', backlogNextPlan: '最安プラン' },
  { size: '10名 / 20プロジェクト', agentpm: '¥14,800', agentpmPlan: 'Pro', backlogNow: '¥16,000', backlogNowPlan: '標準プラン', backlogNext: '¥21,000', backlogNextPlan: '最安プラン' },
  { size: '30名 / 30プロジェクト', agentpm: '¥14,800', agentpmPlan: 'Pro', backlogNow: '¥16,000', backlogNowPlan: '標準プラン', backlogNext: '¥36,300', backlogNextPlan: '標準プラン' },
  { size: '50名以上', agentpm: '個別見積り', agentpmPlan: 'Enterprise', backlogNow: '¥16,000', backlogNowPlan: '標準プラン', backlogNext: '¥36,300', backlogNextPlan: '標準プラン' },
]

const fitForAgentPM = [
  '相手先にアカウントを作らせずに進捗を見せたい',
  'LINEやSlackの会話から、タスクを取りこぼさずに拾いたい',
  '「いま誰待ちか」を一目で分かるようにしたい',
  '見積もり・承認・請求までを1か所でつなげたい',
  '仕様書・議事録・決まったことを案件と同じ場所に置きたい',
  '代理店モードで原価と売値を分けたい',
]

const fitForOthers = [
  {
    situation: '社内だけで使うなら',
    reasons: [
      '外部への共有が要らず、開発チームの中で完結する',
      '課題管理とWikiとGitが1つの画面にまとまっているほうがいい',
      '課題を開く速さとキーボード操作を最優先したい',
    ],
  },
  {
    situation: '50名を超えるなら',
    reasons: [
      '人数無制限の定額プランを持つツールのほうが安く済むことがある',
      '部署ごとに細かい権限管理とSSOが先に要る',
      'ワークフローを自社の形に作り込みたい',
    ],
  },
  {
    situation: 'ドキュメントが中心なら',
    reasons: [
      'タスクは付属で足り、情報置き場としての自由度を優先したい',
      '相手先への共有は公開ページで足りる',
      'テンプレートを自分たちで組み立てたい',
    ],
  },
  {
    situation: 'チャットの中で完結させたいなら',
    reasons: [
      '案件の進行や承認までは要らず、記録と要約で足りる',
      'まず月3,000円以内で試したい',
      '相手先も同じチャットツールを使っている',
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
    description: 'いまお使いのツールからの移行スケジュール雛形',
    icon: FileArrowDown,
  },
]

// 実装済みとして掲げてよいのは、コード・インフラで裏が取れているものだけ
const enterpriseReady = [
  { label: '通信の暗号化（TLS）・保管時の暗号化', done: true },
  { label: 'Row Level Security (RLS)', done: true },
  { label: '監査ログ', done: true },
  { label: '二段階認証（ログイン時）', done: true },
]

// 時期を明示できるのは自社で実装するものだけ。第三者認証の取得時期は約束しない
const enterprisePlanned = [
  { label: 'SSO/SAML', when: '検討中' },
  { label: 'SCIM プロビジョニング', when: '検討中' },
  { label: '細粒度権限管理', when: '検討中' },
  { label: 'SLA保証', when: '検討中' },
]

/* ─── Page Component ─── */

export default function ComparePage() {
  return (
    <main className="font-sans antialiased text-slate-900 bg-surface min-h-screen">
      <LPHeader />

      {/* ──── Hero ──── */}
      <section className="pt-32 pb-20 bg-slate-50">
        <div className="container mx-auto px-6 text-center max-w-3xl">
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="inline-block px-3 py-1 mb-4 text-xs font-bold tracking-wide text-amber-600 bg-amber-100 rounded-full"
          >
            ツール比較
          </motion.div>
          <motion.h1
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="text-4xl lg:text-5xl font-bold mb-6 text-slate-900"
          >
            {/* 自然折返しだと「向かな／い場合。」で切れるため、読点で改行を固定する */}
            AgentPMが向く場合と、<br className="hidden sm:block" />
            向かない場合。
          </motion.h1>
          <motion.p
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="text-lg text-slate-600 mb-8 leading-relaxed"
          >
            プロジェクト管理ツールと、チャットからタスクを拾うツール。<br className="hidden md:block" />
            AgentPMが力を発揮する場面と、他のツールのほうが適している場面を、どちらも載せています。
          </motion.p>
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="space-y-1"
          >
            <p className="text-xs text-slate-400">
              ※ 2026年9月時点、各社公式サイトの公開情報に基づく当社調べ。社名は伏せています
            </p>
            <p className="text-xs text-slate-400">
              ※ 各製品の最新情報は公式サイトをご確認ください
            </p>
          </motion.div>
        </div>
      </section>

      {/* ──── TCO概要 ──── */}
      <section className="py-16 bg-surface">
        <div className="container mx-auto px-6 max-w-3xl">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="bg-gradient-to-br from-slate-50 to-amber-50/30 rounded-2xl border border-slate-200 p-8 lg:p-10"
          >
            <h2 className="text-xl font-bold text-slate-900 mb-4">
              ツール選びで、月額だけを比べていませんか？
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
              詳しい試算は料金ページへ
              <ArrowRight weight="bold" size={14} />
            </Link>
          </motion.div>
        </div>
      </section>

      {/* ──── 機能比較表（表A: PMツール / 表B: チャット連携） ──── */}
      <section className="py-20 bg-slate-50">
        <div className="container mx-auto px-6">
          {/* 表A */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-center mb-12"
          >
            <h2 className="text-3xl font-bold text-slate-900 mb-4">プロジェクト管理ツールと比べる</h2>
            <p className="text-slate-500 max-w-2xl mx-auto text-sm leading-relaxed">
              相手先がいる仕事（受託・制作・代理店）で必要になる機能で並べました。
            </p>
          </motion.div>

          <ComparisonTable columns={pmComparisonColumns} rows={pmComparisonRows} />

          {/* 表B */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-center mt-24 mb-12"
          >
            <h2 className="text-3xl font-bold text-slate-900 mb-4">チャット連携のツールと比べる</h2>
            <p className="text-slate-500 max-w-2xl mx-auto text-sm leading-relaxed">
              LINEやSlackの会話からタスクを拾う機能で並べました。上の表とは別の顔ぶれなので、F社から振り直しています。
            </p>
          </motion.div>

          <ComparisonTable columns={secretaryComparisonColumns} rows={secretaryComparisonRows} />

          <motion.p
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
            className="text-xs text-slate-400 text-center mt-6 max-w-2xl mx-auto leading-relaxed"
          >
            G社・H社・I社は自社のワークスペースの中で働くため、相手先が同じツールを使っていない場合は届きません。
          </motion.p>
        </div>
      </section>

      {/* ──── 代理店モード詳細比較 ──── */}
      <section className="py-20 bg-surface">
        <div className="container mx-auto px-6">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-center mb-12"
          >
            <h2 className="text-3xl font-bold text-slate-900 mb-4">代理店モード詳細比較</h2>
            <p className="text-slate-500 max-w-2xl mx-auto text-sm leading-relaxed">
              原価と売値を分ける機能は、国内の主要ツールの標準機能としては確認できませんでした。海外には近い機能を持つ製品もありますが、日本語のUIがありません。
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
                    <AgentPmMark size={24} />
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

      {/* ──── A社の2027年プラン改定 ──── */}
      <section className="py-20 bg-slate-50">
        <div className="container mx-auto px-6 max-w-4xl">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-center mb-12"
          >
            <h2 className="text-2xl lg:text-3xl font-bold text-slate-900 mb-4">
              A社は2027年1月に料金が変わります
            </h2>
            <p className="text-slate-500 max-w-2xl mx-auto text-sm leading-relaxed">
              4つのプランが3つにまとまり、月¥2,700で始められる入口が無くなります。
            </p>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
          >
            <div className="bg-surface rounded-2xl border border-slate-200 overflow-hidden shadow-sm mb-6">
              <div className="overflow-x-auto">
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200">
                      <th className="p-4 text-left text-sm font-bold text-slate-700 w-[180px]"> </th>
                      <th className="p-4 text-center text-sm font-bold text-slate-500">
                        <div>現行</div>
                        <div className="text-xs font-normal text-slate-400">〜2026年12月</div>
                      </th>
                      <th className="p-4 text-center text-sm font-bold text-slate-900">
                        <div>新プラン</div>
                        <div className="text-xs font-normal text-slate-500">2027年1月〜</div>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {backlogPlanChangeRows.map((row) => (
                      <tr key={row.label} className="border-b border-slate-100 last:border-b-0">
                        <td className="p-4 text-sm text-slate-700 font-medium align-top">{row.label}</td>
                        <td className="p-4 text-center text-sm text-slate-500 whitespace-pre-line align-top">{row.current}</td>
                        <td className="p-4 text-center text-sm text-slate-900 font-medium whitespace-pre-line align-top">{row.next}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="bg-amber-50 rounded-xl border border-amber-200 p-4">
              <p className="text-sm text-amber-800">
                <span className="font-bold">ここが変わります：</span>
                2027年1月以降、受託・制作で使える入口は月¥21,000（15名）になります
              </p>
            </div>
          </motion.div>
        </div>
      </section>

      {/* ──── 料金比較 ──── */}
      <section className="py-20 bg-surface">
        <div className="container mx-auto px-6 max-w-4xl">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-center mb-12"
          >
            <h2 className="text-3xl font-bold text-slate-900 mb-4">料金を並べる</h2>
            <p className="text-slate-500 max-w-2xl mx-auto text-sm leading-relaxed">
              AgentPMは組織単位の定額です。A社はプラン改定をまたぐので、現行と新プランの両方を載せています。
            </p>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
          >
            <div className="bg-surface rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
              <div className="overflow-x-auto">
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200">
                      <th className="p-4 text-left text-sm font-bold text-slate-700">チーム規模</th>
                      <th className="p-4 text-center text-sm font-bold text-amber-600 bg-amber-50/50">AgentPM</th>
                      <th className="p-4 text-center text-sm font-bold text-slate-700">A社（現行）</th>
                      <th className="p-4 text-center text-sm font-bold text-slate-700">A社（2027年1月〜）</th>
                    </tr>
                  </thead>
                  <tbody>
                    {priceComparisonRows.map((row) => (
                      <tr key={row.size} className="border-b border-slate-100 last:border-b-0 hover:bg-slate-50/50 transition-colors">
                        <td className="p-4 text-sm text-slate-700 font-medium">{row.size}</td>
                        <td className="p-4 text-center bg-amber-50/30">
                          <div className="text-sm font-bold text-slate-900">{row.agentpm}</div>
                          <div className="text-xs text-slate-400">{row.agentpmPlan}</div>
                        </td>
                        <td className="p-4 text-center">
                          <div className="text-sm font-medium text-slate-700">{row.backlogNow}</div>
                          <div className="text-xs text-slate-400">{row.backlogNowPlan}</div>
                        </td>
                        <td className="p-4 text-center">
                          <div className="text-sm font-medium text-slate-700">{row.backlogNext}</div>
                          <div className="text-xs text-slate-400">{row.backlogNextPlan}</div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="mt-6 bg-slate-50 rounded-xl border border-slate-200 p-4">
              <p className="text-sm text-slate-600 leading-relaxed">
                <span className="font-bold text-slate-900">正直に書きます：</span>
                50名を超えるチームなら、2026年12月までは A社の標準プラン（月¥16,000・人数無制限）のほうが安く済みます。
                AgentPM が安くなるのは30名まで、または2027年1月以降です。
              </p>
            </div>

            <p className="text-xs text-slate-400 mt-4 text-center">
              ※ すべて税抜・月払い。AgentPM Pro は30名・30プロジェクトまで。相手先（クライアント）の人数は数えません。
            </p>
            <p className="text-xs text-slate-400 mt-1 text-center">
              ※ 2026年9月時点の当社調べ。各社の価格・条件は変更される場合があります。
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
            <h2 className="text-3xl font-bold text-slate-900 mb-4">向いているチーム</h2>
          </motion.div>

          <div className="grid lg:grid-cols-2 gap-8">
            {/* AgentPM向き */}
            <motion.div
              initial={{ opacity: 0, x: -20 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              className="bg-surface rounded-2xl border border-amber-200 p-8"
            >
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 bg-amber-500 rounded-xl flex items-center justify-center shadow-lg shadow-amber-500/20">
                  <AgentPmMark size={30} />
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
              <div className="text-sm font-bold text-slate-500 px-1">ほかのツールのほうが合う場合</div>
              {fitForOthers.map((item) => (
                <div key={item.situation} className="bg-surface rounded-2xl border border-slate-200 p-6">
                  <h3 className="text-base font-bold text-slate-700 mb-3">{item.situation}</h3>
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
              className="bg-surface/5 backdrop-blur rounded-2xl border border-white/10 p-6"
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
              className="bg-surface/5 backdrop-blur rounded-2xl border border-white/10 p-6"
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
            className="mt-8 bg-surface/5 backdrop-blur rounded-2xl border border-white/10 p-6"
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
                <span>権限・運用設計</span>
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
      <section id="approval-pack" className="py-20 bg-surface">
        <div className="container mx-auto px-6 max-w-4xl">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-center mb-12"
          >
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
