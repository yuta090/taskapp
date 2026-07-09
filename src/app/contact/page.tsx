'use client'

import { useState, type FormEvent, type ChangeEvent } from 'react'
import Link from 'next/link'
import { LPHeader } from '@/components/lp/Header'
import { LPFooter } from '@/components/lp/Footer'
import { CTABand } from '@/components/lp/CTABand'
import {
    ChatCircleDots,
    ArrowsClockwise,
    Check,
    CalendarBlank,
    PaperPlaneTilt,
    CheckCircle,
} from '@phosphor-icons/react'

/* ─── Types ─── */

interface FormData {
    company: string
    name: string
    email: string
    teamSize: string
    currentTool: string
    message: string
}

const initialFormData: FormData = {
    company: '',
    name: '',
    email: '',
    teamSize: '',
    currentTool: '',
    message: '',
}

const teamSizeOptions = [
    { value: '', label: '選択してください' },
    { value: '1', label: '1人' },
    { value: '2-5', label: '2-5人' },
    { value: '6-20', label: '6-20人' },
    { value: '21-50', label: '21-50人' },
    { value: '51+', label: '51人以上' },
]

const currentToolOptions = [
    { value: '', label: '選択してください' },
    { value: 'backlog', label: 'Backlog' },
    { value: 'jira', label: 'Jira' },
    { value: 'linear', label: 'Linear' },
    { value: 'redmine', label: 'Redmine' },
    { value: 'excel', label: 'Excel' },
    { value: 'other', label: 'その他' },
    { value: 'none', label: '未使用' },
]

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

/* ─── Input styling ─── */

const inputClasses =
    'w-full rounded-lg border border-slate-300 px-4 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20 focus:outline-none transition-colors'
const selectClasses =
    'w-full rounded-lg border border-slate-300 px-4 py-2.5 text-sm text-slate-900 focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20 focus:outline-none transition-colors appearance-none bg-[url("data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%2020%2020%22%20fill%3D%22%2394a3b8%22%3E%3Cpath%20fill-rule%3D%22evenodd%22%20d%3D%22M5.23%207.21a.75.75%200%20011.06.02L10%2011.168l3.71-3.938a.75.75%200%20111.08%201.04l-4.25%204.5a.75.75%200%2001-1.08%200l-4.25-4.5a.75.75%200%2001.02-1.06z%22%20clip-rule%3D%22evenodd%22%2F%3E%3C%2Fsvg%3E")] bg-[length:1.25rem_1.25rem] bg-[right_0.5rem_center] bg-no-repeat pr-10'
const labelClasses = 'block text-sm font-medium text-slate-700 mb-1.5'

/* ─── Page Component ─── */

