'use client'

import { LPHeader } from '@/components/lp/Header'
import { LPFooter } from '@/components/lp/Footer'
import { CTABand } from '@/components/lp/CTABand'
import { motion } from 'framer-motion'
import {
    Handshake,
    Globe,
    Laptop,
    Briefcase,
    WarningCircle,
    CheckCircle,
    ArrowRight,
    Terminal,
    Browser,
    ArrowsLeftRight,
    BookOpen,
    Stamp,
    Folders,
    ChartBar,
    Receipt,
    FileText,
    ShieldCheck,
    Scales,
    TreeStructure,
    UserCircle,
    CalendarCheck,
    Lightning,
    Users,
    Buildings,
    Rocket,
} from '@phosphor-icons/react'
import { useState, useEffect, type ReactNode } from 'react'
import Link from 'next/link'

/* ─── Types ─── */

interface SceneData {
    id: string
    label: string
    icon: ReactNode
    title: string
    subtitle: string
    context: string
    before: string[]
    after: { step: number; text: string }[]
    results: string[]
    resultsNote: string
    features: string[]
    extraNote?: string
}

interface TemplateData {
    name: string
    color: string
    tasks: string
    milestones: string
    wiki?: string
    approval: string
    special?: string
}

interface TimelineEvent {
    time: string
    text: string
}

/* ─── Data ─── */

