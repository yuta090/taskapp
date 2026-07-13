import Link from 'next/link'
import { LPHeader } from '@/components/lp/Header'
import { LPFooter } from '@/components/lp/Footer'
import { CTABand } from '@/components/lp/CTABand'
import { ContactWizard } from '@/components/lp/ContactWizard'
// server component のため ssr エントリを使う（本体エントリは createContext を含み RSC で落ちる）
import { ChatCircleDots, ArrowsClockwise, Check, CalendarBlank } from '@phosphor-icons/react/dist/ssr'

const migrationPoints = [
    'CSVエクスポート手順のご案内',
    'インポート作業のサポート',
    '並行運用期間のアドバイス',
    'データ移行後の動作確認',
]

const seminars = [
    {
        title: 'AgentPM入門',
        duration: '30分',
        date: '毎週水曜 14:00',
        description: '基本機能とボール管理の考え方を実演でご紹介します。',
    },
    {
        title: 'ポータル活用のベストプラクティス',
        duration: '30分',
        date: '毎週金曜 14:00',
        description: 'クライアントポータルの効果的な運用方法をお伝えします。',
    },
]

/* ─── Page Component ─── */

export default function ContactPage() {
    return (
        <main className="font-sans antialiased text-slate-900 bg-white selection:bg-amber-100 selection:text-amber-900">
            <LPHeader />
            <div className="pt-16" />

            {/* ── Hero ── */}
            <section className="py-20 lg:py-28 bg-gradient-to-b from-slate-50 to-white">
                <div className="container mx-auto px-6 text-center max-w-3xl">
                    <h1 className="text-3xl lg:text-5xl font-black tracking-tight mb-4">
                        お気軽にご相談ください。
                    </h1>
                    <p className="text-lg text-slate-500">
                        チームの規模や業種に合った使い方をご提案します。
                    </p>
                </div>
            </section>

            {/* ── 相談ウィザード（全幅バンド。デザインは multica-prj/shindan-app 準拠） ── */}
            <ContactWizard />

            {/* ── サポートカード ── */}
            <section className="py-16 lg:py-20">
                <div className="container mx-auto px-6">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 max-w-4xl mx-auto">
                        {/* チャットサポート */}
                        <div
                            id="chat"
                            className="bg-slate-50 rounded-2xl p-6 border border-slate-200"
                        >
                            <div className="inline-flex items-center justify-center w-12 h-12 bg-amber-100 rounded-xl mb-4">
                                <ChatCircleDots
                                    size={24}
                                    weight="duotone"
                                    className="text-amber-600"
                                />
                            </div>
                            <h3 className="text-lg font-bold text-slate-900 mb-2">
                                チャットサポート
                            </h3>
                            <p className="text-sm text-slate-600 mb-3">
                                画面右下のチャットから即対応。
                            </p>
                            <p className="text-xs text-slate-400">対応時間: 平日 10:00-18:00</p>
                        </div>

                        {/* 移行サポート */}
                        <div
                            id="migration"
                            className="bg-slate-50 rounded-2xl p-6 border border-slate-200"
                        >
                            <div className="inline-flex items-center justify-center w-12 h-12 bg-amber-100 rounded-xl mb-4">
                                <ArrowsClockwise
                                    size={24}
                                    weight="duotone"
                                    className="text-amber-600"
                                />
                            </div>
                            <h3 className="text-lg font-bold text-slate-900 mb-3">
                                移行サポート
                            </h3>
                            <ul className="space-y-2.5">
                                {migrationPoints.map((point) => (
                                    <li
                                        key={point}
                                        className="flex items-start gap-2 text-sm text-slate-600"
                                    >
                                        <Check
                                            size={16}
                                            weight="bold"
                                            className="text-amber-500 mt-0.5 shrink-0"
                                        />
                                        {point}
                                    </li>
                                ))}
                            </ul>
                        </div>
                    </div>
                </div>
            </section>

            {/* ── セミナー Section ── */}
            <section className="py-20 lg:py-24 bg-slate-50">
                <div className="container mx-auto px-6 max-w-4xl">
                    <div className="text-center mb-12">
                        <h2 className="text-2xl lg:text-3xl font-bold tracking-tight mb-3">
                            AgentPMの使い方、実際にお見せします。
                        </h2>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 mb-8">
                        {seminars.map((seminar) => (
                            <div
                                key={seminar.title}
                                className="bg-white rounded-xl border border-slate-200 p-6 hover:shadow-md transition-shadow"
                            >
                                <div className="flex items-center gap-2 text-xs text-amber-600 font-medium mb-3">
                                    <CalendarBlank size={14} weight="bold" />
                                    {seminar.date}
                                </div>
                                <h3 className="text-lg font-bold text-slate-900 mb-1">
                                    {seminar.title}
                                    <span className="ml-2 text-sm font-normal text-slate-400">
                                        ({seminar.duration})
                                    </span>
                                </h3>
                                <p className="text-sm text-slate-500">{seminar.description}</p>
                            </div>
                        ))}
                    </div>

                    <p className="text-center text-sm text-slate-400">
                        過去のセミナー動画もご覧いただけます →{' '}
                        <Link
                            href="/seminar"
                            className="text-amber-600 hover:text-amber-700 font-medium transition-colors"
                        >
                            セミナー一覧
                        </Link>
                    </p>
                </div>
            </section>

            {/* ── CTA Band ── */}
            <CTABand />

            <LPFooter />
        </main>
    )
}
