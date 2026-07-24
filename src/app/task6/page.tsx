import type { Metadata } from 'next'
import Link from 'next/link'
import { LPHeader } from '@/components/lp/Header'
import { LPFooter } from '@/components/lp/Footer'
import { listPublishedPosts } from '@/lib/blog/posts'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'TASK6（タスクシックス） | 仕事がまわる学びのメディア',
  description:
    'タスク管理・プロジェクト管理・仕事の進め方を、実際にあった話から学べるメディア。ツールを入れたのに回らない、を直します。',
  alternates: { canonical: 'https://agentpm.app/task6' },
}

export default async function Task6IndexPage() {
  const posts = await listPublishedPosts()

  return (
    <main className="font-sans antialiased text-slate-900 bg-white">
      <LPHeader />
      <div className="mx-auto max-w-3xl px-5 pb-20 pt-24">
        <h1 className="text-3xl font-bold tracking-tight text-slate-900">TASK6</h1>
        <p className="mt-2 text-slate-600">
          仕事がまわる学びのメディア。タスク管理・プロジェクト管理・仕事の進め方を、実話から学ぶ。
        </p>

        {posts.length === 0 ? (
          <p className="mt-12 text-slate-400">まだ記事がありません。</p>
        ) : (
          <ul className="mt-10 divide-y divide-slate-100">
            {posts.map((p) => (
              <li key={p.slug} className="py-6">
                <Link href={`/task6/${p.slug}`} className="group block">
                  <h2 className="text-lg font-semibold text-slate-900 group-hover:text-amber-600">
                    {p.title}
                  </h2>
                  {p.description && (
                    <p className="mt-1.5 line-clamp-2 text-sm text-slate-600">{p.description}</p>
                  )}
                  <div className="mt-2 flex items-center gap-3 text-xs text-slate-400">
                    {p.published_at && (
                      <time dateTime={p.published_at}>
                        {new Date(p.published_at).toLocaleDateString('ja-JP')}
                      </time>
                    )}
                    {p.tags.slice(0, 3).map((t) => (
                      <span key={t} className="rounded bg-slate-100 px-2 py-0.5">
                        {t}
                      </span>
                    ))}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
      <LPFooter />
    </main>
  )
}