const scenes: SceneData[] = [
    {
        id: 'outsourced',
        label: '受託開発',
        icon: <Handshake size={20} weight="duotone" />,
        title: '要件定義から納品まで、発注者と一緒に管理',
        subtitle: '受託開発チーム',
        context: 'PM1名 + エンジニア3-5名 + クライアント1名、3-6ヶ月のプロジェクト',
        before: [
            'タスクはBacklog、進捗報告はExcel、承認はメール。3ツール横断',
            '発注者「今どこまで？」→ PMがスクショ撮って報告',
            '仕様変更の経緯が散逸。「言った言わない」で揉める',
        ],
        after: [
            { step: 1, text: 'テンプレート「受託開発」を選択 → タスク・マイルストーン・Wiki・承認フローが自動生成' },
            { step: 2, text: '開発者はCLIでタスク更新 → ポータルに自動反映。報告作成が不要に' },
            { step: 3, text: '発注者はポータルで進捗確認・バグ報告・見積もり承認 → アカウント不要' },
            { step: 4, text: '仕様変更はWiki + レビュー承認で証跡が残る → いつでも辿れる' },
            { step: 5, text: 'ボール管理で「誰待ち」が常に明確 → 催促の連絡が不要に' },
        ],
        results: [
            'プロジェクト立ち上げ: 最大2週間 → 最短当日（テンプレート活用時）',
            '進捗報告の作成時間: 最大80%削減（週2時間 → ポータルで自動共有）',
            '仕様の「言った言わない」 → 証跡が残るため大幅に減少',
        ],
        resultsNote: '※ PM1名+エンジニア3-5名、受託案件での想定値。効果はチーム構成・案件内容により異なります。',
        features: ['CLI/スキル', 'ポータル', 'ボール管理', 'Wiki・レビュー承認', 'テンプレート'],
    },
    {
        id: 'web',
        label: 'Web制作',
        icon: <Globe size={20} weight="duotone" />,
        title: '複数案件を並行管理。報告はポータルにおまかせ',
        subtitle: 'Web制作会社',
        context: 'ディレクター1-2名 + デザイナー・エンジニア3-5名、3-5案件並行',
        before: [
            '案件ごとにBacklog + Chatwork + Googleドライブ',
            '毎朝の全案件ステータス確認だけで1時間',
            'クライアントごとに報告フォーマットが違う',
            'デザインカンプの修正依頼がチャットに埋もれる',
        ],
        after: [
            { step: 1, text: '案件ごとにスペース作成。テンプレート「Web制作」で即スタート' },
            { step: 2, text: '/project-status で全案件の状況を一括レポート → 朝の確認を大幅短縮' },
            { step: 3, text: '各クライアントにポータルURL共有 → 進捗報告の作成が不要に' },
            { step: 4, text: 'デザインカンプの修正依頼をポータルから起票 → チャットの埋もれ防止' },
            { step: 5, text: 'ボール一覧で「どの案件の何が止まっているか」が一目瞭然' },
        ],
        results: [
            '朝の確認作業: 最大80%削減（1時間 → ボール一覧で数分）',
            '進捗報告: 作成不要（ポータルで自動共有）',
            '修正依頼の管理 → ポータル起票でチャット埋もれを防止',
            '案件の抜け漏れ → ボール管理で大幅に減少',
        ],
        resultsNote: '※ 3-5案件並行、ディレクター1-2名体制での想定値。',
        features: ['スペース管理', '/project-status', 'ポータル', 'ボール管理'],
    },
    {
        id: 'freelance',
        label: 'フリーランス',
        icon: <Laptop size={20} weight="duotone" />,
        title: '見積もり・進捗・請求を1ツールで完結',
        subtitle: 'フリーランスエンジニア',
        context: '1名で2-3案件並行管理',
        before: [
            '見積もりはスプレッドシート、タスクはNotionかGitHub Issues',
            '請求の工数転記が毎月発生。漏れも出る',
            'クライアントへの進捗報告はChatworkで手動',
        ],
        after: [
            { step: 1, text: 'CLIでタスク作成・工数記録 → 管理画面を開かず、コーディングに集中' },
            { step: 2, text: '見積もりはポータルで送付 → ワンクリック承認。メール往復が不要に' },
            { step: 3, text: 'ポータルで進捗共有 → 報告メッセージ不要' },
            { step: 4, text: '工数データをCSVエクスポート → 請求書作成。転記ミス・漏れを防止' },
        ],
        results: [
            '月末の請求作業: 大幅短縮（工数データのCSV出力で転記不要）',
            '進捗報告 → ポータルで自動共有',
            '請求漏れ → 工数記録の一元化で防止',
        ],
        resultsNote: '※ 1名で2-3案件管理の場合。',
        features: ['CLI', 'ポータル', '見積もり・承認', 'CSVエクスポート'],
        extraNote: 'CSVエクスポートでfreee・マネーフォワード等の会計ソフトに取り込み可能。API連携（freee, マネーフォワード, Misoca）は2026年Q4以降に対応予定。',
    },
    {
        id: 'agency',
        label: '代理店',
        icon: <Briefcase size={20} weight="duotone" />,
        title: '原価と売値を分けて、クライアントに安心を',
        subtitle: '代理店（制作会社管理）',
        context: 'ディレクター2-4名、制作会社2-3社を管理',
        before: [
            '制作会社の見積もりをExcelに転記 → マージン計算 → クライアント用清書',
            '原価情報が漏れないか常にヒヤヒヤ',
            '案件横断の粗利管理はさらに別のExcel',
        ],
        after: [
            { step: 1, text: '制作会社がベンダーポータルから見積もり提出' },
            { step: 2, text: '代理店がマージン設定 → クライアント向け売値が自動計算' },
            { step: 3, text: 'クライアントにはポータルで売値のみ表示 → 原価情報がシステムで完全分離' },
            { step: 4, text: '3段階承認: ベンダー提出 → 代理店確認 → クライアント承認' },
        ],
        results: [
            '見積もり作成: 大幅短縮（Excel転記 → 自動計算）',
            '原価漏洩リスク → システムで完全分離',
            'マージン計算ミス → 自動計算で防止',
        ],
        resultsNote: '※ 制作会社2-3社管理の場合。',
        features: ['代理店モード', 'ベンダーポータル', '3段階承認', '原価管理'],
    },
]