export default function ContactPage() {
    const [formData, setFormData] = useState<FormData>(initialFormData)
    const [submitted, setSubmitted] = useState(false)
    const [submitting, setSubmitting] = useState(false)
    const [submitError, setSubmitError] = useState<string | null>(null)

    const handleChange = (
        e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
    ) => {
        const { name, value } = e.target
        setFormData((prev) => ({ ...prev, [name]: value }))
    }

    const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
        e.preventDefault()
        setSubmitting(true)
        setSubmitError(null)
        try {
            const res = await fetch('/api/leads', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ source: 'contact', ...formData }),
            })
            if (!res.ok) throw new Error(`status ${res.status}`)
            setSubmitted(true)
        } catch {
            setSubmitError(
                '送信に失敗しました。時間をおいて再度お試しいただくか、メールでご連絡ください。'
            )
        } finally {
            setSubmitting(false)
        }
    }

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

            {/* ── 3-Column Layout ── */}
            <section className="pb-20 lg:pb-28">
                <div className="container mx-auto px-6">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-6xl mx-auto">
                        {/* Column 1: Form (spans 2 cols on lg) */}
                        <div className="md:col-span-2">
                            <div className="bg-white rounded-2xl shadow-lg border border-slate-200 p-8">
                                <h2 className="text-xl font-bold text-slate-900 mb-6">
                                    導入相談フォーム
                                </h2>

                                {submitted ? (
                                    <div className="text-center py-12">
                                        <div className="inline-flex items-center justify-center w-16 h-16 bg-green-100 rounded-full mb-4">
                                            <CheckCircle
                                                size={32}
                                                weight="fill"
                                                className="text-green-600"
                                            />
                                        </div>
                                        <h3 className="text-xl font-bold text-slate-900 mb-2">
                                            送信ありがとうございます
                                        </h3>
                                        <p className="text-slate-500 mb-6">
                                            1営業日以内にご連絡いたします。
                                        </p>
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setSubmitted(false)
                                                setFormData(initialFormData)
                                            }}
                                            className="text-sm text-amber-600 hover:text-amber-700 font-medium transition-colors"
                                        >
                                            フォームに戻る
                                        </button>
                                    </div>
                                ) : (
                                    <form onSubmit={handleSubmit} className="space-y-5">
                                        {/* 会社名 */}
                                        <div>
                                            <label htmlFor="company" className={labelClasses}>
                                                会社名
                                                <span className="ml-1.5 text-xs text-slate-400 font-normal">
                                                    任意
                                                </span>
                                            </label>
                                            <input
                                                type="text"
                                                id="company"
                                                name="company"
                                                value={formData.company}
                                                onChange={handleChange}
                                                placeholder="株式会社〇〇"
                                                className={inputClasses}
                                            />
                                        </div>

                                        {/* お名前 */}
                                        <div>
                                            <label htmlFor="name" className={labelClasses}>
                                                お名前
                                                <span className="ml-1.5 text-xs text-red-500 font-normal">
                                                    必須
                                                </span>
                                            </label>
                                            <input
                                                type="text"
                                                id="name"
                                                name="name"
                                                value={formData.name}
                                                onChange={handleChange}
                                                required
                                                placeholder="山田 太郎"
                                                className={inputClasses}
                                            />
                                        </div>

                                        {/* メールアドレス */}
                                        <div>
                                            <label htmlFor="email" className={labelClasses}>
                                                メールアドレス
                                                <span className="ml-1.5 text-xs text-red-500 font-normal">
                                                    必須
                                                </span>
                                            </label>
                                            <input
                                                type="email"
                                                id="email"
                                                name="email"
                                                value={formData.email}
                                                onChange={handleChange}
                                                required
                                                placeholder="you@example.com"
                                                className={inputClasses}
                                            />
                                        </div>

                                        {/* チーム規模 */}
                                        <div>
                                            <label htmlFor="teamSize" className={labelClasses}>
                                                チーム規模
                                            </label>
                                            <select
                                                id="teamSize"
                                                name="teamSize"
                                                value={formData.teamSize}
                                                onChange={handleChange}
                                                className={selectClasses}
                                            >
                                                {teamSizeOptions.map((opt) => (
                                                    <option key={opt.value} value={opt.value}>
                                                        {opt.label}
                                                    </option>
                                                ))}
                                            </select>
                                        </div>

                                        {/* 現在利用中のツール */}
                                        <div>
                                            <label htmlFor="currentTool" className={labelClasses}>
                                                現在利用中のツール
                                            </label>
                                            <select
                                                id="currentTool"
                                                name="currentTool"
                                                value={formData.currentTool}
                                                onChange={handleChange}
                                                className={selectClasses}
                                            >
                                                {currentToolOptions.map((opt) => (
                                                    <option key={opt.value} value={opt.value}>
                                                        {opt.label}
                                                    </option>
                                                ))}
                                            </select>
                                        </div>

                                        {/* ご相談内容 */}
                                        <div>
                                            <label htmlFor="message" className={labelClasses}>
                                                ご相談内容
                                                <span className="ml-1.5 text-xs text-red-500 font-normal">
                                                    必須
                                                </span>
                                            </label>
                                            <textarea
                                                id="message"
                                                name="message"
                                                value={formData.message}
                                                onChange={handleChange}
                                                required
                                                rows={5}
                                                placeholder="導入を検討している背景や、ご質問をお書きください。"
                                                className={inputClasses + ' resize-y'}
                                            />
                                        </div>

                                        {/* Submit */}
                                        {submitError && (
                                            <p className="text-sm text-red-600" role="alert">
                                                {submitError}
                                            </p>
                                        )}
                                        <button
                                            type="submit"
                                            disabled={submitting}
                                            className="w-full py-3 bg-amber-500 text-white font-bold rounded-lg hover:bg-amber-600 transition-colors flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
                                        >
                                            <PaperPlaneTilt size={18} weight="bold" />
                                            {submitting ? '送信中…' : '送信する'}
                                        </button>

                                        <p className="text-xs text-slate-400 text-center">
                                            1営業日以内にご連絡します
                                        </p>
                                    </form>
                                )}
                            </div>
                        </div>

                        {/* Column 2 & 3: Support cards */}
                        <div className="flex flex-col gap-6">
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
                                <p className="text-xs text-slate-400">
                                    対応時間: 平日 10:00-18:00
                                </p>
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
