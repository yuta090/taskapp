import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { LPHeader } from '@/components/lp/Header'
import { LPFooter } from '@/components/lp/Footer'
import { CtaBlock } from '@/components/blog/CtaBlock'
import { getPublishedPost } from '@/lib/blog/posts'
import { isKnownAuthorName, PRIMARY_AUTHOR } from '@/lib/task6/authors'
import { renderMarkdownToHtml, splitOnCtaPlaceholder } from '@/lib/markdown'

export const dynamic = 'force-dynamic'

const SITE = 'https://agentpm.app'

interface Props {
  params: Promise<{ slug: string }>
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params
  const post = await getPublishedPost(slug)
  if (!post) return { title: '記事が見つかりません | TASK6' }

  const url = `${SITE}/task6/${post.slug}`
  return {
    title: `${post.title} | TASK6`,
    description: post.description ?? undefined,
    alternates: { canonical: url },
    robots: post.noindex ? { index: false, follow: false } : undefined,
    openGraph: {
      title: post.title,
      description: post.description ?? undefined,
      url,
      type: 'article',
      locale: 'ja_JP',
      ...(post.cover_image_url ? { images: [{ url: post.cover_image_url }] } : {}),
    },
  }
}

export default async function BlogArticlePage({ params }: Props) {
  const { slug } = await params
  const post = await getPublishedPost(slug)
  if (!post) notFound()

  const { before, after, hasPlaceholder } = splitOnCtaPlaceholder(post.body_md)
  const beforeHtml = await renderMarkdownToHtml(before)
  const afterHtml = hasPlaceholder ? await renderMarkdownToHtml(after) : ''

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: post.title,
    description: post.description ?? undefined,
    datePublished: post.published_at ?? undefined,
    author: post.author_name
      ? {
          '@type': 'Person',
          name: post.author_name,
          // 著者プロフィールに紐づけて「誰が書いたか」を機械可読にする(E-E-A-T)
          // @idはプロフィール側のPersonと同一(検索エンジンが同一人物と結合できる)
          ...(isKnownAuthorName(post.author_name)
            ? { '@id': `${SITE}/task6/author#person`, url: `${SITE}/task6/author` }
            : {}),
        }
      : undefined,
    mainEntityOfPage: `${SITE}/task6/${post.slug}`,
    ...(post.cover_image_url ? { image: post.cover_image_url } : {}),
  }

  return (
    <main className="font-sans antialiased text-slate-900 bg-surface">
      <LPHeader />
      <script
        type="application/ld+json"
        // DB由来のtitle等が混ざるため、</script>混入によるscript脱出を防ぐ
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c') }}
      />
      <article className="mx-auto max-w-3xl px-5 pb-20 pt-28">
        <header className="mb-10">
          <div className="mb-4 flex items-center gap-2 text-sm">
            <Link href="/task6" className="font-bold tracking-tight">
              <span className="text-slate-900">TASK</span>
              <span className="text-amber-500">6</span>
            </Link>
            {post.tags.slice(0, 3).map((t) => (
              <span
                key={t}
                className="rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-semibold text-amber-700"
              >
                {t}
              </span>
            ))}
          </div>
          <h1 className="text-3xl font-bold leading-snug tracking-tight text-slate-900 md:text-4xl">
            {post.title}
          </h1>
          {post.description && (
            <p className="mt-4 border-l-4 border-amber-300 pl-4 text-lg leading-relaxed text-slate-600">
              {post.description}
            </p>
          )}
          <div className="mt-5 flex items-center gap-3 text-sm text-slate-500">
            {post.published_at && (
              <time dateTime={post.published_at}>
                {new Date(post.published_at).toLocaleDateString('ja-JP', {
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric',
                })}
              </time>
            )}
            {post.author_name &&
              (isKnownAuthorName(post.author_name) ? (
                <Link
                  href="/task6/author"
                  className="underline decoration-slate-300 underline-offset-2 hover:text-slate-700"
                >
                  {post.author_name}
                </Link>
              ) : (
                <span>{post.author_name}</span>
              ))}
          </div>
        </header>

        {post.cover_image_url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={post.cover_image_url}
            alt=""
            className="mb-8 w-full rounded-2xl object-cover"
          />
        )}

        {/*
          読みやすさのリズム: 地の文が続くページは内容が良くても読み飛ばされる。箇条書きと引用に
          「面」を当てて、スクロール中に一定間隔で見た目が変わるようにする。
          記事本文のMarkdownはサニタイザ(rehype-sanitize)を通り class や生HTMLが落ちるため、
          執筆側では面を作れない。ここ(テンプレート)で当てるのが唯一の場所。
          ※純粋な見た目の指定のためテストは書かない(CLAUDE.mdのTDD例外)。
        */}
        <div
          className="prose prose-slate max-w-none prose-headings:scroll-mt-24
            prose-ul:my-6 prose-ul:rounded-xl prose-ul:bg-slate-50 prose-ul:py-4 prose-ul:pr-6 prose-ul:pl-10
            prose-ol:my-6 prose-ol:rounded-xl prose-ol:bg-slate-50 prose-ol:py-4 prose-ol:pr-6 prose-ol:pl-10
            prose-li:my-1
            prose-blockquote:not-italic prose-blockquote:rounded-r-xl prose-blockquote:border-l-4
            prose-blockquote:border-amber-400 prose-blockquote:bg-amber-50 prose-blockquote:py-2 prose-blockquote:pr-4"
        >
          <div dangerouslySetInnerHTML={{ __html: beforeHtml }} />
          {hasPlaceholder && post.inline_cta && (
            <CtaBlock cta={post.inline_cta} articleSlug={post.slug} />
          )}
          {hasPlaceholder && <div dangerouslySetInnerHTML={{ __html: afterHtml }} />}
        </div>

        {post.footer_cta && (
          <div className="mt-12">
            <CtaBlock cta={post.footer_cta} articleSlug={post.slug} />
          </div>
        )}

        {/* 著者カード(E-E-A-T: 誰が書いたかを記事末尾でも示す) */}
        {post.author_name && isKnownAuthorName(post.author_name) && (
          <aside className="mt-14 flex items-start gap-4 rounded-2xl border border-slate-100 bg-slate-50/60 p-6">
            <div
              aria-hidden="true"
              className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-amber-500 text-lg font-bold text-white"
            >
              {PRIMARY_AUTHOR.name.slice(0, 1)}
            </div>
            <div>
              <p className="text-sm font-bold text-slate-900">
                この記事を書いた人:{' '}
                <Link href="/task6/author" className="text-amber-600 hover:text-amber-700">
                  {PRIMARY_AUTHOR.name}
                </Link>
              </p>
              <p className="mt-0.5 text-xs text-slate-500">{PRIMARY_AUTHOR.title}</p>
              <p className="mt-2 text-sm leading-relaxed text-slate-600">
                実際にあった出来事をもとに、ツールを使わなくても解決できる方法まで書くのがTASK6の方針です。
              </p>
            </div>
          </aside>
        )}

        <div className="mt-10">
          <Link href="/task6" className="text-sm font-semibold text-amber-600 hover:text-amber-700">
            ← TASK6の記事一覧へ
          </Link>
        </div>
      </article>
      <LPFooter />
    </main>
  )
}
