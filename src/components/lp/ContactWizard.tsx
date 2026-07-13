'use client'

import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import Link from 'next/link'
import { CheckCircle, PaperPlaneTilt } from '@phosphor-icons/react'

/* ─── Options ─── */

interface Option {
    id: string
    label: string
}

const PAIN_OPTIONS: Option[] = [
    { id: 'chat', label: 'LINEやチャットの依頼が、流れて消えてしまう' },
    { id: 'documents', label: 'クライアントからの資料・返事がなかなか集まらない' },
    { id: 'ball', label: '誰がボールを持っているか分からなくなる' },
    { id: 'visibility', label: 'タスクや進捗が見える化できていない' },
    { id: 'other', label: 'その他・うまく言えない' },
]

const TEAM_SIZE_OPTIONS: Option[] = [
    { id: '1', label: '1人' },
    { id: '2-5', label: '2〜5人' },
    { id: '6-20', label: '6〜20人' },
    { id: '21-50', label: '21〜50人' },
    { id: '51+', label: '51人以上' },
]

const CHANNEL_OPTIONS: Option[] = [
    { id: 'line', label: 'LINE' },
    { id: 'slack', label: 'Slack' },
    { id: 'chatwork', label: 'Chatwork' },
    { id: 'email', label: 'メール' },
    { id: 'phone-fax', label: '電話・FAX' },
    { id: 'other', label: 'その他' },
]

const PARTNER_COUNT_OPTIONS: Option[] = [
    { id: '-5', label: '〜5社' },
    { id: '6-20', label: '6〜20社' },
    { id: '21-50', label: '21〜50社' },
    { id: '51+', label: '51社以上' },
    { id: 'few', label: '社外とのやり取りは少ない' },
]

// pain選択に応じたサンクス画面の一言。PAIN_OPTIONSの並び順で最初に該当したものを採用する
const PAIN_THANKS_MESSAGE: Record<string, string> = {
    chat: 'LINEグループの会話から申し送りを自動で拾う機能があります。当日のデモでお見せできます。',
    documents: '資料の回収と催促を秘書AIが代行する機能をご案内できます。',
    ball: '"いま誰の番か"を可視化するボール管理をお見せできます。',
}
const DEFAULT_THANKS_MESSAGE = '状況に合わせた使い方をご提案します。'

const TOTAL_STEPS = 6

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/* ─── Styling (contact page既存トークンに合わせる) ─── */

const inputClasses =
    'w-full rounded-lg border border-slate-300 px-4 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20 focus:outline-none transition-colors'
const labelClasses = 'block text-sm font-medium text-slate-700 mb-1.5'

const cardClasses =
    'flex items-center gap-3 rounded-lg border border-slate-200 px-4 py-3.5 text-sm text-slate-700 cursor-pointer transition-colors has-[:checked]:border-amber-500 has-[:checked]:bg-amber-50 has-[:checked]:text-amber-900 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-amber-500/40'

function toggleId(list: string[], id: string): string[] {
    return list.includes(id) ? list.filter((v) => v !== id) : [...list, id]
}

function labelsFor(options: Option[], ids: string[]): string {
    return options
        .filter((o) => ids.includes(o.id))
        .map((o) => o.label)
        .join('、')
}

function labelFor(options: Option[], id: string): string {
    return options.find((o) => o.id === id)?.label ?? ''
}

interface Answers {
    pain: string[]
    teamSize: string
    channels: string[]
    partnerCount: string
    message: string
    name: string
    email: string
    company: string
}

const initialAnswers: Answers = {
    pain: [],
    teamSize: '',
    channels: [],
    partnerCount: '',
    message: '',
    name: '',
    email: '',
    company: '',
}

/* ─── Component ─── */