const templates: TemplateData[] = [
    {
        name: '受託開発',
        color: 'border-l-blue-500',
        tasks: '要件定義 / 基本設計 / 詳細設計 / 実装 / テスト / 納品',
        milestones: 'キックオフ / 設計レビュー / 中間レビュー / 受入テスト / 納品',
        wiki: '要件定義書 / 技術仕様 / 議事録',
        approval: '仕様変更承認 / 追加見積もり承認',
    },
    {
        name: 'Web制作',
        color: 'border-l-emerald-500',
        tasks: 'ヒアリング / ワイヤーフレーム / デザイン / コーディング / テスト / 公開',
        milestones: '企画確定 / デザイン確定 / テスト完了 / 公開',
        wiki: 'サイトマップ / デザインガイドライン',
        approval: 'デザイン承認 / 公開前最終確認',
    },
    {
        name: 'フリーランス（軽量）',
        color: 'border-l-amber-500',
        tasks: '見積もり / 開発 / レビュー / 納品',
        milestones: '開始 / 中間報告 / 納品',
        approval: '見積もり承認',
    },
    {
        name: '代理店',
        color: 'border-l-purple-500',
        tasks: '要件整理 / ベンダー見積もり依頼 / 制作管理 / クライアント確認 / 納品',
        milestones: '発注 / 中間確認 / 最終納品',
        approval: 'ベンダー見積もり確認 → 代理店承認 → クライアント承認（3段階）',
        special: '原価/売値分離が自動有効化',
    },
]

const modelCases: { title: string; context: string; events: TimelineEvent[] }[] = [
    {
        title: '受託開発チーム（PM1名+エンジニア4名）',
        context: '3ヶ月の受託開発案件。クライアント1社。Backlogから移行',
        events: [
            { time: 'Week 1', text: 'テンプレートでプロジェクト立ち上げ。ポータルURLをクライアントに共有' },
            { time: 'Week 2', text: '開発者がCLIでタスク更新開始。クライアントがポータルで進捗確認を開始' },
            { time: 'Week 4', text: '追加見積もりをポータル経由で送付 → ワンクリック承認。ボール管理が定着' },
            { time: 'Month 2', text: '進捗確認のチャットが大幅減少。PMの報告作業が不要に' },
        ],
    },
    {
        title: 'フリーランス（2案件並行）',
        context: '受託開発2案件。各案件クライアント1社',
        events: [
            { time: 'Day 1', text: 'アカウント作成。2案件のスペースを作成。各クライアントにURL共有' },
            { time: 'Week 1', text: 'CLIでタスク管理開始。管理画面を開かない日が増える' },
            { time: 'Month 1', text: '月末の請求作業が大幅短縮。工数データのCSV出力で転記不要に' },
        ],
    },
]

const teamSizes: {
    size: string
    recommendation: string
    reasons: string[]
    cta: { label: string; href: string }
}[] = [
        {
            size: '5名以下',
            recommendation: 'まずはFreeで1案件試してみてください。2案件目が必要になったらTeamへ。',
            reasons: [
                'クライアントにアカウント作成を頼まなくていい（URLだけ）',
                '報告書を作る時間がゼロになる',
                '小規模でもプロフェッショナルなクライアント体験を提供できる',
            ],
            cta: { label: '無料で始める', href: '/signup' },
        },
        {
            size: '10-30名',
            recommendation: 'Team（¥4,980/月）またはBusiness（¥14,800/月）。Backlog Standardより安く、ポータル・ボール・証跡管理がフル機能。',
            reasons: [
                'Backlog Standardより安い（10名で¥12,620/月の差）',
                'ポータルで報告作業が不要。PMの時間を案件管理に集中',
                'Wiki・議事録・レビュー承認で仕様の証跡が一元管理',
            ],
            cta: { label: '料金を見る', href: '/pricing' },
        },
        {
            size: '50名以上',
            recommendation: 'Business以上でSSO/SAML認証に対応。部門導入から始めて、全社展開にスケールできます。',
            reasons: [
                'SSO/SAML対応で情シスの管理負担を軽減',
                '部門パイロット → 効果実証 → 全社展開のステップが踏める',
                'Business（¥14,800/月/30名）はBacklog Standardと同等以下の費用',
            ],
            cta: { label: '導入について相談する', href: '/contact' },
        },
    ]

/* ─── Animation variants ─── */

const fadeUp = {
    initial: { opacity: 0, y: 20 },
    whileInView: { opacity: 1, y: 0 },
    viewport: { once: true },
}

