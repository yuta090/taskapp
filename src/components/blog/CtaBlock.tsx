import Link from 'next/link'
import { appendAttribution } from '@/lib/task6/attribution'

export interface CtaBlockData {
  heading: string
  body: string | null
  button_label: string
  button_url: string
  variant: 'inline' | 'band' | 'card'
}

/**
 * 記事に差し込むCTA。variant で見た目を出し分ける。
 * articleSlug を渡すと内部リンクに ?ref=task6&art=<slug> を付与し、
 * どの記事から登録が生まれたかを計測できる。
 */
export function CtaBlock({ cta, articleSlug }: { cta: CtaBlockData; articleSlug?: string }) {
  const isExternal = cta.button_url.startsWith('https://')
  const href =
    articleSlug && !isExternal ? appendAttribution(cta.button_url, articleSlug) : cta.button_url
  const linkProps = {
    href,
    ...(isExternal ? { target: '_blank' as const, rel: 'noopener noreferrer' } : {}),
  }

  const button = (
    <Link
      {...linkProps}
      className="inline-flex items-center justify-center rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-amber-600"
    >
      {cta.button_label}
    </Link>
  )

  // 文中: 記事の続きとして読める「補足」の顔にする。塗り面もボタンも置かず、
  // 左の細い罫とテキストリンクだけ。読んでいる目線を止めない（広告に見えると読者は身構える）。
  if (cta.variant === 'inline') {
    return (
      <aside className="not-prose my-8 border-l-2 border-amber-300 pl-4">
        <p className="text-[15px] font-medium text-slate-700">{cta.heading}</p>
        {cta.body && <p className="mt-1 text-sm leading-relaxed text-slate-500">{cta.body}</p>}
        <Link
          {...linkProps}
          className="mt-2 inline-block text-sm font-semibold text-amber-700 underline decoration-amber-300 underline-offset-4 transition-colors hover:text-amber-800"
        >
          {cta.button_label} →
        </Link>
      </aside>
    )
  }

  // 記事の途中〜末尾の中間強度。淡いグレー面で「区切り」だけを作る。
  if (cta.variant === 'card') {
    return (
      <div className="not-prose my-10 rounded-xl border border-slate-200 bg-slate-50 p-5">
        <p className="text-base font-bold text-slate-900">{cta.heading}</p>
        {cta.body && <p className="mt-1.5 text-sm leading-relaxed text-slate-600">{cta.body}</p>}
        <div className="mt-4">{button}</div>
      </div>
    )
  }

  // band: 記事末尾の最終導線。以前は黒地・中央揃えで、本文の途中に出ると圧が強すぎた
  // （読者が身構える）。淡い琥珀の面＋左揃えにして、記事の続きの温度感に収める。
  // 中央揃えをやめたのは、中央揃えのブロックは広告バナーとして認識されやすいため。
  return (
    <div className="not-prose my-10 rounded-2xl border border-amber-200 bg-amber-50 px-6 py-7">
      <p className="text-base font-bold text-slate-900">{cta.heading}</p>
      {cta.body && <p className="mt-1.5 max-w-xl text-sm leading-relaxed text-slate-600">{cta.body}</p>}
      <div className="mt-4">{button}</div>
    </div>
  )
}
