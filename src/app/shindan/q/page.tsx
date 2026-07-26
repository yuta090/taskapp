'use client'
import { Suspense, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import {
  questionsFor,
  score,
  pickFreeQuestion,
  FREE_Q_LAST,
  Role,
  typesFor,
  verdictsFor,
  VERBS,
  VERB_KEYS,
} from '@/lib/shindan/model'
import { TypeRadar, VerbHexagon, LoadGauge } from '@/components/shindan/charts'
import { ArticlePrescriptions } from '@/components/shindan/ArticlePrescriptions'

// タスク滞留診断のフロー(multica-prj/shindan-app q/page.tsx から移植)。
// 変更点: リード送信は既存の /api/leads(lp_leads) に相乗り(source: shindan / shindan-demo)、
// CTAは agentpm 向け(無料相談 /contact 系文言・/signup?ref=shindan・/task6)、GA計測なし

const ANSWERS = [
  { label: 'よくある', v: 2 },
  { label: 'ときどきある', v: 1 },
  { label: 'ほとんどない', v: 0 },
]

interface Lead {
  email: string
  name: string
  company: string
  size: string
}

/** 診断結果を /api/leads の message 欄(≤2000字)に収まる読みものに要約する */
function summarize(
  role: Role,
  s: ReturnType<typeof score>,
  free: [string, string],
  extraLines: string[] = []
): string {
  const TYPES = typesFor(role)
  const lines = [
    `【タスク滞留診断】${role === 'biz' ? '会社・チーム版' : '個人版'}`,
    `判定: ${s.verdict} / 量の負荷: ${s.load}%`,
    `上位タイプ: ${
      s.top.map((k) => `${TYPES[k as keyof typeof TYPES].name}(${s.type[k]}%)`).join(' × ') ||
      'なし'
    }`,
    `6つの力: ${VERB_KEYS.map((k) => `${VERBS[k].plain}${s.verb[k]}%`).join(' / ')}`,
    ...extraLines,
  ]
  if (free[0].trim()) lines.push(`Q: ${pickFreeQuestion(role, s)}\nA: ${free[0].trim().slice(0, 300)}`)
  if (free[1].trim()) lines.push(`Q: ${FREE_Q_LAST}\nA: ${free[1].trim().slice(0, 300)}`)
  return lines.join('\n').slice(0, 2000)
}

async function postLead(body: {
  source: string
  email: string
  name?: string
  company?: string
  teamSize?: string
  message: string
}): Promise<boolean> {
  try {
    const res = await fetch('/api/leads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    return res.ok
  } catch {
    return false
  }
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

function RoleFlow({ role }: { role: Role }) {
  const qs = questionsFor(role)
  const storeKey = `shindan-${role}`
  const [i, setI] = useState(0)
  const [answers, setAnswers] = useState<number[]>([])
  const [free, setFree] = useState<[string, string]>(['', ''])
  const [analyzing, setAnalyzing] = useState(false)
  const [done, setDone] = useState(false)
  const [locked, setLocked] = useState(false)
  const [restored, setRestored] = useState(false)

  // リロードで回答を失わない（sessionStorage復元）。
  // hydration不整合を避けるため初回描画後に復元する(lint対応で同期setStateはrAF経由)
  useEffect(() => {
    const restore = () => {
      try {
        const raw = sessionStorage.getItem(storeKey)
        if (raw) {
          const saved = JSON.parse(raw)
          // 壊れた/範囲外の復元はクラッシュ・設問スキップの原因になるため厳格に検証
          const iOk = Number.isInteger(saved.i) && saved.i >= 0 && saved.i <= qs.length + 1
          const ansOk =
            Array.isArray(saved.answers) &&
            saved.answers.length <= qs.length &&
            saved.answers.every((v: unknown) => v === 0 || v === 1 || v === 2)
          if (iOk && ansOk) {
            setI(saved.i)
            setAnswers(saved.answers)
            if (
              Array.isArray(saved.free) &&
              saved.free.length === 2 &&
              saved.free.every((s: unknown) => typeof s === 'string')
            ) {
              setFree(saved.free as [string, string])
            }
          } else {
            sessionStorage.removeItem(storeKey)
          }
        }
      } catch {
        /* 復元失敗は最初から */
      }
      setRestored(true)
    }
    const raf = requestAnimationFrame(restore)
    return () => cancelAnimationFrame(raf)
  }, [storeKey, qs.length])

  useEffect(() => {
    if (!restored || done || analyzing) return
    try {
      sessionStorage.setItem(storeKey, JSON.stringify({ i, answers, free }))
    } catch {
      /* 容量超過等は無視 */
    }
  }, [i, answers, free, restored, done, analyzing, storeKey])

  const total = qs.length + 2 // 選択式 + 自由回答2問
  const freeIdx = i - qs.length

  if (!restored) return <div className="card" style={{ minHeight: 200 }} />
  if (done) return <Result role={role} answers={answers} free={free} />
  if (analyzing)
    return (
      <Analyzing
        onDone={() => {
          setAnalyzing(false)
          setDone(true)
        }}
      />
    )

  const pct = Math.round(((i + 1) / total) * 100)

  /* --- 自由回答フェーズ（任意） --- */
  if (freeIdx >= 0) {
    const freeQ = freeIdx === 0 ? pickFreeQuestion(role, score(role, answers)) : FREE_Q_LAST
    const kicker = freeIdx === 0 ? 'ここまでの回答から、この質問を選びました' : '最後の質問'
    const advance = () => {
      if (freeIdx === 0) setI(i + 1)
      else {
        try {
          sessionStorage.removeItem(storeKey)
        } catch {
          /* noop */
        }
        setAnalyzing(true)
      }
      window.scrollTo(0, 0)
    }
    return (
      <div className="card">
        <div className="prog">
          <i style={{ width: `${pct}%` }} />
        </div>
        <div className="qslide" key={i}>
          <div className="qno">{kicker}（任意）</div>
          <div className="qtext">{freeQ}</div>
          <textarea
            className="freebox"
            rows={4}
            aria-label="自由回答"
            placeholder={
              freeIdx === 0
                ? '率直にどうぞ（任意・未記入のまま進めます）'
                : '理想でも愚痴でも。書いていただいた言葉は、そのまま拝読します（任意）'
            }
            value={free[freeIdx]}
            onChange={(e) => {
              const next: [string, string] = [...free] as [string, string]
              next[freeIdx] = e.target.value
              setFree(next)
            }}
          />
          <button className="cta" onClick={advance}>
            {freeIdx === 0 ? '次へ' : '診断結果を見る'}
          </button>
        </div>
        <button className="back" onClick={() => setI(i - 1)}>
          ← 前の質問に戻る
        </button>
      </div>
    )
  }

  /* --- 選択式フェーズ --- */
  const q = qs[i]
  const partLabel =
    role === 'self' ? 'あなたの仕事について' : q.verb === null ? '業務量について' : 'チーム・組織について'
  const pick = (v: number) => {
    if (locked) return
    const next = [...answers]
    next[i] = v
    setAnswers(next)
    setLocked(true)
    // 選択フィードバック（チェックマークのポップ）を見せてから次へ
    window.setTimeout(() => {
      setI(i + 1)
      setLocked(false)
      window.scrollTo(0, 0)
    }, 320)
  }

  return (
    <div className="card">
      <div className="prog">
        <i style={{ width: `${pct}%` }} />
      </div>
      <div className="qslide" key={i}>
        <div className="qno">
          {partLabel} ｜ 設問 {i + 1} / {qs.length}
        </div>
        <div className="qtext">{q.t}</div>
        <div className="opts">
          {ANSWERS.map((a) => (
            <button
              key={a.v}
              className={`opt ${answers[i] === a.v ? 'sel' : ''}`}
              onClick={() => pick(a.v)}
            >
              {a.label}
            </button>
          ))}
        </div>
      </div>
      {i > 0 && (
        <button className="back" onClick={() => !locked && setI(i - 1)}>
          ← 前の質問に戻る
        </button>
      )}
    </div>
  )
}

/** 回答受け取り→分析の間（ま）。感謝を伝えてから結果へ */
function Analyzing({ onDone }: { onDone: () => void }) {
  const [msg, setMsg] = useState('回答を受け取りました。ありがとうございます')
  useEffect(() => {
    const t1 = window.setTimeout(() => setMsg('結果を表示します'), 800)
    const t2 = window.setTimeout(onDone, 1300)
    return () => {
      window.clearTimeout(t1)
      window.clearTimeout(t2)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return (
    <div className="card analyzing">
      <div className="spinner" aria-hidden="true" />
      <p className="qslide" key={msg}>
        {msg}
      </p>
    </div>
  )
}

function Result({ role, answers, free }: { role: Role; answers: number[]; free: [string, string] }) {
  const s = score(role, answers)
  const TYPES = typesFor(role)
  const v = verdictsFor(role)[s.verdict]
  const [lead, setLead] = useState<Lead | null>(null)
  const weakest = [...VERB_KEYS].sort((a, b) => s.verb[a] - s.verb[b])[0]
  const allStrong = VERB_KEYS.every((k) => s.verb[k] >= 100)
  const hasTypes = s.top.length > 0
  const title = hasTypes
    ? s.top.map((k) => TYPES[k as keyof typeof TYPES].name).join(' × ')
    : '大きな滞留は見つかりませんでした'

  return (
    <div className="card">
      <div className="res-kicker rv">診断結果</div>
      <div className="res-title rv" style={{ animationDelay: '.07s' }}>
        {title}
      </div>

      {/* ここまでは誰でも読める（段階リビール） */}
      <div className="chart2 rv" style={{ animationDelay: '.18s' }}>
        <div>
          <h4>滞留タイプ（赤いほど問題）</h4>
          <div className="chartbox">
            <TypeRadar type={s.type} role={role} />
          </div>
        </div>
        <div>
          <h4>仕事を進める6つの力（広いほど強い）</h4>
          <div className="chartbox">
            <VerbHexagon verb={s.verb} />
          </div>
        </div>
      </div>
      <div className="rv" style={{ animationDelay: '.32s' }}>
        <LoadGauge load={s.load} />
      </div>
      <div
        className={`verdict rv ${s.verdict === 'B' ? 'vb' : s.verdict === 'C' ? 'vc' : ''}`}
        style={{ animationDelay: '.45s' }}
      >
        <h3>{v.head}</h3>
        {v.body}
      </div>
      {!allStrong && (
        <p className="meta rv" style={{ marginTop: 14, animationDelay: '.55s' }}>
          いちばん弱いのは
          <b>
            「{VERBS[weakest].plain}（{VERBS[weakest].name}）」
          </b>
          の力 —— {VERBS[weakest].desc}。
        </p>
      )}

      {/* 吐露してもらった言葉を、そのまま結果に接続する（引用＋固定文型。生成なし） */}
      {(free[0].trim() || free[1].trim()) && (
        <div className="yourwords rv" style={{ animationDelay: '.6s' }}>
          <h4>あなたが書いてくれたこと</h4>
          {free[0].trim() && <blockquote>「{free[0].trim()}」</blockquote>}
          {free[1].trim() && <blockquote>「{free[1].trim()}」</blockquote>}
          <p>
            {allStrong ? (
              <>メールをご登録いただくと、この言葉も担当がそのまま拝読します。</>
            ) : (
              <>
                回答では「{VERBS[weakest].plain}（{VERBS[weakest].name}）」の力が相対的に低く出ています。
                {free[1].trim() ? 'ご相談の際は、この言葉を出発点にします。' : '詳しい解説で、仕組みでの対応例を確認できます。'}
              </>
            )}
          </p>
        </div>
      )}

      <p className="disclaimer rv" style={{ animationDelay: '.65s' }}>
        研究知見を参考にした簡易セルフチェックです（学術的検査ではありません）。結果は参考情報であり、成果を約束するものではありません。
      </p>

      {/* 上位タイプがある場合のみ詳細ゲート。ない場合（滞留なし・量のみ）は直接のご案内 */}
      {hasTypes ? (
        lead ? (
          <DetailSection s={s} role={role} free={free} lead={lead} />
        ) : (
          <div className="rv" style={{ animationDelay: '.72s' }}>
            <Gate role={role} s={s} free={free} onUnlock={setLead} />
          </div>
        )
      ) : (
        <div className="rv" style={{ animationDelay: '.72s' }}>
          <DirectNext role={role} s={s} free={free} />
        </div>
      )}
    </div>
  )
}

/** agentpm / TASK6 への導線（結果画面の共通フッター） */
function NextLinks() {
  return (
    <div className="crosslink" style={{ marginTop: 16 }}>
      <Link href="/signup?ref=shindan">自分で仕組みを整えるなら — agentpmを無料で始める →</Link>
      <Link href="/task6">まず学びたいなら — 学びのメディア TASK6 →</Link>
    </div>
  )
}

/** 開錠後の詳細（タイプ解説＋無料相談の申込み） */
function DetailSection({
  s,
  role,
  free,
  lead,
}: {
  s: ReturnType<typeof score>
  role: Role
  free: [string, string]
  lead: Lead
}) {
  const TYPES = typesFor(role)
  const [timeline, setTimeline] = useState('')
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'err'>('idle')
  const inFlight = useRef(false)

  const requestConsult = async () => {
    if (state === 'busy' || inFlight.current) return
    inFlight.current = true
    setState('busy')
    const ok = await postLead({
      source: 'shindan-demo',
      email: lead.email,
      name: lead.name,
      company: lead.company,
      teamSize: lead.size || undefined,
      message: summarize(role, s, free, [
        `希望: 無料相談(オンライン・30分)`,
        `検討状況: ${timeline || '未選択'}`,
      ]),
    })
    setState(ok ? 'done' : 'err')
    inFlight.current = false
  }

  return (
    <div style={{ marginTop: 20 }}>
      {s.top.map((k, idx) => {
        const t = TYPES[k as keyof typeof TYPES]
        return (
          <details className="tsum rv" key={k} open style={{ animationDelay: `${idx * 0.12}s` }}>
            <summary>
              {t.name}で起きていること（一致度 {s.type[k]}%）
            </summary>
            <div className="tbody">
              {t.what}
              <br />
              <br />
              <b style={{ color: 'var(--main)' }}>仕組みで対応する場合の例:</b> {t.how}
            </div>
            {/* そのタイプに効くTASK6記事（処方箋）。該当記事が未公開なら何も出ない */}
            <ArticlePrescriptions type={k} typeName={t.name} />
          </details>
        )
      })}
      <div
        className="verdict rv"
        style={{ marginTop: 16, animationDelay: `${s.top.length * 0.12 + 0.1}s` }}
      >
        <h3>次の一歩: 無料相談（オンライン・30分）</h3>
        <p style={{ marginBottom: 14 }}>
          {free[1].trim()
            ? '書いていただいた「これから」を出発点に、この診断結果の読み解きと、どこから手を打つべきかを一緒に整理します。準備は不要・発注の義務はありません。'
            : 'この診断結果の読み解きと、どこから手を打つべきかを一緒に整理します。準備は不要・発注の義務はありません。'}
        </p>
        {state === 'done' ? (
          <div className="confirm qslide" role="status">
            受け付けました。{lead.email} 宛に、担当より1営業日以内にメールでご連絡し、ご希望の日時で30分の無料相談（オンライン）を調整します。準備は不要です。
          </div>
        ) : (
          <>
            <select
              className="gsel"
              aria-label="ご検討状況"
              value={timeline}
              onChange={(e) => setTimeline(e.target.value)}
            >
              <option value="">ご検討状況（任意）</option>
              <option value="now">すぐに改善したい</option>
              <option value="3mo">3ヶ月以内をめどに</option>
              <option value="info">まずは情報収集</option>
            </select>
            <button
              className="cta"
              style={{ fontSize: 15 }}
              onClick={requestConsult}
              disabled={state === 'busy'}
            >
              {state === 'busy' ? '送信中…' : '無料相談を希望する（オンライン・30分）'}
            </button>
            {state === 'err' && (
              <div className="err" style={{ marginTop: 8 }}>
                送信に失敗しました。時間をおいてお試しください
              </div>
            )}
          </>
        )}
      </div>
      <NextLinks />
      {role === 'self' && (
        <div className="crosslink rv" style={{ marginTop: 12, animationDelay: `${s.top.length * 0.12 + 0.2}s` }}>
          <Link href="/shindan/q?role=biz">会社・チーム版でも診断する →</Link>
          <span>この結果は、上司の方への説明にもお使いいただけます。</span>
        </div>
      )}
    </div>
  )
}

/** 上位タイプなし（滞留なし・量のみ）の直接案内 — タイプ解説は存在しないためゲートを使わない */
function DirectNext({
  role,
  s,
  free,
}: {
  role: Role
  s: ReturnType<typeof score>
  free: [string, string]
}) {
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [err, setErr] = useState('')
  const [state, setState] = useState<'idle' | 'busy' | 'done'>('idle')
  const inFlight = useRef(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (state === 'busy' || inFlight.current) return
    if (!EMAIL_RE.test(email) || email.length > 254) {
      setErr('メールアドレスの形式をご確認ください')
      return
    }
    inFlight.current = true
    setState('busy')
    setErr('')
    const ok = await postLead({
      source: 'shindan-demo',
      email,
      name: name || undefined,
      message: summarize(role, s, free, ['希望: 無料相談(オンライン・30分)']),
    })
    if (ok) setState('done')
    else {
      setState('idle')
      setErr('送信に失敗しました。時間をおいてお試しください')
    }
    inFlight.current = false
  }

  return (
    <div className="verdict" style={{ marginTop: 20 }}>
      <h3>{s.verdict === 'C' ? '次の一歩: 量の仕分け相談（無料・30分）' : '予防にご関心があれば'}</h3>
      <p style={{ marginBottom: 14 }}>
        {s.verdict === 'C'
          ? '量の問題が中心のため、タイプ別の解説はありません。無料相談では、AIに任せて減らせる仕事の仕分けを一緒に行います。'
          : '現状、タイプ別に解説するほどの滞留は見つかりませんでした。予防の仕組みづくりや、AIへの業務委任のご相談を承ります。'}
      </p>
      {state === 'done' ? (
        <div className="confirm qslide" role="status">
          受け付けました。{email} 宛に、担当より1営業日以内にメールでご連絡し、ご希望の日時で30分の無料相談（オンライン）を調整します。準備は不要です。
        </div>
      ) : (
        <form onSubmit={submit}>
          <input
            className="ginput"
            type="email"
            aria-label="メールアドレス"
            placeholder="メールアドレス（必須）"
            maxLength={254}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <input
            className="ginput"
            aria-label="お名前"
            placeholder="お名前（任意）"
            maxLength={100}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          {err && (
            <div className="err" role="alert">
              {err}
            </div>
          )}
          <button className="cta" style={{ fontSize: 15 }} type="submit" disabled={state === 'busy'}>
            {state === 'busy' ? '送信中…' : '無料相談の案内を希望する（オンライン・30分）'}
          </button>
          <p className="privacy">
            入力いただいた情報は、この診断に関するご連絡のみに使用します。
            <Link href="/privacy" target="_blank" rel="noopener" className="privacy-link">
              プライバシーポリシー
            </Link>
          </p>
        </form>
      )}
      <NextLinks />
      <div className="crosslink" style={{ marginTop: 12 }}>
        {role === 'self' ? (
          <Link href="/shindan/q?role=biz">会社・チーム版でも診断する →</Link>
        ) : (
          <Link href="/shindan/q?role=self">自分の仕事版でも診断する →</Link>
        )}
      </div>
    </div>
  )
}

/** メール開錠ゲート — 既存 /api/leads にPOST（source: shindan） */
function Gate({
  role,
  s,
  free,
  onUnlock,
}: {
  role: Role
  s: ReturnType<typeof score>
  free: [string, string]
  onUnlock: (lead: Lead) => void
}) {
  const TYPES = typesFor(role)
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [company, setCompany] = useState('')
  const [size, setSize] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const inFlight = useRef(false)
  const topNames = s.top.map((k) => TYPES[k as keyof typeof TYPES].name)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (busy || inFlight.current) return
    if (!EMAIL_RE.test(email) || email.length > 254) {
      setErr('メールアドレスの形式をご確認ください')
      return
    }
    inFlight.current = true
    setBusy(true)
    setErr('')
    const ok = await postLead({
      source: 'shindan',
      email,
      name: name || undefined,
      company: company || undefined,
      teamSize: size || undefined,
      message: summarize(role, s, free),
    })
    setBusy(false)
    inFlight.current = false
    if (ok) onUnlock({ email, name, company, size })
    else setErr('送信に失敗しました。時間をおいてお試しください')
  }

  return (
    <div className="gate">
      <div className="blurred" aria-hidden="true">
        {topNames.map((n) => (
          <details className="tsum" open key={n}>
            <summary>{n}で起きていることと、仕組みでの対応例</summary>
            <div className="tbody">この部分は、メール送信後に表示されます。</div>
          </details>
        ))}
      </div>
      <div className="gform">
        <form className="gform-inner" onSubmit={submit}>
          <h3>{topNames.join('・')}の原因と対応例を見る</h3>
          <p>開くのは、上位タイプ別の「起きていること」「仕組みでの対応例」と、無料相談のご案内です。</p>
          <input
            type="email"
            aria-label="メールアドレス"
            placeholder="メールアドレス（必須）"
            maxLength={254}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <div className="row2">
            <input
              aria-label="お名前"
              placeholder="お名前（任意）"
              maxLength={100}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <input
              aria-label="会社名"
              placeholder="会社名（任意）"
              maxLength={100}
              value={company}
              onChange={(e) => setCompany(e.target.value)}
            />
          </div>
          {role === 'biz' && (
            <select
              className="gsel"
              aria-label="従業員規模"
              value={size}
              onChange={(e) => setSize(e.target.value)}
            >
              <option value="">従業員規模（任意）</option>
              <option value="~10">〜10名</option>
              <option value="11-50">11〜50名</option>
              <option value="51-100">51〜100名</option>
              <option value="101+">101名〜</option>
            </select>
          )}
          {err && (
            <div className="err" role="alert">
              {err}
            </div>
          )}
          <button className="cta" style={{ fontSize: 15 }} type="submit" disabled={busy}>
            {busy ? '送信中…' : 'メールアドレスを登録して詳細を見る（無料）'}
          </button>
          <p className="privacy">
            入力いただいた情報は、この診断に関するご連絡のみに使用します。
            <Link href="/privacy" target="_blank" rel="noopener" className="privacy-link">
              プライバシーポリシー
            </Link>
          </p>
        </form>
      </div>
    </div>
  )
}

/** role をURLから読み、role が変わるたび RoleFlow を再マウント（前ロールの回答・結果の混入を防ぐ） */
function Flow() {
  const role = (useSearchParams().get('role') === 'self' ? 'self' : 'biz') as Role
  return <RoleFlow key={role} role={role} />
}

export default function Page() {
  return (
    <Suspense fallback={<div className="card">読み込み中…</div>}>
      <Flow />
    </Suspense>
  )
}