const stagger = {
    initial: { opacity: 0, y: 16 },
    whileInView: { opacity: 1, y: 0 },
    viewport: { once: true },
}

/* ─── Sub-components ─── */

function SceneTabNav({ activeId, onSelect }: { activeId: string; onSelect: (id: string) => void }) {
    return (
        <div className="flex flex-wrap justify-center gap-3">
            {scenes.map((scene) => (
                <button
                    key={scene.id}
                    onClick={() => {
                        onSelect(scene.id)
                        const el = document.getElementById(scene.id)
                        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
                    }}
                    className={`inline-flex items-center gap-2 px-5 py-2.5 rounded-full text-sm font-bold transition-all ${activeId === scene.id
                            ? 'bg-amber-500 text-white shadow-lg shadow-amber-500/20'
                            : 'bg-white text-slate-600 border border-slate-200 hover:border-amber-300 hover:text-amber-600'
                        }`}
                >
                    {scene.icon}
                    {scene.label}
                </button>
            ))}
        </div>
    )
}

function FeatureTag({ label }: { label: string }) {
    return (
        <span className="inline-block px-3 py-1 text-xs font-bold bg-amber-100 text-amber-700 rounded-full">
            {label}
        </span>
    )
}

function SceneSection({ scene, index }: { scene: SceneData; index: number }) {
    const featureIcons: Record<string, ReactNode> = {
        'CLI/スキル': <Terminal size={16} weight="bold" />,
        'CLI': <Terminal size={16} weight="bold" />,
        'ポータル': <Browser size={16} weight="bold" />,
        'ボール管理': <ArrowsLeftRight size={16} weight="bold" />,
        'Wiki・レビュー承認': <BookOpen size={16} weight="bold" />,
        'テンプレート': <FileText size={16} weight="bold" />,
        'スペース管理': <Folders size={16} weight="bold" />,
        '/project-status': <ChartBar size={16} weight="bold" />,
        '見積もり・承認': <Stamp size={16} weight="bold" />,
        'CSVエクスポート': <Receipt size={16} weight="bold" />,
        '代理店モード': <Buildings size={16} weight="bold" />,
        'ベンダーポータル': <Browser size={16} weight="bold" />,
        '3段階承認': <TreeStructure size={16} weight="bold" />,
        '原価管理': <Scales size={16} weight="bold" />,
    }

    return (
        <section id={scene.id} className="scroll-mt-24">
            <motion.div
                {...fadeUp}
                transition={{ delay: 0.1 }}
                className="max-w-4xl mx-auto"
            >
                {/* Scene header */}
                <div className="flex items-center gap-3 mb-2">
                    <span className="inline-flex items-center justify-center w-10 h-10 rounded-xl bg-amber-100 text-amber-600">
                        {scene.icon}
                    </span>
                    <span className="text-sm font-bold text-amber-600 uppercase tracking-wider">
                        Scene {index + 1}
                    </span>
                </div>
                <h2 className="text-2xl lg:text-3xl font-bold text-slate-900 mb-2">
                    {scene.title}
                </h2>
                <p className="text-slate-500 text-sm mb-8">
                    {scene.subtitle} &mdash; {scene.context}
                </p>

                {/* Before / After grid */}
                <div className="grid md:grid-cols-2 gap-6 mb-8">
                    {/* Before */}
                    <motion.div
                        {...stagger}
                        transition={{ delay: 0.15 }}
                        className="bg-rose-50 rounded-2xl p-6 border border-rose-100"
                    >
                        <div className="flex items-center gap-2 mb-4">
                            <WarningCircle size={20} weight="fill" className="text-rose-500" />
                            <h3 className="text-sm font-bold text-rose-600 uppercase tracking-wider">Before</h3>
                        </div>
                        <ul className="space-y-3">
                            {scene.before.map((item, i) => (
                                <motion.li
                                    key={i}
                                    {...stagger}
                                    transition={{ delay: 0.2 + i * 0.1 }}
                                    className="flex items-start gap-3 text-sm text-rose-800"
                                >
                                    <span className="mt-1 w-1.5 h-1.5 rounded-full bg-rose-400 shrink-0" />
                                    {item}
                                </motion.li>
                            ))}
                        </ul>
                    </motion.div>

                    {/* After */}
                    <motion.div
                        {...stagger}
                        transition={{ delay: 0.2 }}
                        className="bg-emerald-50 rounded-2xl p-6 border border-emerald-100"
                    >
                        <div className="flex items-center gap-2 mb-4">
                            <CheckCircle size={20} weight="fill" className="text-emerald-500" />
                            <h3 className="text-sm font-bold text-emerald-600 uppercase tracking-wider">After</h3>
                        </div>
                        <ol className="space-y-3">
                            {scene.after.map((item, i) => (
                                <motion.li
                                    key={i}
                                    {...stagger}
                                    transition={{ delay: 0.25 + i * 0.1 }}
                                    className="flex items-start gap-3 text-sm text-emerald-800"
                                >
                                    <span className="mt-0.5 w-5 h-5 rounded-full bg-emerald-500 text-white text-xs font-bold flex items-center justify-center shrink-0">
                                        {item.step}
                                    </span>
                                    {item.text}
                                </motion.li>
                            ))}
                        </ol>
                    </motion.div>
                </div>

                {/* Results */}
                <motion.div
                    {...stagger}
                    transition={{ delay: 0.3 }}
                    className="bg-slate-50 rounded-2xl p-6 border border-slate-200 mb-6"
                >
                    <h3 className="text-sm font-bold text-slate-500 uppercase tracking-wider mb-4 flex items-center gap-2">
                        <Lightning size={16} weight="fill" className="text-amber-500" />
                        導入効果（目安）
                    </h3>
                    <ul className="space-y-2 mb-3">
                        {scene.results.map((result, i) => (
                            <li key={i} className="flex items-start gap-2 text-sm text-slate-700 font-medium">
                                <CheckCircle size={16} weight="fill" className="text-amber-500 mt-0.5 shrink-0" />
                                {result}
                            </li>
                        ))}
                    </ul>
                    <p className="text-xs text-slate-400">{scene.resultsNote}</p>
                    {scene.extraNote && (
                        <p className="text-xs text-slate-500 mt-2 pt-2 border-t border-slate-200">
                            {scene.extraNote}
                        </p>
                    )}
                </motion.div>

                {/* Feature tags */}
                <motion.div {...stagger} transition={{ delay: 0.35 }} className="flex flex-wrap gap-2">
                    <span className="text-xs font-bold text-slate-400 mr-1 self-center">使う機能:</span>
                    {scene.features.map((f) => (
                        <span
                            key={f}
                            className="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-bold bg-amber-100 text-amber-700 rounded-full"
                        >
                            {featureIcons[f]}
                            {f}
                        </span>
                    ))}
                </motion.div>
            </motion.div>
        </section>
    )
}

