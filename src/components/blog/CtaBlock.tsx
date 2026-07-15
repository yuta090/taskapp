import Link from 'next/link'

export interface CtaBlockData {
  heading: string
  body: string | null
  button_label: string
  button_url: string
  variant: 'inline' | 'band' | 'card'
}

/** 記事に差し込むCTA。variant で見た目を出し分ける。 */
export function CtaBlock({ cta }: { cta: CtaBlockData }) {
  const isExternal = cta.button_url.startsWith('https://')
  const button = (
    <Link
      href={cta.button_url}
      {...(isExternal ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
      className="inline-flex items-center justify-center rounded-lg bg-amber-500 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-amber-600"
    >
      {cta.button_label}
    </Link>
  )

  if (cta.variant === 'inline') {
    return (
      <div className="not-prose my-6 rounded-lg border-l-4 border-amber-400 bg-amber-50 px-4 py-3">
        <p className="text-sm font-semibold text-slate-900">{cta.heading}</p>
        {cta.body && <p className="mt-1 text-sm text-slate-600">{cta.body}</p>}
        <div className="mt-3">{button}</div>
      </div>
    )
  }

  if (cta.variant === 'card') {
    return (
      <div className="not-prose my-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <p className="text-lg font-bold text-slate-900">{cta.heading}</p>
        {cta.body && <p className="mt-2 text-sm text-slate-600">{cta.body}</p>}
        <div className="mt-4">{button}</div>
      </div>
    )
  }

  // band
  return (
    <div className="not-prose my-8 rounded-2xl bg-slate-900 px-6 py-8 text-center">
      <p className="text-lg font-bold text-white">{cta.heading}</p>
      {cta.body && <p className="mx-auto mt-2 max-w-xl text-sm text-slate-300">{cta.body}</p>}
      <div className="mt-4">{button}</div>
    </div>
  )
}
