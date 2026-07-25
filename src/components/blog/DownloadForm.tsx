'use client'

import { useState } from 'react'
import Link from 'next/link'

interface Props {
  templateKey: string
}

type Status = 'idle' | 'sending' | 'sent' | 'error'

/**
 * TASK6 テンプレ申込フォーム（中間CV）。
 * メール登録と引き換えに、本人宛メールで期限付きダウンロードリンクを送る。
 */
export function DownloadForm({ templateKey }: Props) {
  const [email, setEmail] = useState('')
  const [newsletterOptIn, setNewsletterOptIn] = useState(false)
  const [website, setWebsite] = useState('') // honeypot: 人間には見えない
  const [status, setStatus] = useState<Status>('idle')
  const [errorMessage, setErrorMessage] = useState('')
  const [fallbackUrl, setFallbackUrl] = useState<string | null>(null)

  // どの記事から来たかを控える（同一オリジンのパスのみ）
  function readSourcePath(): string | null {
    try {
      if (!document.referrer) return null
      const ref = new URL(document.referrer)
      return ref.origin === window.location.origin ? ref.pathname : null
    } catch {
      // referrerが不正な形式でも申込自体は妨げない
      return null
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (status === 'sending') return
    setStatus('sending')
    setErrorMessage('')

    try {
      const sourcePath = readSourcePath()
      const res = await fetch('/api/task6/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          templateKey,
          newsletterOptIn,
          website,
          ...(sourcePath ? { sourcePath } : {}),
        }),
      })

      if (res.ok) {
        const json = await res.json()
        if (json.emailSent === false && typeof json.downloadUrl === 'string') {
          setFallbackUrl(json.downloadUrl)
        }
        setStatus('sent')
        return
      }
      if (res.status === 429) {
        setErrorMessage('短時間に申込が続いたため一時的に受付を止めています。少し時間をおいてお試しください。')
      } else if (res.status === 400) {
        setErrorMessage('メールアドレスの形式をご確認ください。')
      } else {
        setErrorMessage('送信に失敗しました。時間をおいてもう一度お試しください。')
      }
      setStatus('error')
    } catch {
      setErrorMessage('通信に失敗しました。時間をおいてもう一度お試しください。')
      setStatus('error')
    }
  }

  if (status === 'sent') {
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6">
        <p className="font-bold text-slate-900">お申し込みありがとうございます</p>
        {fallbackUrl ? (
          <p className="mt-2 text-sm text-slate-600">
            メールの送信に失敗したため、こちらから直接ダウンロードしてください:{' '}
            <a
              href={fallbackUrl}
              className="font-semibold text-amber-600 underline hover:text-amber-700"
            >
              テンプレートをダウンロード
            </a>
          </p>
        ) : (
          <p className="mt-2 text-sm text-slate-600">
            ダウンロードリンクをメールでお送りしました。届かない場合は、迷惑メールフォルダもご確認ください。
          </p>
        )}
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <label htmlFor="dl-email" className="block text-sm font-semibold text-slate-900">
        メールアドレス
      </label>
      <p className="mt-1 text-xs text-slate-500">ダウンロードリンクをこのアドレスへお送りします。</p>
      <input
        id="dl-email"
        type="email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="you@example.com"
        className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
      />

      {/* honeypot: botだけが埋める欄。画面には出さない */}
      <input
        type="text"
        name="website"
        value={website}
        onChange={(e) => setWebsite(e.target.value)}
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
        className="hidden"
      />

      <label className="mt-4 flex items-start gap-2 text-sm text-slate-600">
        <input
          type="checkbox"
          checked={newsletterOptIn}
          onChange={(e) => setNewsletterOptIn(e.target.checked)}
          className="mt-0.5 h-4 w-4 rounded border-slate-300 text-amber-500 focus:ring-amber-500"
        />
        <span>TASK6の新着記事・お役立ち情報をメールで受け取る（任意）</span>
      </label>

      {status === 'error' && (
        <p className="mt-3 text-sm text-red-600" role="alert">
          {errorMessage}
        </p>
      )}

      <button
        type="submit"
        disabled={status === 'sending'}
        className="mt-5 inline-flex w-full items-center justify-center rounded-lg bg-amber-500 px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-amber-600 disabled:opacity-60"
      >
        {status === 'sending' ? '送信中…' : '無料でテンプレートを受け取る'}
      </button>

      <p className="mt-3 text-xs text-slate-500">
        ご入力いただいたメールアドレスはテンプレートの送付
        {'（チェックした場合はお知らせの配信）'}にのみ利用します。詳しくは{' '}
        <Link href="/privacy" className="underline hover:text-slate-700">
          プライバシーポリシー
        </Link>
        をご覧ください。
      </p>
    </form>
  )
}