/* ─── Page ─── */

export default function UseCasesPage() {
    const [activeScene, setActiveScene] = useState('outsourced')

    // Track active scene on scroll
    useEffect(() => {
        const handleScroll = () => {
            for (const scene of scenes) {
                const el = document.getElementById(scene.id)
                if (el) {
                    const rect = el.getBoundingClientRect()
                    if (rect.top <= 200 && rect.bottom > 200) {
                        setActiveScene(scene.id)
                        break
                    }
                }
            }
        }
        window.addEventListener('scroll', handleScroll, { passive: true })
        return () => window.removeEventListener('scroll', handleScroll)
    }, [])

    return (
        <main className="font-sans antialiased text-slate-900 bg-white min-h-screen">
            <LPHeader />

            {/* ─── Hero ─── */}
            <section className="pt-32 pb-24 relative bg-gradient-to-b from-slate-50 to-white">
                <div className="container mx-auto px-6 text-center max-w-3xl relative z-10">
                    <motion.div
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="inline-block px-3 py-1 mb-4 text-xs font-bold tracking-wider text-amber-600 uppercase bg-amber-100 rounded-full"
                    >
                        Use Cases
                    </motion.div>
                    <motion.h1
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.1 }}
                        className="text-4xl lg:text-5xl font-bold mb-6 text-slate-900"
                    >
                        あなたのチームではこう使う。
                    </motion.h1>
                    <motion.p
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.2 }}
                        className="text-lg text-slate-600 mb-10 leading-relaxed"
                    >
                        AgentPMは受託開発・Web制作・フリーランス・代理店、<br className="hidden sm:block" />
                        それぞれの現場に合わせたプロジェクト管理です。
                    </motion.p>
                    <motion.div
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.3 }}
                    >
                        <SceneTabNav activeId={activeScene} onSelect={setActiveScene} />
                    </motion.div>
                </div>
                <div className="section-divider bottom">
                    <svg viewBox="0 0 1200 120" preserveAspectRatio="none" style={{ width: '100%', height: '50px', fill: '#ffffff' }}>
                        <path d="M321.39,56.44c58-10.79,114.16-30.13,172-41.86,82.39-16.72,168.19-17.73,250.45-.39C823.78,31,906.67,72,985.66,92.83c70.05,18.48,146.53,26.09,214.34,3V0H0V27.35A600.21,600.21,0,0,0,321.39,56.44Z"></path>
                    </svg>
                </div>
            </section>

            {/* ─── Scene Sections ─── */}
            <section className="py-20">
                <div className="container mx-auto px-6 space-y-24">
                    {scenes.map((scene, i) => (
                        <SceneSection key={scene.id} scene={scene} index={i} />
                    ))}
                </div>
            </section>

            {/* ─── 発注者の方へ ─── */}
            <section className="py-24 relative bg-slate-50">
                <div className="section-divider top">
                    <svg viewBox="0 0 1200 120" preserveAspectRatio="none" style={{ width: '100%', height: '40px', fill: '#ffffff' }}>
                        <path d="M1200 120L0 16.48V0h1200v120z"></path>
                    </svg>
                </div>
                <div className="container mx-auto px-6 relative z-10">
                    <motion.div
                        {...fadeUp}
                        className="max-w-3xl mx-auto glass-panel rounded-2xl shadow-xl overflow-hidden relative"
                    >
                        <div className="absolute top-4 right-4 md:-right-8 md:-top-4 z-20">
                            <span className="pen-stamp text-lg">アカウント作成不要！</span>
                        </div>
                        <div className="h-1.5 bg-gradient-to-r from-amber-400 to-orange-500" />
                        <div className="p-8 lg:p-10">
                            <div className="flex items-center gap-3 mb-6">
                                <span className="inline-flex items-center justify-center w-10 h-10 rounded-xl bg-amber-100 text-amber-600">
                                    <UserCircle size={22} weight="duotone" />
                                </span>
                                <h2 className="text-xl lg:text-2xl font-bold text-slate-900">
                                    発注者の方へ
                                </h2>
                            </div>
                            <p className="text-slate-500 text-sm mb-6">
                                どのシーンでも、発注者側の体験は同じです。
                            </p>
                            <ul className="space-y-3 mb-8">
                                {[
                                    '専用ポータルで進捗がリアルタイムに見える',
                                    'バグ報告や追加要望をポータルから直接起票',
                                    'デザインカンプの修正依頼もポータルから起票',
                                    '見積もりはワンクリック承認',
                                    'アカウント登録もアプリも不要',
                                ].map((item, i) => (
                                    <motion.li
                                        key={i}
                                        {...stagger}
                                        transition={{ delay: 0.1 + i * 0.1 }}
                                        className="flex items-start gap-3 text-sm text-slate-700 font-bold"
                                    >
                                        <CheckCircle size={18} weight="fill" className="text-amber-500 mt-0.5 shrink-0" />
                                        {item}
                                    </motion.li>
                                ))}
                            </ul>
                            <blockquote className="border-l-4 border-amber-500 pl-4 py-3 bg-amber-50/70 rounded-r-lg">
                                <p className="text-amber-800 font-bold text-sm italic">
                                    {'"'}いま何が起きているか{'"'}が、聞かなくてもわかる。
                                    <br />
                                    <span className="text-amber-600 font-black not-italic text-base mt-1 block">
                                        それが、AgentPMのクライアント体験です。
                                    </span>
                                </p>
                            </blockquote>
                        </div>
                    </motion.div>
                </div>
            </section>

            {/* ─── モデルケース ─── */}
            <section className="py-20">
                <div className="container mx-auto px-6">
                    <motion.div {...fadeUp} className="text-center max-w-2xl mx-auto mb-12">
                        <h2 className="text-2xl lg:text-3xl font-bold text-slate-900 mb-4">
                            モデルケース
                        </h2>
                        <p className="text-sm text-slate-400 bg-slate-100 inline-block px-4 py-2 rounded-full">
                            ※ 想定シナリオであり、実績ではありません
                        </p>
                    </motion.div>

                    <div className="grid md:grid-cols-2 gap-8 max-w-5xl mx-auto">
                        {modelCases.map((mc, idx) => (
                            <motion.div
                                key={idx}
                                {...stagger}
                                transition={{ delay: idx * 0.1 + 0.1 }}
                                className="bg-white rounded-2xl shadow-lg border border-slate-200 p-6"
                            >
                                <h3 className="text-lg font-bold text-slate-900 mb-1">{mc.title}</h3>
                                <p className="text-xs text-slate-400 mb-6">{mc.context}</p>

                                <div className="space-y-4">
                                    {mc.events.map((ev, i) => (
                                        <div key={i} className="flex gap-4">
                                            <div className="flex flex-col items-center">
                                                <span className="w-8 h-8 rounded-full bg-amber-100 text-amber-600 flex items-center justify-center shrink-0">
                                                    <CalendarCheck size={14} weight="bold" />
                                                </span>
                                                {i < mc.events.length - 1 && (
                                                    <div className="w-0.5 flex-1 bg-amber-200 mt-1" />
                                                )}
                                            </div>
                                            <div className="pb-4">
                                                <span className="text-xs font-bold text-amber-600">{ev.time}</span>
                                                <p className="text-sm text-slate-700 mt-0.5">{ev.text}</p>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </motion.div>
                        ))}
                    </div>
                </div>
            </section>

            {/* ─── チーム規模で選ぶ ─── */}
            <section className="py-24 relative bg-slate-50">
                <div className="section-divider top">
                    <svg viewBox="0 0 1200 120" preserveAspectRatio="none" style={{ width: '100%', height: '50px', fill: '#ffffff' }}>
                        <path d="M0,0V46.29c47.79,22.2,103.59,32.17,158,28,70.36-5.37,136.33-33.31,206.8-37.5C438.64,32.43,512.34,53.67,583,72.05c69.27,18,138.3,24.88,209.4,13.08,36.15-6,69.85-17.84,104.45-29.34C989.49,25,1113-14.29,1200,52.47V0Z"></path>
                    </svg>
                </div>
                <div className="container mx-auto px-6 relative z-10">
                    <motion.div {...fadeUp} className="text-center max-w-2xl mx-auto mb-12">
                        <h2 className="text-2xl lg:text-3xl font-bold text-slate-900 mb-4">
                            チーム規模で選ぶ
                        </h2>
                        <p className="text-slate-500">
                            どの規模でも、あなたのチームに合った始め方があります。
                        </p>
                    </motion.div>

                    <div className="grid md:grid-cols-3 gap-6 max-w-5xl mx-auto">
                        {teamSizes.map((ts, idx) => {
                            const icons = [
                                <Users key="u" size={24} weight="duotone" />,
                                <Buildings key="b" size={24} weight="duotone" />,
                                <ShieldCheck key="s" size={24} weight="duotone" />,
                            ]
                            return (
                                <motion.div
                                    key={idx}
                                    {...stagger}
                                    transition={{ delay: idx * 0.1 + 0.1 }}
                                    className="glass-panel rounded-2xl shadow-lg p-6 flex flex-col"
                                >
                                    <div className="flex items-center gap-3 mb-4">
                                        <span className="w-10 h-10 rounded-xl bg-slate-100 text-slate-600 flex items-center justify-center">
                                            {icons[idx]}
                                        </span>
                                        <h3 className="text-lg font-bold text-slate-900">{ts.size}</h3>
                                    </div>
                                    <p className="text-sm text-slate-600 mb-4 leading-relaxed">
                                        {ts.recommendation}
                                    </p>
                                    <div className="mb-6 flex-1">
                                        <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
                                            AgentPMを選ぶ理由
                                        </p>
                                        <ul className="space-y-2">
                                            {ts.reasons.map((r, i) => (
                                                <li key={i} className="flex items-start gap-2 text-sm text-slate-600">
                                                    <CheckCircle size={14} weight="fill" className="text-amber-500 mt-0.5 shrink-0" />
                                                    {r}
                                                </li>
                                            ))}
                                        </ul>
                                    </div>
                                    <Link
                                        href={ts.cta.href}
                                        className="btn-shine-effect inline-flex items-center justify-center gap-2 w-full py-3 px-4 rounded-full text-sm font-bold bg-amber-500 text-white shadow-md hover:bg-amber-600 transition-colors"
                                    >
                                        {ts.cta.label}
                                        <ArrowRight weight="bold" size={14} />
                                    </Link>
                                </motion.div>
                            )
                        })}
                    </div>
                </div>
            </section>

            {/* ─── テンプレートで当日スタート ─── */}
            <section className="py-20">
                <div className="container mx-auto px-6">
                    <motion.div {...fadeUp} className="text-center max-w-2xl mx-auto mb-12">
                        <div className="inline-flex items-center gap-2 px-3 py-1 mb-4 text-xs font-bold text-amber-600 bg-amber-100 rounded-full">
                            <Rocket size={14} weight="fill" />
                            Quick Start
                        </div>
                        <h2 className="text-2xl lg:text-3xl font-bold text-slate-900 mb-4">
                            テンプレートで当日スタート
                        </h2>
                        <p className="text-slate-500">
                            業種に合わせたテンプレートを選ぶだけで、<br className="hidden sm:block" />
                            タスク・マイルストーン・Wiki・承認フローが自動生成されます。
                        </p>
                    </motion.div>

                    <div className="grid md:grid-cols-2 gap-6 max-w-5xl mx-auto">
                        {templates.map((tpl, idx) => (
                            <motion.div
                                key={idx}
                                {...stagger}
                                transition={{ delay: idx * 0.1 + 0.1 }}
                                className={`glass-panel rounded-2xl p-6 border-l-4 ${tpl.color}`}
                            >
                                <h3 className="text-lg font-bold text-slate-900 mb-4">{tpl.name}</h3>
                                <div className="space-y-3 text-sm">
                                    <div>
                                        <span className="font-bold text-slate-500 text-xs uppercase tracking-wider">タスク</span>
                                        <p className="text-slate-700 mt-0.5">{tpl.tasks}</p>
                                    </div>
                                    <div>
                                        <span className="font-bold text-slate-500 text-xs uppercase tracking-wider">マイルストーン</span>
                                        <p className="text-slate-700 mt-0.5">{tpl.milestones}</p>
                                    </div>
                                    {tpl.wiki && (
                                        <div>
                                            <span className="font-bold text-slate-500 text-xs uppercase tracking-wider">Wiki</span>
                                            <p className="text-slate-700 mt-0.5">{tpl.wiki}</p>
                                        </div>
                                    )}
                                    <div>
                                        <span className="font-bold text-slate-500 text-xs uppercase tracking-wider">承認フロー</span>
                                        <p className="text-slate-700 mt-0.5">{tpl.approval}</p>
                                    </div>
                                    {tpl.special && (
                                        <div className="pt-2 border-t border-slate-100">
                                            <FeatureTag label={tpl.special} />
                                        </div>
                                    )}
                                </div>
                            </motion.div>
                        ))}
                    </div>

                    <motion.p
                        {...fadeUp}
                        transition={{ delay: 0.5 }}
                        className="text-center text-xs text-slate-400 mt-6"
                    >
                        ※ テンプレートはカスタマイズ可能。自社の案件パターンに合わせて編集・保存できます。
                    </motion.p>
                </div>
            </section>

            {/* ─── CTA ─── */}
            <CTABand />

            <LPFooter />
        </main>
    )
}
