import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { LPHeader } from '@/components/lp/Header'
import { LPFooter } from '@/components/lp/Footer'
import { DownloadForm } from '@/components/blog/DownloadForm'
import { LEAD_MAGNETS, getLeadMagnet } from '@/lib/task6/leadMagnets'

// カタログはコード定義なのでビルド時に全ページを静的生成できる
export const dynamic = 'force-static'
export const dynamicParams = false

interface Props {
  params: Promise<{ key: string }>
}

export function generateStaticParams() {
  return Object.keys(LEAD_MAGNETS).map((key) => ({ key }))
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { key } = await params
  const magnet = getLeadMagnet(key)
  if (!magnet) return { title: 'テンプレートが見つかりません | TASK6' }

  return {
    title: `${magnet.title}（無料ダウンロード） | TASK6`,
    description: magnet.description,
    // メール登録と引き換えの配布ページなので検索結果には出さない
    robots: { index: false, follow: false },
  }
}

export default async function TemplateDownloadPage({ params }: Props) {
  const { key } = await params
  const magnet = getLeadMagnet(key)
  if (!magnet) notFound()

  return (
    <main className="font-sans antialiased text-slate-900 bg-white">
      <LPHeader />
      <div className="mx-auto max-w-xl px-5 pb-20 pt-24">
        <p className="text-sm font-semibold text-amber-600">無料テンプレート</p>
        <h1 className="mt-2 text-3xl font-bold leading-tight tracking-tight text-slate-900">
          {magnet.title}
        </h1>
        <p className="mt-4 text-slate-600">{magnet.description}</p>

        <ul className="mt-6 space-y-2">
          {magnet.bullets.map((bullet) => (
            <li key={bullet} className="flex items-start gap-2 text-sm text-slate-700">
              <span className="mt-0.5 text-amber-500" aria-hidden="true">
                ✓
              </span>
              {bullet}
            </li>
          ))}
        </ul>

        <div className="mt-8">
          <DownloadForm templateKey={magnet.key} />
        </div>
      </div>
      <LPFooter />
    </main>
  )
}