export function ContactWizard() {
    const [step, setStep] = useState(1)
    const [answers, setAnswers] = useState<Answers>(initialAnswers)
    const [website, setWebsite] = useState('') // honeypot
    const [emailError, setEmailError] = useState<string | null>(null)
    const [submitting, setSubmitting] = useState(false)
    const [submitError, setSubmitError] = useState<string | null>(null)
    const [submitted, setSubmitted] = useState(false)

    const headingRef = useRef<HTMLHeadingElement>(null)

    useEffect(() => {
        headingRef.current?.focus()
    }, [step, submitted])

    const goNext = () => setStep((s) => Math.min(s + 1, TOTAL_STEPS))
    const goBack = () => setStep((s) => Math.max(s - 1, 1))

    // 単一選択の質問はタップから少し待って自動的に次へ進む(ミツモア型)
    const selectSingleAndAdvance = (key: 'teamSize' | 'partnerCount', id: string) => {
        setAnswers((prev) => ({ ...prev, [key]: id }))
        setTimeout(() => goNext(), 200)
    }

    const handleSubmit = async () => {
        setEmailError(null)
        if (!EMAIL_RE.test(answers.email.trim())) {
            setEmailError('メールアドレスの形式が正しくありません。')
            return
        }

        setSubmitting(true)
        setSubmitError(null)
        try {
            const res = await fetch('/api/leads', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    source: 'contact-wizard',
                    email: answers.email.trim(),
                    name: answers.name.trim(),
                    company: answers.company.trim(),
                    message: answers.message.trim(),
                    pain: labelsFor(PAIN_OPTIONS, answers.pain),
                    teamSize: labelFor(TEAM_SIZE_OPTIONS, answers.teamSize),
                    channels: labelsFor(CHANNEL_OPTIONS, answers.channels),
                    partnerCount: labelFor(PARTNER_COUNT_OPTIONS, answers.partnerCount),
                    website,
                }),
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

    if (submitted) {
        const thanksMessage =
            PAIN_OPTIONS.find((o) => answers.pain.includes(o.id) && PAIN_THANKS_MESSAGE[o.id])
                ?.id ?? null
        return (
            <div className="text-center py-12">
                <div className="inline-flex items-center justify-center w-16 h-16 bg-green-100 rounded-full mb-4">
                    <CheckCircle size={32} weight="fill" className="text-green-600" />
                </div>
                <h2
                    ref={headingRef}
                    tabIndex={-1}
                    className="text-xl font-bold text-slate-900 mb-2 focus:outline-none"
                >
                    送信ありがとうございます。1営業日以内にご連絡します。
                </h2>
                <p className="text-slate-600 mb-8 max-w-md mx-auto">
                    {thanksMessage ? PAIN_THANKS_MESSAGE[thanksMessage] : DEFAULT_THANKS_MESSAGE}
                </p>
                <div className="border-t border-slate-200 pt-6">
                    <p className="text-sm font-medium text-slate-700 mb-3">詳しく知りたい方へ</p>
                    <div className="flex flex-col sm:flex-row gap-3 justify-center">
                        <Link
                            href="/seminar"
                            className="text-sm text-amber-600 hover:text-amber-700 font-medium transition-colors"
                        >
                            セミナー一覧を見る →
                        </Link>
                        <Link
                            href="/features"
                            className="text-sm text-amber-600 hover:text-amber-700 font-medium transition-colors"
                        >
                            機能紹介を見る →
                        </Link>
                    </div>
                </div>
            </div>
        )
    }

    return (
        <div>
            {/* Progress */}
            <div className="mb-6">
                <div className="h-1.5 w-full rounded-full bg-slate-100 overflow-hidden">
                    <div
                        className="h-full bg-amber-500 transition-all duration-200"
                        style={{ width: `${(step / TOTAL_STEPS) * 100}%` }}
                    />
                </div>
                <p className="mt-2 text-xs text-slate-400">
                    {step} / {TOTAL_STEPS}
                </p>
            </div>

            <div className="transition-opacity duration-200">
                {step === 1 && (
                    <fieldset>
                        <legend>
                            <h2
                                ref={headingRef}
                                tabIndex={-1}
                                className="text-lg font-bold text-slate-900 mb-1 focus:outline-none"
                            >
                                いま、どんなことにお困りですか？
                            </h2>
                        </legend>
                        <p className="text-sm text-slate-500 mb-4">近いものをすべて選んでください</p>
                        <div className="space-y-2.5">
                            {PAIN_OPTIONS.map((opt) => (
                                <label key={opt.id} className={cardClasses}>
                                    <input
                                        type="checkbox"
                                        className="accent-amber-500"
                                        checked={answers.pain.includes(opt.id)}
                                        onChange={() =>
                                            setAnswers((prev) => ({
                                                ...prev,
                                                pain: toggleId(prev.pain, opt.id),
                                            }))
                                        }
                                    />
                                    {opt.label}
                                </label>
                            ))}
                        </div>
                        <button
                            type="button"
                            disabled={answers.pain.length === 0}
                            onClick={goNext}
                            className="mt-6 w-full py-3 bg-amber-500 text-white font-bold rounded-lg hover:bg-amber-600 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                            次へ
                        </button>
                    </fieldset>
                )}

                {step === 2 && (
                    <fieldset role="radiogroup" aria-label="チームの人数は？">
                        <BackLink onClick={goBack} />
                        <legend>
                            <h2
                                ref={headingRef}
                                tabIndex={-1}
                                className="text-lg font-bold text-slate-900 mb-4 focus:outline-none"
                            >
                                チームの人数は？
                            </h2>
                        </legend>
                        <div className="space-y-2.5">
                            {TEAM_SIZE_OPTIONS.map((opt) => (
                                <label key={opt.id} className={cardClasses}>
                                    <input
                                        type="radio"
                                        name="teamSize"
                                        className="accent-amber-500"
                                        checked={answers.teamSize === opt.id}
                                        onChange={() => selectSingleAndAdvance('teamSize', opt.id)}
                                    />
                                    {opt.label}
                                </label>
                            ))}
                        </div>
                    </fieldset>
                )}

                {step === 3 && (
                    <fieldset>
                        <BackLink onClick={goBack} />
                        <legend>
                            <h2
                                ref={headingRef}
                                tabIndex={-1}
                                className="text-lg font-bold text-slate-900 mb-4 focus:outline-none"
                            >
                                社外とのやり取りに使っているものは？
                            </h2>
                        </legend>
                        <div className="space-y-2.5">
                            {CHANNEL_OPTIONS.map((opt) => (
                                <label key={opt.id} className={cardClasses}>
                                    <input
                                        type="checkbox"
                                        className="accent-amber-500"
                                        checked={answers.channels.includes(opt.id)}
                                        onChange={() =>
                                            setAnswers((prev) => ({
                                                ...prev,
                                                channels: toggleId(prev.channels, opt.id),
                                            }))
                                        }
                                    />
                                    {opt.label}
                                </label>
                            ))}
                        </div>
                        <button
                            type="button"
                            disabled={answers.channels.length === 0}
                            onClick={goNext}
                            className="mt-6 w-full py-3 bg-amber-500 text-white font-bold rounded-lg hover:bg-amber-600 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                            次へ
                        </button>
                    </fieldset>
                )}

                {step === 4 && (
                    <fieldset role="radiogroup" aria-label="やり取りする相手先（顧問先・クライアント）はどのくらい？">
                        <BackLink onClick={goBack} />
                        <legend>
                            <h2
                                ref={headingRef}
                                tabIndex={-1}
                                className="text-lg font-bold text-slate-900 mb-4 focus:outline-none"
                            >
                                やり取りする相手先（顧問先・クライアント）はどのくらい？
                            </h2>
                        </legend>
                        <div className="space-y-2.5">
                            {PARTNER_COUNT_OPTIONS.map((opt) => (
                                <label key={opt.id} className={cardClasses}>
                                    <input
                                        type="radio"
                                        name="partnerCount"
                                        className="accent-amber-500"
                                        checked={answers.partnerCount === opt.id}
                                        onChange={() =>
                                            selectSingleAndAdvance('partnerCount', opt.id)
                                        }
                                    />
                                    {opt.label}
                                </label>
                            ))}
                        </div>
                    </fieldset>
                )}

                {step === 5 && (
                    <div>
                        <BackLink onClick={goBack} />
                        <h2
                            ref={headingRef}
                            tabIndex={-1}
                            className="text-lg font-bold text-slate-900 mb-1 focus:outline-none"
                        >
                            いまの状況やお気持ちを、そのまま教えてください
                        </h2>
                        <p className="text-sm text-slate-500 mb-4">
                            うまくいっていないこと、モヤモヤしていること、箇条書きでも殴り書きでも大丈夫です。整理されていなくて構いません。
                        </p>
                        <textarea
                            aria-label="いまの状況やお気持ち"
                            rows={5}
                            value={answers.message}
                            onChange={(e: ChangeEvent<HTMLTextAreaElement>) =>
                                setAnswers((prev) => ({ ...prev, message: e.target.value }))
                            }
                            placeholder="例: 顧問先とのLINEに依頼が埋もれて、月末にいつも探している…"
                            className={inputClasses + ' resize-y'}
                        />
                        <div className="mt-6 flex gap-3">
                            <button
                                type="button"
                                onClick={goNext}
                                className="flex-1 py-3 bg-amber-500 text-white font-bold rounded-lg hover:bg-amber-600 transition-colors"
                            >
                                次へ
                            </button>
                            <button
                                type="button"
                                onClick={goNext}
                                className="py-3 px-4 text-sm text-slate-500 hover:text-slate-700 font-medium transition-colors"
                            >
                                スキップ
                            </button>
                        </div>
                    </div>
                )}

                {step === 6 && (
                    <div>
                        <BackLink onClick={goBack} />
                        <h2
                            ref={headingRef}
                            tabIndex={-1}
                            className="text-lg font-bold text-slate-900 mb-4 focus:outline-none"
                        >
                            最後に、ご連絡先を教えてください
                        </h2>

                        {answers.pain.length > 0 && (
                            <div className="flex flex-wrap gap-1.5 mb-5">
                                {PAIN_OPTIONS.filter((o) => answers.pain.includes(o.id)).map(
                                    (o) => (
                                        <span
                                            key={o.id}
                                            className="text-xs bg-amber-50 text-amber-700 border border-amber-200 rounded-full px-2.5 py-1"
                                        >
                                            {o.label}
                                        </span>
                                    )
                                )}
                            </div>
                        )}

                        <div className="space-y-4">
                            <div>
                                <label htmlFor="wizard-name" className={labelClasses}>
                                    お名前
                                    <span className="ml-1.5 text-xs text-red-500 font-normal">
                                        必須
                                    </span>
                                </label>
                                <input
                                    id="wizard-name"
                                    type="text"
                                    required
                                    value={answers.name}
                                    onChange={(e: ChangeEvent<HTMLInputElement>) =>
                                        setAnswers((prev) => ({ ...prev, name: e.target.value }))
                                    }
                                    placeholder="山田 太郎"
                                    className={inputClasses}
                                />
                            </div>
                            <div>
                                <label htmlFor="wizard-email" className={labelClasses}>
                                    メールアドレス
                                    <span className="ml-1.5 text-xs text-red-500 font-normal">
                                        必須
                                    </span>
                                </label>
                                <input
                                    id="wizard-email"
                                    type="email"
                                    required
                                    value={answers.email}
                                    onChange={(e: ChangeEvent<HTMLInputElement>) =>
                                        setAnswers((prev) => ({ ...prev, email: e.target.value }))
                                    }
                                    placeholder="you@example.com"
                                    className={inputClasses}
                                />
                                {emailError && (
                                    <p className="mt-1.5 text-sm text-red-600" role="alert">
                                        {emailError}
                                    </p>
                                )}
                            </div>
                            <div>
                                <label htmlFor="wizard-company" className={labelClasses}>
                                    会社名・事務所名
                                    <span className="ml-1.5 text-xs text-slate-400 font-normal">
                                        任意
                                    </span>
                                </label>
                                <input
                                    id="wizard-company"
                                    type="text"
                                    value={answers.company}
                                    onChange={(e: ChangeEvent<HTMLInputElement>) =>
                                        setAnswers((prev) => ({
                                            ...prev,
                                            company: e.target.value,
                                        }))
                                    }
                                    placeholder="株式会社〇〇"
                                    className={inputClasses}
                                />
                            </div>

                            {/* honeypot: 人間には見えない欄。埋まっていたらAPI側でbot扱いされる */}
                            <div className="relative h-0 w-0 overflow-hidden">
                                <input
                                    type="text"
                                    name="website"
                                    value={website}
                                    onChange={(e) => setWebsite(e.target.value)}
                                    aria-hidden="true"
                                    tabIndex={-1}
                                    autoComplete="off"
                                    className="absolute opacity-0"
                                />
                            </div>

                            {submitError && (
                                <p className="text-sm text-red-600" role="alert">
                                    {submitError}
                                </p>
                            )}

                            <button
                                type="button"
                                disabled={submitting}
                                onClick={handleSubmit}
                                className="w-full py-3 bg-amber-500 text-white font-bold rounded-lg hover:bg-amber-600 transition-colors flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
                            >
                                <PaperPlaneTilt size={18} weight="bold" />
                                {submitting ? '送信中…' : '相談内容を送信する'}
                            </button>
                            <p className="text-xs text-slate-400 text-center">
                                これを添えて送ります・1営業日以内にご連絡します
                            </p>
                        </div>
                    </div>
                )}
            </div>
        </div>
    )
}

function BackLink({ onClick }: { onClick: () => void }) {
    return (
        <button
            type="button"
            onClick={onClick}
            className="mb-4 text-sm text-slate-400 hover:text-slate-600 transition-colors"
        >
            ← 戻る
        </button>
    )
}
