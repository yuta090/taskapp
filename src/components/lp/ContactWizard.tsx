'use client'

import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import Link from 'next/link'
import { CheckCircle, PaperPlaneTilt } from '@phosphor-icons/react'
import styles from './ContactWizard.module.css'

/*
 * デザインは multica-prj/shindan-app と同一の規約に合わせる（design.md が正本）。
 * トークン・クラスは ContactWizard.module.css にスコープし、TaskApp LPの
 * Tailwind/他コンポーネントには影響させない。
 */

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
const SINGLE_SELECT_LOCK_MS = 320

const STEP_CATEGORY: Record<number, string> = {
    1: 'お困りごと',
    2: 'チーム規模',
    3: '連絡手段',
    4: '取引先の数',
    5: '今の気持ち',
    6: 'ご連絡先',
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

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

/* ─── Choice cards ─── */

// 複数選択(Q1/Q3): ネイティブcheckboxをラベルで囲みカード見た目にする
function CheckboxCard({
    checked,
    label,
    onChange,
}: {
    checked: boolean
    label: string
    onChange: () => void
}) {
    return (
        <label className={`${styles.opt} ${checked ? styles.sel : ''}`}>
            <input
                type="checkbox"
                checked={checked}
                onChange={onChange}
                className={styles.visuallyHidden}
            />
            {label}
        </label>
    )
}

// 単一選択(Q2/Q4): ネイティブradioは矢印キーでフォーカス移動しただけでもonChangeが
// 発火し自動前進してしまうため使わない。buttonにrole="radio"+aria-checkedを付与し、
// Tab/矢印でのフォーカス移動では選択されず、click/Enter/Spaceの明示的な活性化でのみ選択する
function RadioCard({
    checked,
    label,
    onSelect,
}: {
    checked: boolean
    label: string
    onSelect: () => void
}) {
    return (
        <button
            type="button"
            role="radio"
            aria-checked={checked}
            className={`${styles.opt} ${checked ? styles.sel : ''}`}
            onClick={onSelect}
        >
            {label}
        </button>
    )
}

/* ─── Component ─── */

export function ContactWizard() {
    const [step, setStep] = useState(1)
    const [answers, setAnswers] = useState<Answers>(initialAnswers)
    const [website, setWebsite] = useState('') // honeypot
    const [locked, setLocked] = useState(false)
    const [nameError, setNameError] = useState<string | null>(null)
    const [emailError, setEmailError] = useState<string | null>(null)
    const [submitting, setSubmitting] = useState(false)
    const [submitError, setSubmitError] = useState<string | null>(null)
    const [submitted, setSubmitted] = useState(false)

    const headingRef = useRef<HTMLHeadingElement>(null)
    // 単一選択の自動前進タイマー。戻る操作やアンマウント時に必ずクリアし、
    // 古いタイマーが後から発火してstepを強制的に進めてしまうバグ(戻った直後に弾き返される)を防ぐ
    const lockTimerRef = useRef<number | null>(null)

    useEffect(() => {
        headingRef.current?.focus()
    }, [step, submitted])

    useEffect(() => {
        return () => {
            if (lockTimerRef.current !== null) window.clearTimeout(lockTimerRef.current)
        }
    }, [])

    const goNext = () => setStep((s) => Math.min(s + 1, TOTAL_STEPS))
    const goBack = () => {
        if (lockTimerRef.current !== null) {
            window.clearTimeout(lockTimerRef.current)
            lockTimerRef.current = null
        }
        setLocked(false)
        setStep((s) => Math.max(s - 1, 1))
    }

    // 単一選択の質問は選択→チェックポップ→320ms保持→自動前進(shindan-app q/page.tsx踏襲)。
    // 保持中は連打ロックし、二重前進を防ぐ
    const selectSingleAndAdvance = (key: 'teamSize' | 'partnerCount', id: string) => {
        if (locked) return
        setAnswers((prev) => ({ ...prev, [key]: id }))
        setLocked(true)
        lockTimerRef.current = window.setTimeout(() => {
            lockTimerRef.current = null
            goNext()
            setLocked(false)
        }, SINGLE_SELECT_LOCK_MS)
    }

    const handleSubmit = async () => {
        setNameError(null)
        setEmailError(null)
        const nameValid = answers.name.trim().length > 0
        const emailValid = EMAIL_RE.test(answers.email.trim())
        if (!nameValid) setNameError('お名前を入力してください。')
        if (!emailValid) setEmailError('メールアドレスの形式が正しくありません。')
        if (!nameValid || !emailValid) return

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
        const matchedPainId =
            PAIN_OPTIONS.find((o) => answers.pain.includes(o.id) && PAIN_THANKS_MESSAGE[o.id])
                ?.id ?? null
        return (
            <div className={styles.root}>
                <section className={styles.section}>
                    <MeshBackground />
                    <div className={styles.wrap}>
                        <div className={styles.card} style={{ textAlign: 'center' }}>
                            <div className={`${styles.thanksIcon} ${styles.rv}`}>
                                <CheckCircle size={28} weight="fill" />
                            </div>
                            <div className={`${styles.resKicker} ${styles.rv}`}>送信完了</div>
                            <h2
                                ref={headingRef}
                                tabIndex={-1}
                                className={`${styles.resTitle} ${styles.rv}`}
                                style={{ animationDelay: '.07s' }}
                            >
                                送信ありがとうございます。1営業日以内にご連絡します。
                            </h2>
                            <p
                                className={`${styles.thanksBody} ${styles.rv}`}
                                style={{ animationDelay: '.14s' }}
                            >
                                {matchedPainId
                                    ? PAIN_THANKS_MESSAGE[matchedPainId]
                                    : DEFAULT_THANKS_MESSAGE}
                            </p>
                            <div
                                className={`${styles.detailLinks} ${styles.rv}`}
                                style={{ animationDelay: '.21s', textAlign: 'left' }}
                            >
                                <p>詳しく知りたい方へ</p>
                                {/* /seminar は未実装(404)のため案内しない。ページ新設時に復活させる */}
                                <Link href="/features">機能紹介を見る →</Link>
                                <Link href="/">業種別の活用例を見る →</Link>
                            </div>
                        </div>
                    </div>
                </section>
            </div>
        )
    }

    const pct = (step / TOTAL_STEPS) * 100

    return (
        <div className={styles.root}>
            <section className={styles.section}>
                <MeshBackground />
                <div className={styles.wrap}>
                    <div className={styles.card}>
                        <div className={styles.prog}>
                            <i style={{ width: `${pct}%` }} />
                        </div>

                        {step === 1 && (
                            <div className={styles.qslide} key={step}>
                                <div className={styles.qno}>
                                    {STEP_CATEGORY[1]} ｜ {step} / {TOTAL_STEPS}
                                </div>
                                <h2 ref={headingRef} tabIndex={-1} className={styles.qtext}>
                                    いま、どんなことにお困りですか？
                                </h2>
                                <p className={styles.lead}>近いものをすべて選んでください</p>
                                <fieldset>
                                    <legend className={styles.visuallyHidden}>
                                        いま、どんなことにお困りですか？
                                    </legend>
                                    <div className={styles.opts}>
                                        {PAIN_OPTIONS.map((opt) => (
                                            <CheckboxCard
                                                key={opt.id}
                                                checked={answers.pain.includes(opt.id)}
                                                label={opt.label}
                                                onChange={() =>
                                                    setAnswers((prev) => ({
                                                        ...prev,
                                                        pain: toggleId(prev.pain, opt.id),
                                                    }))
                                                }
                                            />
                                        ))}
                                    </div>
                                </fieldset>
                                <button
                                    type="button"
                                    disabled={answers.pain.length === 0}
                                    onClick={goNext}
                                    className={styles.cta}
                                    style={{ marginTop: 24 }}
                                >
                                    次へ
                                </button>
                            </div>
                        )}

                        {step === 2 && (
                            <div className={styles.qslide} key={step}>
                                <div className={styles.qno}>
                                    {STEP_CATEGORY[2]} ｜ {step} / {TOTAL_STEPS}
                                </div>
                                <h2
                                    ref={headingRef}
                                    tabIndex={-1}
                                    className={styles.qtext}
                                    style={{ marginBottom: 24 }}
                                >
                                    チームの人数は？
                                </h2>
                                <fieldset role="radiogroup" aria-label="チームの人数は？">
                                    <legend className={styles.visuallyHidden}>
                                        チームの人数は？
                                    </legend>
                                    <div className={styles.opts}>
                                        {TEAM_SIZE_OPTIONS.map((opt) => (
                                            <RadioCard
                                                key={opt.id}
                                                checked={answers.teamSize === opt.id}
                                                label={opt.label}
                                                onSelect={() =>
                                                    selectSingleAndAdvance('teamSize', opt.id)
                                                }
                                            />
                                        ))}
                                    </div>
                                </fieldset>
                                <button type="button" onClick={goBack} className={styles.back}>
                                    ← 戻る
                                </button>
                            </div>
                        )}

                        {step === 3 && (
                            <div className={styles.qslide} key={step}>
                                <div className={styles.qno}>
                                    {STEP_CATEGORY[3]} ｜ {step} / {TOTAL_STEPS}
                                </div>
                                <h2
                                    ref={headingRef}
                                    tabIndex={-1}
                                    className={styles.qtext}
                                    style={{ marginBottom: 24 }}
                                >
                                    社外とのやり取りに使っているものは？
                                </h2>
                                <fieldset>
                                    <legend className={styles.visuallyHidden}>
                                        社外とのやり取りに使っているものは？
                                    </legend>
                                    <div className={styles.opts}>
                                        {CHANNEL_OPTIONS.map((opt) => (
                                            <CheckboxCard
                                                key={opt.id}
                                                checked={answers.channels.includes(opt.id)}
                                                label={opt.label}
                                                onChange={() =>
                                                    setAnswers((prev) => ({
                                                        ...prev,
                                                        channels: toggleId(prev.channels, opt.id),
                                                    }))
                                                }
                                            />
                                        ))}
                                    </div>
                                </fieldset>
                                <button
                                    type="button"
                                    disabled={answers.channels.length === 0}
                                    onClick={goNext}
                                    className={styles.cta}
                                    style={{ marginTop: 24 }}
                                >
                                    次へ
                                </button>
                                <button type="button" onClick={goBack} className={styles.back}>
                                    ← 戻る
                                </button>
                            </div>
                        )}

                        {step === 4 && (
                            <div className={styles.qslide} key={step}>
                                <div className={styles.qno}>
                                    {STEP_CATEGORY[4]} ｜ {step} / {TOTAL_STEPS}
                                </div>
                                <h2
                                    ref={headingRef}
                                    tabIndex={-1}
                                    className={styles.qtext}
                                    style={{ marginBottom: 24 }}
                                >
                                    やり取りする相手先（顧問先・クライアント）はどのくらい？
                                </h2>
                                <fieldset
                                    role="radiogroup"
                                    aria-label="やり取りする相手先（顧問先・クライアント）はどのくらい？"
                                >
                                    <legend className={styles.visuallyHidden}>
                                        やり取りする相手先（顧問先・クライアント）はどのくらい？
                                    </legend>
                                    <div className={styles.opts}>
                                        {PARTNER_COUNT_OPTIONS.map((opt) => (
                                            <RadioCard
                                                key={opt.id}
                                                checked={answers.partnerCount === opt.id}
                                                label={opt.label}
                                                onSelect={() =>
                                                    selectSingleAndAdvance('partnerCount', opt.id)
                                                }
                                            />
                                        ))}
                                    </div>
                                </fieldset>
                                <button type="button" onClick={goBack} className={styles.back}>
                                    ← 戻る
                                </button>
                            </div>
                        )}

                        {step === 5 && (
                            <div className={styles.qslide} key={step}>
                                <div className={styles.qno}>
                                    {STEP_CATEGORY[5]} ｜ {step} / {TOTAL_STEPS}
                                </div>
                                <h2 ref={headingRef} tabIndex={-1} className={styles.qtext}>
                                    いまの状況やお気持ちを、そのまま教えてください
                                </h2>
                                <p className={styles.lead}>
                                    うまくいっていないこと、モヤモヤしていること、箇条書きでも殴り書きでも大丈夫です。整理されていなくて構いません。
                                </p>
                                <textarea
                                    aria-label="いまの状況やお気持ち"
                                    rows={5}
                                    value={answers.message}
                                    onChange={(e: ChangeEvent<HTMLTextAreaElement>) =>
                                        setAnswers((prev) => ({
                                            ...prev,
                                            message: e.target.value,
                                        }))
                                    }
                                    placeholder="率直にどうぞ（任意・未記入のまま進めます）"
                                    className={styles.freebox}
                                />
                                <button type="button" onClick={goNext} className={styles.cta}>
                                    次へ
                                </button>
                                <button type="button" onClick={goNext} className={styles.back}>
                                    スキップ
                                </button>
                                <button type="button" onClick={goBack} className={styles.back}>
                                    ← 戻る
                                </button>
                            </div>
                        )}

                        {step === 6 && (
                            <div className={styles.qslide} key={step}>
                                <div className={styles.qno}>
                                    {STEP_CATEGORY[6]} ｜ {step} / {TOTAL_STEPS}
                                </div>
                                <h2
                                    ref={headingRef}
                                    tabIndex={-1}
                                    className={styles.qtext}
                                    style={{ marginBottom: 20 }}
                                >
                                    最後に、ご連絡先を教えてください
                                </h2>

                                {answers.pain.length > 0 && (
                                    <div className={styles.chips}>
                                        {PAIN_OPTIONS.filter((o) =>
                                            answers.pain.includes(o.id)
                                        ).map((o) => (
                                            <span key={o.id} className={styles.chip}>
                                                {o.label}
                                            </span>
                                        ))}
                                    </div>
                                )}

                                <div className={styles.field}>
                                    <label htmlFor="wizard-name" className={styles.label}>
                                        お名前
                                        <span className={styles.required}>必須</span>
                                    </label>
                                    <input
                                        id="wizard-name"
                                        type="text"
                                        required
                                        value={answers.name}
                                        onChange={(e: ChangeEvent<HTMLInputElement>) =>
                                            setAnswers((prev) => ({
                                                ...prev,
                                                name: e.target.value,
                                            }))
                                        }
                                        placeholder="山田 太郎"
                                        className={styles.input}
                                    />
                                    {nameError && (
                                        <p className={styles.err} role="alert">
                                            {nameError}
                                        </p>
                                    )}
                                </div>
                                <div className={styles.field}>
                                    <label htmlFor="wizard-email" className={styles.label}>
                                        メールアドレス
                                        <span className={styles.required}>必須</span>
                                    </label>
                                    <input
                                        id="wizard-email"
                                        type="email"
                                        required
                                        value={answers.email}
                                        onChange={(e: ChangeEvent<HTMLInputElement>) =>
                                            setAnswers((prev) => ({
                                                ...prev,
                                                email: e.target.value,
                                            }))
                                        }
                                        placeholder="you@example.com"
                                        className={styles.input}
                                    />
                                    {emailError && (
                                        <p className={styles.err} role="alert">
                                            {emailError}
                                        </p>
                                    )}
                                </div>
                                <div className={styles.field}>
                                    <label htmlFor="wizard-company" className={styles.label}>
                                        会社名・事務所名
                                        <span className={styles.optional}>任意</span>
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
                                        className={styles.input}
                                    />
                                </div>

                                {/* honeypot: 人間には見えない欄。埋まっていたらAPI側でbot扱いされる */}
                                <input
                                    type="text"
                                    name="website"
                                    value={website}
                                    onChange={(e) => setWebsite(e.target.value)}
                                    aria-hidden="true"
                                    tabIndex={-1}
                                    autoComplete="off"
                                    className={styles.visuallyHidden}
                                />

                                {submitError && (
                                    <p className={styles.err} role="alert">
                                        {submitError}
                                    </p>
                                )}

                                <button
                                    type="button"
                                    disabled={submitting}
                                    onClick={handleSubmit}
                                    className={styles.cta}
                                >
                                    <PaperPlaneTilt
                                        size={16}
                                        weight="bold"
                                        style={{ marginRight: 8, verticalAlign: -2 }}
                                    />
                                    {submitting ? '送信中…' : '相談内容を送信する'}
                                </button>
                                <p className={styles.privacy}>
                                    入力いただいた内容は、本お問い合わせに関するご連絡にのみ使用します。1営業日以内にご連絡します。
                                </p>
                                <button type="button" onClick={goBack} className={styles.back}>
                                    ← 戻る
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            </section>
        </div>
    )
}

function MeshBackground() {
    return (
        <div className={styles.mesh} aria-hidden="true">
            <i className={styles.m1} />
            <i className={styles.m2} />
            <i className={styles.m3} />
        </div>
    )
}
