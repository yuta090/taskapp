import type { Metadata } from 'next'
import Link from 'next/link'
import { LPHeader } from '@/components/lp/Header'
import { LPFooter } from '@/components/lp/Footer'
import { PRIMARY_AUTHOR } from '@/lib/task6/authors'

// 著者情報はコード定義なので完全静的にできる
export const dynamic = 'force-static'

const SITE = 'https://agentpm.app'
const PAGE_URL = `${SITE}/task6/author`

export const metadata: Metadata = {
  title: `${PRIMARY_AUTHOR.name}（${PRIMARY_AUTHOR.title}） | TASK6`,
  description:
    'TASK6（タスクシックス）の記事を執筆・監修している著者のプロフィールです。',
  alternates: { canonical: PAGE_URL },
  openGraph: {
    title: `${PRIMARY_AUTHOR.name} | TASK6`,
    url: PAGE_URL,
    type: 'profile',
    locale: 'ja_JP',
  },
}

export default function AuthorPage() {
  const author = PRIMARY_AUTHOR

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'ProfilePage',
    mainEntity: {
      '@type': 'Person',
      name: author.name,
      alternateName: author.legalName,
      jobTitle: author.title,
      description: author.bio.join(' '),
      url: PAGE_URL,
      sameAs: author.sameAs,
      worksFor: {
        '@type': 'Organization',
        name: '株式会社ソレカラ',
        url: 'https://skara.co.jp',
      },
    },
  }

  return (
    <main className="font-sans antialiased text-slate-900 bg-white">
      <LPHeader />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <div className="mx-auto max-w-2xl px-5 pb-20 pt-24">
        <p className="text-sm font-semibold text-amber-600">TASK6の著者</p>

        <div className="mt-4 flex items-center gap-4">
          <div
            aria-hidden="true"
            className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-amber-500 text-2xl font-bold text-white"
          >
            高
          </div>
          <div>
            <h1 className="text-2xl font-bold leading-tight tracking-tight text-slate-900">
              {author.name}
            </h1>
            <p className="mt-1 text-sm text-slate-500">{author.title}</p>
          </div>
        </div>

        <div className="mt-8 space-y-4">
          {author.bio.map((para) => (
            <p key={para} className="leading-relaxed text-slate-700">
              {para}
            </p>
          ))}
        </div>

        <div className="mt-10 rounded-2xl border-l-4 border-amber-400 bg-amber-50 px-5 py-4">
          <p className="text-sm font-bold text-slate-900">TASK6の編集方針</p>
          <ul className="mt-2 space-y-1 text-sm text-slate-600">
            <li>・実際にあった出来事をもとに書く（つくり話の事例を使わない）</li>
            <li>・ツールを使わなくても解決できる方法まで書く</li>
            <li>・専門用語はかみくだいて、初めての人にも読めるように書く</li>
          </ul>
        </div>

        <dl className="mt-10 rounded-2xl border border-slate-200 p-5 text-sm">
          <p className="mb-3 font-bold text-slate-900">運営会社</p>
          <div className="grid grid-cols-[7rem_1fr] gap-y-2">
            <dt className="text-slate-500">会社名</dt>
            <dd>
              <a
                href="https://skara.co.jp"
                target="_blank"
                rel="noopener noreferrer"
                className="text-amber-600 underline hover:text-amber-700"
              >
                株式会社ソレカラ
              </a>
            </dd>
            <dt className="text-slate-500">設立</dt>
            <dd>2020年</dd>
            <dt className="text-slate-500">事業内容</dt>
            <dd>
              AIサービスの開発・運用 / 業務自動化の受託開発 /
              タスク完遂の統合コンサルティング / AI内製化教育 / 採用支援
            </dd>
            <dt className="text-slate-500">運営サービス</dt>
            <dd>
              <Link href="/" className="text-amber-600 underline hover:text-amber-700">
                agentpm（タスク管理とAI秘書）
              </Link>
            </dd>
          </div>
        </dl>

        <div className="mt-10">
          <Link
            href="/task6"
            className="text-sm font-semibold text-amber-600 hover:text-amber-700"
          >
            ← TASK6の記事一覧へ
          </Link>
        </div>
      </div>
      <LPFooter />
    </main>
  )
}
